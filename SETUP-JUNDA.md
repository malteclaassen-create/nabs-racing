# NABS Racing on Junda, step by step

This is the full setup for running the site on the Junda hosting package.
The website is already built and included in this zip, so you only upload
things and click through cPanel. No coding needed.

One thing before you start: the site is a Node.js app. In cPanel there must
be an icon called "Setup Node.js App" (in the Software section). If you can
see it, everything below will work. If it is missing, message me first.

## 1. Decide the address

Pick the address the site should live on, for example a subdomain like
`nabs.yourdomain.nl`. You create it in cPanel under "Domains" or
"Subdomains". Remember it, you will need it twice below.

## 2. Upload the zip

1. In cPanel open the "File Manager".
2. Go to your home directory (the folder you land in).
3. Click "Upload" and upload `nabs-racing-share.zip`.
4. Back in the File Manager, right click the zip and choose "Extract".
5. You now have a folder called `nabs-racing`. That is the whole site,
   including the database and all images.

## 3. Create the Node.js app

1. In cPanel open "Setup Node.js App".
2. Click "Create Application" and fill it in like this:
   - Node.js version: 20 or higher
   - Application mode: Production
   - Application root: `nabs-racing/backend`
   - Application URL: the address from step 1
   - Application startup file: `src/index.js`
3. Save it. Do not start it yet, the settings from step 4 come first.

## 4. Fill in the environment variables

Still in the same app screen there is a table called "Environment variables".
Add these entries one by one. Most values are already in the file
`nabs-racing/backend/.env`, you can open it in the File Manager and copy
from there.

| Name | Value |
|------|-------|
| DATABASE_URL | `file:./dev.db` |
| JWT_SECRET | see below, make a fresh one |
| CORS_ORIGIN | `https://` plus the address from step 1 |
| DISCORD_CLIENT_ID | copy from the .env file |
| DISCORD_CLIENT_SECRET | copy from the .env file |
| DISCORD_REDIRECT_URI | `https://` plus the address, plus `/auth/discord/callback` |

Do not add PORT. The host sets that by itself.

For JWT_SECRET you need a long random string. Easiest way: go to the app
screen, there is a command line hint at the top ("Enter to the virtual
environment..."). Open the terminal in cPanel, paste that line, then run:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output into JWT_SECRET. Important: the server refuses to start on a
real domain while a placeholder secret is still set. That is on purpose.

## 5. Install and start

1. In the app screen click "Run NPM Install" and wait until it finishes.
2. Click "Start App".

## 6. Check that it runs

1. Open `https://<your address>/api/health` in the browser.
   It should show `{"ok":true}`.
2. Open the site itself. Standings, races and team pages should all show
   data right away, the database is included.
3. Open the Live Timing page once. If it stays empty on race night, the
   host does not pass the live connection through. Everything else still
   works, only that page would stay empty. Tell me if that happens.

## 7. Discord login

The login needs one entry on the Discord side that only I can make.
Send me the final address (for example `https://nabs.yourdomain.nl`) and I
will add it in the Discord developer portal. After that the login works.

## 8. Last two things

1. Log in to the admin area (link in the footer, PIN is `nabs2026`) and
   change the PIN right away under "Change PIN".
2. The big AC files (tracks, cars and so on) are not in the zip, they are
   too large. Either upload them in the admin under "Downloads", or put
   them in `nabs-racing/backend/downloads/` via the File Manager, or
   register them as external links (Google Drive, Mega and so on) in the
   admin. All three ways work.

## If something goes wrong

- The app writes errors to `stderr.log` inside `nabs-racing/backend`.
  The app screen in cPanel also shows the state.
- After changing an environment variable, click "Restart" in the app screen.
- If the host keeps stopping the app or uploads keep failing, tell me.
  Plan B is a small rented server, the site is prepared for that too.
