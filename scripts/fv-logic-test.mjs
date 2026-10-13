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

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(` - ${f.name}`)
  process.exit(1)
}
