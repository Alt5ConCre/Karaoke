/**
 * A tiny pure parser for Standard MIDI Files (.mid/.midi) and Karaoke MIDI
 * (.kar). It pulls out the note timings, tempo map and — for karaoke files —
 * the tag metadata and the time-stamped lyric syllables, which is all the
 * videoke player needs to synthesize the song and highlight the words.
 *
 * No React, no DOM, no WebAudio: this module is imported by both the UI and
 * the Node test harness.
 */

export interface MidiSyllable {
  /** Word / word fragment, e.g. "Hel" or "rld". */
  text: string
  /** Absolute time in seconds when the syllable starts (based on the tempo map). */
  startSec: number
  /** The next syllable in the song starts here (or the song ends). */
  endSec: number
  /** Where this syllable's text event begins, in MIDI ticks. */
  startTick: number
}

export interface MidiLine {
  text: string
  syllables: MidiSyllable[]
  startSec: number
  endSec: number
}

export interface MidiNote {
  channel: number
  key: number
  velocity: number
  startTick: number
  endTick: number
  startSec: number
  endSec: number
}

export interface MidiProgramChange {
  channel: number
  tick: number
  program: number
}

export interface MidiSong {
  title: string
  artist: string
  language: string
  /** True when the file is a karaoke track (KMIDI KARAOKE banner present). */
  isKar: boolean
  format: number
  division: number
  /** null for SMPTE division, where ticks measure frames instead of a beat. */
  ticksPerQuarter: number | null
  durationSec: number
  /** Flattened syllables across every line, in time order — for highlighting. */
  syllables: MidiSyllable[]
  lines: MidiLine[]
  notes: MidiNote[]
  programChanges: MidiProgramChange[]
  bytes: Uint8Array
}

/** Tempo (µs per quarter note) Blender-ish default when no tempo meta exists. */
export const DEFAULT_MICROSECONDS_PER_QUARTER = 500_000

const KARAOKE_BANNER_RE = /KMIDI KARAOKE/i
/** @K is the KMIDI banner pseudo-tag, not user metadata. */
const KARAOKE_TAG_KEYS = new Set(['T', 'L', 'W', 'V', 'C', 'M', 'R', 'G', 'I', 'H', 'E'])

function decodeText(bytes: Uint8Array, lo: number, len: number): string {
  const slice = bytes.subarray(lo, lo + len)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(slice)
  } catch {
    return new TextDecoder('latin1').decode(slice)
  }
}

/**
 * Parse a Standard MIDI File. Returns null when the bytes are not MIDI at all
 * (so callers can show "not a playable file"), and a `MidiSong` — possibly
 * with empty lyrics — for anything that has a valid header.
 */
