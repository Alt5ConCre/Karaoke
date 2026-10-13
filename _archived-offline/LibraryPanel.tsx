import type { Song } from '../types.ts'

interface LibraryPanelProps {
  songs: Song[] | null
  query: string
  onQuery: (query: string) => void
  selectedId: string | null
  onSelect: (song: Song) => void
}

/**
 * The local catalogue: every song is a folder the user copied into Songs/.
 * A search box filters by title/artist, and each tile jumps straight to the
 * player. Tiles wear honest badges ("notes" = this song has a reference melody
 * to score against; "lyrics" = timed lines are included).
 */
export function LibraryPanel({ songs, query, onQuery, selectedId, onSelect }: LibraryPanelProps) {
  const matches = (song: Song): boolean => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return `${song.title} ${song.artist}`.toLowerCase().includes(q)
  }

  const shown = songs ? songs.filter(matches) : null

  return (
    <section className="panel library-panel" data-testid="library-panel" aria-label="Song library">
      <div className="panel__head">
        <h2 className="panel__title">Song library</h2>
        <span className="panel__count">{shown ? `${shown.length} of ${songs?.length ?? 0}` : ''}</span>
      </div>

      <label className="search-box">
        <span className="search-box__icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
        </span>
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search title or artist…"
          aria-label="Search songs"
          data-testid="search-box"
        />
      </label>

      <div className="song-list" data-testid="song-list">
        {shown === null && (
          <p className="panel__hint" data-testid="library-loading">
            Reading the local Songs folder…
          </p>
        )}
        {shown !== null && shown.length === 0 && (
          <p className="panel__hint" data-testid="library-empty">
            {songs?.length ? 'No song matches that search.' : 'No songs found in the Songs folder yet.'}
          </p>
        )}
        {shown?.map((song) => (
          <button
            key={song.id}
            type="button"
            className={`song-tile${selectedId === song.id ? ' song-tile--active' : ''}`}
            onClick={() => onSelect(song)}
            data-testid="song-tile"
            data-song-id={song.id}
          >
            <span className="song-tile__cover" aria-hidden="true">
              {song.coverUrl ? (
                <img
                  src={song.coverUrl}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <span className="song-tile__glyph">♪</span>
              )}
            </span>
            <span className="song-tile__body">
              <span className="song-tile__title" data-testid="song-title">
                {song.title}
              </span>
              <span className="song-tile__artist">{song.artist}</span>
            </span>
            <span className="song-tile__badges">
              {song.hasNotes && (
                <span className="badge badge--notes" title="Reference melody included — real scoring available">
                  notes
                </span>
              )}
              {song.hasLyrics && (
                <span className="badge" title="Timed lyrics included">
                  lyrics
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {songs !== null && songs.length > 0 && (
        <p className="library-panel__foot">
          Add songs by copying a folder (video.mp4, optional lyrics.json and notes.json, cover.jpg) into the Songs
          folder next to the app.
        </p>
      )}
    </section>
  )
}