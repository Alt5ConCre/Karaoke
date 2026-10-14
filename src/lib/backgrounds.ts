/**
 * Background loops that play behind a song.
 *
 * The videoke screen would otherwise be a flat dark gradient. The singer can
 * pick one of the built-in loops (shipped in `public/backgrounds/`) to run,
 * muted, behind the lyrics or the audio. The choice is kept per device in
 * localStorage (`fv:background`) and shared across tabs, exactly like the
 * custom-song list in `customSongs.ts`.
 *
 * Kept free of React so the test harness can import and exercise the pure
 * parts (`sanitizeBackground`, URL builders) directly.
 */

import { readJson, writeJson } from './storage.ts'

export const STORAGE_KEY = 'fv:background'

/** Sentinel id meaning "no background at all". */
export const BACKGROUND_NONE = 'none'

export type BackgroundCategory = 'abstract' | 'nature' | 'motion'

/** One built-in loop. `file` names the mp4 (and, with .jpg, its poster). */
export interface BackgroundLoop {
  id: string
  name: string
  file: string
  category: BackgroundCategory
}

/**
 * The shipped loops. Every entry must exist twice under `public/backgrounds/`:
 * `<file>` (the 16-second seamless mp4) and a matching `<id>.jpg` poster the
 * picker shows as a cheap thumbnail.
 */
export const BACKGROUNDS: BackgroundLoop[] = [
  { id: 'aurora', name: 'Aurora', file: 'aurora.mp4', category: 'abstract' },
  { id: 'sunset', name: 'Sunset Glow', file: 'sunset.mp4', category: 'abstract' },
  { id: 'ocean', name: 'Ocean Drift', file: 'ocean.mp4', category: 'abstract' },
  { id: 'neon', name: 'Neon Pulse', file: 'neon.mp4', category: 'abstract' },
  { id: 'gold', name: 'Golden Hour', file: 'gold.mp4', category: 'abstract' },
  { id: 'forest', name: 'Forest Canopy', file: 'forest.mp4', category: 'nature' },
  { id: 'desert', name: 'Desert Dunes', file: 'desert.mp4', category: 'nature' },
  { id: 'clouds', name: 'Cloud Drift', file: 'clouds.mp4', category: 'nature' },
  { id: 'tunnel', name: 'Tunnel Lights', file: 'tunnel.mp4', category: 'motion' },
  { id: 'fractal', name: 'Deep Zoom', file: 'fractal.mp4', category: 'motion' },
  { id: 'nebula', name: 'Nebula', file: 'nebula.mp4', category: 'motion' },
]

/** What the singer has chosen: which loop, whether it shows, how dark. */
export interface BackgroundState {
  /** A `BackgroundLoop` id, or `BACKGROUND_NONE`. */
  id: string
  /** Master switch for the background layer. */
  enabled: boolean
  /** Black scrim opacity over the loop (0–0.85) so lyrics stay readable. */
  dim: number
}

export const MAX_DIM = 0.85

export const DEFAULT_BACKGROUND: BackgroundState = {
  id: BACKGROUND_NONE,
  enabled: true,
  dim: 0.45,
}

const BACKGROUND_IDS = new Set(BACKGROUNDS.map((loop) => loop.id))

/** True when `id` names a real loop (not `none`, not unknown). */
export function isKnownBackground(id: string): boolean {
  return BACKGROUND_IDS.has(id)
}

/**
 * Coerce whatever was stored (or a hand-edited value) into valid state: an
 * unknown id falls back to `none`, the dim is clamped to 0–0.85, and a missing
 * `enabled` defaults to true. Exported so the tests can exercise it directly.
 */
export function sanitizeBackground(raw: unknown): BackgroundState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BACKGROUND }
  const candidate = raw as Record<string, unknown>

  const id =
    typeof candidate.id === 'string' &&
    (candidate.id === BACKGROUND_NONE || BACKGROUND_IDS.has(candidate.id))
      ? candidate.id
      : DEFAULT_BACKGROUND.id

  const enabled =
    typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_BACKGROUND.enabled

  const dimRaw =
    typeof candidate.dim === 'number' && Number.isFinite(candidate.dim)
      ? candidate.dim
      : DEFAULT_BACKGROUND.dim
  const dim = Math.min(MAX_DIM, Math.max(0, dimRaw))

  return { id, enabled, dim }
}

/** Vite's base path ("/" in dev and on Vercel), used to build asset URLs. */
function baseUrl(): string {
  try {
    // Replaced with a string literal at build time; throws under plain Node
    // (the test harness), where there is no import.meta.env.
    return import.meta.env.BASE_URL || '/'
  } catch {
    return '/'
  }
}

/** Public URL of a loop's mp4, or '' when the id is unknown/none. */
export function backgroundVideoUrl(id: string): string {
  const loop = BACKGROUNDS.find((entry) => entry.id === id)
  return loop ? `${baseUrl()}backgrounds/${loop.file}` : ''
}

/** Public URL of a loop's poster image, or '' when the id is unknown/none. */
export function backgroundPosterUrl(id: string): string {
  const loop = BACKGROUNDS.find((entry) => entry.id === id)
  return loop ? `${baseUrl()}backgrounds/${loop.file.replace(/\.mp4$/, '.jpg')}` : ''
}

/* ------------------------------------------------------------------ store */

let cache: BackgroundState = { ...DEFAULT_BACKGROUND }
let loaded = false
const listeners = new Set<() => void>()

function hydrate(): void {
  if (loaded) return
  loaded = true
  cache = sanitizeBackground(readJson<unknown>(STORAGE_KEY))
}

function notify(): void {
  for (const listener of listeners) listener()
}

function commit(next: BackgroundState): void {
  cache = next
  writeJson(STORAGE_KEY, next)
  notify()
}

/** The current background state (a stable reference between changes). */
export function getBackground(): BackgroundState {
  hydrate()
  return cache
}

/** Subscribe to changes; returns an unsubscribe function. */
export function subscribeBackground(listener: () => void): () => void {
  hydrate()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Select a loop (or `BACKGROUND_NONE`); unknown ids are ignored. */
export function setBackgroundId(id: string): void {
  hydrate()
  if (id !== BACKGROUND_NONE && !BACKGROUND_IDS.has(id)) return
  commit({ ...cache, id })
}

/** Turn the background layer on or off without losing the picked loop. */
export function setBackgroundEnabled(enabled: boolean): void {
  hydrate()
  commit({ ...cache, enabled })
}

/** Set the scrim opacity (clamped to 0–0.85). */
export function setBackgroundDim(dim: number): void {
  hydrate()
  commit(sanitizeBackground({ ...cache, dim }))
}

// Keep this tab in sync when another tab changes the choice.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key && event.key !== STORAGE_KEY) return
    loaded = false
    hydrate()
    notify()
  })
}
