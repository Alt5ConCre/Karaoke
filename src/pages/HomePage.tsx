import { CreateJoinRoom } from '../components/CreateJoinRoom.tsx'
import { AddSongBox } from '../components/AddSongBox.tsx'
import { DemoBanner } from '../components/DemoBanner.tsx'
import { SongBrowser } from '../components/SongBrowser.tsx'
import { ULTRATAR_LIBRARY } from '../data/ultrastarSongs.ts'
import { useRoom } from '../state/useRoom.ts'

export function HomePage() {
  const { adapterLabel, transportReady } = useRoom()

  return (
    <div className="page page--home">
      <section className="hero">
        <div className="hero__glow" aria-hidden="true" />
        <p className="hero__eyebrow">Open mic · Tagalog, Taglish, at English</p>
        <h1 className="hero__title">
          Your living room is the <span className="hero__accent">videoke bar</span> tonight.
        </h1>
        <p className="hero__lead">
          Search the demo catalog, queue the classics, keep the rotation fair, and see who tops the
          board. Bring the whole barkada — no hardware needed.
        </p>
        <p className="hero__transport">
          Rooms run on: <strong>{transportReady ? adapterLabel : 'starting…'}</strong>
        </p>
      </section>

      <DemoBanner />

      <CreateJoinRoom />

      <AddSongBox />

      <SongBrowser heading="Demo song catalog" />

      <p className="library-note">
        Also streaming <strong>{ULTRATAR_LIBRARY.count}</strong> Creative Commons karaoke tracks from
        the{' '}
        <a href={ULTRATAR_LIBRARY.repo} target="_blank" rel="noreferrer">
          UltraStar Deluxe song pack
        </a>
        . {ULTRATAR_LIBRARY.note}
      </p>

      <footer className="page-footer">
        <p>
          Built with the official YouTube embed only — no video downloads, no audio extraction. Every
          finished song draws a fresh fun random score for the board; it is a party game number, not a
          measurement of anyone's singing.
        </p>
      </footer>
    </div>
  )
}
