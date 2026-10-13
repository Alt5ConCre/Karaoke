// Build the UltraStar song catalog from the public CC song packages.
//
// Source: https://github.com/UltraStar-Deluxe/songs (Creative Commons licensed
// UltraStar packages). Each folder is one song: a `song.txt` (metadata + timed
// lyrics), an audio file (audio.mp3 / audio.ogg) and cover art.
//
// We only READ metadata and write a small TypeScript catalog (titles, artists,
// audio + cover URLs). No audio is ever downloaded or committed: the app streams
// the files straight from the public repo at runtime.
//
// Usage:  node scripts/fetch-ultrastar-catalog.mjs
//
// The generated file is committed; run this again only to refresh the catalog.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const OUT_FILE = path.join(PROJECT_ROOT, 'src', 'data', 'ultrastarSongs.ts')

const REPO = 'UltraStar-Deluxe/songs'
const BRANCH = 'master'
const ROOT_DIR = 'Creative Commons'

const API_TREE = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`

const AUDIO_ORDER = ['audio.mp3', 'audio.ogg', 'audio.m4a', 'audio.wav', 'song.mp3', 'song.ogg']
const COVER_ORDER = ['cover.jpg', 'cover.png', 'cover.jpeg', 'cover.webp', 'background.jpg', 'background.png']

/** Encode a repo-relative path for a raw.githubusercontent URL (keep slashes). */
function rawUrl(repoPath) {
  return `${RAW_BASE}/${repoPath.split('/').map(encodeURIComponent).join('/')}`
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Split an UltraStar header block ("#KEY:value" lines) into a lower-cased map. */
function parseHeaders(text) {
  const headers = new Map()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim()
    if (!line.startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(1, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key && value && !headers.has(key)) headers.set(key, value)
  }
  return headers
}

/** Approximate duration in seconds from the last timed note, when possible. */
function estimateDuration(text, headers) {
  const bpm = Number.parseFloat(headers.get('bpm') ?? '')
  if (!Number.isFinite(bpm) || bpm <= 0) return undefined
  const gapMs = Number.parseFloat(headers.get('gap') ?? '0')
  const gap = Number.isFinite(gapMs) ? gapMs / 1000 : 0
  let lastBeat = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*(\d+)\s+(\d+)\s+-?\d+\s+(.*\S)/)
    if (!match) continue
    const end = Number(match[1]) + Number(match[2])
    if (end > lastBeat) lastBeat = end
  }
  if (lastBeat <= 0) return undefined
  const seconds = gap + (lastBeat * 60) / bpm + 2
  return Math.round(seconds)
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'filipinovideoke-catalog' } })
  if (!response.ok) return null
  return response.text()
}

async function main() {
  console.log(`Fetching tree for ${REPO}@${BRANCH} …`)
  const treeResponse = await fetch(API_TREE, { headers: { 'User-Agent': 'filipinovideoke-catalog' } })
  if (!treeResponse.ok) {
    throw new Error(`GitHub tree request failed: ${treeResponse.status} ${treeResponse.statusText}`)
  }
  const tree = await treeResponse.json()
  const blobs = (tree.tree ?? []).filter((entry) => entry.type === 'blob')

  const prefix = `${ROOT_DIR}/`
  const folders = new Map()
  for (const blob of blobs) {
    if (!blob.path.startsWith(prefix)) continue
    const rest = blob.path.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) continue // a file dropped straight into the root dir
    const folder = rest.slice(0, slash)
    const file = rest.slice(slash + 1)
    if (file.includes('/')) continue // nested deeper than one level — skip
    if (!folders.has(folder)) folders.set(folder, [])
    folders.get(folder).push(file)
  }

  const names = [...folders.keys()].sort((a, b) => a.localeCompare(b))
  console.log(`Found ${names.length} song folders. Reading metadata …`)

  const songs = []
  const usedIds = new Set()
  for (const folder of names) {
    const files = folders.get(folder)
    const lower = files.map((file) => file.toLowerCase())
    const findByOrder = (order) => {
      for (const want of order) {
        const index = lower.indexOf(want)
        if (index !== -1) return files[index]
      }
      return null
    }

    const songFile = findByOrder(['song.txt'])
    const audioFile = findByOrder(AUDIO_ORDER) ?? files.find((f) => /\.(mp3|ogg|m4a|wav|opus)$/i.test(f))
    const coverFile = findByOrder(COVER_ORDER)

    if (!audioFile) {
      console.warn(`  skip (no audio): ${folder}`)
      continue
    }

    let text = ''
    if (songFile) {
      text = (await fetchText(rawUrl(`${ROOT_DIR}/${folder}/${songFile}`))) ?? ''
    }
    const headers = parseHeaders(text)

    const [fallbackArtist, fallbackTitle] = folder.includes(' - ')
      ? folder.split(' - ', 2)
      : ['', folder]
    const title = headers.get('title') ?? fallbackTitle
    const artist = headers.get('artist') ?? fallbackArtist ?? 'Unknown artist'
    const rawLanguage = (headers.get('language') ?? '').trim()
    const genre = headers.get('genre') ?? 'UltraStar'
    const yearValue = Number.parseInt(headers.get('year') ?? '', 10)
    const durationSec = estimateDuration(text, headers)

    const baseId = slugify(`${artist} ${title}`) || slugify(folder) || 'song'
    let id = `ultrastar:${baseId}`
    let suffix = 2
    while (usedIds.has(id)) {
      id = `ultrastar:${baseId}-${suffix}`
      suffix += 1
    }
    usedIds.add(id)

    const tags = ['ultrastar', 'creative-commons']
    if (rawLanguage && rawLanguage.toLowerCase() !== 'english') {
      tags.push(rawLanguage.toLowerCase())
    }

    songs.push({
      id,
      title,
      artist,
      year: Number.isFinite(yearValue) ? yearValue : undefined,
      language: 'English',
      genre,
      tags,
      youtubeId: '',
      durationSec,
      source: 'ultrastar',
      mediaUrl: rawUrl(`${ROOT_DIR}/${folder}/${audioFile}`),
      coverUrl: coverFile ? rawUrl(`${ROOT_DIR}/${folder}/${coverFile}`) : undefined,
      folder,
    })
    console.log(`  + ${artist} — ${title}`)
  }

  const body = songs
    .map((song) => {
      const lines = ['  {']
      lines.push(`    id: ${JSON.stringify(song.id)},`)
      lines.push(`    title: ${JSON.stringify(song.title)},`)
      lines.push(`    artist: ${JSON.stringify(song.artist)},`)
      if (song.year !== undefined) lines.push(`    year: ${song.year},`)
      lines.push(`    language: 'English',`)
      lines.push(`    genre: ${JSON.stringify(song.genre)},`)
      lines.push(`    tags: ${JSON.stringify(song.tags)},`)
      lines.push(`    youtubeId: '',`)
      if (song.durationSec !== undefined) lines.push(`    durationSec: ${song.durationSec},`)
      lines.push(`    source: 'ultrastar',`)
      lines.push(`    mediaUrl: ${JSON.stringify(song.mediaUrl)},`)
      if (song.coverUrl) lines.push(`    coverUrl: ${JSON.stringify(song.coverUrl)},`)
      lines.push(`  },`)
      return lines.join('\n')
    })
    .join('\n')

  const file = `// GENERATED FILE — do not edit by hand.
//
// The Creative Commons song packages from https://github.com/${REPO}, as a
// catalog the app can browse. Titles, artists and cover art come from the
// packages' own \`song.txt\` files; the audio is streamed straight from the
// public repo at runtime (nothing is downloaded or bundled here).
//
// Regenerate with:  node scripts/fetch-ultrastar-catalog.mjs
import type { Song } from '../types.ts'

/** Provenance + attribution for the library these entries came from. */
export const ULTRATAR_LIBRARY = {
  repo: 'https://github.com/${REPO}',
  count: ${songs.length},
  note: 'Songs are Creative Commons licensed (BY, BY-SA, BY-NC, BY-NC-SA or CC0) — see each package\\'s license.txt. Audio is streamed from the public repo; nothing is bundled.',
}

export const ULTRATAR_SONGS: Song[] = [
${body}
]
`

  await writeFile(OUT_FILE, file, 'utf8')
  console.log(`\nWrote ${songs.length} songs to ${path.relative(PROJECT_ROOT, OUT_FILE)}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
