# Running NABS Racing with a junda.nl package

Junda is a shared-hosting provider (cPanel, PHP/WordPress packages). The NABS
site is different from a WordPress site: it is a **Node.js server** that has to
run permanently, keeps its own files on disk (SQLite database, uploaded
images, download files) and uses a WebSocket for live timing. That combination
is exactly what shared PHP hosting is *not* built for.

So read this first - it decides which path applies to you.

---

## Step 0 - Look for "Setup Node.js App" in cPanel

Junda's package pages only advertise PHP, but what decides it is the actual
control panel: log in to cPanel and look in the **Software** section for
**"Setup Node.js App"** (the CloudLinux Node.js selector).

- **The icon is there** -> the app can run on the package. Go to **path B**
  and try it; it costs nothing. Two features may degrade on shared hosting
  (details in path B), everything else works normally.
- **No such icon** -> the package only runs PHP, the app cannot run there.
  Go to **path A**: the Junda package then still holds the **domain** (its
  DNS settings are all we need) plus e-mail.

Their support chat can also confirm it in one line: *"Can I run a persistent
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

## Path B: run it via cPanel "Setup Node.js App"

1. Upload the zip via the cPanel file manager (or SFTP) and extract it, e.g.
   to `~/nabs-racing`.
2. Build the website once **on your own PC** (shared hosts often lack the
   memory for a Vite build): on Windows just run `start-dev.bat` once, or
   manually `cd frontend && npm install && npm run build`. Then upload the
   resulting `frontend/dist` folder to the same place on the server. As soon
   as that folder exists, the backend serves the website itself.
3. In cPanel -> **Setup Node.js App** -> **Create Application**:
   - Node.js version: **20+**
   - Application mode: Production
   - Application root: `nabs-racing/backend`
   - Application URL: the (sub)domain the site should live on
   - Application startup file: `src/index.js`
4. Add the **environment variables** in the same dialog - every entry from
   `backend/.env`, with three changes for the domain (see "In both cases"
   below): a fresh `JWT_SECRET`, `CORS_ORIGIN=https://<your-domain>`,
   `DISCORD_REDIRECT_URI=https://<your-domain>/auth/discord/callback`.
   Do **not** set `PORT` - the host assigns it.
5. Click **Run NPM Install** (this also prepares the database driver via the
   postinstall step), then **Start App**.
6. Open `https://<your-domain>/api/health` - it should answer `{"ok":true}` -
   and then the site itself.

What to expect on shared hosting - worth a 5-minute test after setup:

- **Live timing** (`/api/live/ws` WebSocket): open the Live Timing page. If it
  never connects, the shared proxy doesn't pass WebSockets - the rest of the
  site is unaffected, only that page stays empty.
- **Very large member downloads** (multi-GB AC files): shared packages have
  disk (50-150 GB) and process limits. If big transfers abort, register those
  files as **external links** in the admin Downloads tab instead (Google
  Drive, Mega, R2, ...) - built-in feature, two clicks.
- If the app gets stopped by the host repeatedly, switch to path A rather
  than fighting it. Logs live in the app folder (`stderr.log`) and in the
  panel's app view.

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
