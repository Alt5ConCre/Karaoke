import type { Song } from '../types.ts'

/**
 * DEMO SONG CATALOG
 * ─────────────────
 * Search / queue / rotation / leaderboard are fully wired against this list, so
 * the app is functional out of the box. What deliberately is NOT shipped is a
 * library of karaoke video ids: the app only embeds videos an operator is
 * permitted to embed, and we will not guess ids or bundle unlicensed content.
 *
 * To make playback work, add a permitted 11-character `youtubeId` to an entry
 * below (or use the "Add permitted video" box in the UI, which stores it in this
 * browser). Titles and artists are public facts used as demo metadata.
 *
 * The two `youtubeId` values that are filled in are a technical playback demo
 * only, so the embed path can be seen working end to end.
 */

/** Real, public "first YouTube video" — used purely to prove the embed works. */
export const TECHNICAL_DEMO_VIDEO_ID = 'jNQXAC9IVRw'

export const SONGS: Song[] = [
  {
    id: 'anak',
    title: 'Anak',
    artist: 'Freddie Aguilar',
    year: 1978,
    language: 'Tagalog',
    genre: 'OPM Classic',
    tags: ['classic', 'ballad', 'slow'],
    youtubeId: '',
  },
  {
    id: 'huling-el-bimbo',
    title: 'Ang Huling El Bimbo',
    artist: 'Eraserheads',
    year: 1995,
    language: 'Tagalog',
    genre: 'OPM Rock',
    tags: ['rock', '90s', 'anthem'],
    youtubeId: '',
  },
  {
    id: 'buwan',
    title: 'Buwan',
    artist: 'Juan Karlos',
    year: 2018,
    language: 'Taglish',
    genre: 'OPM Pop',
    tags: ['pop', 'emotional', '2010s'],
    youtubeId: '',
  },
  {
    id: 'tadhana',
    title: 'Tadhana',
    artist: 'Up Dharma Down',
    year: 2012,
    language: 'Tagalog',
    genre: 'OPM Alternative',
    tags: ['alternative', 'chill', 'indie'],
    youtubeId: '',
  },
  {
    id: 'hiling',
    title: 'Hiling',
    artist: 'Silent Sanctuary',
    year: 2011,
    language: 'Tagalog',
    genre: 'OPM Pop Rock',
    tags: ['pop rock', 'romantic'],
    youtubeId: '',
  },
  {
    id: 'ikaw',
    title: 'Ikaw',
    artist: 'Yeng Constantino',
    year: 2013,
    language: 'Tagalog',
    genre: 'OPM Pop',
    tags: ['pop', 'love song'],
    youtubeId: '',
  },
  {
    id: 'narda',
    title: 'Narda',
    artist: 'Kamikazee',
    year: 2006,
    language: 'Tagalog',
    genre: 'OPM Punk',
    tags: ['punk', 'energetic', 'group'],
    youtubeId: '',
  },
  {
    id: 'minsan',
    title: 'Minsan',
    artist: 'Eraserheads',
    year: 1994,
    language: 'Tagalog',
    genre: 'OPM Rock',
    tags: ['rock', '90s', 'mellow'],
    youtubeId: '',
  },
  {
    id: 'kahit-maputi',
    title: 'Kahit Maputi Na Ang Buhok Ko',
    artist: 'Rey Valera',
    year: 1978,
    language: 'Tagalog',
    genre: 'OPM Classic',
    tags: ['classic', 'ballad', 'tito-favorite'],
    youtubeId: '',
  },
  {
    id: 'kailangan-kita',
    title: 'Kailangan Kita',
    artist: 'Ogie Alcasid',
    year: 1991,
    language: 'Tagalog',
    genre: 'OPM Ballad',
    tags: ['ballad', 'slow', 'lover'],
    youtubeId: '',
  },
  {
    id: 'sana',
    title: 'Sana',
    artist: 'Up Dharma Down',
    year: 2012,
    language: 'Tagalog',
    genre: 'OPM Alternative',
    tags: ['alternative', 'mellow'],
    youtubeId: '',
  },
  {
    id: 'buhat',
    title: 'Buhat',
    artist: 'APO Hiking Society',
    year: 1980,
    language: 'Taglish',
    genre: 'OPM Classic',
    tags: ['classic', 'fun', 'group'],
    youtubeId: '',
  },
  {
    id: 'ending-song',
    title: 'Ending Song (Technical Embed Demo)',
    artist: 'Demo Placeholder',
    language: 'English',
    genre: 'Demo',
    tags: ['demo', 'technical'],
    youtubeId: TECHNICAL_DEMO_VIDEO_ID,
    durationSec: 19,
  },
]

const SONGS_BY_ID = new Map(SONGS.map((song) => [song.id, song]))

export function getSongById(id: string): Song | undefined {
  return SONGS_BY_ID.get(id)
}
