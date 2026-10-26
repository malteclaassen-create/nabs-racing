# Rain Racers

The website of the Rain Racers sim racing league (Assetto Corsa). The league
runs several series side by side (Formula International Series, Sahara
Saturdays, ...), and each has its own seasons, calendar and standings (and
teams, if it has any):

- **The league's history**: every series and season since 2025 with its
  calendar, tracks, cars, posters and stream recordings, loaded on the first
  start (see [The history](#the-history))
- **Standings** for drivers (and teams), with round-by-round results, points
  charts, poles, fastest laps and dropped rounds
- **Calendar and results** with the league's posters: rounds of one to four
  races, qualifying, the day's timetable, the car, mystery tracks, grid,
  places gained, steward penalties and the recording to watch
- **Points rules** per season: tables by the number of races in a round (or
  one per race, e.g. sprint and feature), back-to-front scoring, qualifying
  points, dropped rounds, a round's own table (a finale)
- **Driver profiles**: season stats, form chart, head-to-head against any
  other driver, and a career across every series
- **Transfers**: each driver's team round by round, and the moves
- **Sign-ups** for the next races with Discord
- **Live timing** from each series' race server
- **Race Info** with the rules and downloads
- **Admin area**: import the server's result files (or type a result in),
  manage series, seasons, entry lists, transfers, points rules and see who
  is still turning up

- **Backend:** Node.js, Express, Prisma with SQLite (one database file, no
  database server), WebSocket relay for the live timing
- **Frontend:** React, Vite, Tailwind CSS

```
rain-racers/
├── backend/    API, database (prisma/), live timing relay (src/live/), tests (test/),
│               the league's history and posters (seed/)
├── frontend/   the website
└── brand/      the league's logo and graphics, with where they come from
```

## Run it on your computer

You need **Node.js 20 or newer**.

```bash
# 1. the API (http://localhost:4000)
cd backend
cp .env.example .env        # then set JWT_SECRET to a long random string
npm install
npx prisma migrate deploy   # creates the database in backend/data/
npm run dev

# 2. the website (http://localhost:5173), in a second terminal
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173/admin> and sign in with the `ADMIN_PIN` from
`backend/.env` (`1234` in the example).

### First steps in the admin

1. **Settings:** league name, logo, Discord invite, YouTube channel, the
   default points table, the Race Info text, and **Load the Rain Racers
   history** for a database that already had data.
2. **Series & seasons:** create a series (e.g. "RX8 Cup", with its colour and
   schedule); it starts with its first season. A series that no longer runs
   is **archived**: off the menu, still in the history. The bar at the top of
   the admin picks the series and season the other tabs work on. Per season:
   its words and **banner**, how races score (from the tables, or back to
   front: the last classified driver gets 1 point, the one ahead 2, ...), the
   table for a single race and for rounds of 2, 3 or 4 races (one for every
   race, or one per race), qualifying points, how many worst rounds each
   driver drops, manual points (a pole award, a deduction) and a champion
   named by hand.
3. **Teams** (only if the series has teams): the teams with their colours.
   A series without teams hides the team pages and columns.
4. **Entry list & transfers:** who drives in the season, for which team and
   with which number. A team change during the season is a **move** from a
   round on: a round already raced moves its results and team points to the
   new team, a round ahead applies itself when its result is saved.
5. **Races & results:** add the rounds: name, track (or a **mystery track**,
   hidden on the site until the round has results), car, how many races,
   the recording (a YouTube link), the day's timetable, and after saving the
   round's **poster** (Edit). A round can have its own points table (a
   finale) or a points multiplier.
6. After a race: **Results**, pick the session (qualifying, race 1, race 2,
   ...) and **Import** the result file from the server's `results`
   folder (`*_RACE.json`, `*_QUALIFY.json`). The preview shows which driver
   each line is booked on (by Steam id, else by name) and the status (FIN /
   DNF / DSQ / DNS); fix what is wrong, then save. Unknown drivers are created
   and put on the entry list. No file? **Type in by hand**: the drivers in
   finishing order, the DNFs marked.
7. Afterwards in the same place: a **time penalty** (seconds, with a reason)
   is added to the race time and re-orders the finishers; **± pts** adds or
   takes off points; the arrows change the order by hand.
8. **Attendance:** every driver against every round: raced, what they
   answered in the sign-up, and who said yes and did not start (CSV export).

Points are never stored: the standings are worked out from the results with
the points tables, so a change to a table applies to the whole season at
once. The qualifying decides the pole, pays the qualifying points and fills
race 1's grid.

### The history

`backend/seed/rain-racers-history.json` holds the league's series and
seasons as they stand on [Grid Finder](https://www.gridfinder.com/c/rain-racers-2)
and the [YouTube channel](https://www.youtube.com/@rainracers): Formula
International Series (seasons 1 and 2), Sahara Saturdays, RX8 Cup, DTM 2002,
Japanese Summer, GT4 World Series, Vacation Tour, Fictional F3, Ultimate
Touring Challenge and Protosprint, with every round's date, track, car, the
recording and, where the league made one, the poster (`backend/seed/images/`).
The current seasons carry their points rules and timetables from Grid Finder.

An empty database loads it on its first start (set `SEED_HISTORY=off` to
start empty instead). A database with data gets it from **Settings → Load
the Rain Racers history**, which leaves alone every series that is already
there. The results are not in it: Grid Finder does not show them publicly, so
they are imported per round like any other.

### Tests

```bash
cd backend && npm test
```

## Live timing

The live page follows an **AC Server Manager** (for example the ones from
Emperor Servers). Each series can have its own server (**Series & seasons →
Edit → Live socket**); **Settings → Live timing** is the default for the
series without one. Enter the server manager's live socket, usually

```
wss://<your-server-manager-address>/api/race-control
```

The server manager refuses browsers from other websites, so the backend
connects for them and passes the timing on. It only stays connected while
someone has the live page open. With several series on a server, the live
page has a button per series. Leave every address empty and the Live page
disappears from the menu.

To try it without a race server: `npm run fake-live` in `backend/` starts a
pretend server manager with six cars, then enter
`ws://localhost:4100/api/race-control` in the settings.

## Discord login

Members sign in with Discord to sign up for races. Without it, the site works
as a read-only site that the admin fills in.

1. <https://discord.com/developers/applications> → **New Application**.
2. **OAuth2**: copy the **Client ID** and the **Client Secret**, and under
   **Redirects** add `https://<your-site>/api/auth/discord/callback`
   (locally: `http://localhost:4000/api/auth/discord/callback`).
3. Put the three values into the environment: `DISCORD_CLIENT_ID`,
   `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`.

Only the Discord name and avatar are read (scope `identify`). Under
**Admin → Members** a member can be linked to their driver, so the entry
lists show the driver name and team. Discord ids listed in
`ADMIN_DISCORD_IDS` get the admin area without the PIN.

## Put it online (Railway)

The backend serves the built website, the API and the uploads as one service.

1. Push this folder to its own GitHub repository.
2. On <https://railway.app>: **New Project → Deploy from GitHub repo**. If
   the site sits in a subfolder of a bigger repository, set the service's
   **Root Directory** to that folder.
3. Pick the region before the first successful deploy (EU West for a
   European league): the storage is created there.
4. Add a **Volume** with the mount path `/data`, otherwise the database and
   uploads are lost on every deploy.
5. **Variables:**

   ```ini
   DATA_DIR=/data
   DATABASE_URL=file:/data/rain-racers.db
   JWT_SECRET=
   ADMIN_PIN=
   DISCORD_CLIENT_ID=
   DISCORD_CLIENT_SECRET=
   DISCORD_REDIRECT_URI=https://your-site.up.railway.app/api/auth/discord/callback
   ```

   Fill in your own values right after the `=`, with nothing around them:
   `JWT_SECRET` 40 or more random letters and digits, `ADMIN_PIN` a PIN only
   the admins know (e.g. `ADMIN_PIN=4817`), the Discord ones from the
   Discord app (see [Discord login](#discord-login)) and your site's address
   in `DISCORD_REDIRECT_URI`. A value in `< >` counts as not set: the server
   does not start without a real `JWT_SECRET`, and the admin login says so
   for `ADMIN_PIN`.

6. **Settings → Networking → Generate Domain** (or add your own domain).

`railway.json` already holds the build (`npm run build`) and start command
(`npm start`, which applies database migrations first). Back up
`/data/rain-racers.db` now and then: it holds everything.
