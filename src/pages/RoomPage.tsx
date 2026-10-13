import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { DemoBanner } from '../components/DemoBanner.tsx'
import { JoinRoomPanel } from '../components/JoinRoomPanel.tsx'
import { Leaderboard } from '../components/Leaderboard.tsx'
import { NowSingingPanel } from '../components/NowSingingPanel.tsx'
import { QueuePanel, RotationPanel } from '../components/RotationPanel.tsx'
import { RoomTopBar } from '../components/RoomTopBar.tsx'
import { SongBrowser } from '../components/SongBrowser.tsx'
import { normalizeRoomCode } from '../lib/ids.ts'
import { useRoom } from '../state/useRoom.ts'

export function RoomPage() {
  const params = useParams<{ code: string }>()
  const code = normalizeRoomCode(params.code ?? '')
  const { watchRoom, room, joined, status, error, transportReady, addSong } = useRoom()

  useEffect(() => {
    if (!transportReady || code === '') return
    return watchRoom(code)
  }, [transportReady, code, watchRoom])

  if (!transportReady) {
    return (
      <div className="page page--room">
        <p className="room-loading">Connecting to the room service…</p>
      </div>
    )
  }

  return (
    <div className="page page--room">
      {error && <p className="form-error">{error}</p>}

      {!room ? (
        status === 'loading' ? (
          <p className="room-loading">Looking up room {code}…</p>
        ) : (
          <JoinRoomPanel code={code} />
        )
      ) : !joined ? (
        <JoinRoomPanel code={code} />
      ) : (
        <>
          <RoomTopBar />
          <DemoBanner />
          <div className="room-grid">
            <div className="room-col room-col--main">
              <NowSingingPanel />
              <SongBrowser
                heading="Add a song to the queue"
                onAdd={(songId) => void addSong(songId)}
                addLabel="Add to queue"
              />
            </div>
            <div className="room-col room-col--side">
              <RotationPanel />
              <QueuePanel />
              <Leaderboard />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
