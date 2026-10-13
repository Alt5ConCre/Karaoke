// Offline karaoke server.
//
// Serves the built app (dist/) plus the local Songs/ library over plain http,
// with SPA fallback. No database, no network, no accounts. Used by:
//   - scripts/serve-offline.mjs   (the `npm start` launcher for Windows)
//   - scripts/fv-browser-test.mjs (headless runs against the same routes)
//
// Runs on Node's native TypeScript type-stripping for the shared scan helper.
import http from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitTitleArtist } from '../src/lib/songs.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(__dirname, '..')

const VIDEO_ORDER = ['video.mp4', 'video.webm', 'video.m4a', 'song.mp4', 'karaoke.mp4', 'audio.mp3']
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.m4a', '.mp3'])
const COVER_ORDER = ['cover.jpg', 'cover.png', 'cover.webp', 'cover.jpeg', 'poster.jpg', 'poster.png']

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.bat': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
}

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Scan one folder for a karaoke video + sidecars.
 * Returns the first matching extension in priority order, or null.
 */
async function findFile(dir, candidates) {
  let names
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  const set = new Set(names.map((n) => n.toLowerCase()))
  for (const candidate of candidates) {
    if (set.has(candidate.toLowerCase())) return candidate
  }
  return null
}

/**
 * Survey the Songs/ root and build the catalog the client fetches from
 * /api/songs. Every entry maps 1:1 to a folder a user copied into the library.
 */
export async function scanSongsRoot(songsRoot) {
  let entries
  try {
    entries = await readdir(songsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const songs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    const dir = path.join(songsRoot, entry.name)
    const videoFile = await findFile(dir, VIDEO_ORDER)
    if (!videoFile) continue
    const videoExt = path.extname(videoFile).toLowerCase()
    if (!VIDEO_EXTS.has(videoExt)) continue

    let title = entry.name
    let artist = ''
    try {
      const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))
      if (meta && typeof meta === 'object') {
        if (typeof meta.title === 'string' && meta.title.trim()) title = meta.title.trim()
        if (typeof meta.artist === 'string' && meta.artist.trim()) artist = meta.artist.trim()
      }
    } catch {
      const guess = splitTitleArtist(entry.name)
      title = guess.title
      artist = guess.artist
    }

    const encoded = `songs/${encodeURIComponent(entry.name)}`
    const coverFile = await findFile(dir, COVER_ORDER)
    songs.push({
      id: slugify(entry.name),
      title,
      artist,
      folder: entry.name,
      videoUrl: `/${encoded}/${videoFile}`,
      coverUrl: coverFile ? `/${encoded}/${coverFile}` : null,
      hasLyrics: (await findFile(dir, ['lyrics.json'])) !== null,
      hasNotes: (await findFile(dir, ['notes.json'])) !== null,
      lyricsUrl: `/songs/${encodeURIComponent(entry.name)}/lyrics.json`,
      notesUrl: `/songs/${encodeURIComponent(entry.name)}/notes.json`,
    })
  }
  songs.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  return songs
}

function safeJoin(root, decodedPath) {
  const resolved = path.resolve(root, `.${path.sep}${decodedPath}`)
  const within = resolved === root || resolved.startsWith(root + path.sep)
  return within ? resolved : null
}

function typeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/** Build the http server. dist = built app root, songsRoot = library root. */
export function createOfflineServer({ dist, songsRoot, log = () => {} }) {
  return http.createServer(async (req, res) => {
    const url = req.url ?? '/'
    const pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname)

    if (pathname === '/api/songs') {
      const songs = await scanSongsRoot(songsRoot)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(songs))
      return
    }

    if (pathname.startsWith('/songs/')) {
      const filePath = safeJoin(songsRoot, pathname.slice('/songs/'.length))
      if (!filePath || !filePath.startsWith(songsRoot)) {
        res.writeHead(403).end('forbidden')
        return
      }
      try {
        const body = await readFile(filePath)
        const inject = filePath.toLowerCase().endsWith('.json')
        res.writeHead(200, {
          'Content-Type': typeFor(filePath),
          'Cache-Control': inject ? 'no-store' : 'public, max-age=60',
        })
        res.end(body)
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found')
      }
      return
    }

    if (pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('unknown api route')
      return
    }

    // Static build output; unknown paths fall back to the SPA shell.
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const filePath = safeJoin(dist, requested)
    let servedPath = null
    let body = null
    if (filePath && filePath.startsWith(dist)) {
      try {
        body = await readFile(filePath)
        servedPath = filePath
      } catch {
        body = null
      }
    }
    if (body === null) {
      servedPath = path.join(dist, 'index.html')
      try {
        body = await readFile(servedPath)
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('no dist/index.html — run `npm run build` first')
        return
      }
    }
    log('GET', pathname)
    res.writeHead(200, { 'Content-Type': typeFor(servedPath), 'Cache-Control': 'no-cache' })
    res.end(body)
  })
}

/** Default layout: <projectRoot>/dist and <projectRoot>/Songs. */
export function defaultRoots() {
  return { dist: path.join(PROJECT_ROOT, 'dist'), songsRoot: path.join(PROJECT_ROOT, 'Songs') }
}