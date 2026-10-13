import { useEffect, useState } from 'react'
import type { Song } from '../types.ts'
import { useMediaLibrary } from '../state/useMediaLibrary.ts'
import { extensionOf, isKaraokeMidiExt } from '../lib/mediaTypes.ts'
import { YouTubePlayer } from './YouTubePlayer.tsx'
import { AddLocalMediaBox } from './AddLocalMediaBox.tsx'
import { MidiKaraokePlayer } from './MidiKaraokePlayer.tsx'

interface MediaPlayerProps {
  song: Song
  /** The resolved YouTube id (override-aware), as passed to YouTubePlayer. */
  videoId: string
  /** Title shown above the frame. */
  heading?: string
  /** Size variant of the frame. */
  variant?: 'room' | 'card'
  /** Called when the song reaches its end, so the room can score it. */
  onEnded?: () => void
  /** Start playing as soon as the player mounts (used when auto-advancing). */
  autoPlay?: boolean
}

/**
 * MediaPlayer — picks the best source for a song and hands off.
 *
 * Priority: a file the user picked (IndexedDB) beats a Songs/ folder file beats
 * the YouTube embed. In the shipped demo catalog there is no local source, so
 * this renders YouTubePlayer exactly as before and every existing behaviour
 * holds. Only when a local source exists do we render a plain <video> instead.
 */
export function MediaPlayer({ song, videoId, heading, variant = 'card', onEnded, autoPlay }: MediaPlayerProps) {
  const { fileMeta, loadFileUrl, version } = useMediaLibrary()
  const meta = fileMeta(song.id)
  const [loaded, setLoaded] = useState<{ songId: string; url: string } | null>(null)

  useEffect(() => {
    if (!meta) return
    let alive = true
    void loadFileUrl(song.id).then((url) => {
      if (alive && url) setLoaded({ songId: song.id, url })
    })
    return () => {
      alive = false
    }
  }, [song.id, meta, loadFileUrl, version])

  if (meta) {
    const url = loaded && loaded.songId === song.id ? loaded.url : null
    if (!url) {
      return (
        <div className={`player player--${variant} player--local`}>
          {heading && <p className="player__heading">{heading}</p>}
          <div className="player__frame player__frame--loading" aria-busy="true">
            <p className="player__loading">Loading your saved file…</p>
          </div>
        </div>
      )
    }
    if (isKaraokeMidiExt(extensionOf(meta.name ?? ''))) {
      return (
        <MidiKaraokePlayer
          src={url}
          song={song}
          heading={heading}
          variant={variant}
          source="file"
          onEnded={onEnded}
          autoPlay={autoPlay}
        />
      )
    }
    return (
      <LocalMediaPlayer
        src={url}
        song={song}
        heading={heading}
        variant={variant}
        source="file"
        onEnded={onEnded}
        autoPlay={autoPlay}
      />
    )
  }

  if (song.mediaUrl) {
    if (isKaraokeMidiExt(extensionOf(song.mediaUrl))) {
      return (
        <MidiKaraokePlayer
          src={song.mediaUrl}
          song={song}
          heading={heading}
          variant={variant}
          source="folder"
          onEnded={onEnded}
          autoPlay={autoPlay}
        />
      )
    }
    return (
      <LocalMediaPlayer
        src={song.mediaUrl}
        song={song}
        heading={heading}
        variant={variant}
        source={song.source === 'ultrastar' ? 'ultrastar' : 'folder'}
        onEnded={onEnded}
        autoPlay={autoPlay}
      />
    )
  }

  return (
    <>
      <YouTubePlayer
        song={song}
        videoId={videoId}
        heading={heading}
        variant={variant}
        onEnded={onEnded}
        autoPlay={autoPlay}
      />
      <AddLocalMediaBox songId={song.id} />
    </>
  )
}

interface LocalMediaPlayerProps {
  src: string
  song: Song
  heading?: string
  variant: 'room' | 'card'
  source: 'file' | 'folder' | 'ultrastar'
  onEnded?: () => void
  autoPlay?: boolean
}

function LocalMediaPlayer({
  src,
  song,
  heading,
  variant,
  source,
  onEnded,
  autoPlay,
}: LocalMediaPlayerProps) {
  return (
    <div className={`player player--${variant} player--local`}>
      {heading && <p className="player__heading">{heading}</p>}
      <div className="player__frame">
        <video
          className="player__video"
          src={src}
          poster={song.coverUrl}
          controls
          playsInline
          preload="metadata"
          autoPlay={autoPlay}
          onEnded={onEnded}
        />
      </div>
      <p className="player__attribution">
        {source === 'file'
          ? `Playing a file from this device · ${song.title} — ${song.artist}`
          : source === 'ultrastar'
            ? `Streaming from the UltraStar Creative Commons library · ${song.title} — ${song.artist}`
            : `Playing from the local Songs library · ${song.title} — ${song.artist}`}
      </p>
      {source === 'file' && (
        <AddLocalMediaBox songId={song.id} label="Replace or remove this file" />
      )}
    </div>
  )
}
