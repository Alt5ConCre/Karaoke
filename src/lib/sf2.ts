/**
 * sf2.ts — a small, dependency-free SoundFont 2 (`.sf2`) reader.
 *
 * The browser cannot render a `.sf2` on its own, so this turns the RIFF/sfbk
 * container into plain data: the 16-bit PCM sample bank, the sample headers,
 * the instrument zones and the preset zones. `pickVoice` then reduces "play
 * program P, note K, velocity V" to a single sample plus a pitch ratio, which
 * is all the Web Audio sampler in `midiSynth.ts` needs.
 *
 * Scope is deliberately a videoke toy, not a spec-complete synth: it reads the
 * level-1 generators that decide *which* sample plays and *how it is tuned*
 * (sampleID, key/velocity ranges, root key, coarse/fine tune, sample modes,
 * attenuation, pan, loop offsets). Modulators and the LFO/envelope generators
 * are parsed past, not applied.
 */

export interface Sf2Sample {
  name: string
  /** First frame of the sample in the shared PCM bank. */
  start: number
  /** One past the last frame (exclusive), matching Web Audio loop semantics. */
  end: number
  startLoop: number
  endLoop: number
  sampleRate: number
  /** MIDI key the sample was recorded at. */
  originalPitch: number
  /** Correction in cents applied to `originalPitch`. */
  pitchCorrection: number
}

/** A resolved "what to play for this note" answer. */
export interface Sf2Voice {
  sampleIndex: number
  /** MIDI key the chosen sample sounds at, after coarse/fine correction. */
  rootKey: number
  /** Extra detune in semitones (coarse + fine/100 + pitch correction/100). */
  tune: number
  loop: boolean
  /** Absolute frame bounds inside the PCM bank, already offset-adjusted. */
  start: number
  end: number
  loopStart: number
  loopEnd: number
  /** Volume attenuation in centibels (100 cb = -10 dB). */
  attenuationCb: number
  /** -1 (left) .. 1 (right). */
  pan: number
}

interface PresetZone {
  keyLow: number
  keyHigh: number
  velLow: number
  velHigh: number
  instrument: number
  coarseTune: number
  fineTune: number
  attenuationCb: number
  pan: number
}

interface InstrumentZone {
  keyLow: number
  keyHigh: number
  velLow: number
  velHigh: number
  sampleIndex: number
  rootKey: number | null
  coarseTune: number
  fineTune: number
  sampleModes: number
  attenuationCb: number
  pan: number
  startOff: number
  endOff: number
  loopStartOff: number
  loopEndOff: number
}

interface Preset {
  name: string
  program: number
  bank: number
  zones: PresetZone[]
}

interface Instrument {
  name: string
  zones: InstrumentZone[]
}

// --- generator operators (SF2 §8.1.2) --------------------------------------
const GEN_ATTENUATION = 48
const GEN_PAN = 17
const GEN_COARSE_TUNE = 51
const GEN_FINE_TUNE = 52
const GEN_SAMPLE_ID = 53
const GEN_SAMPLE_MODES = 54
const GEN_OVERRIDING_ROOT_KEY = 58
const GEN_KEY_RANGE = 43
const GEN_VEL_RANGE = 44
const GEN_INSTRUMENT = 41
const GEN_START_OFFSET = 0
const GEN_END_OFFSET = 1
const GEN_LOOP_START_OFFSET = 2
const GEN_LOOP_END_OFFSET = 3
const GEN_START_COARSE = 4
const GEN_END_COARSE = 12
const GEN_LOOP_START_COARSE = 45
const GEN_LOOP_END_COARSE = 50

const SAMPLE_MODES_LOOP_CONTINUOUS = 1
const SAMPLE_MODES_LOOP_UNTIL_RELEASE = 3

function ascii(view: DataView, start: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    const code = view.getUint8(start + i)
    if (code === 0) break
    out += String.fromCharCode(code)
  }
  return out.trim()
}

interface Chunk {
  id: string
  dataStart: number
  size: number
}

/** Read one RIFF chunk header at `offset`; data begins 8 bytes later. */
function readChunk(view: DataView, offset: number): Chunk {
  const id = ascii(view, offset, 4)
  const size = view.getUint32(offset + 4, true)
  return { id, dataStart: offset + 8, size }
}

