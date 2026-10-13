import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRoom } from '../state/useRoom.ts'

export function RoomTopBar() {
  const { room, adapterSharingNote, adapterDegraded, adapterDegradedReason } = useRoom()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  if (!room) return null

  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/room/${room.code}` : room.code

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="room-topbar" aria-label="Room details">
      <div className="room-topbar__id">
        <p className="room-topbar__name">{room.name}</p>
        <div className="room-topbar__code">
          <span className="room-topbar__code-label">Room code</span>
          <strong>{room.code}</strong>
        </div>
      </div>

      <div className="room-topbar__actions">
        <button type="button" className="btn btn--ghost" onClick={copyShare}>
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => navigate('/')}>
          Leave
        </button>
      </div>

      <p className={`room-topbar__note${adapterDegraded ? ' is-warn' : ''}`}>
        {adapterDegraded ? adapterDegradedReason : adapterSharingNote}
      </p>
    </section>
  )
}
