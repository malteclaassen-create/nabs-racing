# Rain Racers

The website of the Rain Racers sim racing league (Assetto Corsa): driver and
team standings, the race calendar with results, sign-ups for the next races
with Discord, live timing from the race server, and a Race Info page with the
rules and downloads. Everything is run from an admin area: import the result
file after a race and every table updates.

- **Backend:** Node.js, Express, Prisma with SQLite (one database file, no
  database server), WebSocket relay for the live timing
- **Frontend:** React, Vite, Tailwind CSS

```
rain-racers/
├── backend/    API, database (prisma/), live timing relay (src/live/), tests (test/)
└── frontend/   the website
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

1. **Settings:** league name, colour, logo, Discord invite, points table,
   the Race Info text.
2. **Seasons:** create the first season.
3. **Teams:** create the teams with their colours.
4. **Races & results:** add the races of the season.
5. After a race: **Races & results → Results → Import result file** and pick
   the `*_RACE.json` from the server's `results` folder. The preview shows
   which driver each line is booked on (by Steam id, else by name), the team
   and the status (FIN / DNF / DSQ / DNS). Fix what is wrong, then save.
   Drivers who are not known yet are created on the spot.

Points are never stored: the standings are worked out from the results with
the points table in the settings, so a change to the table applies to the
whole season at once. Per result there is a field for penalty or bonus
points, and per race a points multiplier (double points for a finale).

### Tests

```bash
cd backend && npm test
```

## Live timing

The live page follows an **AC Server Manager** (for example the ones from
Emperor Servers). In the admin under **Settings → Live timing**, enter the
server manager's live socket, usually

```
wss://<your-server-manager-address>/api/race-control
```

The server manager refuses browsers from other websites, so the backend
connects for them and passes the timing on. It only stays connected while
someone has the live page open. Leave the field empty and the Live page
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
