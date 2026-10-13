import { useMemo } from 'react'
import { joinOrder, upcomingBySinger } from '../lib/rotation.ts'
import { useRoom } from '../state/useRoom.ts'
import { useMediaLibrary } from '../state/useMediaLibrary.ts'
import type { Singer } from '../types.ts'

function SingerChip({ singer, size = 26 }: { singer: Singer; size?: number }) {
  return (
    <span className="singer-chip">
      <span
        className="avatar"
        style={{ background: singer.color, width: size, height: size }}
        aria-hidden="true"
      >
        {singer.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="singer-chip__name">{singer.name}</span>
      {singer.isHost && <span className="badge badge--host">host</span>}
    </span>
  )
}

export function RotationPanel() {
  const { room, setRotationMode } = useRoom()

  const onMicId = room?.queue.find((item) => item.status === 'singing')?.singerId ?? null

  const upcoming = useMemo(
    () => (room ? upcomingBySinger(room.queue, room.singers, room.rotationMode) : []),
    [room],
  )

  if (!room) return null

  const queuedCount = (singerId: string) =>
    room.queue.filter((item) => item.singerId === singerId && item.status === 'waiting').length

  return (
    <section className="panel" aria-label="Singer rotation">
      <header className="panel__head">
        <h2 className="panel__title">Singer rotation</h2>
        <div className="segmented" role="group" aria-label="Pick mode">
          <button
            type="button"
            className={`segmented__option${room.rotationMode === 'rotation' ? ' is-active' : ''}`}
            onClick={() => setRotationMode('rotation')}
            aria-pressed={room.rotationMode === 'rotation'}
            title="Round-robin by singer"
          >
            Rotation
          </button>
          <button
            type="button"
            className={`segmented__option${room.rotationMode === 'queue' ? ' is-active' : ''}`}
            onClick={() => setRotationMode('queue')}
            aria-pressed={room.rotationMode === 'queue'}
            title="First come, first served"
          >
            Queue
          </button>
        </div>
      </header>

      <ul className="rotation-list">
        {joinOrder(room.singers).map((singer) => (
          <li
            key={singer.id}
            className={`rotation-row${onMicId === singer.id ? ' is-singing' : ''}`}
          >
            <SingerChip singer={singer} />
            <span className="rotation-row__count">
              {queuedCount(singer.id) > 0 ? `${queuedCount(singer.id)} queued` : '—'}
            </span>
            {onMicId === singer.id && <span className="badge badge--live">on mic</span>}
          </li>
        ))}
      </ul>

      {upcoming.length > 0 && (
        <p className="rotation-next">
          <span className="rotation-next__label">Up next:</span>{' '}
          {upcoming
            .slice(0, 5)
            .map((singerId) => room.singers.find((singer) => singer.id === singerId)?.name)
            .filter(Boolean)
            .join(' → ')}
        </p>
      )}

      <p className="panel__footnote">
        {room.rotationMode === 'rotation'
          ? 'Each singer takes a turn before anyone sings twice.'
          : 'Strict first-come, first-served by song.'}
      </p>
    </section>
  )
}

export function QueuePanel() {
  const { room, me, removeWaiting, clearWaiting, endSong, skipCurrent, startNext } = useRoom()
  const { getSong } = useMediaLibrary()

  if (!room) return null

  const singing = room.queue.find((item) => item.status === 'singing') ?? null
  const waiting = room.queue
    .filter((item) => item.status === 'waiting')
    .sort((a, b) => a.addedAt - b.addedAt)
  const played = room.queue
    .filter((item) => item.status === 'done')
    .sort((a, b) => (a.startedAt ?? a.addedAt) - (b.startedAt ?? b.addedAt))

  const canRemove = (singerId: string) => Boolean(me && (me.isHost || me.id === singerId))

  return (
    <section className="panel" aria-label="Song queue">
      <header className="panel__head">
        <h2 className="panel__title">Song queue</h2>
        <div className="panel__head-actions">
          {singing ? (
            <>
              <button type="button" className="btn btn--primary" onClick={endSong}>
                End &amp; score
              </button>
              <button type="button" className="btn btn--ghost" onClick={skipCurrent}>
                Skip
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={startNext}
              disabled={waiting.length === 0}
            >
              Start next
            </button>
          )}
        </div>
      </header>

      {singing && (
        <div className="queue-now">
          <span className="badge badge--live">now singing</span>
          <strong>{getSong(singing.songId)?.title ?? 'Unknown song'}</strong>
          <span className="queue-now__singer">
            {room.singers.find((singer) => singer.id === singing.singerId)?.name}
          </span>
        </div>
      )}

      <h3 className="panel__subtitle">Up next ({waiting.length})</h3>
      {waiting.length === 0 ? (
        <p className="empty-state empty-state--sm">Walang nakapila. Add a song to get started.</p>
      ) : (
        <ol className="queue-list">
          {waiting.map((item, index) => {
            const song = getSong(item.songId)
            const singer = room.singers.find((candidate) => candidate.id === item.singerId)
            return (
              <li key={item.id} className="queue-row">
                <span className="queue-row__index">{index + 1}</span>
                <div className="queue-row__body">
                  <span className="queue-row__title">{song?.title ?? 'Unknown song'}</span>
                  <span className="queue-row__meta">
                    {song?.artist} · for{' '}
                    <span style={{ color: singer?.color }}>{singer?.name ?? 'Someone'}</span>
                  </span>
                </div>
                {canRemove(item.singerId) && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => removeWaiting(item.id)}
                    aria-label={`Remove ${song?.title ?? 'song'} from queue`}
                  >
                    Remove
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      )}

      <div className="panel__foot">
        <button
          type="button"
          className="link-button"
          onClick={clearWaiting}
          disabled={waiting.length === 0}
        >
          Clear waiting list
        </button>
        {played.length > 0 && <span className="panel__foot-note">{played.length} played</span>}
      </div>
    </section>
  )
}
