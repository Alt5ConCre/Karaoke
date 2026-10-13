# Filipino Videoke

A karaoke-night web app for the living room: search a demo OPM catalog, build a
song queue, keep the singer rotation fair, and see who tops the board — all with
room codes so the whole barkada can join.

Built with **React + TypeScript + Vite**.

---

## What is real, and what is not

This MVP is honest about its boundaries, and the UI says so on every screen via a
permanent demo banner.

| Area | Status |
| --- | --- |
| Song catalog, search, filters | **Working** |
| Queue, singer rotation, room codes | **Working** |
| Leaderboard UI and rules | **Working** |
| Karaoke playback | **Working *only once you attach a permitted YouTube id*** (see below) |
| Singing scores | **SIMULATED** — a deterministic pseudo-random number for demoing the board |

> **Scores are not measurements.** `simulateScore()` never listens to a
> microphone, never analyses pitch, and has nothing to do with how well anyone
> sang. Every score is stored with `simulated: true` and shown as a demo score.
> Real scoring needs microphone pitch analysis (onset detection, F0 tracking,
> comparison to a reference melody, timing) — that is a deliberate later step, not
> something this MVP pretends to do. See `src/lib/scoring.ts`.

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
npm run lint     # oxlint
```

### Try it in 30 seconds

1. **Create room** with a name — you get a 5-character code.
2. Open the same URL in a second tab (or click **Join with a code**) and join with
   that code and a different name.
3. Add songs on both tabs, then **Start next** / **End & score**. Both tabs update
   live.

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

1. Install the client:

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
  data/songs.ts    demo catalog (metadata only) + technical embed id
  lib/             pure helpers: ids, storage, youtube, scoring, rotation
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
  `fv:video-ids`.

## Rotation modes

- **Rotation** (default) — round-robin by singer, so one person can't hog the mic
  even with five songs queued. This is the classic videoke rule.
- **Queue** — strict first-come, first-served by song.

## Roadmap

- Real microphone pitch scoring, replacing `simulateScore` (and the `simulated`
  flag would finally go away).
- Supabase Auth to replace the per-device guest profile.
- Per-room video libraries and moderation.
