/** Small id / code / colour helpers. No external dependency. */

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Room codes use an unambiguous alphabet (no O/0, I/1/L) so a code read aloud
 * across the room can be typed back without guessing.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 5

export function createRoomCode(): string {
  let out = ''
  const bytes = new Uint32Array(CODE_LENGTH)
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      bytes[i] = Math.floor(Math.random() * 0xffffffff)
    }
  }
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return out
}

export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)
}

/** A stable, well-spaced hue per singer so the rotation is readable at a glance. */
const SINGER_COLORS = [
  '#fcd116', // flag gold
  '#3b6ef5', // flag blue, brightened for dark UI
  '#ff3b5c', // flag red, brightened
  '#22d3ee',
  '#ff2fb3',
  '#4ade80',
  '#fb923c',
  '#a78bfa',
]

export function pickSingerColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return SINGER_COLORS[hash % SINGER_COLORS.length]
}
