# NABS Racing League

Full-stack web app for the **NABS Racing League** — a Discord-based
racing series on Assetto Corsa. Driver & constructor standings (Tier 1
and Tier 2), race results, team pages, Discord-based race sign-ups, member
downloads, live timing, and an admin area for importing Assetto Corsa result
JSON and editing results. Older seasons are kept as a read-only archive.

- **Backend:** Node.js + Express + Prisma (SQLite), JWT (PIN) auth, multer upload
- **Frontend:** React + Vite + Tailwind CSS (premium, light, F1-website inspired)

---

## Project structure

```
nabs-racing/
├── backend/      Express REST API + Prisma + seed
└── frontend/     React + Vite + Tailwind SPA
```

---

## Prerequisites

- **Node.js 18+** — that's it. The database is a single SQLite file, no
  database server needs to be installed.

---

## 1. Backend setup

```bash
cd backend
npm install

# configure environment (skip if a filled-in .env is already present)
cp .env.example .env

# only when starting WITHOUT an existing dev.db:
npx prisma migrate deploy   # create the schema
npm run seed                # fill teams, drivers and results

# start the API (http://localhost:4000)
npm run dev
```

The seed is **idempotent** — re-running `npm run seed` wipes and re-inserts the
race data. It does **not** overwrite a changed admin PIN.

### Admin PIN

Default admin PIN: **`nabs2026`** (stored hashed in the `Setting` table, change
it from the admin UI under *Change PIN*).

---

## 2. Frontend setup

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
```

The Vite dev server proxies `/api` → `http://localhost:4000`, so no extra config
is needed for local development. For a production build, set `VITE_API_BASE` to
your API origin and run `npm run build`.

---

## Points system (F1 2007)

| Pos | 1  | 2  | 3  | 4  | 5  | 6  | 7  | 8  | 9  | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19+ |
|-----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|-----|
| Pts | 35 | 30 | 25 | 22 | 20 | 18 | 16 | 14 | 12 | 10 | 8  | 7  | 6  | 5  | 4  | 3  | 2  | 1  | 0   |

`DNS` / `DNF` / `DSQ` = 0 points.

A season can pay a **fastest-lap bonus** (`Season.fastestLapPoints`, admin
Seasons tab, 0 = none): the classified finisher who set the race's best lap
scores it on top of their finishing points, in the driver table and for the
team they drove for (on top of the Tier 2 re-rank). A car that sets the lap and
retires gets nothing. Rows with explicit historical `points` never get it added.
The holder is the admin-recorded fastest lap where one exists, else the best
stored `bestLapMs` of that classification (`pointsCalculator.stampFastestLapBonus`).

