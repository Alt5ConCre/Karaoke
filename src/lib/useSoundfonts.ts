import { useSyncExternalStore } from 'react'
import {
  getSoundfontId,
  getSoundfontsSnapshot,
  subscribeSoundfont,
  type SoundfontInfo,
} from './soundfonts.ts'

/** The selected bank id, re-rendering on change (cross-tab included). */
export function useSoundfontId(): string {
  return useSyncExternalStore(subscribeSoundfont, getSoundfontId, getSoundfontId)
}

/** The selected bank id plus the full list of selectable banks. */
export function useSoundfonts(): { id: string; banks: SoundfontInfo[] } {
  const id = useSoundfontId()
  const banks = useSyncExternalStore(
    subscribeSoundfont,
    getSoundfontsSnapshot,
    getSoundfontsSnapshot,
  )
  return { id, banks }
}