/** Walk a LIST body, yielding each subchunk. */
function listChildren(view: DataView, list: Chunk, bodyStart: number): Chunk[] {
  const out: Chunk[] = []
  let pos = bodyStart
  const end = list.dataStart + list.size
  while (pos + 8 <= end) {
    const child = readChunk(view, pos)
    out.push(child)
    // Chunks are word-aligned: advance past an odd-sized body's pad byte.
    pos = child.dataStart + child.size + (child.size & 1)
  }
  return out
}

interface RawZone {
  genStart: number
  genEnd: number
}

/** Read every bag record (4 bytes: genNdx, modNdx). */
function readBags(view: DataView, chunk: Chunk | undefined): RawZone[] {
  if (!chunk) return []
  const count = Math.floor(chunk.size / 4)
  const zones: RawZone[] = []
  for (let i = 0; i < count; i++) {
    const at = chunk.dataStart + i * 4
    zones.push({ genStart: view.getUint16(at, true), genEnd: view.getUint16(at + 2, true) })
  }
  return zones
}

interface RawGen {
  oper: number
  amount: number
  low: number
  high: number
}

function readGens(view: DataView, chunk: Chunk | undefined, from: number, to: number): RawGen[] {
  if (!chunk) return []
  const gens: RawGen[] = []
  for (let i = from; i < to; i++) {
    const at = chunk.dataStart + i * 4
    const oper = view.getUint16(at, true)
    const low = view.getUint8(at + 2)
    const high = view.getUint8(at + 3)
    gens.push({ oper, amount: view.getInt16(at + 2, true), low, high })
  }
  return gens
}

export class Sf2Bank {
  readonly pcm: Int16Array
  readonly samples: Sf2Sample[]
  private readonly presets: Preset[]
  private readonly instruments: Instrument[]

  constructor(pcm: Int16Array, samples: Sf2Sample[], presets: Preset[], instruments: Instrument[]) {
    this.pcm = pcm
    this.samples = samples
    this.presets = presets
    this.instruments = instruments
  }

  get presetCount(): number {
    return this.presets.length
  }

  get sampleCount(): number {
    return this.samples.length
  }

