import { useState } from 'react'
import type { FormEvent } from 'react'
import { useVideoLibrary } from '../state/useVideoLibrary.ts'

interface AddVideoBoxProps {
  songId: string
  label?: string
  onSaved?: (videoId: string) => void
}

/**
 * AddVideoBox — attaches a permitted YouTube id to a song.
 *
 * This is intentionally manual. The app does not search YouTube on the user's
 * behalf or embed anything it was not handed, which keeps "use only permitted
 * embeds" true by construction.
 */
export function AddVideoBox({ songId, label, onSaved }: AddVideoBoxProps) {
  const { setVideoId, hasOverride } = useVideoLibrary()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const ok = setVideoId(songId, value)
    if (!ok) {
      setError('That does not look like a YouTube id or link.')
      return
    }
    setError(null)
    setValue('')
    onSaved?.(value.trim())
  }

  return (
    <form className="add-video" onSubmit={handleSubmit}>
      <label className="add-video__label">
        {label ?? 'Paste a YouTube id or link you are permitted to embed'}
      </label>
      <div className="add-video__row">
        <input
          className="input"
          type="text"
          value={value}
          placeholder="e.g. jNQXAC9IVRw or https://youtu.be/…"
          onChange={(event) => setValue(event.target.value)}
          aria-label="Permitted YouTube id or link"
        />
        <button type="submit" className="btn btn--ghost">
          Save
        </button>
      </div>
      {hasOverride(songId) && (
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setVideoId(songId, '')
            setError(null)
          }}
        >
          Remove saved video
        </button>
      )}
      {error && <p className="form-error">{error}</p>}
    </form>
  )
}
