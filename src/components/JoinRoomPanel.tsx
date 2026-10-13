import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../state/useAuth.ts'
import { useRoom } from '../state/useRoom.ts'

export function JoinRoomPanel({ code }: { code: string }) {
  const { profile } = useAuth()
  const { joinRoom, status, error, clearError } = useRoom()
  const [name, setName] = useState(profile?.name ?? '')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (name.trim().length === 0) return
    clearError()
    setSubmitting(true)
    const ok = await joinRoom(code, name)
    setSubmitting(false)
    if (!ok) return
  }

  const roomMissing = status === 'idle'

  return (
    <section className="join-panel" aria-label="Join room">
      <h2 className="join-panel__title">
        {roomMissing ? `Room ${code} not found` : `Join room ${code}`}
      </h2>
      <p className="join-panel__copy">
        {roomMissing
          ? 'Double-check the code, or head back home to create a new room.'
          : 'Enter your name so the rotation can call you up. Nothing is uploaded for a local room.'}
      </p>

      <form className="join-panel__form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="input"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Maria"
            maxLength={24}
            autoFocus
          />
        </label>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={submitting || name.trim().length === 0}
        >
          {submitting ? 'Joining…' : 'Join the videoke'}
        </button>
      </form>

      {error && <p className="form-error">{error}</p>}
    </section>
  )
}
