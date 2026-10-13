// Filipino Videoke service worker.
//
// Offline strategy: cache the app shell and serve same-origin GETs cache-first,
// while navigations go network-first (so a fresh deploy is picked up) and fall
// back to the cached shell when offline. Cross-origin requests (the YouTube
// IFrame player, etc.) always pass straight through and are never cached.
const CACHE = 'fv-shell-v1'
const SHELL = '/'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SHELL]))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return

  // The local library routes are live data served by the offline server:
  // `/api/songs` changes as folders are added, and `/songs/*` can be huge
  // media files we must not hoard in the cache. Let the network handle both.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/songs/')) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(SHELL, copy))
          return res
        })
        .catch(() => caches.match(SHELL)),
    )
    return
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok && res.type === 'basic') {
              const copy = res.clone()
              caches.open(CACHE).then((cache) => cache.put(req, copy))
            }
            return res
          })
          .catch(() => hit),
    ),
  )
})
