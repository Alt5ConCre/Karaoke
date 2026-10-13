import { createContext } from 'react'
import type { Room, RotationMode, Singer } from '../types.ts'

export type RoomStatus = 'booting' | 'idle' | 'loading' | 'ready' | 'error'

export interface RoomContextValue {
  /** True once the transport adapter has resolved. */
  transportReady: boolean
  adapterLabel: string
  adapterSharingNote: string
  adapterDegraded: boolean
  adapterDegradedReason?: string

  room: Room | null
  /** The current user as a member of the room, once joined. */
  me: Singer | null
  joined: boolean
  status: RoomStatus
  error: string | null

  createRoom: (roomName: string, displayName: string) => Promise<string>
  joinRoom: (code: string, displayName: string) => Promise<boolean>
  /** Subscribe to a room's updates; returns an unsubscribe function. */
  watchRoom: (code: string) => () => void
  clearError: () => void

  addSong: (songId: string) => Promise<void>
  removeWaiting: (queueItemId: string) => Promise<void>
  startNext: () => Promise<void>
  endSong: () => Promise<void>
  skipCurrent: () => Promise<void>
  clearWaiting: () => Promise<void>
  setRotationMode: (mode: RotationMode) => Promise<void>
}

export const RoomContext = createContext<RoomContextValue | null>(null)
