/**
 * Local media store — a picked file kept in IndexedDB, with a tiny synchronous
 * metadata mirror in localStorage so the UI can show "Local file" without
 * awaiting the database.
 *
 * Nothing here touches the network. A file the operator chooses from this
 * laptop is stored on this device only (IndexedDB), keyed by song id, and read
 * back as an object URL for the player. Browsers that block IndexedDB simply
 * fall back to no local file rather than throwing.
 */

import { readJson, writeJson } from './storage.ts'

const DB_NAME = 'fv-media'
const DB_VERSION = 1
const STORE = 'files'
const META_KEY = 'fv:media-files'

/** What the UI needs to know about a stored file (no Blob — keeps localStorage small). */
export interface LocalFileMeta {
  songId: string
  name: string
  type: string
  size: number
  savedAt: number
}

export type LocalFileMetaMap = Record<string, LocalFileMeta>

/** Synchronous metadata mirror (localStorage), safe to read during render. */
export function readFileMetaMap(): LocalFileMetaMap {
  const raw = readJson<LocalFileMetaMap>(META_KEY)
  if (!raw || typeof raw !== 'object') return {}
  const out: LocalFileMetaMap = {}
  for (const [songId, meta] of Object.entries(raw)) {
    if (
      meta &&
      typeof meta === 'object' &&
      typeof (meta as LocalFileMeta).name === 'string' &&
      typeof (meta as LocalFileMeta).savedAt === 'number'
    ) {
      out[songId] = { ...(meta as LocalFileMeta), songId }
    }
  }
  return out
}

export function writeFileMetaMap(map: LocalFileMetaMap): void {
  writeJson(META_KEY, map)
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'songId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

interface StoredFile {
  songId: string
  name: string
  type: string
  size: number
  savedAt: number
  blob: Blob
}

/** Store (or replace) the file for a song id. Returns the new metadata. */
export async function putFile(songId: string, file: File): Promise<LocalFileMeta> {
  const meta: LocalFileMeta = {
    songId,
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    savedAt: Date.now(),
  }
  const db = await openDb()
  if (!db) return meta
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ ...meta, blob: file } satisfies StoredFile)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
  db.close()
  return meta
}

export async function getFileBlob(songId: string): Promise<Blob | undefined> {
  const db = await openDb()
  if (!db) return undefined
  const record = await new Promise<StoredFile | undefined>((resolve) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(songId)
    request.onsuccess = () => resolve(request.result as StoredFile | undefined)
    request.onerror = () => resolve(undefined)
  })
  db.close()
  return record?.blob
}

export async function deleteFile(songId: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(songId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
  db.close()
}
