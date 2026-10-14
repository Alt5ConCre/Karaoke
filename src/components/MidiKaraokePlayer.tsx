import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { Song } from '../types.ts'
import { parseMidiKaraoke } from '../lib/midi.ts'
import type { MidiSong } from '../lib/midi.ts'
import { KaraokeMidiPlayer } from '../lib/midiSynth.ts'
import { BackgroundVideo } from './BackgroundVideo.tsx'
import { fontStack } from '../lib/lyricFonts.ts'
import { SIZE_REM } from '../lib/lyricsStyle.ts'
import { useLyricsStyle } from '../lib/useLyricsStyle.ts'
import { useSoundfontId } from '../lib/useSoundfonts.ts'
import { loadBank } from '../lib/soundfonts.ts'

interface MidiKaraokePlayerProps {
  /** Object URL of the local file, or the mediaUrl of a Songs/ library track. */
  src: string
  song: Song
  heading?: string
  variant?: 'room' | 'card'
  source?: 'file' | 'folder' | 'ultrastar'
  onEnded?: () => void
  autoPlay?: boolean
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * MidiKaraokePlayer — parses a .kar/.mid/.midi file and plays it back with
 * the synthesizer, showing the lyrics as a karaoke highlight alongside.
 *
 * A regular <video> cannot play MIDI of any kind, so this is the "screen" for
 * local MIDI karaoke tracks. In headless test Chrome the audio context may be
 * blocked; the component still renders and self-tests via its UI state.
 */
export function MidiKaraokePlayer({
  src,
  song: songMeta,
  heading,
  variant = 'card',
  source = 'file',
  onEnded,
  autoPlay = false,
}: MidiKaraokePlayerProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [midi, setMidi] = useState<MidiSong | null>(null)
  const [now, setNow] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.8)
  const playerRef = useRef<KaraokeMidiPlayer | null>(null)
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded

  const lyricsStyle = useLyricsStyle()
  const soundfontId = useSoundfontId()
  const soundfontIdRef = useRef(soundfontId)
  soundfontIdRef.current = soundfontId

  const lyricVars = {
    '--lyric-font': fontStack(lyricsStyle.font),
    '--lyric-size': SIZE_REM[lyricsStyle.size],
    '--lyric-done': lyricsStyle.doneColor,
    '--lyric-active': lyricsStyle.activeColor,
    '--lyric-upcoming': lyricsStyle.upcomingColor,
    '--lyric-outline': `${lyricsStyle.outlineWidth}px`,
    '--lyric-outline-color': lyricsStyle.outlineColor,
    '--lyric-shadow': `${lyricsStyle.shadowBlur}px`,
    '--lyric-shadow-color': lyricsStyle.shadowColor,
  } as CSSProperties

