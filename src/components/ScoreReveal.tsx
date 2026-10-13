import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScoreEntry } from '../types.ts'
import { SCORING_MAX, SCORING_MIN, scoreGrade, starsForScore } from '../lib/scoring.ts'
import { startDrumRoll } from '../lib/drumroll.ts'
import { useRoom } from '../state/useRoom.ts'
import { useMediaLibrary } from '../state/useMediaLibrary.ts'

interface ScoreRevealProps {
  score: ScoreEntry
  /** Called when the reveal is finished and the next song should play. */
  onDone: () => void
}

/** How long the number rolls before it settles on the real score. */
const ROLL_MS = 2400
/** Total time the popup stays up before the next song starts. */
const TOTAL_MS = 5000
/** How fast the rolling number flickers. */
const TICK_MS = 70

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function randomScore(): number {
  return SCORING_MIN + Math.floor(Math.random() * (SCORING_MAX - SCORING_MIN + 1))
}

/**
 * The big centred score popup that appears once a song ends.
 *
 * It covers the whole viewport (the "centre of the monitor"), plays a drum roll
 * while a random number spins, then stops on the real score with a
 * "Congratulations!" headline. After a few seconds it calls `onDone` so the
 * stage can move on to the next singer.
 */
export function ScoreReveal({ score, onDone }: ScoreRevealProps) {
  const { room } = useRoom()
  const { getSong } = useMediaLibrary()
  const reduced = useMemo(() => prefersReducedMotion(), [])
  const [display, setDisplay] = useState(() => randomScore())
  const [settled, setSettled] = useState(false)
  const doneRef = useRef(onDone)

  // Keep the latest callback without letting it reset the timers below.
  useEffect(() => {
    doneRef.current = onDone
  })

  useEffect(() => {
    const rollMs = reduced ? 700 : ROLL_MS
    const roll = startDrumRoll(rollMs)
    const tick = window.setInterval(() => setDisplay(randomScore()), TICK_MS)
    const settle = window.setTimeout(() => {
      window.clearInterval(tick)
      setDisplay(score.value)
      setSettled(true)
      roll.stop()
    }, rollMs)
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(settle)
      roll.cancel()
    }
  }, [score.id, score.value, reduced])

  useEffect(() => {
    const timer = window.setTimeout(() => doneRef.current(), TOTAL_MS)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') doneRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [score.id])

  const song = getSong(score.songId)
  const singer = room?.singers.find((candidate) => candidate.id === score.singerId)
  const stars = starsForScore(score.value)

  return (
    <div className="score-reveal" role="dialog" aria-modal="true" aria-label="Score result">
      <div className="score-reveal__card">
        {settled ? (
          <div className="score-reveal__result" aria-live="assertive">
            <p className="score-reveal__congrats">Congratulations!</p>
            <p className="score-reveal__label">Your score is:</p>
            <p className="score-reveal__value">{display}</p>
            <p className="score-reveal__stars">
              {'★'.repeat(stars)}
              <span className="score-reveal__stars-dim">{'★'.repeat(5 - stars)}</span>
            </p>
            <p className="score-reveal__grade">{scoreGrade(score.value)}</p>
            <p className="score-reveal__who">
              <strong>{singer?.name ?? 'Someone'}</strong>
              {song ? ` · ${song.title}` : ''}
            </p>
          </div>
        ) : (
          <div className="score-reveal__rolling">
            <p className="score-reveal__label">SCORE</p>
            <p className="score-reveal__value score-reveal__value--rolling" aria-hidden="true">
              {display}
            </p>
            <p className="score-reveal__hint">Drum roll… drawing your score</p>
          </div>
        )}

        <button type="button" className="btn btn--primary" onClick={() => doneRef.current()}>
          Next singer ▸
        </button>
        <p className="score-reveal__note">Fun random score — not a measurement of your singing.</p>
      </div>
    </div>
  )
}
