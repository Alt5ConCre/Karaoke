/**
 * Local song-library helpers.
 *
 * These are intentionally free of React and of type-only imports so the offline
 * karaoke server (scripts/offline-server.mjs) can strip types and load this file
 * straight from src with Node's native TypeScript support.
 */

/**
 * Split a folder/file name into title + artist. Convention: "Anak - Freddie
 * Aguilar" → title "Anak", artist "Freddie Aguilar". A meta.json always wins
 * over this guess.
 */
export function splitTitleArtist(name: string): { title: string; artist: string } {
  const cleaned = name
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\s*\((video|karaoke|instrumental)\)\s*$/i, '')
    .trim()
  const parts = cleaned
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    return { title: parts[0] as string, artist: parts.slice(1).join(' - ') }
  }
  return { title: cleaned, artist: 'Unknown artist' }
}

/** m:ss (and h:mm:ss for anything long) from seconds. */
export function formatTime(totalSeconds: number | undefined): string {
  if (totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00'
  const s = Math.floor(totalSeconds)
  const minutes = Math.floor(s / 60)
  const seconds = s % 60
  const hours = Math.floor(minutes / 60)
  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
