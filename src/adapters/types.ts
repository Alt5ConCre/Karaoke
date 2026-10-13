import type { Room } from '../types.ts'

/**
 * The transport seam.
 *
 * The whole app talks to rooms through this interface, so swapping localStorage
 * for Supabase is a one-line change in `createRoomAdapter` and touches no UI.
 */
export interface RoomSyncAdapter {
  readonly kind: 'local' | 'supabase'
  /** Human-facing transport name, shown in the room header. */
  readonly label: string
  /** One sentence on what "shared" means for this transport. */
  readonly sharingNote: string

  createRoom(room: Room): Promise<Room>
  getRoom(code: string): Promise<Room | null>
  roomExists(code: string): Promise<boolean>
  /** Read-modify-write; resolves with the stored room, or null if it vanished. */
  update(code: string, updater: (room: Room) => Room): Promise<Room | null>
  /** Returns an unsubscribe function. */
  subscribe(code: string, listener: (room: Room) => void): () => void
}