export function parseMidiKaraoke(bytes: Uint8Array): MidiSong | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 14) return null
  if (tagAscii(bytes, 0) !== 'MThd') return null

  const format = view.getUint16(8, false)
  const trackCount = view.getUint16(10, false)
  const division = view.getUint16(12, false)

  let ticksPerQuarter: number | null
  let secPerTick: number
  if (division & 0x8000) {
    const frames = 256 - ((division >> 8) & 0xff) // high byte is 8-bit two's complement: 0xE8 → 24, 0xE7 → 25, 0xE3 → 29.97
    const ticksPerFrame = division & 0x00ff
    ticksPerQuarter = null
    secPerTick = 1 / (frames * ticksPerFrame)
  } else {
    ticksPerQuarter = division
    secPerTick = null as never
  }

  let offset = 14
  const tracks: { text: { tick: number; text: string }[]; notes: RawNote[]; programChanges: MidiProgramChange[]; tempos: { tick: number; spq: number }[]; lastTick: number }[] = []

  for (let t = 0; t < trackCount; t++) {
    if (offset + 8 > bytes.byteLength) break
    if (tagAscii(bytes, offset) !== 'MTrk') break
    const trackLen = view.getUint32(offset + 4, false)
    const trackEnd = offset + 8 + trackLen
    if (trackEnd > bytes.byteLength) break
    const events = {
      text: [] as { tick: number; text: string }[],
      notes: [] as RawNote[],
      programChanges: [] as MidiProgramChange[],
      tempos: [] as { tick: number; spq: number }[],
      lastTick: 0,
    }
    let pos = offset + 8
    let running = -1
    let absTick = 0
    while (pos < trackEnd) {
      let [delta, next] = readVlq(bytes, pos)
      pos = next
      absTick += delta // deltas accumulate; MIDI timestamps are relative
      const status = bytes[pos]
      if (status & 0x80) {
        running = status
        pos++
      } else if (running === -1) {
        break
      }
      const cmd = running & 0xf0
      const chan = running & 0x0f
      if (running === 0xff) {
        const metaType = bytes[pos++]
        const [len, after] = readVlq(bytes, pos)
        pos = after
        if (metaType === 0x01 || metaType === 0x05 || metaType === 0x03) {
          events.text.push({ tick: absTick, text: decodeText(bytes, pos, len) })
        } else if (metaType === 0x51 && len >= 3) {
          const spq = (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2]
          if (spq > 0) events.tempos.push({ tick: absTick, spq })
        }
        pos += len
      } else if (running === 0xf0 || running === 0xf7) {
        const [, after] = readVlq(bytes, pos)
        pos = after
        continue
      } else if (cmd === 0x80 || (cmd === 0x90 && bytes[pos + 1] === 0)) {
        // note off — must precede the 0x90 note-on branch or running-status
        // 0x90/vel-0 messages are swallowed as (useless) zero-velocity note-ons
        const key = bytes[pos]
        pos += 2
        events.notes.push({ channel: chan, key, velocity: 0, endTick: absTick })
      } else if (cmd === 0x90) {
        const key = bytes[pos]
        const vel = bytes[pos + 1]
        pos += 2
        events.notes.push({ channel: chan, key, velocity: vel, startTick: absTick })
      } else if (cmd === 0xc0) {
        events.programChanges.push({ channel: chan, tick: absTick, program: bytes[pos] })
        pos += 1
      } else if (cmd === 0xd0) {
        pos += 1
      } else {
        pos += 2
      }
      events.lastTick = Math.max(events.lastTick, absTick)
    }
    tracks.push(events)
    offset = trackEnd
  }

  const allText: { tick: number; text: string }[] = []
  const allNotesRaw: RawNote[] = []
  const allPrograms: MidiProgramChange[] = []
  const tempos: { tick: number; spq: number }[] = []
  let lastTick = 0
  for (const events of tracks) {
    allText.push(...events.text)
    allNotesRaw.push(...events.notes)
    allPrograms.push(...events.programChanges)
    tempos.push(...events.tempos)
    lastTick = Math.max(lastTick, events.lastTick)
  }
  allText.sort((a, b) => a.tick - b.tick)
  tempos.sort((a, b) => a.tick - b.tick)
  if (tempos.length === 0 || tempos[0].tick > 0) tempos.unshift({ tick: 0, spq: DEFAULT_MICROSECONDS_PER_QUARTER })

  const isKar = allText.some((m) => KARAOKE_BANNER_RE.test(m.text))

  const tickToSec = makeTickToSec(secPerTick, division, ticksPerQuarter, tempos)

  const { lines, syllables } = buildLyrics(allText, tickToSec, isKar)
  const meta = extractTags(allText)
  const durationSec = tickToSec(lastTick)

  const notes = resolveNotes(allNotesRaw, tickToSec)

  return {
    title: meta.title || meta.trackName || (isKar ? 'Karaoke track' : ''),
    artist: meta.artist,
    language: meta.language,
    isKar,
    format,
    division,
    ticksPerQuarter,
    durationSec,
    syllables,
    lines,
    notes,
    programChanges: allPrograms.sort((a, b) => a.tick - b.tick),
    bytes,
  }
}

interface RawNote {
  channel: number
  key: number
  velocity: number
  startTick?: number
  endTick?: number
}

function resolveNotes(raw: RawNote[], tickToSec: (tick: number) => number): MidiNote[] {
  const active = new Map<number, RawNote>()
  const done: MidiNote[] = []
  for (const note of raw) {
    const sig = (note.channel << 8) | note.key
    if (note.endTick !== undefined) {
      const open = active.get(sig)
      if (open) {
        active.delete(sig)
        done.push({
          channel: open.channel,
          key: open.key,
          velocity: open.velocity,
          startTick: open.startTick!,
          endTick: note.endTick,
          startSec: tickToSec(open.startTick!),
          endSec: tickToSec(note.endTick),
        })
      }
    } else if (note.velocity > 0) {
      const prev = active.get(sig)
      if (prev) active.delete(sig)
      active.set(sig, note)
    }
  }
  return done.sort((a, b) => a.startTick - b.startTick)
}

