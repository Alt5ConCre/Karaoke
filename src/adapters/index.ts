import { createLocalAdapter } from './localAdapter.ts'
import { createSupabaseAdapter, getSupabaseConfig } from './supabaseAdapter.ts'
import type { RoomSyncAdapter } from './types.ts'

export type { RoomSyncAdapter } from './types.ts'
export { getSupabaseConfig, isSupabaseConfigured } from './supabaseAdapter.ts'
export { listLocalRoomCodes, deleteLocalRoom } from './localAdapter.ts'

export interface AdapterSelection {
  adapter: RoomSyncAdapter
  /** True when Supabase was configured but could not be activated (e.g. missing package). */
  degraded: boolean
  reason?: string
}

/**
 * Pick the transport at startup.
 *
 * Supabase wins when it is configured and reachable; otherwise the app runs on
 * the local adapter. This is the single place that decides, which is why no UI
 * code needs to know which one is live.
 */
export async function createRoomAdapter(): Promise<AdapterSelection> {
  const config = getSupabaseConfig()

  if (config.configured) {
    try {
      const supabase = await createSupabaseAdapter()
      if (supabase) return { adapter: supabase, degraded: false }
      return {
        adapter: createLocalAdapter(),
        degraded: true,
        reason:
          'Supabase credentials are set but the client library is not available. Using local rooms.',
      }
    } catch (error) {
      return {
        adapter: createLocalAdapter(),
        degraded: true,
        reason: `Supabase could not be reached (${
          error instanceof Error ? error.message : 'unknown error'
        }). Using local rooms.`,
      }
    }
  }

  return { adapter: createLocalAdapter(), degraded: false }
}
