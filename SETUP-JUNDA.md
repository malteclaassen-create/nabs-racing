# Running NABS Racing on junda.nl

A concrete walkthrough for putting the site live under the junda.nl domain,
next to what already runs there. The general guide is `DEPLOYMENT.md`; this
file only fills in the junda-specific pieces.

**The plan:** the site gets its own subdomain, e.g. **`nabs.junda.nl`**, and
runs as one Node process on port 4000 behind your existing web server.
www.junda.nl keeps running exactly as it does today.

---

## Step 0 - One thing to check first

The NABS backend is a normal, always-running Node server with its own files on
disk (SQLite database, uploaded images, download files, a WebSocket for live
timing). That works on any VPS / root server / home server.

It does **not** work on serverless platforms (Vercel, Netlify, Cloudflare
Pages): those freeze the process between requests and wipe the disk. So: if
www.junda.nl runs on your own server, perfect, continue below. If it is hosted
on Vercel or similar, host NABS on a small VPS instead and only point the
subdomain there - the steps below stay the same.

## Step 1 - DNS

Add a record for the subdomain at your DNS provider:

```
Type A      Name: nabs      Value: <your server's IP>
```

(Or an AAAA record for IPv6, or a CNAME to the host www.junda.nl already
points at - whatever matches your setup.)

## Step 2 - Put the site on the server

Copy the zip to the server and extract it, e.g.:

```bash
cd /opt
unzip nabs-racing-share.zip     # creates /opt/nabs-racing
cd nabs-racing/backend
npm install
```

The database (`backend/prisma/dev.db`), the uploaded images
(`backend/uploads/`) and the download files (`backend/downloads/`) are already
inside the zip - nothing to import.

## Step 3 - backend/.env for nabs.junda.nl

Edit `backend/.env` and change exactly three values (the Discord ID/secret
that are already in the file stay as they are):

```ini
JWT_SECRET="<paste the output of the command below>"
CORS_ORIGIN="https://nabs.junda.nl"
DISCORD_REDIRECT_URI="https://nabs.junda.nl/auth/discord/callback"
```

Generate the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

(The server refuses to start on a domain while the placeholder secret is still
in the file - that is intentional.)

## Step 4 - Build the website

```bash
cd ../frontend
# put the real domain into the Discord/WhatsApp link-preview tags:
sed -i 's|https://nabs-racing.example|https://nabs.junda.nl|g' index.html
npm install
npm run build
```

After the build, the backend serves the website itself - there is no separate
frontend process.

## Step 5 - Keep it running

```bash
cd ../backend
npm install -g pm2        # once, if you don't use pm2 already
pm2 start npm --name nabs -- start
pm2 save
pm2 startup               # prints one command; run it once for autostart
```

The site now answers on `http://localhost:4000` on the server.

## Step 6 - Hook it into your web server

Whatever already serves www.junda.nl also gets the subdomain. Only one detail
matters: `/api/live/ws` is a WebSocket, so the proxy must allow upgrades.

**nginx** - one extra server block:

```nginx
server {
    server_name nabs.junda.nl;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 5g;    # browser uploads in the admin area
    }
}
```

Then `certbot --nginx -d nabs.junda.nl` for HTTPS (or however you issue
certificates today).

**Caddy** - one extra block, HTTPS is automatic:

```caddy
nabs.junda.nl {
    reverse_proxy localhost:4000
}
```

**Next.js on the same box without nginx/Caddy?** If www.junda.nl is served by
Node directly on ports 80/443, the easiest path is still to put Caddy or nginx
in front of both apps, or to route the subdomain through Cloudflare (free) and
let it proxy to port 4000.

## Step 7 - Discord login for the domain

The redirect URL `https://nabs.junda.nl/auth/discord/callback` must be added
to the Discord application (developer portal, OAuth2 -> Redirects). Only the
owner of the Discord app can do that - **tell Malte the final URL and he adds
it**. Until then everything works except the Discord login button.

## Step 8 - First checks

- `https://nabs.junda.nl/api/health` returns `{"ok":true}`
- The site loads, standings and race pages show data
- Live timing page connects (WebSocket)
- Log in to the admin area (link in the footer, PIN `nabs2026`) and
  **change the PIN right away** (Change PIN, top right)

## Day-to-day notes

- Big AC download files: drop them into `backend/downloads/` on the server (or
  upload them in the admin Downloads tab), then register them there. Files
  hosted elsewhere can be registered as external links instead.
- Backups: Admin -> Health -> "Download full backup" grabs the database plus
  all images as one zip. Do that after every race and keep the file somewhere
  safe.
