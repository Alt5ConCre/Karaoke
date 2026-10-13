/**
 * Local `Songs/` library client.
 *
 * When the app runs through the offline server (scripts/offline-server.mjs,
 * `npm start`) a same-origin GET to `/api/songs` lists the karaoke folders the
 * user copied in. On a static host (e.g. Vercel) that route returns the SPA
 * shell HTML instead, so we only accept a real JSON array and otherwise return
 * an empty list — silently, so the catalog simply falls back to the demo set.
 */

import type { Song } from '../types.ts'

/** Shape of one /api/songs entry emitted by the offline server scan. */
interface RawLocalSong {
  id?: unknown
  title?: unknown
  artist?: unknown
  folder?: unknown
  videoUrl?: unknown
  coverUrl?: unknown
  language?: unknown
  genre?: unknown
  tags?: unknown
  youtubeId?: unknown
}

const LANGUAGES = new Set<Song['language']>(['Tagalog', 'Taglish', 'English'])

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toSong(raw: RawLocalSong): Song | null {
  if (!raw || typeof raw !== 'object') return null
  const mediaUrl = asString(raw.videoUrl)
  if (!mediaUrl) return null

  const folder = asString(raw.folder)
  const title = asString(raw.title) || folder || 'Untitled'
  const artist = asString(raw.artist) || 'Unknown artist'
  const slug = asString(raw.id) || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const language = asString(raw.language) as Song['language']
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map(asString).filter(Boolean)
    : []

  return {
    id: `local:${slug}`,
    title,
    artist,
    language: LANGUAGES.has(language) ? language : 'Tagalog',
    genre: asString(raw.genre) || 'Local library',
    tags: tags.length > 0 ? tags : ['local'],
    youtubeId: asString(raw.youtubeId),
    source: 'folder',
    mediaUrl,
    coverUrl: asString(raw.coverUrl) || undefined,
  }
}

/** Fetch the local Songs/ catalog, or [] when unavailable (any host, any error). */
export async function fetchLocalSongs(): Promise<Song[]> {
  if (typeof fetch !== 'function') return []
  try {
    const response = await fetch('/api/songs', { headers: { Accept: 'application/json' } })
    if (!response.ok) return []
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    if (!contentType.includes('application/json')) return []
    const data: unknown = await response.json()
    if (!Array.isArray(data)) return []
    const songs: Song[] = []
    for (const entry of data) {
      const song = toSong(entry as RawLocalSong)
      if (song) songs.push(song)
    }
    return songs
  } catch {
    return []
  }
}
