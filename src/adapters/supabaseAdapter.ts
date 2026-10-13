import type { Room } from '../types.ts'
import type { RoomSyncAdapter } from './types.ts'

/**
 * SupabaseAdapter — the cross-device transport.
 *
 * Dormant by default. It only wakes up when BOTH are true:
 *   1. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present, and
 *   2. `@supabase/supabase-js` is installed.
 *
 * No credentials are baked in, guessed, or defaulted here. If config is missing
 * this module reports that and the app keeps using the local adapter. See the
 * README for the table + policy SQL to run in your own Supabase project.
 *
 * The anon key is a *public* browser key by design (Supabase expects it in the
 * client), but it is still read from the environment so nothing is hard-coded.
 */

export interface SupabaseConfig {
  url: string
  anonKey: string
  configured: boolean
}

export function getSupabaseConfig(): SupabaseConfig {
  const env = import.meta.env
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : ''
  const anonKey =
    typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : ''
  return { url, anonKey, configured: url !== '' && anonKey !== '' }
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig().configured
}

interface RoomRow {
  code: string
  data: Room
  rev: number
}

/** Minimal structural typing of the bits of the client we use, so this file
 *  type-checks and builds even when the package is not installed. */
interface SupabaseClientLike {
  from(table: string): {
    upsert(row: RoomRow): Promise<{ error: { message: string } | null }>
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): Promise<{ data: RoomRow | null; error: { message: string } | null }>
      }
    }
  }
  channel(name: string): SupabaseChannel
  removeChannel(channel: unknown): void
}

interface SupabaseChannel {
  on(
    type: string,
    filter: unknown,
    handler: (payload: { new?: RoomRow }) => void,
  ): SupabaseChannel
  subscribe(): unknown
}

const TABLE = 'rooms'

/**
 * Resolves to a Supabase-backed adapter, or null when the app should fall back
 * to local. Returning null (rather than throwing) keeps startup resilient.
 */
export async function createSupabaseAdapter(): Promise<RoomSyncAdapter | null> {
  const { url, anonKey, configured } = getSupabaseConfig()
  if (!configured) return null

  let createClient: ((u: string, k: string) => SupabaseClientLike) | undefined
  try {
    // Literal specifier so the bundler resolves and code-splits the client into
    // its own chunk. That chunk is fetched lazily and only when the app is
    // actually Supabase-configured, so an unconfigured build never loads it.
    const mod = (await import('@supabase/supabase-js')) as unknown as {
      createClient?: (u: string, k: string) => SupabaseClientLike
    }
    createClient = mod.createClient
  } catch {
    console.warn(
      '[videoke] Supabase env vars are set but @supabase/supabase-js could not be loaded.\n' +
        '          Run `npm install @supabase/supabase-js` to enable shared rooms.',
    )
    return null
  }

  if (!createClient) return null
  const client = createClient(url, anonKey)

  return {
    kind: 'supabase',
    label: 'Supabase (shared across devices)',
    sharingNote: 'Rooms are shared across every device that joins with the room code.',

    async createRoom(room) {
      const { error } = await client.from(TABLE).upsert({ code: room.code, data: room, rev: room.rev })
      if (error) throw new Error(error.message)
      return room
    },

    async getRoom(code) {
      const { data, error } = await client
        .from(TABLE)
        .select('code,data,rev')
        .eq('code', code)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data?.data ?? null
    },

    async roomExists(code) {
      const { data, error } = await client
        .from(TABLE)
        .select('code,data,rev')
        .eq('code', code)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data !== null
    },

    async update(code, updater) {
      const { data, error } = await client
        .from(TABLE)
        .select('code,data,rev')
        .eq('code', code)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return null
      const next = updater(data.data)
      next.rev = data.data.rev + 1
      const written = await client.from(TABLE).upsert({ code, data: next, rev: next.rev })
      if (written.error) throw new Error(written.error.message)
      return next
    },

    subscribe(code, listener) {
      const channel = client
        .channel(`room-${code}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: TABLE, filter: `code=eq.${code}` },
          (payload) => {
            if (payload.new?.data) listener(payload.new.data)
          },
        )
      channel.subscribe()
      return () => client.removeChannel(channel)
    },
  }
}
