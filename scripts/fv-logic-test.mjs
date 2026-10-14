// Pure-logic test harness for FilipinoVideoke.
// Runs with Node's native TypeScript type-stripping (no build, no new deps).
//   node fv-logic-test.mjs
// Covers: ids/codes, youtube parse+embed+error text, scoring, rotation (both
// modes), and the local transport adapter end-to-end (persistence + cross-tab
// broadcast). It does NOT exercise React components — that is the browser test.

import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const SRC = process.argv[2]
if (!SRC) {
  console.error('usage: node fv-logic-test.mjs <abs path to project src>')
  process.exit(2)
}
const url = (rel) => pathToFileURL(path.join(SRC, rel)).href

// ---- browser shims (must exist before importing modules that touch window) ----
const store = new Map()
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
}
globalThis.window = {
  localStorage: localStorageStub,
  addEventListener() {},
  removeEventListener() {},
}

// Real cross-instance delivery, like a browser BroadcastChannel.
class FakeBroadcastChannel {
  static channels = new Map()
  constructor(name) {
    this.name = name
    this.listeners = new Set()
    const set = FakeBroadcastChannel.channels.get(name) ?? new Set()
    set.add(this)
    FakeBroadcastChannel.channels.set(name, set)
  }
  addEventListener(type, fn) {
    if (type === 'message') this.listeners.add(fn)
  }
  removeEventListener(type, fn) {
    if (type === 'message') this.listeners.delete(fn)
  }
  postMessage(data) {
    const peers = FakeBroadcastChannel.channels.get(this.name) ?? new Set()
    for (const peer of peers) {
      if (peer === this) continue
      const event = { data }
      for (const fn of peer.listeners) setTimeout(() => fn(event), 0)
    }
  }
  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }
}
globalThis.BroadcastChannel = FakeBroadcastChannel

const tick = () => new Promise((r) => setTimeout(r, 5))

// ---- tiny runner ----
let passed = 0
const failures = []
async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS  ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`FAIL  ${name}\n      ${error?.message ?? error}`)
  }
}

// ---- modules under test ----
const ids = await import(url('lib/ids.ts'))
const youtube = await import(url('lib/youtube.ts'))
const scoring = await import(url('lib/scoring.ts'))
const rotation = await import(url('lib/rotation.ts'))
const { createLocalAdapter, listLocalRoomCodes, deleteLocalRoom } = await import(
  url('adapters/localAdapter.ts')
)
const mediaTypes = await import(url('lib/mediaTypes.ts'))
const customSongs = await import(url('lib/customSongs.ts'))
const background = await import(url('lib/backgrounds.ts'))
const midi = await import(url('lib/midi.ts'))
const { buildKarFixture, buildPlainMidi, buildSmpteMidi, buildRealisticKarFixture } = await import('./fv-midi-fixture.mjs')

// ================================ ids =====================================
await test('normalizeRoomCode: uppercases, strips symbols, slices to 5', () => {
  assert.equal(ids.normalizeRoomCode('ab-cd1efg'), 'ABCD1')
  assert.equal(ids.normalizeRoomCode('  xy z '), 'XYZ')
  assert.equal(ids.normalizeRoomCode('abcdefgh'), 'ABCDE')
})

await test('createRoomCode: 5 chars, unambiguous alphabet, no O/0/I/1/L', () => {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  for (let i = 0; i < 500; i += 1) {
    const code = ids.createRoomCode()
    assert.equal(code.length, 5)
    for (const ch of code) {
      assert.ok(alphabet.includes(ch), `char ${ch} not in alphabet`)
      assert.ok(!'O0I1L'.includes(ch), `ambiguous char ${ch}`)
    }
  }
})

