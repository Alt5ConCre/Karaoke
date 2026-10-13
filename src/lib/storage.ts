/**
 * Guarded localStorage access.
 *
 * Private-mode browsers and some embedded webviews throw on storage access, and
 * a videoke party should not die because of it, so every call degrades to an
 * in-memory fallback instead of throwing.
 */

const memory = new Map<string, string>()

function canUseLocalStorage(): boolean {
  try {
    const probe = '__fv_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

const available = typeof window !== 'undefined' && canUseLocalStorage()

export function readRaw(key: string): string | null {
  if (available) {
    try {
      return window.localStorage.getItem(key)
    } catch {
      /* fall through to memory */
    }
  }
  return memory.has(key) ? (memory.get(key) as string) : null
}

export function writeRaw(key: string, value: string): void {
  if (available) {
    try {
      window.localStorage.setItem(key, value)
      return
    } catch {
      /* fall through to memory */
    }
  }
  memory.set(key, value)
}

export function removeRaw(key: string): void {
  if (available) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
  memory.delete(key)
}

export function readJson<T>(key: string): T | null {
  const raw = readRaw(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown): void {
  writeRaw(key, JSON.stringify(value))
}
