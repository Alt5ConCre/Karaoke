import { useState } from 'react'
import type { Song } from '../types.ts'
import { useVideoLibrary } from '../state/useVideoLibrary.ts'
import { useMediaLibrary } from '../state/useMediaLibrary.ts'
import { MediaPlayer } from './MediaPlayer.tsx'

interface SongCardProps {
  song: Song
  onAdd?: (songId: string) => void
  addDisabled?: boolean
  addLabel?: string
  onRemove?: (songId: string) => void
}

export function SongCard({
  song,
  onAdd,
  addDisabled = false,
  addLabel = 'Add to queue',
  onRemove,
}: SongCardProps) {
  const { resolveVideoId, hasOverride } = useVideoLibrary()
  const { sourceKind } = useMediaLibrary()
  const [previewing, setPreviewing] = useState(false)
  const videoId = resolveVideoId(song)
  const kind = sourceKind(song)

  const badge =
    kind === 'file'
      ? { label: 'Local file', ok: true }
      : kind === 'ultrastar'
        ? { label: 'UltraStar', ok: true }
        : kind === 'folder'
          ? { label: 'Songs folder', ok: true }
          : kind === 'youtube'
            ? { label: hasOverride(song.id) ? 'Video set' : 'Video ready', ok: true }
            : { label: 'No video id', ok: false }

  return (
    <article className="song-card">
      <div className="song-card__head">
        <div>
          <h3 className="song-card__title">{song.title}</h3>
          <p className="song-card__artist">{song.artist}</p>
        </div>
        <div className="song-card__badges">
          {song.source === 'custom' && <span className="badge badge--user">Your song</span>}
          <span className={`badge${badge.ok ? ' badge--ok' : ' badge--muted'}`}>
            {badge.label}
          </span>
        </div>
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
        {song.source === 'custom' && onRemove && (
          <button type="button" className="link-button" onClick={() => onRemove(song.id)}>
            Remove
          </button>
        )}
      </div>

      {previewing && <MediaPlayer song={song} videoId={videoId} />}
    </article>
  )
}
