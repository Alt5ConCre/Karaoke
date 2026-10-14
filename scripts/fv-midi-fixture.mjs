// MIDI fixture builder shared by fv-logic-test.mjs and fv-browser-test.mjs.
// Builds tiny, hand-checked SMF0 files so the parser and the app have a stable
// input that does not depend on composer output. Zero deps.

const MThd = [0x4d, 0x54, 0x68, 0x64] // "MThd"
const MTrk = [0x4d, 0x54, 0x72, 0x6b] // "MTrk"

function vlq(n) {
  if (n < 0 || n > 0x0fffffff || !Number.isInteger(n)) throw new Error(`vlq out of range: ${n}`)
  const bytes = [n & 0x7f]
  n >>= 7
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80)
    n >>= 7
  }
  return bytes
}

function u16(v) {
  return [(v >> 8) & 0xff, v & 0xff]
}
function u32(v) {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
}
function asciiBytes(str) {
  return [...Buffer.from(str, 'latin1')]
}

/**
 * Build a Standard MIDI File (format 0, single track) from a flat list of
 * pre-assembled event byte arrays. Tempo meta (0x51) is always emitted first at
 * tick 0, then the events in order, then the end-of-track meta.
 */
function buildMidi({ division = 96, tempo = 500000, events }) {
  const body = [0x00, 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff]
  for (const ev of events) body.push(...ev)
  body.push(0x00, 0xff, 0x2f, 0x00) // end of track
  const track = [...MTrk, ...u32(body.length), ...body]
  return new Uint8Array([...MThd, ...u32(6), ...u16(0), ...u16(1), ...u16(division), ...track])
}

/**
 * Build a format-1 SMF from several independent tracks. Tempo meta (0x51) is
 * emitted first in track 0; every track gets the end-of-track meta.
 */
function buildMidiMulti({ division = 96, tempo = 500000, tracks }) {
  const chunks = tracks.map((bytes, i) => {
    const body = []
    if (i === 0) body.push(0x00, 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff)
    for (const b of bytes) body.push(b)
    body.push(0x00, 0xff, 0x2f, 0x00) // end of track
    return [...MTrk, ...u32(body.length), ...body]
  })
  return new Uint8Array([
    ...MThd, ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(division), ...chunks.flat(),
  ])
}

function metaText(type, str) {
  const b = asciiBytes(str)
  return [0x00, 0xff, type, ...vlq(b.length), ...b]
}

/** A lyric syllable event: "\Hel", "/lo", "\" (line break) — standard .kar text. */
function lyric(str) {
  return metaText(0x05, str)
}

/** One note: a lyric syllable and a note-on keyed at the same tick `delta`
 * after the previous event, then the note-off `len` ticks later. Lyrics are
 * written first so every syllable shares its note's tick. Note-ons always carry
 * their 0x9x status byte (a lyric meta event resets running status anyway);
 * note-offs are bare data bytes, exercising running-status parsing. */
function sungNote({ delta, key, vel = 0x50, len = 48, text = '' }) {
  const ev = []
  if (text) ev.push(...lyric(text))
  ev.push(...vlq(delta))
  ev.push(0x90, key, vel)
  ev.push(...vlq(len))
  ev.push(key, 0x00) // running 0x90 with vel 0 = note off
  return ev
}

export function karBanner() {
  return '\x00@KMIDI KARAOKE FILE\x00 [9:0]\r\n@TFull Sample Song\r\n@LEnglish\r\n@WTest Artist\r\n'
}

/**
 * 120 bpm (500000 µs/quarter), 96 ticks/quarter → 1 tick = 5.2083 ms,
 * 48 ticks = 0.25 s. Four notes at ticks 0/48/96/144, keys 60/62/64/65, each
 * one syllable in line. Expected: startSec/endSec 0–0.25–0.5–0.75–1.0.
 */
export function buildKarFixture() {
  // Each note lands right after the previous note-off (which sits at tick
  // 48·i), so every note-on delta is 0 and notes sit at ticks 0/48/96/144.
  const start = [0, 0, 0, 0]
  const keys = [60, 62, 64, 65]
  const lyrics = ['\\Hel', '/lo', '\\Wo', '/rld']
  const events = [metaText(0x01, karBanner())]
  for (let i = 0; i < 4; i++) {
    events.push(sungNote({ delta: start[i], key: keys[i], text: lyrics[i] }))
  }
  events.push(lyric('\\'))
  return buildMidi({ tempo: 500000, events })
}

/**
 * A realistic .kar shaped like the real library: a KMIDI banner in track 0,
 * lyrics in a 0x05 track using blank + CR line breaks (not `\`/`/`), and a
 * byte-identical SECOND lyric track — the duplicate many karaoke files ship.
 * Expected: two lines ("Hello", "World"), each syllable counted once.
 */
export function buildRealisticKarFixture() {
  const banner = '\x00@KMIDI KARAOKE FILE\x00 [9:0]\r\n@TRealistic Song\r\n@LEnglish\r\n@WTest Artist\r\n'
  const lyr = (str, delta = 0) => [...vlq(delta), 0xff, 0x05, ...vlq(asciiBytes(str).length), ...asciiBytes(str)]
  const note = ({ key, len = 48 }) => [0x00, 0x90, key, 0x50, ...vlq(len), key, 0x00]
  const lyricTrack = [
    ...lyr('Hel'), ...note({ key: 60 }),
    ...lyr('lo '), ...note({ key: 62 }),
    ...lyr(''), ...lyr('\r'),
    ...lyr('Wo'), ...note({ key: 64 }),
    ...lyr('rld'), ...note({ key: 65 }),
    ...lyr('\r'),
  ]
  return buildMidiMulti({
    tempo: 500000,
    tracks: [metaText(0x01, banner), lyricTrack, [...lyricTrack]],
  })
}

/** No karaoke banner, no lyrics — a bare instrumental. Tempo 128 bpm. */
export function buildPlainMidi() {
  const events = [
    metaText(0x03, 'My Song'), // track name
    [0x00, 0xc0, 0x28], // program change ch0 → 40 (violin)
    sungNote({ delta: 0, key: 55, vel: 0x50 }),
  ]
  return buildMidi({ tempo: 468750, events })
}

/** SMPTE time division: 25 fps, 40 ticks/frame → 1000 ticks/second. */
export function buildSmpteMidi() {
  const events = [
    metaText(0x03, 'Smpte'),
    sungNote({ delta: 0, key: 60, vel: 0x50 }),
  ]
  return buildMidi({ division: 0xe728, tempo: 500000, events })
}