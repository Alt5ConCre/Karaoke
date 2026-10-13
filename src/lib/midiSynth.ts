/**
 * KaraokeMidiPlayer — turns a parsed `MidiSong` into audible music using only
 * the Web Audio API. No samples, no soundfonts, no network calls: every tone
 * is synthesised on the fly with oscillators and a shared white-noise buffer.
 *
 * The browser cannot play `.kar`/`.mid`/`.midi` natively, so this is the "play
 * engine" behind the MIDI karaoke player. Volume shaping is crude on purpose —
 * it is a videoke toy, not a General MIDI module.
 */

import type { MidiSong } from './midi.ts'

type OscType = OscillatorType

interface Timbre {
  wave: OscType
  detune: number
  filterHz: number | null
  attack: number
  release: number
}

/** Map a General MIDI program number to a cheap, decent-sounding voice. */
export function timbreForProgram(program: number): Timbre {
  if (program <= 7) return { wave: 'triangle', detune: 6, filterHz: null, attack: 0.008, release: 0.1 }
  if (program <= 15) return { wave: 'sine', detune: 4, filterHz: null, attack: 0.01, release: 0.15 }
  if (program <= 23) return { wave: 'sawtooth', detune: 0, filterHz: 2200, attack: 0.01, release: 0.08 }
  if (program <= 39) return { wave: 'sawtooth', detune: -6, filterHz: 900, attack: 0.005, release: 0.09 }
  if (program <= 47) return { wave: 'sawtooth', detune: 5, filterHz: 2600, attack: 0.03, release: 0.18 }
  if (program <= 55) return { wave: 'triangle', detune: 3, filterHz: 1800, attack: 0.04, release: 0.2 }
  if (program <= 63) return { wave: 'sawtooth', detune: 0, filterHz: 3000, attack: 0.02, release: 0.12 }
  if (program <= 71) return { wave: 'sine', detune: 0, filterHz: null, attack: 0.03, release: 0.1 }
  if (program <= 79) return { wave: 'square', detune: 0, filterHz: null, attack: 0.008, release: 0.1 }
  if (program <= 87) return { wave: 'sawtooth', detune: 8, filterHz: 3200, attack: 0.005, release: 0.12 }
  if (program <= 95) return { wave: 'triangle', detune: 4, filterHz: 1600, attack: 0.08, release: 0.3 }
  if (program <= 103) return { wave: 'square', detune: 0, filterHz: null, attack: 0.002, release: 0.04 }
  if (program <= 111) return { wave: 'sine', detune: 0, filterHz: null, attack: 0.02, release: 0.12 }
  if (program <= 119) return { wave: 'square', detune: 0, filterHz: null, attack: 0.001, release: 0.03 }
  return { wave: 'square', detune: 0, filterHz: null, attack: 0.001, release: 0.05 }
}

const NOTE_FREQ = (key: number): number => 440 * Math.pow(2, (key - 69) / 12)

export class KaraokeMidiPlayer {
  onended: (() => void) | null = null

  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private programByChannel = new Map<number, number>()
  private scheduled: Array<{ stopAt: number }> = []
  private startCtxTime = 0
  private pausedAt = 0
  private playing = false
  private volume = 0.8
  private endTimer: ReturnType<typeof setInterval> | null = null

  private song: MidiSong

  constructor(song: MidiSong) {
    this.song = song
    for (const change of song.programChanges) {
      this.programByChannel.set(change.channel, change.program)
    }
  }

  get duration(): number {
    return this.song.durationSec
  }

  get currentTime(): number {
    if (!this.ctx) return 0
    if (!this.playing) return this.pausedAt
    return this.pausedAt + (this.ctx.currentTime - this.startCtxTime)
  }

  get isPlaying(): boolean {
    return this.playing
  }

