import { createContext } from 'react'
import type { BackgroundLoop, BackgroundState } from '../lib/backgrounds.ts'

/** The background choice plus the setters, shared through React context. */
export interface BackgroundValue {
  /** Which loop is picked, whether it shows and how dark. */
  background: BackgroundState
  /** Every built-in loop the picker can offer. */
  loops: BackgroundLoop[]
  /** Choose a loop (or `BACKGROUND_NONE`). */
  setId: (id: string) => void
  /** Master on/off for the background layer. */
  setEnabled: (enabled: boolean) => void
  /** Scrim opacity, 0–0.85. */
  setDim: (dim: number) => void
}

export const BackgroundContext = createContext<BackgroundValue | null>(null)
