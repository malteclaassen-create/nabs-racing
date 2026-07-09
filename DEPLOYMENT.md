# Hosting guide (deployment)

How to put the NABS Racing website permanently on a server of your own. The
**Node backend serves everything itself** - the website, the API and the
downloads, as **one single program**. The only thing in front of it is a thin
HTTPS layer (Caddy) for the encrypted connection.

```
Visitor ──► Caddy (domain, HTTPS)  ──►  Node backend (port 4000)
                                         ├─ Website   (frontend/dist)
                                         ├─ API       (/api/*)
                                         └─ Downloads
```

> Why this setup? Website and `/api` automatically live under **the same
> address** - exactly what the login and the members-only downloads need.
> And there is only **one** service to keep running.

---

## Requirements

- A server (VPS or home server) with **Node.js 18+** and **git**.
- A **domain** pointing at the server's IP (e.g. `nabs.example.com`).
- **Caddy** (recommended, handles HTTPS by itself): <https://caddyserver.com/docs/install>
- Enough **disk space** for the download files (tracks, F1 2007, ...).

---

## Step 1 - Get the code onto the server

```bash
git clone <REPO-URL> nabs-racing
cd nabs-racing
```

(If you received the site as a zip instead, just extract it there.)

## Step 2 - Set up the backend

```bash
cd backend
npm install
cp .env.example .env    # skip if the zip already contains a filled-in .env
```

Now edit `backend/.env`:

```ini
DATABASE_URL="file:./dev.db"
JWT_SECRET="<put a long, random string here>"
# This command generates a safe value (paste its output here):
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Important: if the placeholder is left in, the server deliberately REFUSES to
# start, because with a known key anyone could forge admin access.
PORT=4000
CORS_ORIGIN="https://nabs.example.com"

# Discord login (needed, because the downloads are members-only):
DISCORD_CLIENT_ID="<your client id>"
DISCORD_CLIENT_SECRET="<your client secret>"
DISCORD_REDIRECT_URI="https://nabs.example.com/auth/discord/callback"
```

**Database** - two options:

- **Easiest (recommended):** copy the existing, working database file from the
  development machine to `backend/prisma/dev.db`. It already contains every
  table (including the download ones) and the current data. Then do **not**
  seed.
- **Or start fresh:**
  ```bash
  npx prisma migrate deploy   # creates all tables (incl. downloads)
  npm run seed                # fills teams, drivers and results
  ```

**Download files** go into this folder (deliberately not part of the repo):

```bash
mkdir -p downloads
# copy the big AC files (tracks, safety car, CSP, Real Penalty, F1 2007 ...)
# here via SFTP/copy: nabs-racing/backend/downloads/
```

## Step 3 - Build the website

```bash
cd ../frontend
npm install
npm run build      # creates frontend/dist/
```

> Important: leave `VITE_API_BASE` **empty** (do not set it). Website and API
> then talk to the same address - which matches the setup below.

As soon as `frontend/dist` exists, **the backend automatically serves the
website too** (on the same address as the API). All that is missing in front
of it is HTTPS.

## Step 4 - HTTPS in front (Caddy)

Because the backend already serves everything, a **one-line** reverse proxy is
enough; it only handles the encrypted connection. Create a file `Caddyfile`:

```caddy
nabs.example.com {
    reverse_proxy localhost:4000
}
```

Start it:

```bash
caddy start --config ./Caddyfile
```

Caddy fetches an **HTTPS certificate automatically** for the domain and
forwards everything to the backend - website, API, large downloads (including
resume) and the live timing (WebSocket at `/api/live/ws`).

> **Even simpler, without any web server of your own:** route the domain
> through **Cloudflare** (free). Cloudflare handles the HTTPS, the backend runs
> behind it - no Caddy/nginx needed at all.
>
> Prefer nginx? Also fine: `location / { proxy_pass http://localhost:4000; }`
> with `proxy_http_version 1.1` + upgrade headers for the WebSocket, HTTPS via
> certbot.

## Step 5 - Allow the Discord login for the domain

1. <https://discord.com/developers/applications> -> your app -> **OAuth2**.
2. Under **Redirects**, add exactly:
   `https://nabs.example.com/auth/discord/callback`
3. The same URL is already in `backend/.env` as `DISCORD_REDIRECT_URI`. Done.