  private ensureCtx(): AudioContext {
    if (this.ctx) return this.ctx
    const ctx = new AudioContext()
    this.ctx = ctx
    const master = ctx.createGain()
    master.gain.value = this.volume
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -18
    compressor.knee.value = 20
    compressor.ratio.value = 8
    compressor.attack.value = 0.005
    compressor.release.value = 0.25
    master.connect(compressor)
    compressor.connect(ctx.destination)
    this.master = master
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this.noise = buffer
    return ctx
  }

  /** Request to start (or resume) playback. False when the audio context is
   *  blocked and a later user gesture is needed. */
  play(): boolean {
    const ctx = this.ensureCtx()
    if (this.playing) return true
    if (ctx.state === 'suspended') {
      void ctx.resume()
      // Keep the button in the "paused" state; resume() resolves asynchronously
      // and the block only lifts on a real gesture anyway.
    }
    this.scheduleFrom(this.pausedAt)
    this.startCtxTime = ctx.currentTime
    this.playing = true
    this.startEndTimer()
    return ctx.state === 'running' || ctx.state === 'suspended'
  }

  pause(): void {
    if (!this.playing) return
    this.pausedAt = this.currentTime
    this.playing = false
    this.stopEndTimer()
  }

  stop(): void {
    this.cutAll()
    this.playing = false
    this.pausedAt = 0
    this.stopEndTimer()
  }

