import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { normalizeRoomCode } from '../lib/ids.ts'
import { useAuth } from '../state/useAuth.ts'
import { useRoom } from '../state/useRoom.ts'

export function CreateJoinRoom() {
  const { profile } = useAuth()
  const { createRoom, joinRoom, transportReady, error, clearError } = useRoom()
  const navigate = useNavigate()

  const [roomName, setRoomName] = useState('')
  const [createName, setCreateName] = useState(profile?.name ?? '')
  const [joinCode, setJoinCode] = useState('')
  const [joinName, setJoinName] = useState(profile?.name ?? '')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (createName.trim().length === 0) return
    clearError()
    setBusy('create')
    try {
      const code = await createRoom(roomName, createName)
      navigate(`/room/${code}`)
    } catch {
      /* error surfaces through context */
    } finally {
      setBusy(null)
    }
  }

  async function handleJoin(event: FormEvent) {
    event.preventDefault()
    if (joinName.trim().length === 0 || joinCode.trim().length < 4) return
    clearError()
    setBusy('join')
    try {
      const ok = await joinRoom(joinCode, joinName)
      if (ok) navigate(`/room/${normalizeRoomCode(joinCode)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="lobby">
      <form className="lobby-card" onSubmit={handleCreate}>
        <h2 className="lobby-card__title">Start a videoke night</h2>
        <p className="lobby-card__copy">
          Create a room and get a code your barkada can enter to join the rotation.
        </p>
        <label className="field">
          <span className="field__label">Room name</span>
          <input
            className="input"
            type="text"
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            placeholder="e.g. Lola's Birthday"
            maxLength={40}
          />
        </label>
        <label className="field">
          <span className="field__label">Your name (host)</span>
          <input
            className="input"
            type="text"
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="e.g. Ana"
            maxLength={24}
          />
        </label>
        <button
          type="submit"
          className="btn btn--primary btn--lg"
          disabled={!transportReady || busy !== null || createName.trim().length === 0}
        >
          {busy === 'create' ? 'Creating…' : 'Create room'}
        </button>
      </form>

      <form className="lobby-card lobby-card--alt" onSubmit={handleJoin}>
        <h2 className="lobby-card__title">Join with a code</h2>
        <p className="lobby-card__copy">
          Enter the room code someone shared with you. On this device the room syncs across tabs.
        </p>
        <label className="field">
          <span className="field__label">Room code</span>
          <input
            className="input input--code"
            type="text"
            value={joinCode}
            onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))}
            placeholder="ABC12"
            maxLength={5}
            autoCapitalize="characters"
          />
        </label>
        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="input"
            type="text"
            value={joinName}
            onChange={(event) => setJoinName(event.target.value)}
            placeholder="e.g. Ben"
            maxLength={24}
          />
        </label>
        <button
          type="submit"
          className="btn btn--ghost btn--lg"
          disabled={!transportReady || busy !== null || joinCode.trim().length < 4}
        >
          {busy === 'join' ? 'Joining…' : 'Join room'}
        </button>
      </form>

      {error && <p className="form-error lobby__error">{error}</p>}
    </div>
  )
}
