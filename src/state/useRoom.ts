import { useContext } from 'react'
import { RoomContext } from './roomContext.ts'
import type { RoomContextValue } from './roomContext.ts'

export function useRoom(): RoomContextValue {
  const value = useContext(RoomContext)
  if (!value) {
    throw new Error('useRoom must be used inside <RoomProvider>')
  }
  return value
}
