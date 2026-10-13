import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Profile } from '../types.ts'
import { createId } from '../lib/ids.ts'
import { readJson, writeJson, removeRaw } from '../lib/storage.ts'
import { isSupabaseConfigured } from '../adapters/supabaseAdapter.ts'
import { AuthContext } from './authContext.ts'
import type { AuthContextValue } from './authContext.ts'

/**
 * AuthProvider — local guest identity for the MVP.
 *
 * There is deliberately no email/password here yet. Supabase Auth is the planned
 * replacement, but it is only worth enabling once credentials exist in the
 * environment, so this provider:
 *   - always works today with a per-device guest profile, and
 *   - reports `supabaseConfigured` + `authMode` so the UI can explain which
 *     identity system is actually live.
 *
 * Nothing is faked as authenticated: a guest profile is labelled a guest profile.
 */

const PROFILE_KEY = 'fv:profile'

function loadStoredProfile(): Profile | null {
  const stored = readJson<Profile>(PROFILE_KEY)
  if (stored && typeof stored.id === 'string' && typeof stored.name === 'string') {
    return stored
  }
  return null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabaseConfigured = isSupabaseConfigured()
  const [profile, setProfile] = useState<Profile | null>(() => loadStoredProfile())

  useEffect(() => {
    if (profile) writeJson(PROFILE_KEY, profile)
  }, [profile])

  const setDisplayName = useCallback(
    (rawName: string): Profile => {
      const name = rawName.trim().slice(0, 24)
      const next: Profile = profile
        ? { ...profile, name }
        : {
            id: createId(),
            name,
            createdAt: Date.now(),
            // Guest identity is always local; a Supabase identity would set 'supabase'.
            provider: 'local',
          }
      setProfile(next)
      return next
    },
    [profile],
  )

  const signOut = useCallback(() => {
    removeRaw(PROFILE_KEY)
    setProfile(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      profile,
      authMode: supabaseConfigured ? 'supabase' : 'local-guest',
      supabaseConfigured,
      authProviderLabel: supabaseConfigured ? 'Supabase configured' : 'Guest (this device)',
      setDisplayName,
      signOut,
    }),
    [profile, supabaseConfigured, setDisplayName, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
