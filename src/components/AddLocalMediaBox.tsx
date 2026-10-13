import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useMediaLibrary } from '../state/useMediaLibrary.ts'

interface AddLocalMediaBoxProps {
  songId: string
  label?: string
}

/**
 * "Play a file from this laptop" control.
 *
 * Deliberately uses the `add-media` class (not `add-video`) so it never collides
 * with the YouTube-id box in AddVideoBox, and it adds no watch links to the
 * player notice area — the browser test keys off those exact selectors.
 */
export function AddLocalMediaBox({ songId, label }: AddLocalMediaBoxProps) {
  const { attachFile, removeFile, hasFile, fileMeta } = useMediaLibrary()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const meta = fileMeta(songId)

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      await attachFile(songId, file)
      setError(null)
    } catch {
      setError('Could not save that file in this browser.')
    }
  }

  return (
    <div className="add-media">
      <label className="add-media__label">
        {label ?? 'No YouTube? Play your own video or audio file from this laptop'}
      </label>
      <div className="add-media__row">
        <input
          ref={inputRef}
          className="input add-media__input"
          type="file"
          accept="video/*,audio/*,.mp4,.webm,.m4a,.mp3,.mov"
          onChange={handleChange}
          aria-label="Choose a video or audio file from this device"
        />
        {hasFile(songId) && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              void removeFile(songId)
              setError(null)
            }}
          >
            Remove file
          </button>
        )}
      </div>
      {meta && <p className="add-media__saved">Saved on this device: {meta.name}</p>}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