  useEffect(() => {
    let alive = true
    let player: KaraokeMidiPlayer | null = null
    setStatus('loading')
    setNow(0)
    setPlaying(false)
    void fetch(src)
      .then((response) => response.arrayBuffer())
      .then((buffer) => parseMidiKaraoke(new Uint8Array(buffer)))
      .then((parsed) => {
        if (!alive) return
        if (!parsed) {
          setStatus('error')
          return
        }
        player = new KaraokeMidiPlayer(parsed)
        player.setVolume(volume)
        player.onended = () => {
          setPlaying(false)
          onEndedRef.current?.()
        }
        playerRef.current = player
        setMidi(parsed)
        setStatus('ready')
        void loadBank(soundfontIdRef.current).then((bank) => {
          if (alive && player) player.setBank(bank)
        })
        if (autoPlay) player.play()
      })
      .catch((error: unknown) => {
        void error
        if (alive) setStatus('error')
      })
    return () => {
      alive = false
      player?.destroy()
      if (playerRef.current === player) playerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  useEffect(() => {
    let frame = 0
    const tick = (): void => {
      const player = playerRef.current
      if (player) setNow(player.currentTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    playerRef.current?.setVolume(volume)
  }, [volume])

  useEffect(() => {
    let alive = true
    void loadBank(soundfontId).then((bank) => {
      if (alive) playerRef.current?.setBank(bank)
    })
    return () => {
      alive = false
    }
  }, [soundfontId])

  const activeLine = useMemo(() => {
    if (!midi) return null
    let found: (typeof midi.lines)[number] | null = null
    for (const line of midi.lines) {
      if (line.startSec <= now) found = line
      else break
    }
    return found
  }, [midi, now])

  const activeNext = useMemo(() => {
    if (!midi || !activeLine) return null
    const index = midi.lines.indexOf(activeLine)
    return index >= 0 && index + 1 < midi.lines.length ? midi.lines[index + 1] : null
  }, [midi, activeLine])

  const togglePlay = (): void => {
    const player = playerRef.current
    if (!player) return
    if (player.isPlaying) {
      player.pause()
      setPlaying(false)
    } else {
      const started = player.play()
      if (started) setPlaying(true)
    }
  }

  const scrub = (seconds: number): void => {
    playerRef.current?.seek(seconds)
    setNow(seconds)
  }

  const title = midi?.title.trim() || songMeta.title
  const artist = midi?.artist.trim() || songMeta.artist
  const language = midi && midi.language.trim() ? midi.language : songMeta.language

  return (
    <div className={`midi-player midi-player--${variant}`} style={lyricVars}>
      {heading && <p className="midi-player__heading">{heading}</p>}
      <div className="midi-player__screen" aria-live="polite">
        <BackgroundVideo />
        {status === 'loading' && <p className="midi-player__hint">Reading MIDI track…</p>}

        {status === 'error' && (
          <p className="midi-player__hint midi-player__hint--error">
            This doesn&apos;t look like a playable MIDI karaoke track.
          </p>
        )}

        {status === 'ready' && midi && (
          <>
            <div className="midi-player__meta">
              <p className="midi-player__title">{title}</p>
              <p className="midi-player__artist">{artist}</p>
              <p className="midi-player__tag">
                {language} · {midi.isKar ? 'Karaoke MIDI' : 'Instrumental MIDI'}
              </p>
            </div>

            <div className="midi-player__lyrics">
              {midi.isKar ? (
                <>
                  <p className="midi-player__line">{activeLine ? renderLine(activeLine, now) : ''}</p>
                  <p className="midi-player__next hidden-when-empty">{activeNext ? renderLine(activeNext, now) : ''}</p>
                </>
              ) : (
                <p className="midi-player__hint">
                  Instrumental track · no embedded lyrics — it still sings along.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <div className="midi-player__controls">
        {status === 'ready' && (
          <>
            <button
              type="button"
              className="midi-player__toggle"
              onClick={togglePlay}
              disabled={!playerRef.current}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              type="range"
              className="midi-player__seek"
              min={0}
              max={Math.max(midi?.durationSec ?? 1, 0.001)}
              step={0.05}
              value={Math.min(now, midi?.durationSec ?? 0)}
              onChange={(event) => scrub(Number(event.target.value))}
              aria-label="Seek"
            />
            <span className="midi-player__time">
              {formatTime(now)} / {formatTime(midi?.durationSec ?? 0)}
            </span>
            <input
              type="range"
              className="midi-player__volume"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              aria-label="Volume"
            />
          </>
        )}
      </div>

      <p className="midi-player__attribution">
        {source === 'file'
          ? 'Synthesized from a file on your device'
          : 'Synthesized from your local Songs library'}{' '}
        · {title} — {artist}
      </p>
    </div>
  )
}

function renderLine(line: { syllables: { text: string; startSec: number; endSec: number }[] }, now: number): ReactElement {
  return (
    <>
      {line.syllables.map((syllable, index) => {
        const active = now >= syllable.startSec && now < syllable.endSec
        const done = now >= syllable.endSec
        return (
          <span
            key={index}
            className={
              active
                ? 'midi-player__syl midi-player__syl--on'
                : done
                  ? 'midi-player__syl midi-player__syl--done'
                  : 'midi-player__syl midi-player__syl--up'
            }
          >
            {syllable.text}
          </span>
        )
      })}
    </>
  )
}