Without this step nobody can log in - and therefore nobody can see the
downloads.

## Step 6 - Run the backend as a permanent service

Not `npm run dev` (developer mode) - run it permanently with a process
manager, so it comes back up automatically after a reboot or crash:

```bash
cd nabs-racing/backend
npm install -g pm2
pm2 start npm --name nabs-api -- start
pm2 save
pm2 startup        # prints a command -> run it once (autostart)
```

---

## Alternative: Railway (instead of your own server)

The project is prepared for it: `railway.json` and the root `package.json`
tell Railway how to build and start (build website -> start backend -> create
database tables automatically). Steps 1-6 above then mostly disappear - no
Caddy, no pm2, no own server.

1. Create a project on [railway.app](https://railway.app) and connect the
   GitHub repo. Railway rebuilds on every `git push` from then on.
2. Give the service a **volume**, mounted at `/data`.
   **Without a volume the disk is wiped on every deploy** - database, images
   and downloads would be gone.
3. Under *Variables* set:

   ```ini
   DATA_DIR=/data
   DATABASE_URL=file:/data/dev.db
   JWT_SECRET=<long, random string - see the command in step 2 above>
   CORS_ORIGIN=https://<your-domain>
   DISCORD_CLIENT_ID=<your client id>
   DISCORD_CLIENT_SECRET=<your client secret>
   DISCORD_REDIRECT_URI=https://<your-domain>/auth/discord/callback
   ```

   Railway sets `PORT` by itself.
4. Connect the domain under *Settings -> Networking*. Railway handles HTTPS
   automatically. Afterwards add the redirect URL in the Discord developer
   portal as in step 5 above.
5. **First data:** the very first start only creates empty tables. Either copy
   the existing `dev.db` from the development machine onto the volume via the
   Railway CLI (to `/data/dev.db`), or seed once. Put the big download files
   onto the volume as well (`/data/downloads/`).

> **Keep an eye on cost:** Railway charges for storage **and** outgoing
> traffic. If many members download the big AC files (several GB), that can
> get more expensive than a fixed VPS. Alternative for the big files: external
> storage such as Cloudflare R2 (free traffic), registered in the download
> catalogue as an external link.

---

## Filling the downloads (day-to-day operation)

1. Put a file onto the server into `backend/downloads/` via SFTP/copy - or
   upload it straight from the browser in the admin Downloads tab.
2. On the website: **Admin** (PIN) -> **Downloads** tab -> the file shows up
   there automatically -> click **Register** and add title/folder/notes.
   For files hosted elsewhere (Google Drive, Mega, ...), register an
   **external link** instead.
3. Members see and download it immediately under **Downloads**.

## Backups (the most important routine)

The server backs up the database automatically before every result import -
but those backups live on **the same disk** as the database itself. So
regularly (e.g. after every race): **Admin -> Health -> "Download full
backup"**. That downloads database + all uploaded images as one zip. Keep the
file on your own machine, a USB stick or in a cloud. If the server is ever
lost, this zip is all you need: copy `dev.db` to `backend/prisma/dev.db` and
the `uploads` folder to `backend/uploads`, done.

## Updating later

```bash
cd nabs-racing
git pull
cd backend  && npm install
cd ../frontend && npm install && npm run build
pm2 restart nabs-api      # Caddy picks up the new dist/ automatically
```

---

## Short checklist

- [ ] Domain points at the server
- [ ] `backend/.env` filled in (JWT_SECRET, Discord values, `https` redirect, CORS)
- [ ] Database copied **or** `migrate deploy` + `seed`
- [ ] Download files in `backend/downloads/`
- [ ] `frontend` built (`npm run build`), `VITE_API_BASE` empty
- [ ] HTTPS in front (Caddy `reverse_proxy localhost:4000` **or** Cloudflare)
- [ ] Discord redirect URL added in the developer portal
- [ ] Backend running via pm2 as a permanent service + autostart
- [ ] Link previews: in `frontend/index.html`, replace
      `https://nabs-racing.example` in the two `og:image` / `twitter:image`
      lines with the real domain (otherwise Discord shows no preview image)

> **Only 3 things deliberately live outside of git** and have to be created on
> the server itself: `backend/.env`, the database file `backend/prisma/dev.db`
> and the folder `backend/downloads/` with the big files.