  seek(seconds: number): void {
    const target = Math.min(Math.max(seconds, 0), this.duration)
    this.cutAll()
    this.pausedAt = target
    if (this.playing && this.ctx) {
      this.startCtxTime = this.ctx.currentTime
      this.scheduleFrom(target)
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.min(Math.max(volume, 0), 1)
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02)
    }
  }

  destroy(): void {
    this.stop()
    if (this.ctx) {
      void this.ctx.close().catch((error: unknown) => void error)
      this.ctx = null
      this.master = null
      this.noise = null
    }
  }

  private programAt(channel: number): number {
    return this.programByChannel.get(channel) ?? 0
  }

  private scheduleFrom(offsetSec: number): void {
    const ctx = this.ensureCtx()
    if (!this.noise || !this.master) return
    const now = ctx.currentTime
    for (const note of this.song.notes) {
      const start = Math.max(note.startSec, offsetSec)
      if (start >= note.endSec) continue
      const nodeTime = now + (start - offsetSec)
      const dur = note.endSec - start
      const program = this.programAt(note.channel)
      if (note.channel === 9) this.scheduleDrum(nodeTime, note.key, note.velocity, dur)
      else this.scheduleTone(nodeTime, note.key, note.velocity, dur, program)
    }
  }

  private envelope(gain: GainNode, nodeTime: number, peak: number, dur: number, timbre: Timbre): void {
    gain.gain.setValueAtTime(0, nodeTime)
    gain.gain.linearRampToValueAtTime(peak, nodeTime + timbre.attack)
    const end = nodeTime + Math.max(dur, timbre.attack + 0.01)
    gain.gain.setValueAtTime(peak, Math.max(end - timbre.release, nodeTime + timbre.attack + 0.001))
    gain.gain.linearRampToValueAtTime(0, end)
  }

  private scheduleTone(nodeTime: number, key: number, velocity: number, dur: number, program: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const timbre = timbreForProgram(program)
    const peak = (velocity / 127) * 0.4
    const freq = NOTE_FREQ(key)

    const osc = ctx.createOscillator()
    osc.type = timbre.wave
    osc.frequency.value = freq
    const gain = ctx.createGain()
    this.envelope(gain, nodeTime, peak, dur, timbre)

    let head: AudioNode = osc
    if (timbre.filterHz) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = timbre.filterHz
      head.connect(filter)
      head = filter
    }
    head.connect(gain)
    gain.connect(master)

    osc.start(nodeTime)
    const stopAt = nodeTime + Math.max(dur, timbre.attack + 0.01) + 0.05
    osc.stop(stopAt)
    this.scheduled.push({ stopAt })

    if (timbre.detune) {
      const second = ctx.createOscillator()
      second.type = timbre.wave
      second.frequency.value = freq
      second.detune.value = timbre.detune
      const gain2 = ctx.createGain()
      this.envelope(gain2, nodeTime, peak * 0.35, dur, timbre)
      let head2: AudioNode = second
      if (timbre.filterHz) {
        const filter2 = ctx.createBiquadFilter()
        filter2.type = 'lowpass'
        filter2.frequency.value = timbre.filterHz
        head2.connect(filter2)
        head2 = filter2
      }
      head2.connect(gain2)
      gain2.connect(master)
      second.start(nodeTime)
      second.stop(stopAt)
      this.scheduled.push({ stopAt })
    }
  }

  private noiseBurst(nodeTime: number, dur: number, filterType: BiquadFilterType, filterFreq: number, peak: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master || !this.noise) return
    const source = ctx.createBufferSource()
    source.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = filterType
    filter.frequency.value = filterFreq
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(peak, nodeTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, nodeTime + dur)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    source.start(nodeTime)
    source.stop(nodeTime + dur)
    this.scheduled.push({ stopAt: nodeTime + dur })
  }

  private drumTone(nodeTime: number, freq: number, freqEnd: number, dur: number, peak: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, nodeTime)
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), nodeTime + dur)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(peak, nodeTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, nodeTime + dur)
    osc.connect(gain)
    gain.connect(master)
    osc.start(nodeTime)
    osc.stop(nodeTime + dur)
    this.scheduled.push({ stopAt: nodeTime + dur })
  }

  private scheduleDrum(nodeTime: number, key: number, velocity: number, dur: number): void {
    const v = velocity / 127
    switch (key) {
      case 35:
      case 36:
        this.drumTone(nodeTime, 150, 45, 0.18, v * 0.8)
        break
      case 38:
      case 40:
        this.noiseBurst(nodeTime, 0.14, 'bandpass', 2000, v * 0.55)
        this.drumTone(nodeTime, 200, 120, 0.08, v * 0.3)
        break
      case 39:
      case 52:
        this.noiseBurst(nodeTime, 0.18, 'bandpass', 1600, v * 0.5)
        break
      case 42:
      case 44:
        this.noiseBurst(nodeTime, Math.min(dur, 0.06), 'highpass', 7000, v * 0.35)
        break
      case 46:
        this.noiseBurst(nodeTime, Math.min(dur, 0.3), 'highpass', 6000, v * 0.4)
        break
      case 45:
        this.drumTone(nodeTime, 160, 90, 0.25, v * 0.6)
        break
      case 47:
        this.drumTone(nodeTime, 130, 70, 0.28, v * 0.6)
        break
      case 48:
      case 50:
        this.drumTone(nodeTime, 100, 55, 0.3, v * 0.65)
        break
      case 49:
      case 57:
        this.noiseBurst(nodeTime, 0.9, 'highpass', 5000, v * 0.4)
        break
      case 51:
      case 59:
        this.drumTone(nodeTime, 300, 250, 0.35, v * 0.35)
        this.drumTone(nodeTime, 350, 300, 0.4, v * 0.25)
        break
      default:
        this.noiseBurst(nodeTime, 0.05, 'highpass', 4000, v * 0.3)
    }
  }

  private cutAll(): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    for (const node of this.scheduled) {
      if (node.stopAt > t) {
        this.master.gain.cancelScheduledValues(t)
        this.master.gain.setValueAtTime(this.volume, t)
      }
    }
    this.scheduled = []
  }

  private startEndTimer(): void {
    if (this.endTimer) return
    this.endTimer = setInterval(() => {
      if (!this.playing || this.song.notes.length === 0) return
      if (this.currentTime >= this.duration) {
        this.playing = false
        this.pausedAt = this.duration
        this.stopEndTimer()
        this.cutAll()
        this.onended?.()
      }
    }, 200)
  }

  private stopEndTimer(): void {
    if (this.endTimer) {
      clearInterval(this.endTimer)
      this.endTimer = null
    }
  }
}