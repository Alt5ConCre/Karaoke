/**
 * Real microphone pitch analysis.
 *
 * Pure functions and a tiny accumulator — no audio APIs, no WebAudio, no DOM.
 * Everything here runs equally well in Node (for the logic suite) and in the
 * browser (fed by an AnalyserNode), so the scoring math is locked down by tests
 * instead of by headless microphone hardware.
 *
 * Scoring is deliberately conservative: a song without a reference melody in
 * `notes.json` is never given a made-up number.
 */

import type { PitchReading, ReferenceNote } from '../types.ts'

export const A4_MIDI = 69
export const A4_FREQ = 440
/** Semitones either side of the expected note that still count as "on pitch". */
export const PITCH_TOLERANCE_ST = 2
/** RMS loudness below which a frame counts as silence. */
export const SILENCE_RMS = 0.012
/** Minimum autocorrelation clarity for a frame to be treated as voiced. */
export const PITCH_CLARITY = 0.55

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Frequency (Hz) for a MIDI note number. 69 (A4) = 440 Hz. */
export function freqFromMidi(midi: number): number {
  return A4_FREQ * 2 ** ((midi - A4_MIDI) / 12)
}

/** MIDI note number for a frequency in Hz (rounds to the nearest note). */
export function midiFromFreq(freq: number): number {
  if (!freq || !Number.isFinite(freq) || freq <= 0) return NaN
  return Math.round(A4_MIDI + 12 * Math.log2(freq / A4_FREQ))
}

/** Human note name ("C4", "F#3") for a MIDI note number. */
export function noteNameFromMidi(midi: number): string {
  const pc = ((Math.round(midi) % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[pc]}${octave}`
}

/** MIDI note number for a human name like "C4", "A#3" or "Gb2". */
export function midiFromName(name: string): number | undefined {
  const match = /^\s*([A-Ga-g])([#b]?)\s*(-?\d+)\s*$/.exec(name)
  if (!match) return undefined
  const letter = match[1].toUpperCase()
  const accidental = match[2]
  const octave = Number(match[3])
  let pc = letter.charCodeAt(0) - 65 // A=0, B=1, C=2, D=3, E=4, F=5, G=6
  // Chromatic scale order: C=0 D=2 E=4 F=5 G=7 A=9 B=11
  pc = [9, 11, 0, 2, 4, 5, 7][pc]
  if (accidental === '#') pc += 1
  if (accidental === 'b') pc -= 1
  return (octave + 1) * 12 + pc
}

/** Shortest circular distance in semitones (octaves fold into the same note). */
export function semitoneDistance(aMidi: number, bMidi: number): number {
  const d = ((aMidi - bMidi) % 12 + 12) % 12
  return Math.min(d, 12 - d)
}

/** True when the sung note is within `semitones` of the expected note. */
export function noteInTolerance(
  expectedMidi: number,
  detectedMidi: number,
  semitones = PITCH_TOLERANCE_ST,
): boolean {
  return semitoneDistance(expectedMidi, detectedMidi) <= semitones
}

/**
 * Detect the fundamental of one analysis window.
 * `buffer` is time-domain samples in [-1, 1]; windowSize is how many to use.
 * Returns undefined fundamental when the frame is silent or not voiced enough,
 * so a hiss, clap or dead mic never masquerades as a sung note.
 */
export function detectPitch(buffer: Float32Array, sampleRate: number, windowSize: number): PitchReading {
  const size = Math.max(8, Math.min(buffer.length, windowSize))
  const win = buffer.length === size ? buffer : buffer.subarray(0, size)

  let sumSq = 0
  for (let i = 0; i < size; i += 1) {
    const v = win[i] as number
    sumSq += v * v
  }
  const rms = Math.sqrt(sumSq / size)
  if (rms < SILENCE_RMS) {
    return { freq: undefined, midi: undefined, rms, clarity: 0 }
  }

  // Autocorrelation over the valid pitch lag range (approx 60–500 Hz).
  const minLag = Math.max(2, Math.floor(sampleRate / 500))
  const maxLag = Math.min(size, Math.floor(sampleRate / 60))
  let bestLag = -1
  let bestCorr = 0
  for (let lag = minLag; lag <= maxLag && lag < size; lag += 1) {
    let corr = 0
    for (let i = 0; i < size - lag; i += 1) {
      corr += (win[i] as number) * (win[i + lag] as number)
    }
    corr /= size - lag
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }
  const clarity = maxLag > minLag ? bestCorr / Math.max(1e-9, sumSq / size) : 0
  if (bestLag <= 0 || clarity < PITCH_CLARITY) {
    return { freq: undefined, midi: undefined, rms, clarity }
  }

  // Parabolic interpolation around the best lag for sub-sample accuracy.
  const lo = (win[bestLag - 1] as number) ?? 0
  const mid = win[bestLag] as number
  const hi = (win[bestLag + 1] as number) ?? 0
  const denom = lo - 2 * mid + hi
  let refine = denom !== 0 ? (lo - hi) / (2 * denom) : 0
  refine = Math.max(-0.5, Math.min(0.5, refine))
  const lag = bestLag + refine
  const freq = sampleRate / lag
  const midi = midiFromFreq(freq)
  return { freq, midi: Number.isNaN(midi) ? undefined : midi, rms, clarity }
}

/**
 * The reference-note window that covers `time`. Notes must be sorted by time
 * (parseReferenceNotes does this for you). Returns the active note and where it
 * ends, or null when no note is expected yet/any more.
 */
export function referenceNoteAt(
  notes: ReferenceNote[],
  time: number,
): { note: ReferenceNote; end: number } | null {
  let current: ReferenceNote | null = null
  let currentIndex = -1
  for (let i = 0; i < notes.length; i += 1) {
    const n = notes[i] as ReferenceNote
    if (n.time <= time + 0.05) {
      current = n
      currentIndex = i
    } else {
      break
    }
  }
  if (!current) return null
  const end = currentIndex + 1 < notes.length ? (notes[currentIndex + 1] as ReferenceNote).time : Infinity
  return { note: current, end }
}

/**
 * Normalise a notes.json into a sorted list of ReferenceNote.
 * Accepts several shapes so a song pack made by hand stays forgiving:
 *   [60, 62, 64, ...]                      // one note per second
 *   [{"t": 0, "note": "C4"}, ...]          // keyed references
 *   {"notes": [ ... ], "unit": "sec"}      // wrapped
 *   {"melody": [ ... ]}
 */
export function parseReferenceNotes(data: unknown): ReferenceNote[] {
  let raw: unknown[] = []
  if (Array.isArray(data)) {
    raw = data
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const list = obj.notes ?? obj.melody ?? obj.referenceMelody
    if (Array.isArray(list)) raw = list
  }
  if (raw.length === 0) throw new Error('notes.json has no notes array')

  const out: ReferenceNote[] = []
  raw.forEach((entry, index) => {
    let time: number | undefined
    let midi: number | undefined
    if (typeof entry === 'number') {
      time = index
      midi = Math.round(entry)
    } else if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>
      const t = e.t ?? e.time ?? e.sec ?? e.start ?? (e.at === undefined ? undefined : Number(e.at))
      time = typeof t === 'number' ? t : t !== undefined ? Number(t) : undefined
      const m = e.midi ?? e.noteNo ?? e.pitch
      const named = e.note ?? e.name ?? e.letter
      if (typeof m === 'number') midi = Math.round(m)
      else if (typeof named === 'string') midi = midiFromName(named)
      else if (typeof e.tone === 'number') midi = Math.round(e.tone)
    }
    if (time === undefined || Number.isNaN(time) || midi === undefined || !Number.isFinite(midi)) {
      throw new Error(`notes.json entry #${index} is not a usable note (need time + midi/note)`)
    }
    out.push({ time, midi, name: noteNameFromMidi(midi) })
  })
  out.sort((a, b) => a.time - b.time)
  return out
}

