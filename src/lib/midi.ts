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

/** A karaoke song is never longer than this; anything beyond is a broken file. */
const MAX_SONG_SEC = 15 * 60
/** A silence longer than this between notes is junk appended after the song. */
const GAP_TRIM_SEC = 30

type TextKind = 'lyric' | 'text' | 'trackName'
interface TextEvent {
  tick: number
  text: string
  kind: TextKind
  track: number
}

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
  const tracks: { text: TextEvent[]; notes: RawNote[]; programChanges: MidiProgramChange[]; tempos: { tick: number; spq: number }[]; lastTick: number }[] = []

  for (let t = 0; t < trackCount; t++) {
    if (offset + 8 > bytes.byteLength) break
    if (tagAscii(bytes, offset) !== 'MTrk') break
    const trackLen = view.getUint32(offset + 4, false)
    const trackEnd = offset + 8 + trackLen
    if (trackEnd > bytes.byteLength) break
    const events = {
      text: [] as TextEvent[],
      notes: [] as RawNote[],
      programChanges: [] as MidiProgramChange[],
      tempos: [] as { tick: number; spq: number }[],
      lastTick: 0,
    }
    let pos = offset + 8
    let running = -1
    let absTick = 0
    while (pos < trackEnd) {
      const [delta, next] = readVlq(bytes, pos)
      pos = next
      absTick += delta // deltas accumulate; MIDI timestamps are relative
      if (pos >= trackEnd) break
      let status = bytes[pos]
      if (status & 0x80) {
        pos++
        // Only channel messages set running status. Meta (0xFF) and SysEx
        // (0xF0/0xF7) leave it untouched — otherwise a data-byte event after a
        // meta or SysEx event (a lyric line, say) is misread and the whole
        // track desyncs, producing absurd timings.
        if (status < 0xf0) running = status
      } else if (running !== -1) {
        status = running
      } else {
        break
      }
      if (status === 0xff) {
        const metaType = bytes[pos++]
        const [len, after] = readVlq(bytes, pos)
        pos = after
        if (metaType === 0x01 || metaType === 0x05 || metaType === 0x03) {
          const kind: TextKind = metaType === 0x05 ? 'lyric' : metaType === 0x03 ? 'trackName' : 'text'
          events.text.push({ tick: absTick, text: decodeText(bytes, pos, len), kind, track: t })
        } else if (metaType === 0x51 && len >= 3) {
          const spq = (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2]
          if (spq > 0) events.tempos.push({ tick: absTick, spq })
        }
        pos += len
      } else if (status === 0xf0 || status === 0xf7) {
        // SysEx — skip the whole payload, not just its length prefix.
        const [len, after] = readVlq(bytes, pos)
        pos = after + len
        continue
      } else {
        const cmd = status & 0xf0
        const chan = status & 0x0f
        if (cmd === 0x80 || (cmd === 0x90 && bytes[pos + 1] === 0)) {
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
      }
      events.lastTick = Math.max(events.lastTick, absTick)
    }
    tracks.push(events)
    offset = trackEnd
  }

  const allText: TextEvent[] = []
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

  const tickToSec = makeTickToSec(secPerTick, division, ticksPerQuarter, tempos)

  // Karaoke files carry lyrics either as Lyric meta events (0x05) or — in the
  // classic .kar files — as plain Text events (0x01) split by `\` / `/` markers.
  // Trusting the banner alone made most of the library look instrumental.
  const lyricEvents = selectLyricEvents(allText)
  const isKar = allText.some((m) => KARAOKE_BANNER_RE.test(m.text)) || lyricEvents.length > 0

  const { lines, syllables, lastLyricTick } = buildLyrics(lyricEvents, tickToSec)
  const meta = extractTags(allText)
  // Duration from the actual note/lyric data, not from the last event of every
  // track — marker and metadata tracks routinely stretch far past the music.
  const durationSec = computeDuration(allNotesRaw, lastLyricTick, tickToSec, lastTick)
  if (syllables.length) {
    syllables[syllables.length - 1].endSec = durationSec
    lines[lines.length - 1].endSec = durationSec
  }

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

/** Strip `@T`/`@L`-style karaoke tags out of a text event. */
function stripTags(text: string): string {
  return text.replace(/@[A-Za-z][^@\r\n]*/g, '')
}

/**
 * Pick the events that actually carry lyrics. Lyric meta events (0x05) win when
 * present; otherwise fall back to Text events (0x01) that use kar-style markup
 * (`\`, `/`, NUL or CR/LF line breaks) — the shape old .kar files put their
 * words in.
 *
 * Empty events are dropped but whitespace-only ones are kept: a lone `"\r"` is
 * how most .kar files encode a line break, and trimming it away would collapse
 * the whole song onto one line.
 *
 * Karaoke files often ship the same lyric track twice (a display copy and an
 * identical duplicate). Only the track with the most lyric events is read, so
 * those files don't come back with every syllable doubled.
 */
function selectLyricEvents(allText: TextEvent[]): TextEvent[] {
  const lyric = allText.filter((t) => t.kind === 'lyric' && t.text !== '')
  if (lyric.length) return mostPopulatedTrack(lyric)
  const text = allText.filter((t) => t.kind === 'text' && !/^[\s\0]*@/.test(t.text))
  const looksKar = text.some((t) => /[\\/\r\n\0]/.test(t.text))
  return looksKar ? mostPopulatedTrack(text) : []
}

/** Keep the single track carrying the most events, then order by time. */
function mostPopulatedTrack(events: TextEvent[]): TextEvent[] {
  const counts = new Map<number, number>()
  for (const e of events) counts.set(e.track, (counts.get(e.track) ?? 0) + 1)
  let best = events[0].track
  for (const [track, n] of counts) if (n > (counts.get(best) ?? 0)) best = track
  return events.filter((e) => e.track === best).sort((a, b) => a.tick - b.tick)
}

function buildLyrics(events: TextEvent[], tickToSec: (tick: number) => number): { lines: MidiLine[]; syllables: MidiSyllable[]; lastLyricTick: number } {
  const lines: MidiLine[] = []
  const flat: MidiSyllable[] = []
  let lineSyls: MidiSyllable[] = []
  let buf = ''
  let lastLyricTick = 0
  const flushSyl = (tick: number) => {
    if (buf.trim()) {
      lineSyls.push({ text: buf, startSec: tickToSec(tick), endSec: Number.MAX_SAFE_INTEGER, startTick: tick })
      lastLyricTick = Math.max(lastLyricTick, tick)
    }
    buf = ''
  }
  const commitLine = () => {
    if (lineSyls.length) {
      flat.push(...lineSyls)
      lines.push({
        text: lineSyls.map((s) => s.text).join('').replace(/\s+/g, ' ').trim(),
        syllables: lineSyls,
        startSec: lineSyls[0].startSec,
        endSec: Number.MAX_SAFE_INTEGER,
      })
      lineSyls = []
    }
  }
  for (const ev of events) {
    for (const ch of stripTags(ev.text)) {
      const code = ch.charCodeAt(0)
      // `\` and `/` are the classic .kar line/syllable markers; CR/LF/NUL are
      // what most files actually use. None of them break on event boundaries —
      // one syllable per event simply accumulates into the current line.
      if (ch === '\\' || ch === '/' || code === 0x0d || code === 0x0a || code === 0x00) {
        flushSyl(ev.tick)
        commitLine()
      } else {
        buf += ch
      }
    }
    flushSyl(ev.tick)
  }
  flushSyl(0)
  commitLine()
  for (let i = 0; i < flat.length - 1; i++) flat[i].endSec = flat[i + 1].startSec
  for (const line of lines) line.endSec = line.syllables[line.syllables.length - 1].endSec
  return { lines, syllables: flat, lastLyricTick }
}

/**
 * Song length from the music itself. The last event of every track is a bad
 * source: karaoke files ship marker/metadata tracks (and the odd stray note)
 * that sit minutes or hours past the actual song. So use the last note, trim
 * anything after a long silence, and cap the result.
 */
function computeDuration(raw: RawNote[], lastLyricTick: number, tickToSec: (tick: number) => number, lastTrackTick: number): number {
  const starts: number[] = []
  let noteEndTick = 0
  for (const n of raw) {
    if (n.startTick !== undefined) starts.push(n.startTick)
    const end = n.endTick ?? n.startTick
    if (end !== undefined) noteEndTick = Math.max(noteEndTick, end)
  }
  starts.sort((a, b) => a - b)

  let endTick = Math.max(noteEndTick, lastLyricTick)
  for (let i = 1; i < starts.length; i++) {
    if (tickToSec(starts[i]) - tickToSec(starts[i - 1]) > GAP_TRIM_SEC) {
      endTick = starts[i - 1]
      break
    }
  }

  let sec = tickToSec(endTick)
  if (!Number.isFinite(sec) || sec <= 0) sec = tickToSec(lastTrackTick)

  // Notes running far past the last lyric means the timing is stretched or the
  // tail is junk; the lyrics end where the song does.
  const lyricSec = tickToSec(lastLyricTick)
  if (lyricSec > 0 && sec > lyricSec * 2 + GAP_TRIM_SEC) sec = lyricSec + 15

  if (sec > MAX_SONG_SEC) sec = MAX_SONG_SEC
  return sec
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