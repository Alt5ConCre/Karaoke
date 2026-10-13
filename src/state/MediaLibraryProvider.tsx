import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Song } from '../types.ts'
import { SONGS, getSongById } from '../data/songs.ts'
import { fetchLocalSongs } from '../lib/localLibrary.ts'
import {
  deleteFile,
  getFileBlob,
  putFile,
  readFileMetaMap,
  writeFileMetaMap,
} from '../lib/mediaStore.ts'
import type { LocalFileMeta, LocalFileMetaMap } from '../lib/mediaStore.ts'
import { MediaLibraryContext } from './mediaContext.ts'
import type { MediaLibraryValue, MediaSourceKind } from './mediaContext.ts'

export function MediaLibraryProvider({ children }: { children: ReactNode }) {
  const [localSongs, setLocalSongs] = useState<Song[]>([])
  const [folderScanned, setFolderScanned] = useState(false)
  const [fileMetaMap, setFileMetaMap] = useState<LocalFileMetaMap>(() => readFileMetaMap())
  const [version, setVersion] = useState(0)
  const urlCache = useRef(new Map<string, string>())

  useEffect(() => {
    let alive = true
    void fetchLocalSongs().then((songs) => {
      if (!alive) return
      setLocalSongs(songs)
      setFolderScanned(true)
    })
    return () => {
      alive = false
    }
  }, [])

  const catalog = useMemo(() => {
    if (localSongs.length === 0) return SONGS
    const known = new Set(SONGS.map((song) => song.id))
    return [...SONGS, ...localSongs.filter((song) => !known.has(song.id))]
  }, [localSongs])

  const songIndex = useMemo(() => {
    const map = new Map<string, Song>()
    for (const song of catalog) map.set(song.id, song)
    return map
  }, [catalog])

  const getSong = useCallback(
    (songId: string): Song | undefined => songIndex.get(songId) ?? getSongById(songId),
    [songIndex],
  )

  const fileMeta = useCallback((songId: string) => fileMetaMap[songId], [fileMetaMap])
  const hasFile = useCallback((songId: string) => Boolean(fileMetaMap[songId]), [fileMetaMap])

  const sourceKind = useCallback(
    (song: Song): MediaSourceKind => {
      if (fileMetaMap[song.id]) return 'file'
      if (song.mediaUrl) return 'folder'
      if (song.youtubeId) return 'youtube'
      return 'none'
    },
    [fileMetaMap],
  )

  const loadFileUrl = useCallback(async (songId: string): Promise<string | undefined> => {
    const cached = urlCache.current.get(songId)
    if (cached) return cached
    const blob = await getFileBlob(songId)
    if (!blob) return undefined
    const url = URL.createObjectURL(blob)
    urlCache.current.set(songId, url)
    return url
  }, [])

  const dropCachedUrl = useCallback((songId: string) => {
    const existing = urlCache.current.get(songId)
    if (existing) {
      URL.revokeObjectURL(existing)
      urlCache.current.delete(songId)
    }
  }, [])

  const commitMeta = useCallback((mutate: (prev: LocalFileMetaMap) => LocalFileMetaMap) => {
    setFileMetaMap((prev) => {
      const next = mutate(prev)
      writeFileMetaMap(next)
      return next
    })
    setVersion((v) => v + 1)
  }, [])

  const attachFile = useCallback(
    async (songId: string, file: File): Promise<void> => {
      dropCachedUrl(songId)
      const meta: LocalFileMeta = await putFile(songId, file)
      commitMeta((prev) => ({ ...prev, [songId]: meta }))
    },
    [commitMeta, dropCachedUrl],
  )

  const removeFile = useCallback(
    async (songId: string): Promise<void> => {
      dropCachedUrl(songId)
      await deleteFile(songId)
      commitMeta((prev) => {
        const next = { ...prev }
        delete next[songId]
        return next
      })
    },
    [commitMeta, dropCachedUrl],
  )

  useEffect(() => {
    const cache = urlCache.current
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url)
      cache.clear()
    }
  }, [])

  const value = useMemo<MediaLibraryValue>(
    () => ({
      catalog,
      localSongs,
      folderScanned,
      getSong,
      sourceKind,
      hasFile,
      fileMeta,
      loadFileUrl,
      attachFile,
      removeFile,
      version,
    }),
    [
      catalog,
      localSongs,
      folderScanned,
      getSong,
      sourceKind,
      hasFile,
      fileMeta,
      loadFileUrl,
      attachFile,
      removeFile,
      version,
    ],
  )

  return <MediaLibraryContext.Provider value={value}>{children}</MediaLibraryContext.Provider>
}
