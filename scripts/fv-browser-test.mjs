// Browser smoke/flow test for FilipinoVideoke using headless Chrome over CDP.
// No npm deps: Node 24's global fetch + WebSocket drive Chrome's DevTools API.
// Usage: node fv-browser-test.mjs <abs dist dir> <abs chrome path>
// Serves dist/ on a local port (SPA fallback) and drives three tabs.

import { createServer } from 'node:http'
import { readFile, mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { buildKarFixture } from './fv-midi-fixture.mjs'

const [DIST, CHROME] = process.argv.slice(2)
if (!DIST || !CHROME) {
  console.error('usage: node fv-browser-test.mjs <dist dir> <chrome.exe>')
  process.exit(2)
}

const PORT = 4174
const DBG_PORT = 9235
const tick = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------- static server (SPA fallback) ----------------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.json': 'application/json', '.map': 'application/json',
  '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
}
const server = createServer(async (req, res) => {
  try {
    let url = decodeURIComponent((req.url || '/').split('?')[0])
    let file = path.join(DIST, url === '/' ? 'index.html' : url)
    if (!existsSync(file) || !url.startsWith('/')) {
      // SPA fallback: unknown deep routes serve index.html so Router can run.
      file = path.join(DIST, 'index.html')
    }
    const body = await readFile(file)
    const ext = path.extname(file).toLowerCase()
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise((r) => server.listen(PORT, r))
const BASE = `http://127.0.0.1:${PORT}`

// ---------------- chrome ----------------
const profile = await mkdtemp(path.join(tmpdir(), 'fv-profile-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${DBG_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-sandbox',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
)
async function waitForDebugger() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${DBG_PORT}/json/version`)
      if (r.ok) return
    } catch { /* not up yet */ }
    await tick(100)
  }
  throw new Error('Chrome DevTools endpoint never came up')
}
await waitForDebugger()

// ---------------- minimal CDP client ----------------
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.seq = 0
    this.pending = new Map()
    this.consoleErrors = []
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = () => reject(new Error('ws error'))
    })
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id) {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (!p) return
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result)
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(`EXCEPTION: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`)
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry?.level === 'error') {
        this.consoleErrors.push(`LOG ERROR: ${msg.params.entry.text}`)
      }
    }
  }
  async send(method, params = {}) {
    await this.ready
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
}

async function connectToPage(target) {
  const cdp = new CDP(target.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  })
  return cdp
}

async function newTab(url) {
  const res = await fetch(`http://127.0.0.1:${DBG_PORT}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  })
  const target = await res.json()
  // never fails: wait until the target appears in /json/list with a ws url
  for (let i = 0; i < 50; i += 1) {
    const list = await (await fetch(`http://127.0.0.1:${DBG_PORT}/json/list`)).json()
    const live = list.find((t) => t.id === target.id && t.webSocketDebuggerUrl)
    if (live) return connectToPage(live)
    await tick(100)
  }
  throw new Error('tab never became connectable')
}

async function evalJs(page, expression) {
  const r = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  }
  return r.result?.value
}

async function waitFor(page, expression, label, timeoutMs = 9000) {
  const start = Date.now()
  for (;;) {
    const ok = await evalJs(page, `Boolean(${expression})`)
    if (ok) return
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for: ${label} (${expression})`)
    }
    await tick(200)
  }
}

const HELPERS = `
window.__qs = (s) => document.querySelector(s);
window.__qsa = (s) => [...document.querySelectorAll(s)];
window.__set = function(el, v) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
window.__text = (el) => el ? (el.innerText || el.textContent || '').trim() : '';
`

// ---------------- runner ----------------
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

// ---------------- the tests ----------------
const A = await newTab(`${BASE}/`)
await evalJs(A, HELPERS)

await test('homepage renders: title, hero, demo banner, 13-song grid, local transport', async () => {
  await waitFor(A, `__qs('.hero__title')`, 'hero title')
  const title = await evalJs(A, `document.title`)
  assertTrue(title.includes('Filipino Videoke'), `document.title = ${title}`)
  const hero = await evalJs(A, `__qs('.hero__title').innerText`)
  assertTrue(hero.includes('videoke bar'), `hero = "${hero}"`)
  const banner = await evalJs(A, `__text(__qs('.demo-banner'))`)
  assertTrue(banner.includes('simulated'), 'banner must say scores are simulated')
  const count = await evalJs(A, `__qsa('.song-card').length`)
  assertTrue(count === 13, `expected 13 song cards, got ${count}`)
  const transport = await evalJs(A, `__text(__qs('.hero__transport'))`)
  assertTrue(transport.includes('Local room (this browser)'), `transport = ${transport}`)
  const identity = await evalJs(A, `__text(__qs('.chip--identity'))`)
  assertTrue(identity.includes('Guest'), `identity = ${identity}`)
})

await test('search filters the catalog (title/artist match + empty state)', async () => {
  await waitFor(A, `__qs('.search__input')`, 'search input')
  await evalJs(A, `__set(__qs('.search__input'), 'eraser')`)
  await waitFor(A, `__text(__qs('.results-line')).includes('2 songs')`, '2 results for eraser')
  const titles = await evalJs(
    A,
    `__qsa('.song-card__title').map((e) => e.innerText).join('|')`,
  )
  assertTrue(titles.includes('Ang Huling El Bimbo') && titles.includes('Minsan'), titles)
  await evalJs(A, `__set(__qs('.search__input'), 'zzzznope')`)
  await waitFor(A, `__qs('.empty-state')`, 'empty state')
  const emptyText = await evalJs(A, `__text(__qs('.empty-state'))`)
  assertTrue(emptyText.includes('Walang nahanap'), emptyText)
  await evalJs(A, `__set(__qs('.search__input'), '')`)
})

await test('language filter pills narrow to one catalog entry', async () => {
  await waitFor(A, `__qsa('.pill').length === 4`, '4 pills')
  await evalJs(
    A,
    `[...document.querySelectorAll('.pill')].find((b) => b.innerText.trim() === 'English').click()`,
  )
  await waitFor(A, `__text(__qs('.results-line')).includes('1 song')`, '1 result for English')
  const title = await evalJs(A, `__qs('.song-card__title').innerText`)
  assertTrue(title.includes('Ending Song'), `English result = ${title}`)
  await evalJs(
    A,
    `[...document.querySelectorAll('.pill')].find((b) => b.innerText.trim() === 'All').click()`,
  )
  await waitFor(A, `__qsa('.song-card').length === 13`, 'restore all')
})

await test('create room navigates to /room/CODE and shows the code', async () => {
  const card = `__qsa('.lobby-card')[0]`
  await evalJs(A, `__set(${card}.querySelectorAll('input')[0], 'Test Night')`)
  await evalJs(A, `__set(${card}.querySelectorAll('input')[1], 'Ana')`)
  await evalJs(A, `${card}.querySelector('button[type=submit]').click()`)
  await waitFor(A, `/^\\/room\\/[A-Z2-9]{5}$/.test(location.pathname)`, 'room URL')
  const code = await evalJs(A, `location.pathname.split('/').pop()`)
  await waitFor(A, `(/^[A-Z2-9]{5}$/.test('${code}'))`, 'valid code')
  globalThis.ROOM_CODE = code
  await waitFor(A, `__text(__qs('.room-topbar__code strong')) === '${code}'`, 'topbar code')
})

await test('add a song and it auto-promotes to now singing (host on mic)', async () => {
  const card = `__qsa('.song-card')[0]`
  await evalJs(A, `${card}.querySelector('button.btn--primary').click()`)
  await waitFor(A, `__qs('.queue-now') && __text(__qs('.queue-now')).includes('Anak')`, 'Anak now singing')
  await waitFor(A, `__qs('.rotation-row .badge--live')`, 'on Mic badge')
  const micText = await evalJs(A, `__text(__qs('.rotation-list'))`)
  // .badge applies text-transform: uppercase, so innerText reads "ON MIC".
  const micLower = micText.toLowerCase()
  assertTrue(micLower.includes('ana') && micLower.includes('on mic'), micText)
})

// ---- second singer joins in a second tab (real guest path) ----
const B = await newTab(`${BASE}/`)
await evalJs(B, HELPERS)
await waitFor(B, `__qs('.hero__title')`, 'hero on tab B')

await test('second tab joins the same room with a fresh guest identity', async () => {
  // Forgetting the shared guest profile makes tab B a brand-new person.
  await evalJs(B, `localStorage.removeItem('fv:profile')`)
  await evalJs(B, `location.href = '${BASE}/room/${globalThis.ROOM_CODE}'`)
  // A full document reload wipes the injected helpers; re-install them.
  await tick(500)
  await evalJs(B, HELPERS)
  await waitFor(B, `__qs('.join-panel__title')`, 'join panel')
  const joinTitle = await evalJs(B, `__text(__qs('.join-panel__title'))`)
  assertTrue(joinTitle.includes('Join room'), joinTitle)
  await evalJs(B, `__set(__qs('.join-panel__form input.input'), 'Ben')`)
  await evalJs(B, `__qs('.join-panel__form button[type=submit]').click()`)
  await waitFor(B, `__qs('.room-topbar')`, 'room topbar on B (joined)')
  const topbar = await evalJs(B, `__text(__qs('.room-topbar__code strong'))`)
  assertTrue(topbar === globalThis.ROOM_CODE, topbar)
})

await test('host tab sees the new singer appear through cross-tab sync', async () => {
  await waitFor(A, `__qsa('.rotation-row').length === 2`, 'two singers in rotation on A')
  await waitFor(A, `__text(__qs('.rotation-list')).includes('Ben')`, 'Ben listed on A')
  const rotation = await evalJs(A, `__text(__qs('.rotation-list'))`)
  assertTrue(rotation.includes('Ana') && rotation.includes('Ben'), rotation)
})

await test('second singer queues a song from their own tab', async () => {
  await waitFor(B, `__qsa('.song-card').length === 13`, 'catalog on B')
  await evalJs(B, `__qsa('.song-card')[0].querySelector('button.btn--primary').click()`)
  await waitFor(
    A,
    `__qsa('.queue-row').length === 1 && __text(__qs('.queue-list')).includes('Ben')`,
    'Ben song waiting visible on A',
  )
})

await test('singer A queues a second song, then rotation fairness gives the mic to Ben', async () => {
  await evalJs(A, `__qsa('.song-card')[1].querySelector('button.btn--primary').click()`)
  await waitFor(A, `__qsa('.queue-row').length === 2`, 'two waiting songs on A')
  await evalJs(A, `[...document.querySelectorAll('button')].find((b) => b.innerText.includes('End & score')).click()`)
  // Ana just sang → rotation must promote Ben's song, not Ana's.
  await waitFor(
    A,
    `__qs('.queue-now') && __text(__qs('.queue-now')).includes('Anak') && __text(__qs('.queue-now__singer')).includes('Ben')`,
    'Ben now singing after Ana ended',
  )
  const now = await evalJs(A, `__text(__qs('.queue-now'))`)
  assertTrue(now.includes('Anak') && now.includes('Ben'), now)
})

await test('demo score recorded on leaderboard with simulated disclaimer', async () => {
  await waitFor(A, `__qsa('.leader-row').length >= 1`, 'leaderboard row')
  await waitFor(A, `__qs('.badge--demo')`, 'demo badge')
  const score = Number(await evalJs(A, `__text(__qs('.leader-row__score strong'))`))
  assertTrue(score >= 62 && score <= 100, `leaderboard total = ${score}`)
  const warn = await evalJs(A, `__text(__qs('.panel__footnote--warn'))`)
  assertTrue(warn.includes('simulated'), warn)
  const lbText = await evalJs(A, `__text(__qs('.leaderboard'))`)
  assertTrue(lbText.includes('Ana'), lbText)
})

await test('mode toggle switches rotation ↔ queue in the UI', async () => {
  await evalJs(
    A,
    `[...document.querySelectorAll('.segmented__option')].find((b) => b.innerText.trim() === 'Queue').click()`,
  )
  await waitFor(A, `__text(__qs('.panel__footnote')).includes('first-come')`, 'queue footnote on A')
  const footnote = await evalJs(A, `__text(__qs('.panel__footnote'))`)
  assertTrue(footnote.includes('Strict first-come'), footnote)
})

await test('background picker: lists loops (incl. nature + animated) and remembers the choice', async () => {
  await waitFor(A, `__qs('.bg-picker')`, 'background picker on the stage')
  const swatches = await evalJs(A, `__qsa('.bg-swatch').length`)
  // one "None" tile plus the built-in loops
  assertTrue(swatches >= 6, `expected None + >=5 loops, got ${swatches}`)
  const names = await evalJs(A, `__qsa('.bg-swatch[title]').map((b) => b.title).join('|')`)
  assertTrue(/Aurora/.test(names), names)
  assertTrue(/Forest|Desert|Cloud/.test(names), `needs a nature loop: ${names}`)
  assertTrue(/Tunnel|Deep|Nebula/.test(names), `needs an animated/3D loop: ${names}`)
  // Selecting a loop marks it active and persists the choice.
  await evalJs(A, `__qsa('.bg-swatch').find((b) => b.title === 'Aurora').click()`)
  await waitFor(
    A,
    `(__qsa('.bg-swatch.is-active')[0] || {}).title === 'Aurora'`,
    'Aurora marked selected',
  )
  const saved = await evalJs(A, `JSON.parse(localStorage.getItem('fv:background') || '{}').id`)
  assertTrue(saved === 'aurora', `persisted background id = ${saved}`)
  const dim = await evalJs(A, `Number(__qs('.bg-picker__dim input').value)`)
  assertTrue(dim > 0 && dim <= 0.85, `dim slider value = ${dim}`)
})

const CARD_BY_TITLE = (t) => `
  [...document.querySelectorAll('.song-card')]
    .find((c) => c.querySelector('.song-card__title').innerText.includes(${JSON.stringify(t)}))
`
const PREVIEW_BUTTON = (t) => `
  (() => { const c = ${CARD_BY_TITLE(t)}; [...c.querySelectorAll('button')].find((b) => b.innerText.includes('Preview')).click(); })()
`
const CARD_IFRAME = (t, needle) => `
  (() => { const c = ${CARD_BY_TITLE(t)}; const i = c && c.querySelector('.player__frame iframe');
    return !!(i && i.src.includes(${JSON.stringify(needle)})); })()
`
const CARD_NOTICE = (t) => `
  (() => { const c = ${CARD_BY_TITLE(t)}; return c ? c.querySelector('.player__notice') : null; })()
`

await test('official embed iframe wiring for the technical demo video', async () => {
  await evalJs(A, PREVIEW_BUTTON('Ending Song'))
  await waitFor(A, CARD_IFRAME('Ending Song', 'youtube-nocookie.com/embed/jNQXAC9IVRw'), 'embed iframe', 12000)
  const src = await evalJs(A, `(${CARD_BY_TITLE('Ending Song')}).querySelector('.player__frame iframe').src`)
  assertTrue(src.includes('enablejsapi=1'), src)
  assertTrue(src.includes('origin='), src)
})

await test('unavailable/restricted video shows a graceful fallback (no silent black box)', async () => {
  // Pick a song with no configured id, attach one that cannot play, and expect
  // either the hard error notice or the soft "Video not showing?" hint.
  await evalJs(A, PREVIEW_BUTTON('Ang Huling El Bimbo'))
  await waitFor(
    A,
    `(${CARD_BY_TITLE('Ang Huling El Bimbo')}) && (${CARD_BY_TITLE('Ang Huling El Bimbo')}).querySelector('.add-video input')`,
    'add-video box on card',
  )
  await evalJs(
    A,
    `__set((${CARD_BY_TITLE('Ang Huling El Bimbo')}).querySelector('.add-video input'), 'zzzzzzzzzzz')`,
  )
  await evalJs(A, `(${CARD_BY_TITLE('Ang Huling El Bimbo')}).querySelector('.add-video button[type=submit]').click()`)
  await waitFor(A, CARD_NOTICE('Ang Huling El Bimbo'), 'player notice after embed fail', 14000)
  const notice = await evalJs(A, `__text(${CARD_NOTICE('Ang Huling El Bimbo')})`)
  assertTrue(
    notice.includes('YouTube') || notice.includes('unavailable') || notice.includes('embedding'),
    `notice = ${notice}`,
  )
  const link = await evalJs(A, `(${CARD_BY_TITLE('Ang Huling El Bimbo')}).querySelector('.player__notice a').href`)
  assertTrue(link.includes('watch?v=zzzzzzzzzzz'), link)
})

await test('responsive: no horizontal overflow at phone and desktop sizes', async () => {
  await evalJs(A, HELPERS)
  await waitFor(A, `__qs('.room-grid')`, 'room grid')
  await A.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
  })
  await tick(400)
  const phone = await evalJs(
    A,
    `({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth })`,
  )
  assertTrue(phone.scrollW <= phone.innerW + 2, `phone overflow: ${JSON.stringify(phone)}`)

  await A.send('Emulation.clearDeviceMetricsOverride')
  await A.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  })
  await tick(400)
  const desktop = await evalJs(
    A,
    `({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth })`,
  )
  assertTrue(desktop.scrollW <= desktop.innerW + 2, `desktop overflow: ${JSON.stringify(desktop)}`)
})

// ---- add-your-own-songs flow (device-local, third tab) ----
const C = await newTab(`${BASE}/`)
await evalJs(C, HELPERS)

// Pre-select a background loop so the local MIDI player must render it behind
// the lyrics (local songs are the only ones that get a background).
await evalJs(
  C,
  `localStorage.setItem('fv:background', JSON.stringify({ id: 'aurora', enabled: true, dim: 0.45 }))`,
)
await evalJs(C, `location.reload()`)
await tick(700)
await evalJs(C, HELPERS)

/** Attach a real file to the "Choose files" input via CDP (no drag-and-drop). */
async function setDeviceFile(page, filePath) {
  await page.send('DOM.enable')
  const doc = await page.send('DOM.getDocument')
  const q = await page.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'input[aria-label="Choose video or audio files from this device"]',
  })
  assertTrue(q.nodeId > 0, 'must find the files input node')
  await page.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [filePath] })
}

await test('add-song: form adds a custom song, then Remove takes it back', async () => {
  await waitFor(C, `__qsa('.song-card').length === 13`, 'full catalog on C')
  await evalJs(C, `__qs('.add-song .panel__head button').click()`)
  await waitFor(C, `__qs('#add-song-title')`, 'add-song single form')
  await evalJs(C, `__set(__qs('#add-song-title'), 'Test Custom Song')`)
  await evalJs(C, `__set(__qs('#add-song-artist'), 'QA Bot')`)
  await evalJs(C, `__qs('.add-song form button[type=submit]').click()`)
  await waitFor(C, `__qsa('.song-card').length === 14`, 'one more card after add')
  await waitFor(C, `__qs('.add-song__notice')`, 'add-song notice')
  const badgeCount = await evalJs(C, `__qsa('.badge--user').length`)
  assertTrue(badgeCount === 1, `expected one "Your song" badge, got ${badgeCount}`)
  const hasCard = await evalJs(
    C,
    `[...document.querySelectorAll('.song-card')]
       .some((c) => c.querySelector('.song-card__title').innerText.includes('Test Custom Song'))`,
  )
  assertTrue(hasCard, 'the added song must have a card')
  await evalJs(
    C,
    `(() => {
       const c = [...document.querySelectorAll('.song-card')]
         .find((c) => c.querySelector('.song-card__title').innerText.includes('Test Custom Song'))
       ;[...c.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Remove').click()
     })()`,
  )
  await waitFor(C, `__qsa('.song-card').length === 13`, 'card removed')
})

await test('add-song: a .kar file previews through the MIDI karaoke player', async () => {
  if (!(await evalJs(C, `!!__qs('.add-song__body')`))) {
    await evalJs(C, `__qs('.add-song .panel__head button').click()`)
    await waitFor(C, `__qs('.add-song__body')`, 'add-song panel body')
  }
  await evalJs(
    C,
    `[...document.querySelectorAll('.segmented__option')].find((b) => b.innerText.includes('Pick files')).click()`,
  )
  await waitFor(C, `__qs('input[aria-label="Choose video or audio files from this device"]')`, 'files input')

  const karDir = await mkdtemp(path.join(tmpdir(), 'fv-kar-'))
  const karPath = path.join(karDir, 'Full Sample Song.kar')
  await writeFile(karPath, buildKarFixture())

  await setDeviceFile(C, karPath)

  try {
    await waitFor(C, `__qsa('.song-card').length === 14`, 'kar card added')
  } catch (error) {
    const dbg = await evalJs(
      C,
      `({ notice: __qs('.add-song__notice') ? __text(__qs('.add-song__notice')) : null, cards: __qsa('.song-card').length, titles: __qsa('.song-card__title').map((e) => e.innerText).join('|') })`,
    )
    console.log(`DIAG  ${JSON.stringify(dbg)}`)
    throw error
  }
  await waitFor(
    C,
    `__qsa('.song-card').some((c) => c.querySelector('.song-card__title').innerText.includes('Full Sample Song'))`,
    'kar song card',
  )
  await evalJs(C, PREVIEW_BUTTON('Full Sample Song'))
  await waitFor(
    C,
    `(${CARD_BY_TITLE('Full Sample Song')}).querySelector('.midi-player')`,
    'MIDI player in the card',
    12000,
  )
  const midiText = await evalJs(
    C,
    `__text((${CARD_BY_TITLE('Full Sample Song')}).querySelector('.midi-player'))`,
  )
  assertTrue(
    midiText.includes('Full Sample Song') &&
      midiText.toUpperCase().includes('ENGLISH') &&
      midiText.includes('Hel') &&
      midiText.includes('lo'),
    `midi player text = ${midiText}`,
  )

  // The pre-selected background must run, muted and looping, behind the lyrics
  // (z-index 0, lyrics lifted above it).
  const bg = await evalJs(
    C,
    `(() => {
       const screen = (${CARD_BY_TITLE('Full Sample Song')}).querySelector('.midi-player__screen');
       const layer = screen && screen.querySelector('.bgvideo');
       const v = layer && layer.querySelector('.bgvideo__el');
       const lyrics = screen && screen.querySelector('.midi-player__lyrics');
       if (!v) return { present: false };
       return {
         present: true,
         src: v.getAttribute('src') || v.src,
         muted: v.muted,
         loop: v.loop,
         zLayer: getComputedStyle(layer).zIndex,
         zLyrics: lyrics ? getComputedStyle(lyrics).zIndex : null,
       };
     })()`,
  )
  assertTrue(bg.present, 'background layer must render in the MIDI screen')
  assertTrue(bg.src.includes('/backgrounds/aurora.mp4'), `bg src = ${bg.src}`)
  assertTrue(bg.muted === true, 'background must be muted')
  assertTrue(bg.loop === true, 'background must loop')
  assertTrue(bg.zLayer === '0', `bg layer z-index = ${bg.zLayer}`)
  assertTrue(Number(bg.zLyrics) >= 1, `lyrics must sit above the bg, z = ${bg.zLyrics}`)

  await evalJs(
    C,
    `(() => {
       const c = ${CARD_BY_TITLE('Full Sample Song')}
       ;[...c.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Remove').click()
     })()`,
  )
  await waitFor(C, `__qsa('.song-card').length === 13`, 'kar card removed')
})

// console noise (favicon etc.) is a warning only; uncaught exceptions fail.
const allErrors = [...A.consoleErrors, ...B.consoleErrors, ...C.consoleErrors]
if (allErrors.length) {
  console.log(`WARN  console errors (checked, not auto-failing):\n  ${allErrors.join('\n  ')}`)
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log(`\n${passed} passed, ${failures.length} failed, 3 tabs used`)
chrome.kill()
server.close()
if (failures.length) process.exit(1)