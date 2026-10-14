import { useContext } from 'react'
import { BackgroundContext } from './backgroundContext.ts'
import type { BackgroundValue } from './backgroundContext.ts'

export function useBackground(): BackgroundValue {
  const value = useContext(BackgroundContext)
  if (!value) {
    throw new Error('useBackground must be used inside <BackgroundProvider>')
  }
  return value
}
