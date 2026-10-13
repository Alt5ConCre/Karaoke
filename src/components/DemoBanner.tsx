import { SCORING_DISCLAIMER, SCORING_MODE } from '../lib/scoring.ts'

/**
 * DemoBanner — permanent, honest labelling of what is real and what is not.
 * Deliberately not dismissible: it is the difference between a demo and a claim.
 */
export function DemoBanner() {
  return (
    <aside className="demo-banner" role="note">
      <span className="demo-banner__pill">DEMO</span>
        <p className="demo-banner__text">
          Demo song catalog and playlist tools are fully working. Karaoke videos appear only when a
          permitted YouTube id is configured. Each finished song draws a new score,{' '}
          <strong>simulated ({SCORING_MODE})</strong> — {SCORING_DISCLAIMER}
        </p>
    </aside>
  )
}
