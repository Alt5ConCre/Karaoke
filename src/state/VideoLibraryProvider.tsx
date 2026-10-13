import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Song } from '../types.ts'
import { readJson, writeJson } from '../lib/storage.ts'
import { parseVideoId } from '../lib/youtube.ts'
import { VideoLibraryContext } from './videoContext.ts'
import type { VideoLibraryValue } from './videoContext.ts'

/**
 * VideoLibraryProvider — where permitted video ids live.
 *
 * The shipped catalog carries no karaoke video ids on purpose (see data/songs.ts).
 * An operator who has the right to embed a given video can attach its id here;
 * those choices are stored in this browser and always take precedence over the
 * catalog default. Nothing is fetched, downloaded, or scraped — only ids that a
 * human explicitly supplied are embedded.
 */

const VIDEO_IDS_KEY = 'fv:video-ids'

function loadOverrides(): Record<string, string> {
  return readJson<Record<string, string>>(VIDEO_IDS_KEY) ?? {}
}

export function VideoLibraryProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, string>>(() => loadOverrides())

  const setVideoId = useCallback((songId: string, input: string): boolean => {
    const trimmed = input.trim()
    if (trimmed === '') {
      setOverrides((current) => {
        const next = { ...current }
        delete next[songId]
        writeJson(VIDEO_IDS_KEY, next)
        return next
      })
      return true
    }
    const parsed = parseVideoId(trimmed)
    if (!parsed) return false
    setOverrides((current) => {
      const next = { ...current, [songId]: parsed }
      writeJson(VIDEO_IDS_KEY, next)
      return next
    })
    return true
  }, [])

  const value = useMemo<VideoLibraryValue>(
    () => ({
      resolveVideoId: (song: Song) => overrides[song.id] ?? song.youtubeId,
      setVideoId,
      hasOverride: (songId: string) => Boolean(overrides[songId]),
    }),
    [overrides, setVideoId],
  )

  return <VideoLibraryContext.Provider value={value}>{children}</VideoLibraryContext.Provider>
}