function extractTags(texts: { tick: number; text: string }[]): { title: string; artist: string; language: string; trackName: string } {
  const meta: { title?: string; artist?: string; language?: string; trackName?: string } = {}
  const tagRe = /@([A-Za-z])([^@\r\n]*)/g
  for (const { text } of texts) {
    for (const m of text.matchAll(tagRe)) {
      const key = m[1].toUpperCase()
      if (!KARAOKE_TAG_KEYS.has(key)) continue
      const value = m[2].trim()
      if (key === 'T' && !meta.title) meta.title = value
      else if ((key === 'V' || key === 'W') && !meta.artist) meta.artist = value
      else if (key === 'L' && !meta.language) meta.language = value
    }
  }
  if (!meta.title) {
    for (const { text } of texts) {
      const line = text.trim()
      if (line && !line.startsWith('@')) {
        meta.trackName = line
        break
      }
    }
  }
  return {
    title: meta.title ?? '',
    artist: meta.artist ?? '',
    language: meta.language ?? '',
    trackName: meta.trackName ?? '',
  }
}

function buildLyrics(texts: { tick: number; text: string }[], tickToSec: (tick: number) => number, isKar: boolean): { lines: MidiLine[]; syllables: MidiSyllable[] } {
  const dummies: { text: string; startSec: number; startTick: number }[] = []
  const tagRe = /@[A-Za-z][^@\r\n]*/g
  for (const { tick, text } of texts) {
    if (!isKar) continue
    const clean = text.replace(tagRe, '')
    let current = ''
    let lineSyllables: { text: string; startSec: number; startTick: number }[] = []
    const flush = () => {
      const trimmed = current.trim()
      if (trimmed) lineSyllables.push({ text: trimmed, startSec: tickToSec(tick), startTick: tick })
      current = ''
    }
    const commitLine = () => {
      if (lineSyllables.length) {
        dummies.push(...lineSyllables)
        lineSyllables = []
      }
    }
    for (const ch of clean) {
      const code = ch.charCodeAt(0)
      if (ch === '\\') {
        flush()
        commitLine()
      } else if (ch === '/') {
        flush()
      } else if (code < 0x20 && code !== 0x09) {
        // NUL (common at the top of a KMIDI banner) and other control chars are separators; tab is kept.
      } else {
        current += ch
      }
    }
    flush()
    commitLine()
  }

  const flat: MidiSyllable[] = []
  for (let i = 0; i < dummies.length; i++) {
    const s = dummies[i]
    const next = dummies[i + 1]
    const endSec = next ? next.startSec : Number.MAX_SAFE_INTEGER
    flat.push({ text: s.text, startSec: s.startSec, endSec, startTick: s.startTick })
  }

  return { lines: groupFlat(flat), syllables: flat }
}

function groupFlat(flat: MidiSyllable[]): MidiLine[] {
  const lines: MidiLine[] = []
  let current: MidiSyllable[] = []
  for (const s of flat) {
    if (current.length && s.startTick !== current[current.length - 1].startTick) {
      lines.push(makeLine(current))
      current = []
    }
    current.push(s)
  }
  if (current.length) lines.push(makeLine(current))
  return lines
}

function makeLine(syllables: MidiSyllable[]): MidiLine {
  return {
    text: syllables.map((s) => s.text).join(' '),
    syllables,
    startSec: syllables[0].startSec,
    endSec: syllables[syllables.length - 1].endSec,
  }
}

function makeTickToSec(
  secPerTick: number,
  division: number,
  ticksPerQuarter: number | null,
  tempos: { tick: number; spq: number }[],
): (tick: number) => number {
  if (ticksPerQuarter === null) {
    return (tick) => tick * secPerTick
  }
  return (tick) => {
    let sec = 0
    let cur = 0
    let spq = DEFAULT_MICROSECONDS_PER_QUARTER
    for (const t of tempos) {
      if (t.tick > tick) break
      sec += ((t.tick - cur) / division) * (spq / 1_000_000)
      spq = t.spq
      cur = t.tick
    }
    sec += ((tick - cur) / division) * (spq / 1_000_000)
    return sec
  }
}

function readVlq(bytes: Uint8Array, pos: number): [number, number] {
  let value = 0
  while (pos < bytes.length) {
    const b = bytes[pos++]
    value = (value << 7) | (b & 0x7f)
    if (!(b & 0x80)) break
  }
  return [value, pos]
}

function tagAscii(bytes: Uint8Array, pos: number): string {
  return String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3])
}