A round can carry its **own points table** (`Race.pointsTable`, admin race
editor, null = the season's): every result of the round is priced by that
table instead of the season's, sprint child included, with the fastest-lap
bonus on top; explicit historical `points` are never re-priced
(`pointsCalculator.stampRacePointsTable`, read through
`standingsService.roundPointsTables`). The standings payload names them in
`customPoints`.

A season can name a **champion by rule** (`Season.championDriverId`, admin
Seasons tab): the final driver table puts that row first and reports it as
`championOverride`; a mid-season (`upToRound`) view is untouched. Everything
reading "the first row of the standings" follows.

**Pole position** is the fastest driver of the imported qualifying session
(`Race.qualiJson`); only a round without one falls back to `grid = 1`
(`lib/raceHonours.js` `readPoleHolders`). Every pole consumer — Hall of Fame,
profiles, cockpit, track history, Discord result posts — goes through it, so a
reverse-grid feature race's slot 1 is never counted as a pole.

A **sprint + feature weekend** (an F2-style round, race format `SPRINT_FEATURE`)
runs two races on one evening and both pay this table in full. The sprint's
points are added to that round — for the drivers and for both constructor
tables (Tier 2 is re-ranked in each race on its own) — so a sprint weekend is
one round worth up to 70 points. The drop rule still counts rounds, so the
weekend drops or counts as a whole. The sprint classification lives on a hidden
child race of the event (`Race.parentRaceId`) and shows up as the Sprint tab of
the round.

---

## Standings logic

All standings are computed **server-side**; the frontend never hardcodes data.

- **Driver standings** — every driver (T1 + T2 + Reserve) ranked by total points;
  points come straight from the actual finishing position (or the stored
  historical points for rounds 1–8).
- **Tier 1 constructors** — sum of both Tier-1 drivers' real race points.
  A reserve subbing for a T1 team contributes to that T1 team. **No re-ranking.**
- **Tier 2 constructors** — the critical bit:
  1. Keep **only** drivers whose effective team is a Tier-2 team. Tier-1 drivers
     (incl. reserves subbing for a T1 team) **and team-less reserves** are
     removed entirely — a team-less reserve does **not** occupy a slot.
  2. **Re-rank** that Tier-2 field in finishing order.
  3. Award points by the new rank. A reserve subbing for a Tier-2 team scores
     for that team; a Tier-2 DNF/DSQ keeps its slot but scores 0.

The Tier-2 re-ranking lives in `backend/src/services/pointsCalculator.js` and is
exercised both at seed time and on every race import/edit.

---

## Data model notes

Two pragmatic additions were made to the original schema, because the historical
data could not otherwise be represented faithfully:

- **`RaceResult.points`** — rounds 1–8 provide per-driver *points* only (not
  finishing positions), so points are stored directly. For round 9 onward,
  points are computed from `position` and this column is left null.
- **`ConstructorRaceScore`** — for rounds 1–8 the per-race constructor totals are
  **not** derivable from the two listed tier drivers (reserve substitutes
  contributed points), so the verified per-race totals are stored and summed.
  For round 9 onward these rows are generated by the points calculator at import
  time.

---

## API

### Public
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/standings/drivers` | Driver standings |
| GET | `/api/standings/constructors/t1` | Tier 1 constructor standings |
| GET | `/api/standings/constructors/t2` | Tier 2 constructor standings |
| GET | `/api/races` | List all races |
| GET | `/api/races/:id/results` | Full results of one race |
| GET | `/api/teams` | All teams with their drivers |
| GET | `/api/events` | Upcoming races with attendance |
| POST | `/api/events/:id/rsvp` | Set your attendance (Discord login required) |
| GET | `/api/auth/discord/config` | Whether Discord login is enabled |
| POST | `/api/auth/discord/callback` | Exchange Discord code for a session |

### Admin (JWT required — `Authorization: Bearer <token>`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/login` | PIN login → JWT |
| POST | `/api/admin/races/import` | Upload AC JSON, returns fuzzy-matched mapping |
| POST | `/api/admin/races/commit` | Create/update a race from a confirmed mapping |
| PUT | `/api/admin/races/:id/results` | Edit a race's results (`session: "SPRINT"` targets the weekend's sprint, created on first save) |
| POST | `/api/admin/drivers` | Create a driver |
| PUT | `/api/admin/drivers/:id` | Edit / deactivate a driver |
| PUT | `/api/admin/settings/pin` | Change the admin PIN |

---

## Dark mode

There is a 🌙/☀️ button at the top right of the navigation. The choice is
stored in the browser; on the first visit it follows the system setting.

---

## Discord integration

### Webhook (posting sign-ups/events) — no bot needed
1. Discord: channel → **Edit** → **Integrations** → **Webhooks** →
   **New Webhook** → **Copy Webhook URL**.
2. Website: **Admin** (PIN) → **Discord & Events** tab → paste the URL →
   **Save** → **Send test**.

From then on the website posts an Apollo-style message for every race sign-up
(✅ Accepted (n/40) · ❌ Declined · ❓ Tentative) and keeps it updated live.

### Discord login (optional, forgery-proof)
As long as the following variables are empty, the login is **disabled** and the
site falls back to the driver dropdown. To enable it:

