import { createContext } from 'react'
import type { Profile } from '../types.ts'

export type AuthMode = 'local-guest' | 'supabase'

export interface AuthContextValue {
  /** Null until the user has given a display name. */
  profile: Profile | null
  authMode: AuthMode
  /** True when Supabase credentials are present in the environment. */
  supabaseConfigured: boolean
  /** Short label for the header, e.g. "Guest (this device)". */
  authProviderLabel: string
  /**
   * Create or rename the local profile. Returns the resulting profile so callers
   * can immediately use `profile.id` as the singer id.
   */
  setDisplayName: (name: string) => Profile
  signOut: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