await test('pickSingerColor: deterministic and from the palette', () => {
  const palette = [
    '#fcd116', '#3b6ef5', '#ff3b5c', '#22d3ee',
    '#ff2fb3', '#4ade80', '#fb923c', '#a78bfa',
  ]
  assert.equal(ids.pickSingerColor('singer-1'), ids.pickSingerColor('singer-1'))
  assert.ok(palette.includes(ids.pickSingerColor('singer-1')))
  assert.ok(palette.includes(ids.pickSingerColor('singer-2')))
})

// ============================== youtube ==================================
await test('isValidVideoId accepts 11-char ids only', () => {
  assert.equal(youtube.isValidVideoId('jNQXAC9IVRw'), true)
  assert.equal(youtube.isValidVideoId('jNQXAC9IVR'), false)
  assert.equal(youtube.isValidVideoId('jNQXAC9IVRww'), false)
  assert.equal(youtube.isValidVideoId('has space11'), false)
  assert.equal(youtube.isValidVideoId(''), false)
})

await test('parseVideoId handles every common URL shape', () => {
  const id = 'jNQXAC9IVRw'
  assert.equal(youtube.parseVideoId(id), id)
  assert.equal(youtube.parseVideoId(`https://youtu.be/${id}`), id)
  assert.equal(youtube.parseVideoId(`https://www.youtube.com/watch?v=${id}&t=3s`), id)
  assert.equal(youtube.parseVideoId(`https://www.youtube.com/embed/${id}`), id)
  assert.equal(youtube.parseVideoId(`https://www.youtube.com/shorts/${id}`), id)
  assert.equal(youtube.parseVideoId(`https://www.youtube-nocookie.com/embed/${id}?rel=0`), id)
  assert.equal(youtube.parseVideoId('not a url'), null)
  assert.equal(youtube.parseVideoId(''), null)
})

await test('buildEmbedUrl: nocookie + enablejsapi + origin', () => {
  const u = youtube.buildEmbedUrl('jNQXAC9IVRw', 'https://example.test')
  assert.ok(u.startsWith('https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?'))
  assert.ok(u.includes('enablejsapi=1'))
  assert.ok(u.includes('origin=https%3A%2F%2Fexample.test'))
})

await test('youtubeWatchUrl + describeEmbedError map codes to honest text', () => {
  assert.equal(youtube.youtubeWatchUrl('abc'), 'https://www.youtube.com/watch?v=abc')
  assert.match(youtube.describeEmbedError(101), /disabled embedding/i)
  assert.equal(youtube.describeEmbedError(101), youtube.describeEmbedError(150))
  assert.match(youtube.describeEmbedError(100), /unavailable/i)
  assert.match(youtube.describeEmbedError(2), /valid/i)
  assert.equal(typeof youtube.describeEmbedError(undefined), 'string')
})

// ============================== scoring ==================================
await test('generateFunScore: fresh random integer 65..100, varies, no input', () => {
  assert.equal(scoring.SCORING_MODE, 'FUN_RANDOM')
  assert.equal(scoring.SCORING_MIN, 65)
  assert.equal(scoring.SCORING_MAX, 100)
  assert.match(scoring.SCORING_DISCLAIMER, /simulated/i)
  assert.match(scoring.SCORING_DISCLAIMER, /random/i)
  assert.equal(scoring.generateFunScore.length, 0)
  const seen = new Set()
  for (let i = 0; i < 2000; i += 1) {
    const v = scoring.generateFunScore()
    assert.ok(Number.isInteger(v), `not an integer: ${v}`)
    assert.ok(v >= 65 && v <= 100, `out of range: ${v}`)
    seen.add(v)
  }
  assert.ok(seen.size > 20, 'scores should vary across draws')
})

await test('starsForScore / scoreGrade stay within bounds', () => {
  for (let v = 0; v <= 120; v += 1) {
    const s = scoring.starsForScore(v)
    assert.ok(s >= 1 && s <= 5)
  }
  assert.equal(scoring.scoreGrade(100), 'Karaoke Legend')
  assert.equal(scoring.scoreGrade(60), 'Brave Soul')
})

