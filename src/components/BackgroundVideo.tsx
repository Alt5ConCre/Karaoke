import { useEffect, useRef } from 'react'
import { useBackground } from '../state/useBackground.ts'
import { backgroundVideoUrl } from '../lib/backgrounds.ts'

interface BackgroundVideoProps {
  /** Extra class for the wrapper (e.g. a variant-specific layer). */
  className?: string
}

/**
 * BackgroundVideo — the muted loop that plays behind a song.
 *
 * Rendered as the first child of a positioned frame (`.player__frame`,
 * `.midi-player__screen`). It fills the frame at z-index 0; the song content
 * paints above it. Returns nothing when no background is selected or the layer
 * is switched off, so frames look exactly as before in that case.
 *
 * The element is always muted and plays inline — it is scenery, never the
 * audio source — which also lets autoplay start without a user gesture.
 */
export function BackgroundVideo({ className }: BackgroundVideoProps) {
  const { background } = useBackground()
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const url =
    background.enabled && background.id !== 'none' ? backgroundVideoUrl(background.id) : ''

  // Some browsers only honour autoplay when `muted` is set as a property too.
  useEffect(() => {
    const el = videoRef.current
    if (el) el.muted = true
  }, [url])

  if (!url) return null

  return (
    <div className={`bgvideo${className ? ` ${className}` : ''}`} aria-hidden="true">
      <video
        key={url}
        ref={videoRef}
        className="bgvideo__el"
        src={url}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        tabIndex={-1}
      />
      <div className="bgvideo__dim" style={{ opacity: background.dim }} />
    </div>
  )
}
