# Filipino Videoke

A karaoke-night web app for the living room: search a 52-song catalog (13 demo
OPM tracks plus a 39-song Creative Commons karaoke collection from the UltraStar
Deluxe community), build a song queue, keep the singer rotation fair, and see who
tops the board — all with room codes so the whole barkada can join.

Built with **React + TypeScript + Vite**.

---

## What is real, and what is not

This MVP is honest about its boundaries, and the UI says so on every screen via a
permanent demo banner.

| Area | Status |
| --- | --- |
| Song catalog, search, filters | **Working** |
| Add your own songs (device-local) | **Working** |
| Queue, singer rotation, room codes | **Working** |
| Leaderboard UI and rules | **Working** |
| Karaoke playback | **Working** — a file from this device, a local `Songs/` folder, or an attached permitted YouTube id (see below) |
| Singing scores | **FUN SIMULATION** — a fresh random whole number from 65 to 100 for every finished song |

> **Scores are not measurements.** `generateFunScore()` never listens to a
> microphone, never analyses pitch, and has nothing to do with how well anyone
> sang — it draws a new random whole number between 65 and 100 for each song that
> finishes, purely to make the board fun at a party. Every score is stored with
> `simulated: true` and labelled a fun random score. Real scoring needs microphone
> pitch analysis (onset detection, F0 tracking, comparison to a reference melody,
> timing) — that is a deliberate later step, not something this MVP pretends to do.
> See `src/lib/scoring.ts`.

### Why the catalog ships without video ids

The app **only ever embeds** through the official YouTube IFrame player. It never
downloads a video, extracts audio, or proxies a stream — that is a YouTube
Terms-of-Service requirement and the reason `youtubeId` is a plain id rather than a
URL. So the catalog ships with metadata only, plus a single technical demo id that
exists purely to prove the embed path works end to end.

To play a song, attach a YouTube id/link **you are permitted to embed** using the
"Add permitted video" box (stored in your browser) — nothing is fetched, scraped,
or guessed.

---

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build    # tsc -b && vite build  → dist/
npm run preview  # serve the production build
npm start        # offline server: dist/ + the local Songs/ folder, no network
npm run lint     # oxlint
```

### Try it in 30 seconds

1. **Create room** with a name — you get a 5-character code.
2. Open the same URL in a second tab (or click **Join with a code**) and join with
   that code and a different name.
3. Add songs on both tabs, then **Start next** / **End & score**. Both tabs update
   live.

### Install it as an app (PWA)

The production build ships a web app manifest and a service worker
(`public/sw.js`), so it can be **installed** and opened **offline**:

- Install: open the deployed site and use the browser's “Install app” / “Add to
  Home Screen”.
- Offline: the app shell is cached. Navigations go network-first (a new deploy is
  picked up automatically) and fall back to the cached shell when offline;
  same-origin assets are cache-first. Cross-origin requests (the YouTube player)
  always pass through and are never cached.
- The service worker registers **only in the production build** and is a pure
  enhancement — if it cannot register, the app still runs.

### Play from your own device (no YouTube needed)

The app can play **your own video/audio files**, so nothing has to come from
youtube.com:

- **Per song:** open a song and use the *“Play your own video or audio file”* box.
  The file is stored in your browser (IndexedDB, database `fv-media`) and plays in
  a plain `<video>` instead of the embed. It never leaves your device.
- **A whole folder:** drop karaoke files into a `Songs/` folder at the project
  root and run the offline server:

  ```bash
  npm run build
  npm start          # http://127.0.0.1:4175
  ```

  Each sub-folder is one song. Put a karaoke video named `video.mp4` (or `.webm`,
  `.m4a`, `.mp3`) inside, plus optional `cover.jpg`, `lyrics.json`, `notes.json`,
  and a `meta.json` (`{"title","artist","language","genre","tags","youtubeId"}`).
  The server scans `Songs/`, serves it at `/songs/…`, and lists it at `/api/songs`;
  the app merges it into the catalog on load. Folder names like
  `Araw-Araw - Ben&Ben` are split into title/artist automatically.

Playback priority for any song: **your picked file → `Songs/` folder file →
YouTube embed**. On a static host (e.g. Vercel) `/api/songs` is not present, so
the app quietly falls back to the shelf catalog.

### Add your own songs (device-local)

Press **+ Add song** on the home page to add a song that lives only on this
device:

- **One song** — title (required), artist, language, genre, and an optional
  YouTube id **you are permitted to embed** or a local video/audio file (stored
  in IndexedDB, same as the picked files above).
- **Bulk** — pick many video/audio files at once; each becomes a song.
- **Folder** — pick a whole folder of karaoke files; title/artist are read from
  each file name.
- **Paste list** — paste `Title | Artist | YouTube link` lines, one song per
  line, to add up to 100 at once.

Added songs get a **Your song** badge, appear instantly in every open tab on that
device (search and filters include them), and play exactly like any other song.
They are stored per device in `localStorage` (`fv:custom-songs`) plus any media
file in IndexedDB — nothing is uploaded, and removing the card removes the song.
Bulk adds are idempotent: adding the same file again is a no-op, not a duplicate.

### The Creative Commons catalog

The shelf catalog carries **13 demo OPM tracks** (metadata + one technical embed
id) and **39 songs from the [UltraStar Deluxe community catalog]**
(https://github.com/UltraStar-Deluxe/songs), a Creative Commons repository
(BY, BY-SA, BY-NC, BY-NC-SA or CC0 per package — see each package's `license.txt`).
UltraStar songs play as **audio** on a plain `<audio>` element, streamed live
from the public repository (nothing is downloaded or bundled), with the song's
author credited on the card. The catalog is generated by
`scripts/fetch-ultrastar-catalog.mjs`.

Three copyright-safe ways to sing: play **your own files**, pick a **Creative
Commons song from the shelf**, or attach a **YouTube id you are permitted to
embed**.

---

## How rooms sync

There is exactly one `Room` object, and one seam through which it syncs:
`RoomSyncAdapter` (`src/adapters/types.ts`). UI code never knows which transport is
live.

- **Local (default).** Works with no configuration. Rooms are stored in
  `localStorage` and broadcast between **tabs of the same browser** via
  `BroadcastChannel` (with a `storage`-event fallback). This is enough for a
  single-device demo, but two people on two phones need Supabase.
- **Supabase (optional).** Turns on only when credentials are present *and*
  `@supabase/supabase-js` is installed. It is the cross-device transport.

The header always shows which transport is live, so it is never ambiguous.

---

## Enabling Supabase (cross-device rooms)

1. Install the client (already a dependency of this project — only needed if you
   removed it):

   ```bash
   npm install @supabase/supabase-js
   ```

2. Create `.env.local` in the project root (never commit it):

   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-PUBLIC-ANON-KEY
   ```

   The anon key is a *public* browser key by design — but it still belongs in the
   environment, never hard-coded. No credentials are bundled in this repo.

