/**
 * Songs the singer added themselves, kept per device.
 *
 * These live in localStorage (`fv:custom-songs`) rather than IndexedDB: they are
 * small metadata records (a title, an artist, maybe a YouTube id). Any video or
 * audio file that goes with them is stored separately by `mediaStore.ts` under
 * the song's id, exactly like a demo song's picked file.
 *
 * The module keeps one cached array so `useSyncExternalStore` can hand React a
 * stable reference, and notifies subscribers on every change (including changes
 * made in another tab, via the `storage` event).
 */

import type { Language, Song } from '../types.ts'
import { readJson, writeJson } from './storage.ts'
import { parseVideoId } from './youtube.ts'

export const STORAGE_KEY = 'fv:custom-songs'

/** Languages a user-added song can be tagged with (matches `Language`). */
export const LANGUAGES: Language[] = ['Tagalog', 'Taglish', 'English']

const LANGUAGE_BY_LOWER = new Map(
  LANGUAGES.map((language) => [language.toLowerCase(), language]),
)

/** A `Song` the singer added on this device. */
export interface CustomSong extends Song {
  source: 'custom'
  createdAt: number
}

/** What the add-song form collects for one entry. */
export interface NewSongInput {
  title: string
  artist?: string
  language?: string
  genre?: string
  youtubeId?: string
  tags?: string[]
}

function toLanguage(value: unknown): Language {
  if (typeof value === 'string') {
    const hit = LANGUAGE_BY_LOWER.get(value.trim().toLowerCase())
    if (hit) return hit
  }
  return 'Tagalog'
}

/** Lower-case, ASCII-ish slug; blank when the input has no usable characters. */
export function slugify(value: string, max = 48): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8)
}

/**
 * Build a stable id for a custom song. Pass a `unique` hint (a list marker or a
 * file size) to make adding the same thing twice a no-op; omit it for entries
 * that should be allowed to repeat.
 */
export function makeCustomSongId(label: string, unique?: string | number): string {
  const base = slugify(label, 40) || 'song'
  const suffix =
    unique === undefined ? randomSuffix() : slugify(String(unique), 16) || randomSuffix()
  return `custom:${base}-${suffix}`
}

/**
 * Turn raw input into a `CustomSong`, or `null` when there is no title.
 * `unique` is threaded into the id so bulk re-adds stay idempotent.
 */
export function buildCustomSong(
  input: NewSongInput,
  unique?: string | number,
): CustomSong | null {
  const title = (input.title ?? '').trim()
  if (!title) return null

  const artist = (input.artist ?? '').trim() || 'Unknown artist'
  const genre = (input.genre ?? '').trim() || 'My songs'
  const youtubeRaw = (input.youtubeId ?? '').trim()
  const youtubeId = youtubeRaw ? parseVideoId(youtubeRaw) ?? '' : ''
  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 12)

  return {
    id: makeCustomSongId(title, unique),
    title,
    artist,
    language: toLanguage(input.language),
    genre,
    tags: tags.length ? tags : ['my song'],
    youtubeId,
    source: 'custom',
    createdAt: Date.now(),
  }
}

/**
 * Parse a pasted block into entries. One song per line, fields split on `|`:
 *
 *   Title | Artist | YouTube link or id
 *
 * A field equal to Tagalog/Taglish/English (any case) sets the language, and a
 * line starting with `#` or that is empty is ignored. Only the title is
 * required; the rest may be omitted.
 */
export function parseSongLines(text: string): NewSongInput[] {
  const out: NewSongInput[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const parts = line.split('|').map((part) => part.trim())
    const title = parts[0]
    if (!title) continue

    const entry: NewSongInput = { title }
    for (const part of parts.slice(1)) {
      if (!part) continue
      const language = LANGUAGE_BY_LOWER.get(part.toLowerCase())
      if (language) {
        entry.language = language
        continue
      }
      if (!entry.artist) {
        entry.artist = part
        continue
      }
      if (!entry.youtubeId) entry.youtubeId = part
    }
    out.push(entry)
  }
  return out
}

/**
 * Coerce whatever was stored (or a hand-edited file) into well-formed songs.
 * Exported on its own so the tests can exercise it without touching storage.
 */
export function sanitizeCustomSongs(raw: unknown): CustomSong[] {
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  const out: CustomSong[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
    if (!id || !title) continue
    if (seen.has(id)) continue
    seen.add(id)

    const artist =
      typeof candidate.artist === 'string' && candidate.artist.trim()
        ? candidate.artist.trim()
        : 'Unknown artist'
    const genre =
      typeof candidate.genre === 'string' && candidate.genre.trim()
        ? candidate.genre.trim()
        : 'My songs'
    const tags = Array.isArray(candidate.tags)
      ? candidate.tags
          .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
          .slice(0, 12)
      : []
    const youtubeId = typeof candidate.youtubeId === 'string' ? candidate.youtubeId : ''
    const createdAt =
      typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
        ? candidate.createdAt
        : Date.now()

    const song: CustomSong = {
      id,
      title,
      artist,
      language: toLanguage(candidate.language),
      genre,
      tags: tags.length ? tags : ['my song'],
      youtubeId,
      source: 'custom',
      createdAt,
    }
    if (typeof candidate.year === 'number') song.year = candidate.year
    if (typeof candidate.durationSec === 'number') song.durationSec = candidate.durationSec
    out.push(song)
  }
  return out
}

/* ------------------------------------------------------------------ store */

let cache: CustomSong[] = []
let loaded = false
const listeners = new Set<() => void>()

function hydrate(): void {
  if (loaded) return
  loaded = true
  cache = sanitizeCustomSongs(readJson<unknown>(STORAGE_KEY))
}

function notify(): void {
  for (const listener of listeners) listener()
}

function commit(next: CustomSong[]): void {
  cache = next
  writeJson(STORAGE_KEY, next)
  notify()
}

/** All songs added on this device (a stable reference between changes). */
export function getCustomSongs(): CustomSong[] {
  hydrate()
  return cache
}

/** Subscribe to changes; returns an unsubscribe function. */
export function subscribeCustomSongs(listener: () => void): () => void {
  hydrate()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Add songs, skipping any whose id is already known. Returns how many landed. */
export function addCustomSongs(songs: CustomSong[]): number {
  hydrate()
  const known = new Set(cache.map((song) => song.id))
  const fresh = songs.filter((song) => {
    if (known.has(song.id)) return false
    known.add(song.id)
    return true
  })
  if (!fresh.length) return 0
  commit([...cache, ...fresh])
  return fresh.length
}

/** Remove one song by id. Returns true when something was removed. */
export function removeCustomSong(id: string): boolean {
  hydrate()
  const next = cache.filter((song) => song.id !== id)
  if (next.length === cache.length) return false
  commit(next)
  return true
}

// Keep this tab in sync when another tab edits the list.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key && event.key !== STORAGE_KEY) return
    loaded = false
    hydrate()
    notify()
  })
}
