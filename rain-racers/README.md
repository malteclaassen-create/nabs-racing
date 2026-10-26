# Rain Racers

The website of the Rain Racers sim racing league (Assetto Corsa). The league
runs several series side by side (RX8 Cup, DTM 2002, ...), and each has its
own teams, seasons, calendar and standings:

- **Standings** for drivers and teams, with round-by-round results, points
  charts, sprint results, poles, fastest laps and dropped rounds
- **Calendar and results**: feature race, sprint and qualifying per round,
  with grid, places gained and steward penalties
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
├── backend/    API, database (prisma/), live timing relay (src/live/), tests (test/)
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
   default points tables (race and sprint), the Race Info text.
2. **Series & seasons:** create a series (e.g. "RX8 Cup", with its colour and
   schedule); it starts with its first season. The bar at the top of the
   admin picks the series and season the other tabs work on. Per season:
   its own points tables, how many worst rounds each driver drops, manual
   points (a pole award, a deduction) and a champion named by hand.
3. **Teams:** the teams of the series, with their colours.
4. **Entry list & transfers:** who drives in the season, for which team and
   with which number. A team change during the season is a **move** from a
   round on: a round already raced moves its results and team points to the
   new team, a round ahead applies itself when its result is saved.
5. **Races & results:** add the rounds. Tick "Sprint + feature race" for a
   round with two races, and give a round its own points table if it needs
   one (a double-points finale).
6. After a race: **Results**, pick the session (feature race, sprint or
   qualifying) and **Import** the result file from the server's `results`
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
once. The qualifying decides the pole and fills the feature race's grid.

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
   JWT_SECRET=<40+ random letters and digits>
   ADMIN_PIN=<a PIN only the admins know>
   DISCORD_CLIENT_ID=...
   DISCORD_CLIENT_SECRET=...
   DISCORD_REDIRECT_URI=https://<your-site>/api/auth/discord/callback
   ```

6. **Settings → Networking → Generate Domain** (or add your own domain).

`railway.json` already holds the build (`npm run build`) and start command
(`npm start`, which applies database migrations first). Back up
`/data/rain-racers.db` now and then: it holds everything.
