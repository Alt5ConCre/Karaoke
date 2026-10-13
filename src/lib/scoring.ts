/**
 * Fun videoke scoring.
 *
 * This build draws a fresh random whole number for every finished performance.
 * The value is deliberately independent of the singer, the song, and any audio:
 * it is a party game score, not a measurement, and the UI says so everywhere it
 * is shown or saved.
 */

export const SCORING_MODE = 'FUN_RANDOM'

/** Lowest score a performance can receive. */
export const SCORING_MIN = 65

/** Highest score a performance can receive. */
export const SCORING_MAX = 100

export const SCORING_DISCLAIMER =
  'Fun simulated score: a fresh random number from 65 to 100 is drawn for every song. It is not a measurement of your singing.'

/**
 * Draw a fresh fun score: an integer from SCORING_MIN to SCORING_MAX inclusive.
 * Takes no input on purpose — the result never depends on who sang or what they
 * sang, and every call is an independent draw.
 */
export function generateFunScore(): number {
  const span = SCORING_MAX - SCORING_MIN + 1
  return SCORING_MIN + Math.floor(Math.random() * span)
}

/** 1-5 stars from an integer score, so even a low draw keeps a gold star. */
export function starsForScore(score: number): number {
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  if (clamped >= 95) return 5
  if (clamped >= 88) return 4
  if (clamped >= 78) return 3
  if (clamped >= 65) return 2
  return 1
}

/** Short grade word for a score, in videoke-bar spirit. */
export function scoreGrade(score: number): string {
  const s = Math.max(0, Math.min(100, Math.round(score)))
  if (s >= 97) return 'Karaoke Legend'
  if (s >= 90) return 'Birit King/Queen'
  if (s >= 80) return 'Certified Videoke'
  if (s >= 70) return 'Palaban'
  if (s >= 60) return 'Brave Soul'
  return 'Warm-up'
}
