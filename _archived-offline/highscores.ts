/**
 * Top-5 high scores per song, persisted on this machine.
 *
 * Uses the guarded storage wrapper (lib/storage.ts): real localStorage in a
 * normal browser, a memory fallback in tests, and it never throws.
 */

import type { HighScore } from '../types.ts'
import { readJson, writeJson } from './storage.ts'

export const HIGHSCORE_LIMIT = 5
const KEY = 'fv:highscores'

export function loadHighScores(): HighScore[] {
  const value = readJson<HighScore[]>(KEY)
  return Array.isArray(value) ? value : []
}

function saveAll(list: HighScore[]): void {
  writeJson(KEY, list)
}

/** Scores for one song, best first. */
export function highScoresForSong(songId: string): HighScore[] {
  return loadHighScores()
    .filter((entry) => entry.songId === songId)
    .sort((a, b) => b.score - a.score || b.date - a.date)
    .slice(0, HIGHSCORE_LIMIT)
}

/** Insert a score, keep only the best `HIGHSCORE_LIMIT` per song, save. */
export function addHighScore(entry: HighScore): HighScore[] {
  const list = loadHighScores()
  list.push(entry)
  saveAll(list)
  return highScoresForSong(entry.songId)
}

/** True when this score would land on the top-5 board for the song. */
export function wouldMakeBoard(songId: string, score: number): boolean {
  const board = highScoresForSong(songId)
  if (board.length < HIGHSCORE_LIMIT) return true
  return score > (board[board.length - 1]?.score ?? 0)
}