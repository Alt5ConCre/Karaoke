import { useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  BACKGROUNDS,
  getBackground,
  setBackgroundDim,
  setBackgroundEnabled,
  setBackgroundId,
  subscribeBackground,
} from '../lib/backgrounds.ts'
import { BackgroundContext } from './backgroundContext.ts'
import type { BackgroundValue } from './backgroundContext.ts'

/**
 * BackgroundProvider — exposes the singer's background choice to the tree.
 *
 * The state lives in `backgrounds.ts` (localStorage + sync-external-store), so
 * it survives reloads and syncs across tabs without any provider-level state.
 */
export function BackgroundProvider({ children }: { children: ReactNode }) {
  const background = useSyncExternalStore(subscribeBackground, getBackground, getBackground)

  const value = useMemo<BackgroundValue>(
    () => ({
      background,
      loops: BACKGROUNDS,
      setId: setBackgroundId,
      setEnabled: setBackgroundEnabled,
      setDim: setBackgroundDim,
    }),
    [background],
  )

  return <BackgroundContext.Provider value={value}>{children}</BackgroundContext.Provider>
}