/** True when two note names are the same pitch ("" safe). */
export function sameNoteName(a: string, b: string): boolean {
  if (!a || !b) return false
  return midiFromName(a) === midiFromName(b)
}

/**
 * Accumulates genuine measured frames during one performance.
 * Every frame where a reference note is expected scores a hit (on pitch) or a
 * miss; silence counts as a miss, because the note was expected and not sung.
 * The final number is literally hits ÷ evaluated, so it can never exceed 100 or
 * go below 0, and it is never produced when nothing could be evaluated.
 */
export class ScoreTracker {
  private evaluated = 0
  private hits = 0
  private noPitch = 0

  reset(): void {
    this.evaluated = 0
    this.hits = 0
    this.noPitch = 0
  }

  /** Score one frame. `expected` is the active reference note midi or null. */
  observe(expected: number | null, reading: PitchReading): void {
    if (expected === null || expected === undefined) return
    this.evaluated += 1
    if (reading.midi === undefined) {
      this.noPitch += 1
      return
    }
    if (noteInTolerance(expected, reading.midi)) this.hits += 1
  }

  frameView(): { evaluated: number; hits: number; noPitch: number } {
    return { evaluated: this.evaluated, hits: this.hits, noPitch: this.noPitch }
  }

  /** Integer 0-100 score, or null when no frame could be evaluated. */
  score(): number | null {
    if (this.evaluated === 0) return null
    return Math.round((100 * this.hits) / this.evaluated)
  }
}

/** Clamp an arbitrary number to the score scale. */
export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}