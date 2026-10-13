import { useEffect, useMemo, useRef, useState } from 'react'
import type { Song } from '../types.ts'
import { buildEmbedUrl, describeEmbedError, youtubeWatchUrl } from '../lib/youtube.ts'
import { AddVideoBox } from './AddVideoBox.tsx'

interface YouTubePlayerProps {
  song: Song
  videoId: string
  /** Title shown above the frame. */
  heading?: string
  /** Size variant of the frame. */
  variant?: 'room' | 'card'
  /** Called when the embed reports the video finished (best effort). */
  onEnded?: () => void
  /** Start playing automatically (used when auto-advancing). */
  autoPlay?: boolean
}

/** How long we wait for the embed to report itself ready before hinting. */
const READY_TIMEOUT_MS = 6000

type Phase = 'loading' | 'ready' | 'error'

/**
 * YouTubePlayer — the official IFrame embed, and nothing else.
 *
 * No download, no audio extraction, no stream proxying: just the sanctioned
 * embed URL rendered in a sandboxed iframe. When no permitted id is configured
 * we say so plainly and offer the manual attach form instead of guessing.
 *
 * When an embed cannot play — the id is wrong, the video was removed, or the
 * owner disabled embedding — we detect it and explain it in plain language
 * rather than showing a silent black box. We never try to defeat an embed
 * restriction; we just link out to the video's real watch page and let the
 * operator attach a different permitted id.
 */
export function YouTubePlayer({
  song,
  videoId,
  heading,
  variant = 'card',
  onEnded,
  autoPlay,
}: YouTubePlayerProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [errorCode, setErrorCode] = useState<number | null>(null)
  const [slow, setSlow] = useState(false)
  const [loadedFor, setLoadedFor] = useState(videoId)
  const endedRef = useRef(false)
  const onEndedRef = useRef(onEnded)

  // Keep the latest callback without re-subscribing the message listener.
  useEffect(() => {
    onEndedRef.current = onEnded
  })

  const src = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return videoId ? buildEmbedUrl(videoId, origin, autoPlay) : ''
  }, [videoId, autoPlay])

  // A new video resets the detection state. Adjusting during render (rather than
  // in an effect) avoids a second cascading render pass.
  if (loadedFor !== videoId) {
    setLoadedFor(videoId)
    setPhase('loading')
    setErrorCode(null)
    setSlow(false)
  }

  // The embed posts messages (onReady / onError / onStateChange) once
  // enablejsapi is on. We only trust messages that actually come from this
  // frame's window. We also subscribe to the feed ourselves so the player
  // reports state changes at all.
  useEffect(() => {
    if (!videoId) return
    endedRef.current = false

    function onMessage(event: MessageEvent) {
      const frame = frameRef.current
      if (!frame || event.source !== frame.contentWindow) return

      let payload: unknown = event.data
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload)
        } catch {
          return
        }
      }
      if (!payload || typeof payload !== 'object') return

      const data = payload as { event?: unknown; info?: unknown }
      if (data.event === 'onReady') {
        setPhase('ready')
        return
      }
      if (data.event === 'onError') {
        setPhase('error')
        if (typeof data.info === 'number') setErrorCode(data.info)
        return
      }
      if (data.event === 'onStateChange') {
        // info 0 === ended. Fire the hook at most once per video.
        if (data.info === 0 && !endedRef.current) {
          endedRef.current = true
          onEndedRef.current?.()
        }
        return
      }
      const info = data.info as { errorCode?: unknown } | undefined
      if (info && typeof info.errorCode === 'number' && info.errorCode > 0) {
        setPhase('error')
        setErrorCode(info.errorCode)
      }
    }

    const sendListening = () => {
      const frame = frameRef.current
      if (!frame?.contentWindow) return
      try {
        frame.contentWindow.postMessage(
          JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
          '*',
        )
      } catch {
        /* cross-origin postMessage can throw in exotic cases; ignore */
      }
    }
    sendListening()
    const handshake = window.setTimeout(sendListening, 900)
    const handshake2 = window.setTimeout(sendListening, 2200)

    window.addEventListener('message', onMessage)
    return () => {
      window.clearTimeout(handshake)
      window.clearTimeout(handshake2)
      window.removeEventListener('message', onMessage)
    }
  }, [videoId, src])

  // Watchdog: if the player never signals ready it is usually blocked or
  // unavailable. We do not assume failure (the frame may just be slow), we show
  // a soft "here is how to check" hint while leaving the frame in place.
  useEffect(() => {
    if (!videoId || phase !== 'loading') return
    const timer = window.setTimeout(() => setSlow(true), READY_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [videoId, phase])

  if (!videoId) {
    return (
      <div className={`player player--${variant} player--empty`}>
        <p className="player__empty-title">No permitted video configured</p>
        <p className="player__empty-copy">
          This catalog ships without video ids so nothing unlicensed is embedded. Add one below to
          enable playback for this browser.
        </p>
        <AddVideoBox songId={song.id} />
      </div>
    )
  }

  const failed = phase === 'error'
  const noticeClass = failed ? 'player__notice player__notice--error' : 'player__notice'

  return (
    <div className={`player player--${variant}`}>
      {heading && <p className="player__heading">{heading}</p>}

      {failed && (
        <div className={noticeClass} role="alert" data-testid="embed-error">
          <p className="player__notice-title">This video can&rsquo;t be played here</p>
          <p className="player__notice-copy">{describeEmbedError(errorCode)}</p>
          <div className="player__notice-actions">
            <a
              className="btn btn--ghost"
              href={youtubeWatchUrl(videoId)}
              target="_blank"
              rel="noreferrer"
            >
              Watch on YouTube &#8599;
            </a>
          </div>
          <AddVideoBox songId={song.id} label="Attach a different permitted video id" />
        </div>
      )}

      {!failed && slow && (
        <div className={noticeClass} data-testid="embed-slow">
          <p className="player__notice-title">Video not showing?</p>
          <p className="player__notice-copy">
            It may be unavailable or have embedding disabled by its owner. You can{' '}
            <a href={youtubeWatchUrl(videoId)} target="_blank" rel="noreferrer">
              open it on YouTube
            </a>{' '}
            instead.
          </p>
        </div>
      )}

      <div className="player__frame">
        <iframe
          ref={frameRef}
          src={src}
          title={`YouTube: ${song.title} — ${song.artist}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          loading="lazy"
        />
      </div>
      <p className="player__attribution">
        Embedded via the official YouTube player · {song.title} — {song.artist}
      </p>
    </div>
  )
}
