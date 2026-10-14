import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useMediaLibrary } from '../state/useMediaLibrary.ts'
import {
  LANGUAGES,
  buildCustomSong,
  parseSongLines,
} from '../lib/customSongs.ts'
import type { CustomSong } from '../lib/customSongs.ts'
import { MEDIA_ACCEPT, isPlayableMedia } from '../lib/mediaTypes.ts'
import { splitTitleArtist } from '../lib/songs.ts'

type Mode = 'single' | 'files' | 'folder' | 'paste'

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'single', label: 'One song' },
  { id: 'files', label: 'Pick files' },
  { id: 'folder', label: 'Whole folder' },
  { id: 'paste', label: 'Paste a list' },
]

/** Cap a single bulk action so we never try to write thousands of files at once. */
const MAX_BULK = 20000

type Entry = { song: CustomSong; file?: File }

/**
 * AddSongBox — the "songs I own" front door.
 *
 * Everything here stays on the device: titles in localStorage, any media files
 * in IndexedDB. It adds no watch links and no network calls, so it never pub-
 * lishes anything the singer did not already have the right to play.
 */
export function AddSongBox() {
  const { addCustomSongs } = useMediaLibrary()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('single')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [language, setLanguage] = useState<string>(LANGUAGES[0] ?? 'Tagalog')
  const [genre, setGenre] = useState('')
  const [youtube, setYoutube] = useState('')
  const singleFileRef = useRef<HTMLInputElement | null>(null)

  const [pasteText, setPasteText] = useState('')

  function resetMessages() {
    setNotice(null)
    setError(null)
  }

  function switchMode(next: Mode) {
    setMode(next)
    resetMessages()
  }

  async function save(entries: Entry[], message: (count: number) => string) {
    if (!entries.length) {
      setError('Nothing to add yet.')
      return
    }
    setBusy(true)
    try {
      await addCustomSongs(entries)
      setNotice(message(entries.length))
    } catch {
      setError('Could not save those songs in this browser.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSingle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    resetMessages()
    const song = buildCustomSong({ title, artist, language, genre, youtubeId: youtube })
    if (!song) {
      setError('Add a title first.')
      return
    }
    const file = singleFileRef.current?.files?.[0]
    if (singleFileRef.current) singleFileRef.current.value = ''
    await save([{ song, file }], () => `Added “${song.title}” to this device.`)
    setTitle('')
    setArtist('')
    setGenre('')
    setYoutube('')
  }

  function buildFromFiles(files: File[]): { entries: Entry[]; skipped: number } {
    const playable = files.filter((file) => isPlayableMedia(file))
    const capped = playable.slice(0, MAX_BULK)
    const entries: Entry[] = []
    for (const file of capped) {
      const song = buildCustomSong({ ...splitTitleArtist(file.name) }, String(file.size))
      if (song) entries.push({ song, file })
    }
    return { entries, skipped: files.length - capped.length }
  }

  async function handleBulkChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target
    const files = input.files ? Array.from(input.files) : []
    input.value = ''
    resetMessages()

    if (!files.length) {
      setError('No files selected.')
      return
    }
    const { entries, skipped } = buildFromFiles(files)
    if (!entries.length) {
      setError('Those files are not playable video or audio. Try MP4, WebM, MKV, MOV, MP3, M4A, OGG, WAV, FLAC or karaoke MIDI (.kar/.mid/.midi).')
      return
    }
    const extra = skipped > 0 ? ` (the first ${MAX_BULK} only)` : ''
    await save(entries, (count) => `Added ${count} song${count === 1 ? '' : 's'} to this device${extra}.`)
  }

  async function handlePaste() {
    resetMessages()
    const inputs = parseSongLines(pasteText)
    if (!inputs.length) {
      setError('Paste at least one line: Title | Artist | YouTube id.')
      return
    }
    const songs = inputs
      .map((input) => buildCustomSong(input, 'list'))
      .filter((song): song is CustomSong => song !== null)
      .slice(0, MAX_BULK)
    if (!songs.length) {
      setError('No lines with a title were found.')
      return
    }
    await save(songs.map((song) => ({ song })), (count) => `Added ${count} song${count === 1 ? '' : 's'} to this device.`)
    setPasteText('')
  }

  return (
    <section className="panel add-song" aria-label="Add your own songs">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">Your own songs</h2>
          <p className="add-song__hint">
            Add karaoke you own — titles, and files stay on this device only.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? 'Close' : '+ Add song'}
        </button>
      </div>

      {open && (
        <div className="add-song__body">
          <div className="segmented" role="group" aria-label="How to add songs">
            {MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`segmented__option${mode === option.id ? ' is-active' : ''}`}
                onClick={() => switchMode(option.id)}
                aria-pressed={mode === option.id}
              >
                {option.label}
              </button>
            ))}
          </div>

          {mode === 'single' && (
            <form className="add-song__form" onSubmit={handleSingle}>
              <div className="add-song__grid">
                <div className="add-song__field">
                  <label htmlFor="add-song-title">Title (required)</label>
                  <input
                    id="add-song-title"
                    className="input"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="e.g. Bakit Ngayon Ka Lang"
                  />
                </div>
                <div className="add-song__field">
                  <label htmlFor="add-song-artist">Artist</label>
                  <input
                    id="add-song-artist"
                    className="input"
                    value={artist}
                    onChange={(event) => setArtist(event.target.value)}
                    placeholder="e.g. Ogie Alcasid"
                  />
                </div>
                <div className="add-song__field">
                  <label htmlFor="add-song-language">Language</label>
                  <select
                    id="add-song-language"
                    className="input"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                  >
                    {LANGUAGES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="add-song__field">
                  <label htmlFor="add-song-genre">Genre</label>
                  <input
                    id="add-song-genre"
                    className="input"
                    value={genre}
                    onChange={(event) => setGenre(event.target.value)}
                    placeholder="e.g. OPM"
                  />
                </div>
                <div className="add-song__field">
                  <label htmlFor="add-song-youtube">YouTube id or link (optional)</label>
                  <input
                    id="add-song-youtube"
                    className="input"
                    value={youtube}
                    onChange={(event) => setYoutube(event.target.value)}
                    placeholder="Paste a video you are permitted to embed"
                  />
                </div>
                <div className="add-song__field">
                  <label htmlFor="add-song-file">Video or audio file (optional)</label>
                  <input
                    id="add-song-file"
                    ref={singleFileRef}
                    className="input add-song__input"
                    type="file"
                    accept={MEDIA_ACCEPT}
                  />
                </div>
              </div>
              <div className="add-song__actions">
                <button type="submit" className="btn btn--primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Add song'}
                </button>
              </div>
            </form>
          )}

          {mode === 'files' && (
            <div className="add-song__form">
              <p className="add-song__hint">
                Pick one or many files. Each file becomes a song named after the file (use
                “Artist - Title” in the file name for both).
              </p>
              <input
                className="input add-song__input"
                type="file"
                multiple
                accept={MEDIA_ACCEPT}
                onChange={handleBulkChange}
                aria-label="Choose video or audio files from this device"
              />
            </div>
          )}

          {mode === 'folder' && (
            <div className="add-song__form">
              <p className="add-song__hint">
                Choose a folder and every playable file inside it is added. Long folders are capped
                at {MAX_BULK} files per go.
              </p>
              <input
                ref={(element) => {
                  if (!element) return
                  element.setAttribute('webkitdirectory', '')
                  element.setAttribute('directory', '')
                  element.multiple = true
                }}
                className="input add-song__input"
                type="file"
                accept={MEDIA_ACCEPT}
                onChange={handleBulkChange}
                aria-label="Choose a folder of songs from this device"
              />
            </div>
          )}

          {mode === 'paste' && (
            <div className="add-song__form">
              <p className="add-song__hint">
                One song per line: <code className="add-song__mono">Title | Artist | YouTube id</code>.
                Add “Tagalog”, “Taglish” or “English” as a field to set the language.
              </p>
              <textarea
                className="input add-song__paste"
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                rows={6}
                placeholder={'Bakit Ngayon Ka Lang | Ogie Alcasid | dQw4w9WgXcQ\nPusong Bato | Jovit Baldivino'}
                aria-label="Paste a list of songs, one per line"
              />
              <div className="add-song__actions">
                <button type="button" className="btn btn--primary" onClick={handlePaste} disabled={busy}>
                  {busy ? 'Saving…' : 'Add these songs'}
                </button>
              </div>
            </div>
          )}

          {notice && <p className="add-song__notice">{notice}</p>}
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </section>
  )
}
