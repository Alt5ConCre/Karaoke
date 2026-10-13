import { useRoom } from '../state/useRoom.ts'
import { useVideoLibrary } from '../state/useVideoLibrary.ts'
import { useMediaLibrary } from '../state/useMediaLibrary.ts'
import { MediaPlayer } from './MediaPlayer.tsx'
import { ScorePanel } from './Leaderboard.tsx'

export function NowSingingPanel() {
  const { room, startNext, endSong, skipCurrent } = useRoom()
  const { resolveVideoId } = useVideoLibrary()
  const { getSong } = useMediaLibrary()

  if (!room) return null

  const current = room.queue.find((item) => item.status === 'singing') ?? null
  const song = current ? (getSong(current.songId) ?? null) : null
  const singer = current
    ? (room.singers.find((candidate) => candidate.id === current.singerId) ?? null)
    : null
  const latestScore =
    [...room.scores].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null

  return (
    <section className="panel panel--stage" aria-label="Now singing">
      <header className="panel__head">
        <h2 className="panel__title">On the mic</h2>
        {singer && (
          <span className="now-singer" style={{ borderColor: singer.color }}>
            <span className="avatar" style={{ background: singer.color }} aria-hidden="true">
              {singer.name.slice(0, 1).toUpperCase()}
            </span>
            {singer.name}
          </span>
        )}
      </header>

      {song ? (
        <>
          <MediaPlayer
            song={song}
            videoId={resolveVideoId(song)}
            variant="room"
            heading={`${song.title} — ${song.artist}`}
          />
          <div className="stage-controls">
            <button type="button" className="btn btn--primary btn--lg" onClick={endSong}>
              End song &amp; score it
            </button>
            <button type="button" className="btn btn--ghost" onClick={skipCurrent}>
              Skip without scoring
            </button>
          </div>
        </>
      ) : (
        <div className="stage-idle">
          <p className="stage-idle__title">Walang kumakanta… yet.</p>
          <p className="stage-idle__copy">
            Add a song from the catalog, then start it when you are ready.
          </p>
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={startNext}
            disabled={!room.queue.some((item) => item.status === 'waiting')}
          >
            Start next singer
          </button>
        </div>
      )}

      <ScorePanel score={latestScore} />
    </section>
  )
}
