/**
 * What the player can actually play.
 *
 * The videoke player is a plain HTML5 <video>/<audio> element, so the only
 * formats that matter are the ones the browser can decode: MP4/M4V/MOV, WebM,
 * MKV, Ogg, MP3, M4A, AAC, WAV, FLAC, Opus. Containers the browser generally
 * cannot play (`.avi`, `.wmv`, …) are deliberately left out, so the file picker
 * and the validators never invite a song that would fail on screen.
 *
 * Karaoke MIDI (`.kar`/`.mid`/`.midi`) is the exception: the browser cannot
 * render it directly, but the app loads it and synthesizes the playback
 * itself, so it is accepted and routed to the MIDI karaoke player separately.
 *
 * Kept free of React and DOM-only globals so the test harness can import it.
 */

/** Formats every browser ships with — the safest bet for a karaoke file. */
export const CORE_MEDIA_EXTENSIONS = ['.mp4', '.webm', '.m4a', '.mp3']

/** Formats that play in current Chrome/Edge/Firefox builds. */
export const EXTRA_MEDIA_EXTENSIONS = [
  '.m4v',
  '.mkv',
  '.mov',
  '.ogv',
  '.ogg',
  '.oga',
  '.opus',
  '.aac',
  '.wav',
  '.flac',
]

export const MEDIA_EXTENSIONS = [...CORE_MEDIA_EXTENSIONS, ...EXTRA_MEDIA_EXTENSIONS]

/**
 * Karaoke MIDI: the browser cannot decode these, but the app parses the
 * standard MIDI file itself and synthesizes the playback, so they are still
 * accepted — and routed to the MIDI karaoke player instead of <video>/<audio>.
 */
export const KARAOKE_MIDI_EXTENSIONS = ['.kar', '.mid', '.midi']

/** True when the extension is a karaoke MIDI file. */
export function isKaraokeMidiExt(ext: string): boolean {
  return KARAOKE_MIDI_EXTENSIONS.includes(ext)
}

/** Extensions that are audio only (the player shows no picture). */
export const AUDIO_EXTENSIONS = new Set([
  '.m4a',
  '.mp3',
  '.oga',
  '.ogg',
  '.opus',
  '.aac',
  '.wav',
  '.flac',
])

/**
 * The `accept` string for a media `<input type="file">`: the broad
 * `video/*,audio/*` hints first, then the explicit extensions so a mistyped
 * MIME type on the OS side still shows the file.
 */
export const MEDIA_ACCEPT = `video/*,audio/*,${[...MEDIA_EXTENSIONS, ...KARAOKE_MIDI_EXTENSIONS].join(',')}`

/** The minimal shape the validators need — a File or a plain object. */
export interface MediaLike {
  name: string
  type?: string
}

/** Lower-cased extension of a file name, e.g. `Song.MP4` → `.mp4`. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

/**
 * True when a file looks like something the player can open — either the
 * browser reported a media MIME type, or the extension is on our list
 * (including karaoke MIDI, which the app renders itself).
 */
export function isPlayableMedia(file: MediaLike): boolean {
  const type = file.type ?? ''
  if (type.startsWith('video/') || type.startsWith('audio/')) return true
  return [...MEDIA_EXTENSIONS, ...KARAOKE_MIDI_EXTENSIONS].includes(extensionOf(file.name))
}

/** True when a file is audio only (callers may label it differently). */
export function isAudioFile(file: MediaLike): boolean {
  const type = file.type ?? ''
  if (type.startsWith('audio/')) return true
  if (type.startsWith('video/')) return AUDIO_EXTENSIONS.has(extensionOf(file.name))
  return AUDIO_EXTENSIONS.has(extensionOf(file.name))
}
