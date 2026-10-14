/**
 * How the lyric screen looks: font, colours for each syllable state, outline
 * and shadow weight, and the pre-song countdown length.
 *
 * The choice is kept per device in localStorage (`fv:lyrics-style`) and shared
 * across tabs, exactly like the background choice in `backgrounds.ts`. Kept free
 * of React so the test harness can exercise `sanitizeLyricsStyle` directly.
 */

import { readJson, writeJson } from './storage.ts'
import { DEFAULT_FONT_ID, isKnownFont } from './lyricFonts.ts'

export const STORAGE_KEY = 'fv:lyrics-style'

export type LyricSize = 'sm' | 'md' | 'lg'
export type CountdownSeconds = 0 | 3 | 5

export interface LyricsStyle {
  /** A `LYRIC_FONTS` id. */
  font: string
  size: LyricSize
  /** Colour of a syllable already sung. */
  doneColor: string
  /** Colour of the syllable being sung right now. */
  activeColor: string
  /** Colour of a syllable not yet reached. */
  upcomingColor: string
  /** Text outline width in px (0 disables it). */
  outlineWidth: number
  outlineColor: string
  /** Text shadow blur radius in px (0 disables the shadow). */
  shadowBlur: number
  shadowColor: string
  /** Seconds to count in before the song starts (0 skips the countdown). */
  countdown: CountdownSeconds
}

export const SIZE_REM: Record<LyricSize, string> = {
  sm: '1.1rem',
  md: '1.35rem',
  lg: '1.75rem',
}

export const DEFAULT_LYRICS_STYLE: LyricsStyle = {
  font: DEFAULT_FONT_ID,
  size: 'md',
  doneColor: '#ffd54a',
  activeColor: '#ffffff',
  upcomingColor: '#5b6472',
  outlineWidth: 0,
  outlineColor: '#000000',
  shadowBlur: 4,
  shadowColor: '#000000',
  countdown: 3,
}

const HEX = /^#[0-9a-f]{6}$/i
const SIZES: LyricSize[] = ['sm', 'md', 'lg']
const COUNTDOWNS: CountdownSeconds[] = [0, 3, 5]

function coerceColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

/** Coerce stored/hand-edited data into valid style. Exported for the tests. */
export function sanitizeLyricsStyle(raw: unknown): LyricsStyle {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LYRICS_STYLE }
  const value = raw as Record<string, unknown>

  const font = typeof value.font === 'string' && isKnownFont(value.font) ? value.font : DEFAULT_FONT_ID
  const size = SIZES.includes(value.size as LyricSize) ? (value.size as LyricSize) : DEFAULT_LYRICS_STYLE.size
  const countdown = COUNTDOWNS.includes(value.countdown as CountdownSeconds)
    ? (value.countdown as CountdownSeconds)
    : DEFAULT_LYRICS_STYLE.countdown

  return {
    font,
    size,
    countdown,
    doneColor: coerceColor(value.doneColor, DEFAULT_LYRICS_STYLE.doneColor),
    activeColor: coerceColor(value.activeColor, DEFAULT_LYRICS_STYLE.activeColor),
    upcomingColor: coerceColor(value.upcomingColor, DEFAULT_LYRICS_STYLE.upcomingColor),
    outlineColor: coerceColor(value.outlineColor, DEFAULT_LYRICS_STYLE.outlineColor),
    shadowColor: coerceColor(value.shadowColor, DEFAULT_LYRICS_STYLE.shadowColor),
    outlineWidth: clamp(value.outlineWidth, 0, 6, DEFAULT_LYRICS_STYLE.outlineWidth),
    shadowBlur: clamp(value.shadowBlur, 0, 24, DEFAULT_LYRICS_STYLE.shadowBlur),
  }
}

/* ------------------------------------------------------------------- store */

let cache: LyricsStyle = { ...DEFAULT_LYRICS_STYLE }
let loaded = false
const listeners = new Set<() => void>()

function hydrate(): void {
  if (loaded) return
  loaded = true
  cache = sanitizeLyricsStyle(readJson<unknown>(STORAGE_KEY))
}

function notify(): void {
  for (const listener of listeners) listener()
}

function commit(next: LyricsStyle): void {
  cache = next
  writeJson(STORAGE_KEY, next)
  notify()
}

export function getLyricsStyle(): LyricsStyle {
  hydrate()
  return cache
}

export function subscribeLyricsStyle(listener: () => void): () => void {
  hydrate()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Patch one or more fields; unknown values are sanitized away. */
export function setLyricsStyle(patch: Partial<LyricsStyle>): void {
  hydrate()
  commit(sanitizeLyricsStyle({ ...cache, ...patch }))
}

export function resetLyricsStyle(): void {
  hydrate()
  commit({ ...DEFAULT_LYRICS_STYLE })
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key && event.key !== STORAGE_KEY) return
    loaded = false
    hydrate()
    notify()
  })
}
