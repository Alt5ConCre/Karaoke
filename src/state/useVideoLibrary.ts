import { useContext } from 'react'
import { VideoLibraryContext } from './videoContext.ts'
import type { VideoLibraryValue } from './videoContext.ts'

export function useVideoLibrary(): VideoLibraryValue {
  const value = useContext(VideoLibraryContext)
  if (!value) {
    throw new Error('useVideoLibrary must be used inside <VideoLibraryProvider>')
  }
  return value
}
