import type { Room } from '../types.ts'
import { readJson, writeJson, removeRaw } from '../lib/storage.ts'
import type { RoomSyncAdapter } from './types.ts'

/**
 * LocalAdapter — "shared" state for a single browser.
 *
 * A room lives in localStorage under `fv:room:<CODE>` and every tab on this
 * machine that opens the room syncs through a BroadcastChannel (with a `storage`
 * event as the fallback). That makes the create/join/queue/rotation/leaderboard
 * loop genuinely multi-user across tabs and survive a refresh.
 *
 * It is NOT shared across devices — that is exactly what the Supabase adapter is
 * for. The UI says so plainly so nobody expects their phone to see the laptop's
 * room until Supabase is configured.
 */

const ROOM_PREFIX = 'fv:room:'
const INDEX_KEY = 'fv:room-index'

function roomKey(code: string): string {
  return `${ROOM_PREFIX}${code}`
}

function channelName(code: string): string {
  return `fv-room-${code}`
}

function readIndex(): string[] {
  return readJson<string[]>(INDEX_KEY) ?? []
}

function addToIndex(code: string): void {
  const index = readIndex()
  if (!index.includes(code)) {
    writeJson(INDEX_KEY, [code, ...index].slice(0, 50))
  }
}

export function listLocalRoomCodes(): string[] {
  return readIndex().filter((code) => readJson<Room>(roomKey(code)) !== null)
}

export function deleteLocalRoom(code: string): void {
  removeRaw(roomKey(code))
  writeJson(
    INDEX_KEY,
    readIndex().filter((existing) => existing !== code),
  )
}

export function createLocalAdapter(): RoomSyncAdapter {
  return {
    kind: 'local',
    label: 'Local room (this browser)',
    sharingNote:
      'Rooms are shared between tabs on this device. Configure Supabase to share across phones and laptops.',

    async createRoom(room) {
      writeJson(roomKey(room.code), room)
      addToIndex(room.code)
      broadcast(room)
      return room
    },

    async getRoom(code) {
      return readJson<Room>(roomKey(code))
    },

    async roomExists(code) {
      return readJson<Room>(roomKey(code)) !== null
    },

    async update(code, updater) {
      const current = readJson<Room>(roomKey(code))
      if (!current) return null
      const next = updater(current)
      next.rev = current.rev + 1
      writeJson(roomKey(code), next)
      broadcast(next)
      return next
    },

    subscribe(code, listener) {
      const cleanups: Array<() => void> = []

      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const channel = new BroadcastChannel(channelName(code))
          const onMessage = (event: MessageEvent<{ type: string; room: Room }>) => {
            if (event.data?.type === 'room') listener(event.data.room)
          }
          channel.addEventListener('message', onMessage)
          cleanups.push(() => {
            channel.removeEventListener('message', onMessage)
            channel.close()
          })
        } catch {
          /* BroadcastChannel unsupported; the storage listener below still works */
        }
      }

      const onStorage = (event: StorageEvent) => {
        if (event.key !== roomKey(code) || !event.newValue) return
        try {
          listener(JSON.parse(event.newValue) as Room)
        } catch {
          /* ignore malformed payloads */
        }
      }
      window.addEventListener('storage', onStorage)
      cleanups.push(() => window.removeEventListener('storage', onStorage))

      return () => cleanups.forEach((fn) => fn())
    },
  }
}

const outboundChannels = new Map<string, BroadcastChannel>()

function broadcast(room: Room): void {
  if (typeof BroadcastChannel === 'undefined') return
  let channel = outboundChannels.get(room.code)
  if (!channel) {
    try {
      channel = new BroadcastChannel(channelName(room.code))
      outboundChannels.set(room.code, channel)
    } catch {
      return
    }
  }
  channel.postMessage({ type: 'room', room })
}