// ============================== rotation =================================
const singer = (id, joinedAt) => ({ id, name: id, joinedAt, color: '#000', isHost: false })
const item = (id, singerId, addedAt, status = 'waiting') => ({
  id, songId: `song-${id}`, singerId, addedAt, status,
})

await test('queue mode: strict first-come-first-served', () => {
  const singers = [singer('A', 1), singer('B', 2)]
  const queue = [item('a2', 'A', 20), item('b1', 'B', 10), item('a1', 'A', 5)]
  assert.equal(rotation.pickNextItem(queue, singers, 'queue').id, 'a1')
})

await test('rotation mode: round-robin gives the mic to the next singer', () => {
  const singers = [singer('A', 1), singer('B', 2)]
  // A just sang (done), so B is up even though A queued a second song.
  const queue = [
    item('a1', 'A', 5, 'done'),
    item('a2', 'A', 20),
    item('b1', 'B', 10),
  ]
  assert.equal(rotation.pickNextItem(queue, singers, 'rotation').id, 'b1')
})

await test('rotation mode: no history falls back to the earliest song', () => {
  const singers = [singer('A', 1), singer('B', 2)]
  const queue = [item('b1', 'B', 10), item('a1', 'A', 20)]
  assert.equal(rotation.pickNextItem(queue, singers, 'rotation').id, 'b1')
})

await test('rotation mode: cycles back around when only one singer has songs', () => {
  const singers = [singer('A', 1), singer('B', 2)]
  const queue = [item('a1', 'A', 5, 'done'), item('a2', 'A', 20), item('a3', 'A', 30)]
  assert.equal(rotation.pickNextItem(queue, singers, 'rotation').id, 'a2')
})

await test('ensureSinging: promotes one, is idempotent, keeps ref when nothing to do', () => {
  const singers = [singer('A', 1)]
  const waiting = [item('a1', 'A', 5)]
  const promoted = rotation.ensureSinging(waiting, singers, 'queue')
  assert.equal(promoted[0].status, 'singing')
  assert.equal(typeof promoted[0].startedAt, 'number')
  // nothing waiting → same reference (callers rely on this to skip a write)
  const same = rotation.ensureSinging(promoted, singers, 'queue')
  assert.equal(same, promoted)
})

await test('upcomingBySinger: previews round-robin order', () => {
  const singers = [singer('A', 1), singer('B', 2)]
  const queue = [item('a1', 'A', 5), item('b1', 'B', 10), item('a2', 'A', 15)]
  const order = rotation.upcomingBySinger(queue, singers, 'rotation')
  assert.deepEqual(order, ['A', 'B', 'A'])
})

// ====================== local transport (integration) ====================
await test('local adapter: create → exists → get, rev bumps on update', async () => {
  store.clear()
  const adapter = createLocalAdapter()
  const room = {
    code: 'ABCDE', name: 'Test', createdAt: 1, hostId: 'A',
    rotationMode: 'rotation', singers: [singer('A', 1)], queue: [], scores: [], rev: 0,
  }
  await adapter.createRoom(room)
  assert.equal(await adapter.roomExists('ABCDE'), true)
  assert.equal((await adapter.getRoom('ABCDE')).name, 'Test')
  const updated = await adapter.update('ABCDE', (r) => ({ ...r, name: 'Renamed' }))
  assert.equal(updated.rev, 1)
  assert.equal((await adapter.getRoom('ABCDE')).name, 'Renamed')
  assert.ok(listLocalRoomCodes().includes('ABCDE'))
  deleteLocalRoom('ABCDE')
  assert.equal(await adapter.roomExists('ABCDE'), false)
})

