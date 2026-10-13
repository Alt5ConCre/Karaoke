import { useEffect, useMemo, useState } from 'react'
import type { ScoreEntry, Singer } from '../types.ts'
import { scoreGrade, SCORING_DISCLAIMER, starsForScore } from '../lib/scoring.ts'
import { useRoom } from '../state/useRoom.ts'
import { useMediaLibrary } from '../state/useMediaLibrary.ts'

interface Row {
  singer: Singer
  total: number
  count: number
  best: number
  average: number
}

export function Leaderboard() {
  const { room, me } = useRoom()

  const rows = useMemo<Row[]>(() => {
    if (!room) return []
    const bySinger = new Map<string, Row>()
    for (const singer of room.singers) {
      bySinger.set(singer.id, { singer, total: 0, count: 0, best: 0, average: 0 })
    }
    for (const score of room.scores) {
      const row = bySinger.get(score.singerId)
      if (!row) continue
      row.total += score.value
      row.count += 1
      row.best = Math.max(row.best, score.value)
    }
    return [...bySinger.values()]
      .map((row) => ({ ...row, average: row.count ? Math.round(row.total / row.count) : 0 }))
      .sort((a, b) => b.total - a.total || b.best - a.best || a.singer.name.localeCompare(b.singer.name))
  }, [room])

  if (!room) return null

  const medals = ['🥇', '🥈', '🥉']
  const anyScores = room.scores.length > 0

  return (
    <section className="panel" aria-label="Leaderboard">
      <header className="panel__head">
        <h2 className="panel__title">Leaderboard</h2>
        <span className="badge badge--demo">demo scores</span>
      </header>

      {!anyScores ? (
        <p className="empty-state empty-state--sm">
          No scores yet. Finish a song and a simulated demo score lands here.
        </p>
      ) : (
        <ol className="leaderboard">
          {rows.map((row, index) => (
            <li
              key={row.singer.id}
              className={`leader-row${me?.id === row.singer.id ? ' is-me' : ''}`}
            >
              <span className="leader-row__rank">{medals[index] ?? index + 1}</span>
              <span className="avatar" style={{ background: row.singer.color }} aria-hidden="true">
                {row.singer.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="leader-row__body">
                <span className="leader-row__name">{row.singer.name}</span>
                <span className="leader-row__grade">
                  {scoreGrade(row.average)} · best {row.best}
                </span>
              </div>
              <div className="leader-row__score">
                <strong>{row.total}</strong>
                <small>
                  {row.count} {row.count === 1 ? 'song' : 'songs'}
                </small>
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="panel__footnote panel__footnote--warn">{SCORING_DISCLAIMER}</p>
    </section>
  )
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  )
}

/** Counts up to the score once on mount; remounts (via key) for each result. */
function AnimatedScore({ value }: { value: number }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0))

  useEffect(() => {
    if (prefersReducedMotion()) return
    let raf = 0
    const start = performance.now()
    const duration = 700
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(Math.round(eased * value))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])

  return <p className="score-panel__value">{shown}</p>
}

export function ScorePanel({ score }: { score: ScoreEntry | null }) {
  const { room } = useRoom()
  const { getSong } = useMediaLibrary()

  if (!score) {
    return (
      <div className="score-panel score-panel--idle">
        <p className="score-panel__label">Last result</p>
        <p className="score-panel__hint">
          Finish a song to draw a fun score for it. Every song gets a fresh random number, just for
          kicks.
        </p>
      </div>
    )
  }

  const song = getSong(score.songId)
  const singer = room?.singers.find((s) => s.id === score.singerId) ?? null
  const stars = starsForScore(score.value)

  return (
    <div className="score-panel score-panel--fresh" aria-live="polite">
      <p className="score-panel__label">
        Result <span className="badge badge--demo">fun random</span>
      </p>
      <AnimatedScore key={score.id} value={score.value} />
      <p className="score-panel__who">
        <strong>{singer?.name ?? 'Someone'}</strong>
        {song ? ` · ${song.title}` : ''}
      </p>
      <p className="score-panel__stars" aria-label={`${stars} of 5 stars`}>
        {'★'.repeat(stars)}
        <span className="score-panel__stars-dim">{'★'.repeat(5 - stars)}</span>
      </p>
      <p className="score-panel__grade">{scoreGrade(score.value)}</p>
      <p className="score-panel__note">
        Fun random score — a fresh number drawn for the fun of it, not a measurement of your singing.
      </p>
    </div>
  )
}
