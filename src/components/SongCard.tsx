import { useState } from 'react'
import type { Song } from '../types.ts'
import { useVideoLibrary } from '../state/useVideoLibrary.ts'
import { YouTubePlayer } from './YouTubePlayer.tsx'

interface SongCardProps {
  song: Song
  onAdd?: (songId: string) => void
  addDisabled?: boolean
  addLabel?: string
}

export function SongCard({
  song,
  onAdd,
  addDisabled = false,
  addLabel = 'Add to queue',
}: SongCardProps) {
  const { resolveVideoId, hasOverride } = useVideoLibrary()
  const [previewing, setPreviewing] = useState(false)
  const videoId = resolveVideoId(song)
  const videoReady = videoId !== ''

  return (
    <article className="song-card">
      <div className="song-card__head">
        <div>
          <h3 className="song-card__title">{song.title}</h3>
          <p className="song-card__artist">{song.artist}</p>
        </div>
        <span className={`badge${videoReady ? ' badge--ok' : ' badge--muted'}`}>
          {videoReady ? (hasOverride(song.id) ? 'Video set' : 'Video ready') : 'No video id'}
        </span>
      </div>

      <ul className="song-card__meta">
        {song.year && <li>{song.year}</li>}
        <li>{song.language}</li>
        <li>{song.genre}</li>
      </ul>

      <ul className="tag-list">
        {song.tags.map((tag) => (
          <li key={tag} className="tag">
            {tag}
          </li>
        ))}
      </ul>

      <div className="song-card__actions">
        {onAdd && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onAdd(song.id)}
            disabled={addDisabled}
          >
            {addLabel}
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setPreviewing((value) => !value)}
          aria-expanded={previewing}
        >
          {previewing ? 'Hide preview' : 'Preview'}
        </button>
      </div>

      {previewing && <YouTubePlayer song={song} videoId={videoId} />}
    </article>
  )
}