await test('local adapter: an update in one tab reaches a subscriber in another', async () => {
  store.clear()
  const tabA = createLocalAdapter()
  const tabB = createLocalAdapter()
  const room = {
    code: 'WXYZ2', name: 'Party', createdAt: 1, hostId: 'A',
    rotationMode: 'rotation', singers: [singer('A', 1)], queue: [], scores: [], rev: 0,
  }
  await tabA.createRoom(room)

  const received = []
  const stop = tabB.subscribe('WXYZ2', (r) => received.push(r))
  await tabA.update('WXYZ2', (r) => ({ ...r, singers: [...r.singers, singer('B', 2)] }))
  await tick()
  stop()

  assert.ok(received.length >= 1, 'subscriber never heard the update')
  assert.equal(received.at(-1).singers.length, 2)
})

// =========================== media types =================================
await test('mediaTypes: extensionOf and the playable-file checks', () => {
  assert.equal(mediaTypes.extensionOf('Song.MP4'), '.mp4')
  assert.equal(mediaTypes.extensionOf('noext'), '')
  assert.equal(mediaTypes.isPlayableMedia({ name: 'a.mp4' }), true)
  assert.equal(mediaTypes.isPlayableMedia({ name: 'a.wav' }), true)
  assert.equal(mediaTypes.isPlayableMedia({ name: 'a.avi' }), false)
  assert.equal(mediaTypes.isPlayableMedia({ name: 'a.txt' }), false)
  assert.equal(mediaTypes.isPlayableMedia({ name: 'noext', type: 'video/mp4' }), true)
  assert.equal(mediaTypes.isPlayableMedia({ name: 'noext', type: 'audio/mpeg' }), true)
  assert.equal(mediaTypes.isPlayableMedia({ name: 'noext', type: 'application/pdf' }), false)
  assert.equal(mediaTypes.isAudioFile({ name: 'a.mp3' }), true)
  assert.equal(mediaTypes.isAudioFile({ name: 'a.mp4' }), false)
  assert.equal(mediaTypes.isAudioFile({ name: 'noext', type: 'audio/flac' }), true)
  assert.ok(mediaTypes.MEDIA_ACCEPT.includes('video/*'))
  assert.ok(mediaTypes.MEDIA_ACCEPT.includes('audio/*'))
  assert.ok(mediaTypes.MEDIA_ACCEPT.includes('.mp4'))
  assert.ok(mediaTypes.MEDIA_ACCEPT.includes('.flac'))
  assert.ok(!mediaTypes.MEDIA_ACCEPT.includes('.avi'))
})

// ============================ custom songs ==============================
await test('parseSongLines: pipes, languages, comments, blank lines', () => {
  const lines = customSongs.parseSongLines(
    [
      '# my playlist',
      'Bakit Ngayon Ka Lang | Ogie Alcasid | https://youtu.be/abcd',
      'Pusong Bato | Jovit Baldivino | Tagalog',
      'Just A Title',
      '   ',
      '|',
      '',
    ].join('\n'),
  )
  assert.equal(lines.length, 3)
  assert.deepEqual(lines[0], {
    title: 'Bakit Ngayon Ka Lang', artist: 'Ogie Alcasid', youtubeId: 'https://youtu.be/abcd',
  })
  assert.deepEqual(lines[1], { title: 'Pusong Bato', artist: 'Jovit Baldivino', language: 'Tagalog' })
  assert.deepEqual(lines[2], { title: 'Just A Title' })
  assert.equal(customSongs.parseSongLines('').length, 0)
})

await test('slugify: lowercases, strips accents/junk, trims, caps length', () => {
  assert.equal(customSongs.slugify('Bakit Ngayon Ka Lang'), 'bakit-ngayon-ka-lang')
  assert.equal(customSongs.slugify('  Hello!! World  '), 'hello-world')
  assert.equal(customSongs.slugify('A-B—C'), 'a-b-c')
  assert.equal(customSongs.slugify('!!!'), '')
  assert.equal(customSongs.slugify('x'.repeat(100)).length, 48)
})

