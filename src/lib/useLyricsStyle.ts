import { useSyncExternalStore } from 'react'
import { getLyricsStyle, subscribeLyricsStyle, type LyricsStyle } from './lyricsStyle.ts'

/** The current lyric style, re-rendering on change (cross-tab included). */
export function useLyricsStyle(): LyricsStyle {
  return useSyncExternalStore(subscribeLyricsStyle, getLyricsStyle, getLyricsStyle)
}
