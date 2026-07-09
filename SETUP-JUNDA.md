# Running NABS Racing with a junda.nl package

Junda is a shared-hosting provider (cPanel, PHP/WordPress packages). The NABS
site is different from a WordPress site: it is a **Node.js server** that has to
run permanently, keeps its own files on disk (SQLite database, uploaded
images, download files) and uses a WebSocket for live timing. That combination
is exactly what shared PHP hosting is *not* built for.

So read this first - it decides which path applies to you.

---

## Step 0 - Check what your Junda package can do

Log in to the Junda cPanel and look for an icon called **"Setup Node.js App"**
(sometimes "Node.js Selector", in the "Software" section).

- **It's there** -> you can *try* path B below. Fair warning: even then,
  shared hosting limits apply. The live-timing WebSocket and large file
  up-/downloads may not survive the shared LiteSpeed/Passenger proxy, and the
  always-on process can be put to sleep. Treat it as an experiment.
- **It's not there** (only PHP visible) -> the app cannot run on the package
  at all. Use path A - it is the intended setup anyway.

Junda's support chat can also answer in one line: *"Can I run a persistent
Node.js web app (with WebSockets) on my package?"*

---

## Path A (recommended): app elsewhere, domain stays at Junda

Domain and hosting are separate things. The domain registered at Junda can
point anywhere - so let the app run on something made for it and keep the
domain:

1. Run the app on one of:
   - a small **VPS** (e.g. Hetzner, DigitalOcean, Contabo - a few euros per
     month). Then follow `DEPLOYMENT.md` step by step; it fits a VPS 1:1.
   - **Railway** (no server admin work at all). `DEPLOYMENT.md` has a
     dedicated Railway section; the repo is already prepared for it.
2. In the Junda control panel, open the **DNS settings** of the domain and add
   a record for a subdomain, e.g.:
   ```
   Type A      Name: nabs      Value: <IP of the VPS>
   ```
   (For Railway: a CNAME record pointing at the target Railway shows you.)
3. Everything else (HTTPS, .env values, Discord redirect, first checks) is in
   `DEPLOYMENT.md`. The final address is then e.g. `https://nabs.<domain>`.

This path has no surprises: everything on the site works, including live
timing and the big member downloads.

## Path B (experiment): cPanel "Setup Node.js App"

Only if step 0 found the Node.js icon. Rough outline:

1. Upload the zip via the cPanel file manager and extract it, e.g. to
   `~/nabs-racing`.
2. Build the website once **on your own PC** (shared hosts often have no
   build tools): `cd frontend && npm install && npm run build`, then upload
   the resulting `frontend/dist` folder along with the rest.
3. In "Setup Node.js App" create an application:
   - Application root: `nabs-racing/backend`
   - Startup file: `src/index.js`
   - Node version: 20+
   - Environment variables: everything from `backend/.env` (the panel has an
     env-var table; `PORT` is set by the host - do not set it yourself).
4. Run `npm install` via the panel button, then start the app.
5. Point the (sub)domain at the app in the same dialog.

Known rough edges on shared hosting: the `/api/live/ws` WebSocket (live
timing) often doesn't connect through the shared proxy, upload limits are
typically far below our 5 GB admin uploads, and the host may recycle the
process. If any of that bites, switch to path A rather than fighting it.

---

## In both cases

- Set a fresh `JWT_SECRET` in the environment (the server refuses to start on
  a domain with the placeholder). Generate one:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- The Discord callback URL for the final domain must be added in the Discord
  developer portal - **tell Malte the final URL and he adds it**. Put the same
  URL in `DISCORD_REDIRECT_URI` and the domain in `CORS_ORIGIN`.
- Replace `https://nabs-racing.example` in `frontend/index.html` (two image
  lines) with the real domain before building, so Discord link previews show
  an image.
- After the first login, change the admin PIN (Admin -> Change PIN).
- Backups: Admin -> Health -> "Download full backup" after every race.