await test('buildCustomSong: defaults, language map, youtube parse, id determinism', () => {
  const song = customSongs.buildCustomSong({
    title: '  Bakit Ngayon Ka Lang  ',
    artist: ' Ogie Alcasid ',
    language: ' english ',
    genre: 'OPM',
    youtubeId: 'https://youtu.be/jNQXAC9IVRw',
  }, 'list')
  assert.ok(song)
  assert.equal(song.title, 'Bakit Ngayon Ka Lang')
  assert.equal(song.artist, 'Ogie Alcasid')
  assert.equal(song.language, 'English')
  assert.equal(song.genre, 'OPM')
  assert.equal(song.youtubeId, 'jNQXAC9IVRw')
  assert.equal(song.source, 'custom')
  assert.equal(song.id, 'custom:bakit-ngayon-ka-lang-list')
  assert.ok(song.createdAt > 0)
  assert.deepEqual(song.tags, ['my song'])

  assert.equal(customSongs.buildCustomSong({ title: '   ' }), null)

  const plain = customSongs.buildCustomSong({ title: 'X' })
  assert.equal(plain.artist, 'Unknown artist')
  assert.equal(plain.genre, 'My songs')
  assert.equal(plain.language, 'Tagalog')
  assert.equal(plain.youtubeId, '')

  const badYt = customSongs.buildCustomSong({ title: 'Y', youtubeId: 'not a url' })
  assert.equal(badYt.youtubeId, '')

  // A reused `unique` hint makes ids stable; omitting it allows repeats.
  assert.equal(
    customSongs.buildCustomSong({ title: 'Repeat Me' }, 'bulk').id,
    customSongs.buildCustomSong({ title: 'Repeat Me' }, 'bulk').id,
  )
  assert.notEqual(
    customSongs.buildCustomSong({ title: 'One Off' }).id,
    customSongs.buildCustomSong({ title: 'One Off' }).id,
  )
})

await test('sanitizeCustomSongs: drops junk and duplicates, fills defaults', () => {
  const cleaned = customSongs.sanitizeCustomSongs([
    { id: 'custom:x-1', title: ' Good ' },
    { id: 'custom:x-1', title: 'dup' },
    { title: 'no id' },
    'nonsense',
    null,
  ])
  assert.equal(cleaned.length, 1)
  assert.equal(cleaned[0].title, 'Good')
  assert.equal(cleaned[0].artist, 'Unknown artist')
  assert.equal(cleaned[0].source, 'custom')
  assert.deepEqual(cleaned[0].tags, ['my song'])
  assert.equal(customSongs.sanitizeCustomSongs('nope').length, 0)
})

await test('custom song store: add dedupes by id, remove frees the id', () => {
  const start = customSongs.getCustomSongs().length
  const a = customSongs.buildCustomSong({ title: 'Alpha Test' }, 'bulk')
  const b = customSongs.buildCustomSong({ title: 'Beta Test' }, 'bulk')
  assert.equal(customSongs.addCustomSongs([a, b]), 2)
  assert.equal(customSongs.getCustomSongs().length, start + 2)
  assert.equal(customSongs.addCustomSongs([a]), 0, 'duplicate id must be a no-op')
  assert.equal(customSongs.getCustomSongs().length, start + 2)
  assert.equal(customSongs.removeCustomSong(a.id), true)
  assert.equal(customSongs.removeCustomSong(a.id), false)
  assert.equal(customSongs.addCustomSongs([a]), 1, 'id is free again after remove')
  assert.equal(customSongs.removeCustomSong(a.id), true)
  assert.equal(customSongs.removeCustomSong(b.id), true)
  assert.equal(customSongs.getCustomSongs().length, start)
})

// ================================ midi ======================================
await test('parseMidiKaraoke: rejects non-MIDI bytes', () => {
  assert.equal(midi.parseMidiKaraoke(new TextEncoder().encode('this is not a midi file')), null)
  assert.equal(midi.parseMidiKaraoke(new Uint8Array(4)), null)
})

