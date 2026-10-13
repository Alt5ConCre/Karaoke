import { createContext } from 'react'
import type { Song } from '../types.ts'

export interface VideoLibraryValue {
  /** The id to embed: an operator override if present, else the song's own id. */
  resolveVideoId: (song: Song) => string
  /** Store a permitted video id (or URL). Empty string clears the override. */
  setVideoId: (songId: string, input: string) => boolean
  hasOverride: (songId: string) => boolean
}

export const VideoLibraryContext = createContext<VideoLibraryValue | null>(null)
