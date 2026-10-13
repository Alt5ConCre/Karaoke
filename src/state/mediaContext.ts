import { createContext } from 'react'
import type { Song } from '../types.ts'
import type { LocalFileMeta } from '../lib/mediaStore.ts'

/** How a song will actually be played right now, in priority order. */
export type MediaSourceKind = 'file' | 'folder' | 'youtube' | 'none'

export interface MediaLibraryValue {
  /** Demo catalog merged with any Songs/ folder entries discovered locally. */
  catalog: Song[]
  /** Just the Songs/ folder entries (empty when none / not served locally). */
  localSongs: Song[]
  /** True once the folder scan has settled (even when it found nothing). */
  folderScanned: boolean
  /** Resolve any song id — demo or local — to its entry. */
  getSong: (songId: string) => Song | undefined
  /** Which kind of media backs a song today: local file > Songs/ folder > YouTube. */
  sourceKind: (song: Song) => MediaSourceKind
  /** True when a file the user picked is stored for this song id. */
  hasFile: (songId: string) => boolean
  /** Metadata for a stored file, if any. */
  fileMeta: (songId: string) => LocalFileMeta | undefined
  /** Resolve (and cache) a playable object URL for a stored file. */
  loadFileUrl: (songId: string) => Promise<string | undefined>
  /** Store a file the user picked from this device. */
  attachFile: (songId: string, file: File) => Promise<void>
  /** Forget the stored file for a song id. */
  removeFile: (songId: string) => Promise<void>
  /** Bumped on every attach/remove so views re-render. */
  version: number
}

export const MediaLibraryContext = createContext<MediaLibraryValue | null>(null)
