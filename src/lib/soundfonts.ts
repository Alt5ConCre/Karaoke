/**
 * SoundFont banks for the MIDI karaoke player.
 *
 * One General MIDI bank ships with the app (`public/soundfonts/soundfont.sf2`,
 * also the default); the operator can add more `.sf2` files from this device,
 * which are kept in IndexedDB and never uploaded. The chosen bank id lives in
 * localStorage (`fv:soundfont`) and is shared across tabs, exactly like the
 * background choice in `backgrounds.ts`.
 *
 * Parsing is expensive (a few ms for a 6 MB bank plus PCM decoding), so each
 * bank is parsed at most once and the promise cached. Kept free of React so the
 * test harness can exercise the pure parts directly.
 */

import { readJson, writeJson } from './storage.ts'
import { parseSf2, type Sf2Bank } from './sf2.ts'

export const SOUNDFONT_KEY = 'fv:soundfont'
const USER_META_KEY = 'fv:soundfont-files'
const DB_NAME = 'fv-soundfont'
const STORE = 'banks'

/** The default bank, always present. */
export const DEFAULT_SOUNDFONT_ID = 'gm'

export interface SoundfontInfo {
  id: string
  name: string
  /** True for the shipped bank, false for an operator-loaded one. */
  builtin: boolean
  /** File name under `public/soundfonts/` for a built-in bank. */
  file?: string
}

const BUILTINS: SoundfontInfo[] = [
  {
    id: DEFAULT_SOUNDFONT_ID,
    name: 'General MIDI (TimGM6mb)',
    builtin: true,
    file: 'soundfont.sf2',
  },
]

const BUILTIN_IDS = new Set(BUILTINS.map((entry) => entry.id))

/** User-added banks, mirrored synchronously in localStorage (no Blob). */
export interface UserSoundfontMeta {
  id: string
  name: string
  size: number
  savedAt: number
}

function readUserMeta(): UserSoundfontMeta[] {
  const raw = readJson<unknown>(USER_META_KEY)
  if (!Array.isArray(raw)) return []
  const out: UserSoundfontMeta[] = []
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as UserSoundfontMeta).id === 'string' &&
      typeof (entry as UserSoundfontMeta).name === 'string' &&
      typeof (entry as UserSoundfontMeta).savedAt === 'number'
    ) {
      const meta = entry as UserSoundfontMeta
      out.push({ id: meta.id, name: meta.name, size: meta.size ?? 0, savedAt: meta.savedAt })
    }
  }
  return out
}

function writeUserMeta(list: UserSoundfontMeta[]): void {
  writeJson(USER_META_KEY, list)
}

function baseUrl(): string {
  try {
    return import.meta.env.BASE_URL || '/'
  } catch {
    return '/'
  }
}

/** Every selectable bank: the shipped one first, then operator-added ones. */
export function listSoundfonts(): SoundfontInfo[] {
  const users = readUserMeta().map((meta) => ({
    id: meta.id,
    name: meta.name,
    builtin: false,
  }))
  return [...BUILTINS, ...users]
}

export function isKnownSoundfont(id: string): boolean {
  return BUILTIN_IDS.has(id) || readUserMeta().some((meta) => meta.id === id)
}

export function isUserSoundfont(id: string): boolean {
  return id.startsWith('us_')
}

/* --------------------------------------------------------------- IndexedDB */

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, 1)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

async function putBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
  db.close()
}

async function getBlob(id: string): Promise<Blob | undefined> {
  const db = await openDb()
  if (!db) return undefined
  const blob = await new Promise<Blob | undefined>((resolve) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(id)
    request.onsuccess = () => resolve(request.result as Blob | undefined)
    request.onerror = () => resolve(undefined)
  })
  db.close()
  return blob
}

async function deleteBlob(id: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
  db.close()
}

/* ----------------------------------------------------------------- loading */

const bankCache = new Map<string, Promise<Sf2Bank | null>>()

/** Read and parse a bank by id, caching the result (and the parsed bank). */
export function loadBank(id: string): Promise<Sf2Bank | null> {
  const cached = bankCache.get(id)
  if (cached) return cached
  const promise = (async (): Promise<Sf2Bank | null> => {
    try {
      let buffer: ArrayBuffer | null = null
      const builtin = BUILTINS.find((entry) => entry.id === id)
      if (builtin) {
        const response = await fetch(`${baseUrl()}soundfonts/${builtin.file}`)
        if (!response.ok) return null
        buffer = await response.arrayBuffer()
      } else {
        const blob = await getBlob(id)
        if (!blob) return null
        buffer = await blob.arrayBuffer()
      }
      return parseSf2(buffer)
    } catch {
      return null
    }
  })()
  bankCache.set(id, promise)
  return promise
}

/* ----------------------------------------------------------- user banks */

export async function addUserSoundfont(file: File): Promise<SoundfontInfo | null> {
  const buffer = await file.arrayBuffer()
  if (!parseSf2(buffer)) return null
  const id = `us_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  await putBlob(id, file)
  const name = file.name.replace(/\.sf2$/i, '')
  const meta: UserSoundfontMeta = { id, name, size: file.size, savedAt: Date.now() }
  writeUserMeta([...readUserMeta(), meta])
  notify()
  return { id, name, builtin: false }
}

export async function removeUserSoundfont(id: string): Promise<void> {
  if (!isUserSoundfont(id)) return
  await deleteBlob(id)
  writeUserMeta(readUserMeta().filter((meta) => meta.id !== id))
  bankCache.delete(id)
  if (getSoundfontId() === id) setSoundfontId(DEFAULT_SOUNDFONT_ID)
  else notify()
}

/* ------------------------------------------------------------------- store */

const listeners = new Set<() => void>()

/** Stable snapshot for `useSyncExternalStore`; refreshed whenever we notify. */
let listSnapshot: SoundfontInfo[] = BUILTINS

function notify(): void {
  listSnapshot = listSoundfonts()
  for (const listener of listeners) listener()
}

/** The bank list as a stable reference between changes. */
export function getSoundfontsSnapshot(): SoundfontInfo[] {
  return listSnapshot
}

export function getSoundfontId(): string {
  const raw = readJson<unknown>(SOUNDFONT_KEY)
  const id = typeof raw === 'string' ? raw : ''
  return isKnownSoundfont(id) ? id : DEFAULT_SOUNDFONT_ID
}

export function setSoundfontId(id: string): void {
  if (!isKnownSoundfont(id)) return
  writeJson(SOUNDFONT_KEY, id)
  notify()
}

export function subscribeSoundfont(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key && event.key !== SOUNDFONT_KEY && event.key !== USER_META_KEY) return
    notify()
  })
}
