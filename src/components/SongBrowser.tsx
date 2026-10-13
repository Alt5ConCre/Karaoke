import { useMemo, useState } from 'react'
import type { Song } from '../types.ts'
import { useMediaLibrary } from '../state/useMediaLibrary.ts'
import { SongCard } from './SongCard.tsx'

type LanguageFilter = 'All' | Song['language']

const LANGUAGE_FILTERS: LanguageFilter[] = ['All', 'Tagalog', 'Taglish', 'English']

function matchesQuery(song: Song, query: string): boolean {
  if (query === '') return true
  const haystack = [song.title, song.artist, song.genre, song.language, ...song.tags]
    .join(' ')
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token))
}

interface SongBrowserProps {
  onAdd?: (songId: string) => void
  addDisabled?: boolean
  addLabel?: string
  heading?: string
}

export function SongBrowser({ onAdd, addDisabled, addLabel, heading }: SongBrowserProps) {
  const { catalog, removeCustomSong } = useMediaLibrary()
  const [query, setQuery] = useState('')
  const [language, setLanguage] = useState<LanguageFilter>('All')

  const results = useMemo(
    () =>
      catalog
        .filter((song) => language === 'All' || song.language === language)
        .filter((song) => matchesQuery(song, query)),
    [catalog, query, language],
  )

  return (
    <section className="song-browser" aria-label="Song catalog">
      <div className="song-browser__controls">
        <div className="search">
          <span className="search__icon" aria-hidden="true">
            ⌕
          </span>
          <input
            className="input search__input"
            type="search"
            value={query}
            placeholder="Search title, artist, genre or mood…"
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search songs"
          />
        </div>
        <div className="filter-row" role="group" aria-label="Filter by language">
          {LANGUAGE_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              className={`pill${language === option ? ' pill--active' : ''}`}
              onClick={() => setLanguage(option)}
              aria-pressed={language === option}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <p className="results-line">
        {heading && <span className="results-line__heading">{heading}</span>}
        {results.length} {results.length === 1 ? 'song' : 'songs'}
        {query && ` matching “${query}”`}
      </p>

      {results.length === 0 ? (
        <p className="empty-state">
          Walang nahanap. Try a different title, artist, or clear the filters.
        </p>
      ) : (
        <div className="song-grid">
          {results.map((song) => (
            <SongCard
              key={song.id}
              song={song}
              onAdd={onAdd}
              addDisabled={addDisabled}
              addLabel={addLabel}
              onRemove={
                song.source === 'custom' ? (songId) => void removeCustomSong(songId) : undefined
              }
            />
          ))}
        </div>
      )}
    </section>
  )
}