await test('parseMidiKaraoke: kar fixture parses tags, banner and timing', () => {
  const song = midi.parseMidiKaraoke(buildKarFixture())
  assert.ok(song, 'must parse the karaoke fixture')
  assert.equal(song.isKar, true)
  assert.equal(song.title, 'Full Sample Song')
  assert.equal(song.language, 'English')
  assert.equal(song.artist, 'Test Artist')
  assert.equal(song.format, 0)
  assert.equal(song.division, 96)
  assert.equal(song.ticksPerQuarter, 96)
  assert.ok(Math.abs(song.durationSec - 1.0) < 1e-6, `duration ~1s, got ${song.durationSec}`)
  // 120 bpm, 96 tpq → tick = 500000e-6/96 = 5.208333ms; 48 ticks = 0.25 s
  assert.equal(song.lines.length, 4)
  assert.deepEqual(
    song.lines.map((l) => l.text),
    ['Hel', 'lo', 'Wo', 'rld'],
  )
  assert.equal(song.syllables[0].startSec, 0)
  assert.ok(Math.abs(song.syllables[0].endSec - 0.25) < 1e-6)
  assert.ok(Math.abs(song.syllables[2].startSec - 0.5) < 1e-6)
  assert.ok(Math.abs(song.syllables[3].startSec - 0.75) < 1e-6)
  // melody: 60, 62, 64, 65 starting at 0, .25, .5, .75 with length .25
  assert.equal(song.notes.length, 4)
  assert.deepEqual(song.notes.map((n) => n.key), [60, 62, 64, 65])
  assert.ok(Math.abs(song.notes[0].startSec - 0) < 1e-6)
  assert.ok(Math.abs(song.notes[0].endSec - 0.25) < 1e-6)
  assert.ok(Math.abs(song.notes[3].endSec - 1.0) < 1e-6)
})

await test('parseMidiKaraoke: plain instrumental has no lyrics but music', () => {
  const song = midi.parseMidiKaraoke(buildPlainMidi())
  assert.ok(song)
  assert.equal(song.isKar, false, 'no banner → not karaoke')
  assert.equal(song.title, 'My Song', 'falls back to track name')
  assert.equal(song.syllables.length, 0)
  assert.equal(song.lines.length, 0)
  assert.equal(song.programChanges.length, 1)
  assert.equal(song.programChanges[0].program, 40)
  assert.equal(song.notes.length, 1)
  assert.equal(song.notes[0].key, 55)
  assert.ok(song.durationSec > 0.2 && song.durationSec < 0.3, `128bpm 48 ticks ≈ 0.234s, got ${song.durationSec}`)
})

await test('parseMidiKaraoke: SMPTE time division converts ticks to seconds', () => {
  const song = midi.parseMidiKaraoke(buildSmpteMidi())
  assert.ok(song)
  assert.equal(song.ticksPerQuarter, null)
  // 25 fps × 40 tpf = 1000 ticks/s → 48 ticks = 48 ms
  assert.ok(Math.abs(song.notes[0].endSec - 0.048) < 1e-6, `got ${song.notes[0].endSec}`)
})

await test('parseMidiKaraoke: CR line breaks split lines, duplicate lyric track dedupes', () => {
  const song = midi.parseMidiKaraoke(buildRealisticKarFixture())
  assert.ok(song)
  assert.equal(song.isKar, true, 'banner present')
  assert.equal(song.format, 1)
  // CR (0x0d) line breaks — not the `\`/`/` markup — must still split lines.
  assert.deepEqual(
    song.lines.map((l) => l.text),
    ['Hello', 'World'],
  )
  // the byte-identical second lyric track must not double every syllable
  assert.deepEqual(
    song.syllables.map((s) => s.text),
    ['Hel', 'lo ', 'Wo', 'rld'],
  )
  assert.ok(Math.abs(song.durationSec - 1.0) < 1e-6, `duration ~1s, got ${song.durationSec}`)
})

