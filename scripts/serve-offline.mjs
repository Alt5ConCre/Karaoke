// `npm start` — launch the offline karaoke app for Windows.
//
//     node scripts/serve-offline.mjs [port]
//
// Serves the built app from ./dist and the local library from ./Songs on
// 127.0.0.1:<port> (default 4175). Open the printed URL with any browser.
// No internet, accounts, rooms or services are involved.

import { createOfflineServer, defaultRoots } from './offline-server.mjs'

const port = Number(process.argv[2] ?? process.env.PORT ?? 4175)
const { dist, songsRoot } = defaultRoots()

const server = createOfflineServer({
  dist,
  songsRoot,
  log: () => {},
})

server.listen(port, '127.0.0.1', () => {
  console.log('')
  console.log('  Filipino Videoke — offline karaoke')
  console.log('  ----------------------------------')
  console.log(`  Open: http://127.0.0.1:${port}/`)
  console.log('  Songs library: ' + songsRoot)
  console.log('  Runs entirely on this machine. Press Ctrl+C to stop.')
  console.log('')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}