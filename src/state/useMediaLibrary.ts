import { useContext } from 'react'
import { MediaLibraryContext } from './mediaContext.ts'
import type { MediaLibraryValue } from './mediaContext.ts'

export function useMediaLibrary(): MediaLibraryValue {
  const value = useContext(MediaLibraryContext)
  if (!value) {
    throw new Error('useMediaLibrary must be used inside <MediaLibraryProvider>')
  }
  return value
}
