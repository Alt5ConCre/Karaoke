import { useEffect, useMemo, useRef } from 'react'
import type { LyricLine, Song } from '../types.ts'
import { formatTime, lyricAt } from '../lib/songs.ts'

interface PlayerPanelProps {
  song: Song | null
  lyrics: LyricLine[]
  time: number
  playing: boolean
  onTime: (seconds: number) => void
  onPlaying: (playing: boolean) => void
  onEnded: () => void
}

/**
 * Local video playback plus the lyric showcase. The video element reads a file
 * from Songs/ through the offline server — there is no embed, iframe or remote
 * stream anywhere in this component.
 */
export function PlayerPanel({ song, lyrics, time, playing, onTime, onPlaying, onEnded }: PlayerPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.currentTime = 0
    onTime(0)
    onPlaying(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id])

  const { active, next } = useMemo(() => {
    const line = lyricAt(lyrics, time)
    const index = lyrics.findIndex((entry) => entry.text === line && entry.start <= time)
    const upcoming = index >= 0 ? (lyrics[index + 1]?.text ?? '') : ''
    return { active: line, next: upcoming }
  }, [lyrics, time])

  const toggle = (): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => {})
    else video.pause()
  }

  const restart = (): void => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    void video.play().catch(() => {})
  }

  const duration = videoRef.current?.duration ?? 0

  return (
    <section className="panel player-panel" data-testid="player-panel" aria-label="Now singing">
      <div className="panel__head">
        <h2 className="panel__title" data-testid="video-title">
          {song ? song.title : 'Pick a song'}
        </h2>
        {song && <span className="panel__count">{song.artist}</span>}
      </div>

      <div className="player-stage">
        {song ? (
          <video
            ref={videoRef}
            className="player-video"
            data-testid="video-player"
            src={song.videoUrl}
            playsInline
            preload="metadata"
            onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => onTime(event.currentTarget.currentTime)}
            onPlay={() => onPlaying(true)}
            onPause={() => onPlaying(false)}
            onEnded={() => {
              onPlaying(false)
              onEnded()
            }}
          />
        ) : (
          <div className="player-stage__empty" data-testid="player-empty">
            <span aria-hidden="true">🎤</span>
            <p>Choose a song from the library to start.</p>
          </div>
        )}
      </div>

      <div className="player-controls">
        <button
          type="button"
          className="btn btn--primary"
          onClick={toggle}
          disabled={!song}
          data-testid="play-button"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="btn" onClick={restart} disabled={!song}>
          Restart
        </button>
        <span className="player-time" data-testid="player-time">
          {formatTime(time)} / {formatTime(duration)}
        </span>
      </div>

      <div className="lyric-stage" data-testid="lyric-stage">
        {song && lyrics.length > 0 ? (
          <>
            <p key={active} className="lyric-line lyric-line--active" data-testid="current-lyric">
              {active || '\u00a0'}
            </p>
            <p className="lyric-line lyric-line--next">{next || '\u00a0'}</p>
          </>
        ) : (
          <p className="lyric-line lyric-line--muted" data-testid="current-lyric">
            {song
              ? song.hasLyrics
                ? 'Lyrics file found but empty.'
                : 'No lyrics.json for this song — the video still plays.'
              : '\u00a0'}
          </p>
        )}
      </div>
    </section>
  )
}