  /**
   * Choose the sample + tuning for one note. Returns null when the bank has
   * nothing usable, letting the caller fall back to the oscillator synth.
   */
  pickVoice(program: number, key: number, velocity: number, bank = 0): Sf2Voice | null {
    const preset =
      this.presets.find((p) => p.bank === bank && p.program === program) ??
      this.presets.find((p) => p.bank === 0 && p.program === 0) ??
      this.presets[0]
    if (!preset) return null

    for (const pz of preset.zones) {
      if (key < pz.keyLow || key > pz.keyHigh) continue
      if (velocity < pz.velLow || velocity > pz.velHigh) continue
      const instrument = this.instruments[pz.instrument]
      if (!instrument) continue

      for (const iz of instrument.zones) {
        if (key < iz.keyLow || key > iz.keyHigh) continue
        if (velocity < iz.velLow || velocity > iz.velHigh) continue
        const sample = this.samples[iz.sampleIndex]
        if (!sample) continue

        const rootKey = iz.rootKey ?? sample.originalPitch
        const tune = iz.coarseTune + (iz.fineTune + sample.pitchCorrection) / 100
        const start = clamp(sample.start + iz.startOff, 0, this.pcm.length)
        const end = clamp(sample.end + iz.endOff, start + 1, this.pcm.length)
        const loopStart = clamp(sample.startLoop + iz.loopStartOff, start, end)
        const loopEnd = clamp(sample.endLoop + iz.loopEndOff, loopStart + 1, end)
        const loop =
          iz.sampleModes === SAMPLE_MODES_LOOP_CONTINUOUS ||
          iz.sampleModes === SAMPLE_MODES_LOOP_UNTIL_RELEASE

        return {
          sampleIndex: iz.sampleIndex,
          rootKey,
          tune,
          loop,
          start,
          end,
          loopStart,
          loopEnd,
          attenuationCb: iz.attenuationCb + pz.attenuationCb,
          pan: clamp((iz.pan + pz.pan) / 500, -1, 1),
        }
      }
    }
    return null
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Parse an `.sf2` file. Returns null when the container is not a SoundFont. */
export function parseSf2(buffer: ArrayBuffer): Sf2Bank | null {
  try {
    const view = new DataView(buffer)
    if (view.byteLength < 12) return null
    const riff = readChunk(view, 0)
    if (riff.id !== 'RIFF') return null
    if (ascii(view, 8, 4) !== 'sfbk') return null

    let sdta: Chunk | undefined
    const pdtaChildren: Chunk[] = []

    let pos = 12
    const end = riff.dataStart + riff.size
    while (pos + 8 <= end) {
      const list = readChunk(view, pos)
      const listType = ascii(view, list.dataStart, 4)
      const bodyStart = list.dataStart + 4
      if (list.id === 'LIST' && listType === 'sdta') {
        const children = listChildren(view, list, bodyStart)
        sdta = children.find((c) => c.id === 'smpl')
      } else if (list.id === 'LIST' && listType === 'pdta') {
        pdtaChildren.push(...listChildren(view, list, bodyStart))
      }
      pos = list.dataStart + list.size + (list.size & 1)
    }

    if (!sdta) return null
    const pcm = new Int16Array(buffer, sdta.dataStart, Math.floor(sdta.size / 2))

    const phdr = pdtaChildren.find((c) => c.id === 'phdr')
    const pbag = pdtaChildren.find((c) => c.id === 'pbag')
    const pgen = pdtaChildren.find((c) => c.id === 'pgen')
    const inst = pdtaChildren.find((c) => c.id === 'inst')
    const ibag = pdtaChildren.find((c) => c.id === 'ibag')
    const igen = pdtaChildren.find((c) => c.id === 'igen')
    const shdr = pdtaChildren.find((c) => c.id === 'shdr')
    if (!phdr || !inst || !shdr) return null

    // --- samples (shdr, 46 bytes each; last record is the EOS sentinel) -----
    const samples: Sf2Sample[] = []
    const sampleCount = Math.floor(shdr.size / 46) - 1
    for (let i = 0; i < sampleCount; i++) {
      const at = shdr.dataStart + i * 46
      samples.push({
        name: ascii(view, at, 20),
        start: view.getUint32(at + 20, true),
        end: view.getUint32(at + 24, true),
        startLoop: view.getUint32(at + 28, true),
        endLoop: view.getUint32(at + 32, true),
        sampleRate: view.getUint32(at + 36, true),
        originalPitch: view.getUint8(at + 40),
        pitchCorrection: view.getInt8(at + 41),
      })
    }

    // Bags describe zone boundaries: header i points at its first bag, and a
    // zone's generators run from that bag's genNdx to the next bag's genNdx.
    const presetBags = readBags(view, pbag)
    const instBags = readBags(view, ibag)

    // --- instruments (inst, 22 bytes each; last is the EOI sentinel) --------
    const instruments: Instrument[] = []
    const instrumentCount = Math.floor(inst.size / 22) - 1
    const instBagNdx = (i: number) => view.getUint16(inst.dataStart + i * 22 + 20, true)
    for (let i = 0; i < instrumentCount; i++) {
      const at = inst.dataStart + i * 22
      const name = ascii(view, at, 20)
      const b0 = instBagNdx(i)
      const b1 = instBagNdx(i + 1)
      const zones: InstrumentZone[] = []
      for (let j = b0; j < b1; j++) {
        const from = instBags[j]?.genStart ?? 0
        const to = instBags[j + 1]?.genStart ?? from
        zones.push(buildInstrumentZone(readGens(view, igen, from, to)))
      }
      instruments.push({ name, zones })
    }

    // --- presets (phdr, 38 bytes each; last is the EOP sentinel) ------------
    const presets: Preset[] = []
    const presetCount = Math.floor(phdr.size / 38) - 1
    const presetBagNdx = (i: number) => view.getUint16(phdr.dataStart + i * 38 + 24, true)
    for (let i = 0; i < presetCount; i++) {
      const at = phdr.dataStart + i * 38
      const name = ascii(view, at, 20)
      const program = view.getUint16(at + 20, true)
      const bank = view.getUint16(at + 22, true)
      const b0 = presetBagNdx(i)
      const b1 = presetBagNdx(i + 1)
      const zones: PresetZone[] = []
      for (let j = b0; j < b1; j++) {
        const from = presetBags[j]?.genStart ?? 0
        const to = presetBags[j + 1]?.genStart ?? from
        zones.push(buildPresetZone(readGens(view, pgen, from, to)))
      }
      presets.push({ name, program, bank, zones })
    }

    return new Sf2Bank(pcm, samples, presets, instruments)
  } catch {
    return null
  }
}

/** Build one preset zone from its generator slice (defaults where absent). */
function buildPresetZone(gens: RawGen[]): PresetZone {
  const zone: PresetZone = {
    keyLow: 0,
    keyHigh: 127,
    velLow: 0,
    velHigh: 127,
    instrument: 0,
    coarseTune: 0,
    fineTune: 0,
    attenuationCb: 0,
    pan: 0,
  }
  for (const gen of gens) {
    switch (gen.oper) {
      case GEN_KEY_RANGE:
        zone.keyLow = gen.low
        zone.keyHigh = gen.high
        break
      case GEN_VEL_RANGE:
        zone.velLow = gen.low
        zone.velHigh = gen.high
        break
      case GEN_INSTRUMENT:
        zone.instrument = gen.amount
        break
      case GEN_COARSE_TUNE:
        zone.coarseTune = gen.amount
        break
      case GEN_FINE_TUNE:
        zone.fineTune = gen.amount
        break
      case GEN_ATTENUATION:
        zone.attenuationCb = gen.amount
        break
      case GEN_PAN:
        zone.pan = gen.amount
        break
      default:
        break
    }
  }
  return zone
}

/** Build one instrument zone from its generator slice (defaults where absent). */
function buildInstrumentZone(gens: RawGen[]): InstrumentZone {
  const zone: InstrumentZone = {
    keyLow: 0,
    keyHigh: 127,
    velLow: 0,
    velHigh: 127,
    sampleIndex: 0,
    rootKey: null,
    coarseTune: 0,
    fineTune: 0,
    sampleModes: 0,
    attenuationCb: 0,
    pan: 0,
    startOff: 0,
    endOff: 0,
    loopStartOff: 0,
    loopEndOff: 0,
  }
  for (const gen of gens) {
    switch (gen.oper) {
      case GEN_KEY_RANGE:
        zone.keyLow = gen.low
        zone.keyHigh = gen.high
        break
      case GEN_VEL_RANGE:
        zone.velLow = gen.low
        zone.velHigh = gen.high
        break
      case GEN_SAMPLE_ID:
        zone.sampleIndex = gen.amount
        break
      case GEN_OVERRIDING_ROOT_KEY:
        zone.rootKey = gen.amount
        break
      case GEN_COARSE_TUNE:
        zone.coarseTune = gen.amount
        break
      case GEN_FINE_TUNE:
        zone.fineTune = gen.amount
        break
      case GEN_SAMPLE_MODES:
        zone.sampleModes = gen.amount
        break
      case GEN_ATTENUATION:
        zone.attenuationCb = gen.amount
        break
      case GEN_PAN:
        zone.pan = gen.amount
        break
      case GEN_START_OFFSET:
        zone.startOff += gen.amount
        break
      case GEN_END_OFFSET:
        zone.endOff += gen.amount
        break
      case GEN_LOOP_START_OFFSET:
        zone.loopStartOff += gen.amount
        break
      case GEN_LOOP_END_OFFSET:
        zone.loopEndOff += gen.amount
        break
      case GEN_START_COARSE:
        zone.startOff += gen.amount * 32768
        break
      case GEN_END_COARSE:
        zone.endOff += gen.amount * 32768
        break
      case GEN_LOOP_START_COARSE:
        zone.loopStartOff += gen.amount * 32768
        break
      case GEN_LOOP_END_COARSE:
        zone.loopEndOff += gen.amount * 32768
        break
      default:
        break
    }
  }
  return zone
}
