import { useRef, useState } from 'react'
import type { ScoreEntry } from '../types.ts'
import { useRoom } from '../state/useRoom.ts'
import { useVideoLibrary } from '../state/useVideoLibrary.ts'
import { useMediaLibrary } from '../state/useMediaLibrary.ts'
import { MediaPlayer } from './MediaPlayer.tsx'
import { BackgroundPicker } from './BackgroundPicker.tsx'
import { ScorePanel } from './Leaderboard.tsx'
import { ScoreReveal } from './ScoreReveal.tsx'

/** High-water mark of scores already seen, so only fresh ones pop the reveal. */
interface SeenScores {
  code: string
  count: number
}

export function NowSingingPanel() {
  const { room, startNext, endSong, skipCurrent } = useRoom()
  const { resolveVideoId } = useVideoLibrary()
  const { getSong } = useMediaLibrary()

  // Which queue item should start playing once the score popup closes.
  const [autoplayItemId, setAutoplayItemId] = useState<string | null>(null)
  const [seen, setSeen] = useState<SeenScores | null>(null)
  const endingRef = useRef<string | null>(null)

  const scores = room?.scores ?? []

  // First render with a room (or after switching rooms): remember how many
  // scores already exist so we never surprise the user with an old one.
  if (room && (!seen || seen.code !== room.code)) {
    setSeen({ code: room.code, count: scores.length })
  }

  // A freshly drawn score (auto-advance, the End button, or another device)
  // is always the last appended entry.
  const reveal: ScoreEntry | null =
    room && seen && seen.code === room.code && scores.length > seen.count
      ? (scores[scores.length - 1] ?? null)
      : null

  const current = room?.queue.find((item) => item.status === 'singing') ?? null
  const song = current ? (getSong(current.songId) ?? null) : null
  const singer = current
    ? (room?.singers.find((candidate) => candidate.id === current.singerId) ?? null)
    : null
  const latestScore = room ? ([...room.scores].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null) : null

  // Ends the current song once. The local <video> and the End button both call
  // this, so guard against ending the same song twice (which would skip ahead).
  function handleEnd() {
    const id = current?.id
    if (!id || endingRef.current === id) return
    endingRef.current = id
    void endSong()
  }

  // When the reveal closes, remember the now-current song so it auto-plays.
  function handleRevealDone() {
    const nextItem = room?.queue.find((item) => item.status === 'singing') ?? null
    setAutoplayItemId(nextItem?.id ?? null)
    setSeen({ code: room?.code ?? '', count: scores.length })
  }

  if (!room) return null

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

      {!reveal &&
        (song ? (
          <>
            <MediaPlayer
              song={song}
              videoId={resolveVideoId(song)}
              variant="room"
              heading={`${song.title} — ${song.artist}`}
              onEnded={handleEnd}
              autoPlay={current?.id === autoplayItemId}
            />
            <div className="stage-controls">
              <button type="button" className="btn btn--primary btn--lg" onClick={handleEnd}>
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
        ))}

      <BackgroundPicker />

      <ScorePanel score={latestScore} />

      {reveal && <ScoreReveal score={reveal} onDone={handleRevealDone} />}
    </section>
  )
}