1. <https://discord.com/developers/applications> → **New Application**.
2. **OAuth2** tab → copy **Client ID** and **Client Secret**.
3. Under **Redirects**, add exactly:
   `http://localhost:5173/auth/discord/callback`
4. Fill in `backend/.env` and restart the backend:
   ```
   DISCORD_CLIENT_ID="…"
   DISCORD_CLIENT_SECRET="…"
   DISCORD_REDIRECT_URI="http://localhost:5173/auth/discord/callback"
   ```

On first login the Discord account is matched to the driver with the same
Discord name automatically (and permanently linked from then on). Logged-in
drivers can only RSVP as themselves.

---

## Importing an Assetto Corsa race

1. Admin → **Import Race** → upload the AC result JSON (Content Manager / AC
   Server export, `Type: "RACE"`).
2. The backend parses `Result[]` (array order = finishing order) and
   fuzzy-matches each `DriverName` to a registered driver (Levenshtein distance).
3. Review the mapping: pick the driver for each entry, set status
   (DSQ is auto-detected), assign reserves a "sub for" team, add penalty
   positions if needed.
4. Confirm → results are saved and **all standings are recalculated**.

### No result file? Enter the round by hand

A round that was never exported by the server (or whose JSON is lost) can be
typed in under Admin → **Edit Results**: pick the round, then add the drivers
one by one in finishing order (each pick takes the next free position) or add
the whole Tier 1/2 grid and fill the positions in. Set retirements to DNF, then
**Save results** — points, the Tier 2 re-ranking and the standings are computed
from the positions exactly as for an imported race. Grid, race times, contacts
and laps led are optional. The same picker adds a driver an import missed to an
existing round.

On a sprint + feature weekend the round's own entry is the feature race and the
picker offers "Round N sprint" underneath it. Before any sprint result exists it
reads "(nothing stored yet)": entering and saving it creates the sprint
classification (`PUT /api/admin/races/:id/results` with `session: "SPRINT"`,
the same split the import commit makes), and from then on the sprint is edited
as its own entry.

---

## The live page during a race

While the session on the server is a **Race**, the live page asks different
questions than it does in practice:

| Practice / Qualifying | Race |
| --------------------- | ---- |
| Session best lap      | Who is leading (with the fastest lap underneath) |
| Time left             | Laps left, e.g. "31 of 39" |
| Δ to personal best    | Gap to the leader ("+4.271", "+1 LAP") |
| —                     | A yellow **SAFETY CAR ON TRACK** bar while one is out |

The gap is measured from the two cars' crossings of the *same* lap, both stamped
by the race server's own clock, so it doesn't jump around between snapshots. It
appears a lap or so after the page starts watching — before that there is nothing
to compare, and a blank is better than a guess.

**How the safety car is recognised** (`backend/src/services/liveTiming.js`,
`looksLikeSafetyCar`): by the **car skin** — "safety" anywhere in it, or exactly
"sc" — or by the **car model** being one of the four the league has used as a
pace or broadcast car:

| Model | Used in |
| ----- | ------- |
| `lotus_exige_240` | seasons 5-6 |
| `mercedes_sls` | season 5 |
| `mercedes_sls_gt3` | season 7 (pace car *and* broadcast car) |
| `drf_audi_rs5_dtm_2019` | season 8 |

Both halves are needed. The skin has been renamed almost every season
("!NABS_Safety_Car", "NABS_Racing_Safety_Car", "NABS Safetycar", now "sc"), and
in season 7 rounds 1-7 the pace car ran under plain Kunos skin names that say
nothing at all. Checked against all 47 events in `results-archive`: these rules
catch all 112 pace/broadcast entries and none of the 1673 racing entries.

It is deliberately **not** "whichever model the fewest people are on" — season 7
is a twelve-make 2007 grid with two drivers per car, and that rule flags sixteen
real drivers. And never by driver name: the people who drive it also race.

So: **a new pace car needs its model added to that list** (or a skin the pattern
catches), or the live page will show it leading the race. A safety car it does
recognise is kept out of the running order, out of the driver count, out of the
gap calculation and out of the live championship projection.