3. Run this SQL in the Supabase SQL editor to create the table and open it up:

   ```sql
   create table if not exists public.rooms (
     code text primary key,
     data jsonb not null,
     rev  int   not null default 0,
     updated_at timestamptz not null default now()
   );

   alter table public.rooms enable row level security;

   -- Demo policy: anyone with the anon key may read and write rooms.
   -- Tighten this (or add auth) before using it for anything real.
   create policy "rooms are readable"  on public.rooms for select using (true);
   create policy "rooms are insertable" on public.rooms for insert with check (true);
   create policy "rooms are updatable"  on public.rooms for update using (true);

   -- Live updates for subscribers joining a room by code.
   alter publication supabase_realtime add table public.rooms;
   ```

   > The open policy above is fine for a party demo and **not** for production.
   > Add Supabase Auth and restrict rows by owner before you rely on it.

4. Restart `npm run dev`. The header should now read **Supabase (shared across
   devices)**.

---

## Project structure

```
src/
  adapters/        transport seam: local + (dormant) supabase, and the picker
  components/      presentational + interactive pieces (player, queue, panels…)
  data/songs.ts        demo catalog (metadata only) + technical embed id
  data/ultrastarSongs.ts  generated CC catalog (UltraStar Deluxe, audio streamed)
  lib/                 pure helpers: ids, storage, youtube, scoring, rotation,
                       localLibrary (Songs/ client), mediaStore (IndexedDB files),
                       mediaTypes (playable formats), customSongs (add-your-own)
  pages/           HomePage, RoomPage
  state/           contexts + providers + hooks (auth, video library, room)
  types.ts         shared domain types
```

Conventions worth knowing:

- **Contexts are split three ways** — `*Context.ts` (the object), `*Provider.tsx`
  (component only), `use*.ts` (hook only). This keeps the
  `react/only-export-components` lint rule satisfied and the files focused.
- **Strict TypeScript** (`verbatimModuleSyntax`, `erasableSyntaxOnly`,
  `noUnusedLocals`). Imports use explicit extensions.
- **Local storage keys:** `fv:room:<CODE>`, `fv:room-index`, `fv:profile`,
  `fv:video-ids`, `fv:custom-songs`.

## Rotation modes

- **Rotation** (default) — round-robin by singer, so one person can't hog the mic
  even with five songs queued. This is the classic videoke rule.
- **Queue** — strict first-come, first-served by song.

## Roadmap

- Real microphone pitch scoring, replacing `simulateScore` (and the `simulated`
  flag would finally go away).
- Supabase Auth to replace the per-device guest profile.
- Per-room video libraries and moderation.
