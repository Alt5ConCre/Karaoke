/**
 * Local song metadata helpers.
 *
 * Song packs are plain folders inside `Songs/`. The server reads the folder
 * name and optional meta.json; everything in here is shared by the server scan
 * (via the offline-server script, which reads this file straight from src) and
 * the browser for one-off display chores like formatting timestamps.
 */

import type { LyricLine } from '../types.ts'

/**
 * Split a folder/file name into title + artist. Convention: "Anak - Freddie
 * Aguilar" → title "Anak", artist "Freddie Aguilar". When a meta.json is
 * present it always wins over this guess.
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

function toSeconds(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * Normalise a lyrics.json into a list of timed lines. Accepts:
 *   {"lyrics": [{"start": 0, "text": "..."}, ...]}
 *   [{"t": 0, "text": "..."}, {"time": 0, "line": "..."}]
 *   {"lines": [{"sec": 0, "text": "..."}]}
 */
export function parseLyrics(data: unknown): LyricLine[] {
  let raw: unknown[] = []
  if (Array.isArray(data)) raw = data
  else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const list = obj.lyrics ?? obj.lines ?? obj.cues
    if (Array.isArray(list)) raw = list
  }
  const out: LyricLine[] = []
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`lyrics.json entry #${index} must be an object`)
    }
    const e = entry as Record<string, unknown>
    const t = e.start ?? e.t ?? e.time ?? e.sec ?? e.at
    const text = e.text ?? e.line ?? e.cue ?? e.lyric
    const start = toSeconds(t)
    if (start === undefined || typeof text !== 'string' || !text.trim()) {
      throw new Error(`lyrics.json entry #${index} needs a numeric start and non-empty text`)
    }
    const end = toSeconds(e.end)
    out.push({ start, end, text: text.trim() })
  })
  out.sort((a, b) => a.start - b.start)
  return out
}

/** The single loud/active lyric line at `time` ("" when none or no lyrics). */
export function lyricAt(lines: LyricLine[], time: number): string {
  let current = ''
  for (const line of lines) {
    if (line.start <= time) current = line.text
    if (line.end !== undefined && time < line.end) return current
  }
  return current
}

/** True when the reference melody exists — the hard gate for real scoring. */
export function scoringAvailable(song: { hasNotes?: boolean } | null, micActive: boolean): boolean {
  return Boolean(song?.hasNotes) && micActive
}