// ============================ backgrounds ===============================
await test('backgrounds: manifest is well-formed and >= 5 built-in loops', () => {
  assert.ok(background.BACKGROUNDS.length >= 5, 'need at least 5 built-in videos')
  const ids = new Set()
  for (const loop of background.BACKGROUNDS) {
    assert.ok(loop.id && loop.name, 'id and name required')
    assert.equal(loop.file, `${loop.id}.mp4`, 'file must be <id>.mp4')
    assert.ok(loop.category, 'category required')
    assert.ok(!ids.has(loop.id), `duplicate id ${loop.id}`)
    ids.add(loop.id)
    assert.equal(background.isKnownBackground(loop.id), true)
  }
  // a nature and an animated/motion entry must exist
  const cats = new Set(background.BACKGROUNDS.map((l) => l.category))
  assert.ok(cats.has('nature'), 'needs a Nature loop')
  assert.ok(cats.has('motion'), 'needs an Animated/3D loop')
  assert.equal(background.isKnownBackground('none'), false)
  assert.equal(background.isKnownBackground('nope'), false)
})

await test('backgrounds: url builders map id -> public asset, empty when unknown', () => {
  assert.equal(background.backgroundVideoUrl('aurora'), '/backgrounds/aurora.mp4')
  assert.equal(background.backgroundPosterUrl('aurora'), '/backgrounds/aurora.jpg')
  assert.equal(background.backgroundVideoUrl('none'), '')
  assert.equal(background.backgroundPosterUrl('none'), '')
  assert.equal(background.backgroundVideoUrl('nope'), '')
  assert.equal(background.backgroundPosterUrl('nope'), '')
})

await test('sanitizeBackground: clamps dim, fills defaults, rejects unknown ids', () => {
  assert.deepEqual(background.sanitizeBackground(null), background.DEFAULT_BACKGROUND)
  assert.deepEqual(background.sanitizeBackground('junk'), background.DEFAULT_BACKGROUND)
  assert.equal(background.sanitizeBackground({ id: 'nope' }).id, 'none')
  assert.equal(background.sanitizeBackground({ id: 'aurora' }).id, 'aurora')
  assert.equal(background.sanitizeBackground({ id: 'aurora' }).enabled, true)
  assert.equal(background.sanitizeBackground({ id: 'aurora', enabled: false }).enabled, false)
  assert.equal(background.sanitizeBackground({ id: 'aurora', dim: 9 }).dim, background.MAX_DIM)
  assert.equal(background.sanitizeBackground({ id: 'aurora', dim: -3 }).dim, 0)
  assert.equal(background.sanitizeBackground({ id: 'aurora', dim: 0.5 }).dim, 0.5)
  assert.equal(background.sanitizeBackground({ id: 'aurora', dim: 'x' }).dim, background.DEFAULT_BACKGROUND.dim)
})

await test('background store: select/toggle/dim persist and notify subscribers', () => {
  let hits = 0
  const stop = background.subscribeBackground(() => {
    hits += 1
  })

  background.setBackgroundId('aurora')
  assert.equal(background.getBackground().id, 'aurora')
  assert.ok(hits >= 1, 'subscriber should hear the change')

  background.setBackgroundEnabled(false)
  assert.equal(background.getBackground().enabled, false)

  background.setBackgroundDim(5)
  assert.equal(background.getBackground().dim, background.MAX_DIM)
  background.setBackgroundDim(-1)
  assert.equal(background.getBackground().dim, 0)

  assert.ok(localStorageStub.getItem('fv:background'), 'state must be persisted')
  const saved = JSON.parse(localStorageStub.getItem('fv:background'))
  assert.equal(saved.id, 'aurora')
  assert.equal(saved.enabled, false)

  // unknown ids are ignored (no corrupt state)
  background.setBackgroundId('totally-not-a-loop')
  assert.equal(background.getBackground().id, 'aurora')

  stop()
  const before = hits
  background.setBackgroundId('none')
  assert.equal(hits, before, 'unsubscribed listener must not fire')
  assert.equal(background.getBackground().id, 'none')
})

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(` - ${f.name}`)
  process.exit(1)
}
