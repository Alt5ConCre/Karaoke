/**
 * Core domain types for the videoke rooms app.
 *
 * A room is a shared queue of songs plus the singers who joined it. Everything
 * here is plain data so it can be persisted by any transport (local
 * BroadcastChannel today, Supabase later) without change.
 */

/** Languages a demo catalog entry can be tagged with. */
export type Language = 'Tagalog' | 'Taglish' | 'English'

/**
 * A singable catalog entry. `youtubeId` may be empty: the app only embeds
 * videos an operator is permitted to embed, so a blank id is a normal state
 * (the UI then offers to attach one) rather than a bug.
 */
export interface Song {
  /** URL-safe unique id, e.g. "anak". */
  id: string
  title: string
  artist: string
  /** Release year, for the card meta line. Optional. */
  year?: number
  language: Language
  genre: string
  tags: string[]
  /** 11-character YouTube id, or '' when none is configured. */
  youtubeId: string
  /** Video duration in seconds, when known. Optional. */
  durationSec?: number
  /**
   * Where the entry comes from: the shipped demo catalog ('demo'), a folder in
   * the local `Songs/` library ('folder'), the Creative Commons UltraStar pack
   * ('ultrastar'), or added by the singer on this device ('custom'). Defaults to
   * 'demo' when absent.
   */
  source?: 'demo' | 'folder' | 'ultrastar' | 'custom'
  /**
   * A same-origin URL the browser can play directly (set for `Songs/` folder
   * entries served by the offline server). When present the player streams this
   * file instead of embedding YouTube.
   */
  mediaUrl?: string
  /** Poster image URL for a folder song, when one was found. Optional. */
  coverUrl?: string
}

/** A per-device identity. Guest identities are always provider 'local'. */
export interface Profile {
  id: string
  name: string
  createdAt: number
  provider: 'local' | 'supabase'
}

/** A person taking part in a room. */
export interface Singer {
  id: string
  name: string
  /** Join time; drives rotation order. */
  joinedAt: number
  /** Avatar tint, stable for the singer id. */
  color: string
  isHost: boolean
}

/** Where a queued song is in its life cycle. */
export type QueueStatus = 'waiting' | 'singing' | 'done'

/** One song queued by one singer. */
export interface QueueItem {
  id: string
  songId: string
  singerId: string
  addedAt: number
  status: QueueStatus
  /** When this item was promoted to 'singing'; drives fair rotation. */
  startedAt?: number
}

/**
 * How the next singer is chosen:
 *  - 'rotation' → round-robin by singer (classic videoke fairness).
 *  - 'queue'    → strict first-come, first-served by song.
 */
export type RotationMode = 'rotation' | 'queue'

/**
 * A fun score drawn for one finished performance. The value is a fresh random
 * number each time (see lib/scoring.ts) and is never a measurement of singing.
 */
export interface ScoreEntry {
  id: string
  singerId: string
  songId: string
  /** Whole number, SCORING_MIN..SCORING_MAX. */
  value: number
  /** Always true in this build: the score is a simulated game score. */
  simulated: boolean
  createdAt: number
}

/** A videoke room: identity, participants, queue and score history. */
export interface Room {
  code: string
  name: string
  createdAt: number
  hostId: string
  rotationMode: RotationMode
  singers: Singer[]
  queue: QueueItem[]
  scores: ScoreEntry[]
  /** Monotonic revision, bumped on every write by the adapter. */
  rev: number
}
