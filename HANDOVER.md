# Taking over the website - step by step

This guide is for the league admin who wants to run the NABS Racing website
on his own accounts. Right now everything runs through Malte: his GitHub
account holds the code, his Railway account runs the server, and his Discord
app powers the login. After this guide, the site runs on YOUR Railway account
with YOUR Discord app, while Malte keeps pushing code updates.

You do not need to know anything about programming, GitHub or servers. Every
step is spelled out. You DO need about 1 to 2 hours, and it helps a lot to
have Malte reachable on Discord while you do it (one step near the end is
easiest done together).

**Who does what after the takeover:**

| You (league admin)                          | Malte                            |
| ------------------------------------------- | -------------------------------- |
| Own the Railway account (site + bill)       | Owns the GitHub repo (the code)  |
| Own the Discord app (the login)             | Pushes updates and fixes         |
| Enter results, manage downloads, do backups | Helps when something breaks      |

When Malte pushes an update to GitHub, your Railway rebuilds the site
automatically. You never have to touch the code.

---

## What you need before you start

- A normal **Discord account** (you have one).
- An **email address** for the new accounts.
- A **credit card or PayPal** for Railway. The Hobby plan is **$5 per month**
  and includes some usage; heavy download traffic can add to that (more on
  cost at the end).
- **Malte on standby** for two moments: he has to approve your access to the
  code (5 minutes), and the data move at the end is best done together.

---

## Step 1 - GitHub account and access to the code

GitHub is where the website's code lives. The code stays on Malte's account;
you only need access to it so Railway (next step) is allowed to read it.

1. Go to <https://github.com> and click **Sign up**. Pick a username, use
   your email, done. The free plan is all you need.
2. Tell Malte your GitHub username. He will invite you as a **collaborator**
   on the repository.
3. You get an email from GitHub ("... invited you to collaborate").
   Open it and click **Accept invitation**.

That's it for GitHub. You will barely ever look at it again.

## Step 2 - Railway account and first deploy

Railway is the hosting service: it runs the website 24/7 and rebuilds it
whenever the code changes.

1. Go to <https://railway.app> and sign up. **Choose "Login with GitHub"**,
   not email. This is important: it is how Railway later finds the code.
2. Subscribe to the **Hobby plan** ($5/month) when it asks. The free trial
   is too small for this site.
3. Click **New Project** -> **Deploy from GitHub repo**.
4. Railway will ask to be connected to GitHub ("Configure GitHub App").
   Because the repo belongs to Malte, GitHub sends HIM an approval request
   at this point. Ping him; once he approves it, the repo shows up in your
   list. (If it does not appear, log out of Railway and back in.)
5. Select the **nabs-racing** repo. Railway starts building right away.
   **The first build may fail - that is expected**, the settings below are
   still missing. Ignore the red X and continue.
6. Click on the service (the box on the project canvas), open **Settings**,
   and set the **Region to EU West (Amsterdam)**. Do this BEFORE the first
   successful deploy: the storage is created in whatever region the first
   deploy lands in, and moving it later is painful. EU because the drivers
   are in Europe.
7. Add a **Volume** (permanent storage): right-click on an empty spot of the
   project canvas -> **Volume** -> attach it to the service -> mount path
   `/data`. Without this, the database and all images would be wiped on
   every update.
8. Open the **Variables** tab of the service, switch to the **Raw Editor**,
   and paste this in:

   ```ini
   DATA_DIR=/data
   DATABASE_URL=file:/data/dev.db
   JWT_SECRET=REPLACE-ME
   CORS_ORIGIN=https://${{RAILWAY_PUBLIC_DOMAIN}}
   DISCORD_REDIRECT_URI=https://${{RAILWAY_PUBLIC_DOMAIN}}/auth/discord/callback
   DISCORD_CLIENT_ID=FILLED-IN-IN-STEP-3
   DISCORD_CLIENT_SECRET=FILLED-IN-IN-STEP-3
   ```

   Replace `REPLACE-ME` behind `JWT_SECRET` with a long random string. Use a
   password generator (for example the one built into your browser or
   <https://bitwarden.com/password-generator/>) and make it **at least 40
   characters, letters and numbers**. This is the key that protects all
   logins. Never share it, never reuse an old one. If you leave the
   placeholder in, the server refuses to start on purpose.

   Leave the two `${{RAILWAY_PUBLIC_DOMAIN}}` lines exactly as they are -
   Railway fills in the real address by itself.
9. Go to **Settings -> Networking** and click **Generate Domain** (pick port
   **8080** if it asks - that is the port Railway assigns to the app via the
   PORT variable; 4000 is only the local dev port and answers nothing here).
   This gives the site its public address, something like
   `nabs-racing-production.up.railway.app`. **Write this address down**, you
   need it in the next step.
10. Click **Deploy** (or wait for the automatic redeploy). The build should
    now go green. The site is online but the Discord login does not work yet.
11. **Custom domain (nabsracing.com):** still under **Settings -> Networking**,
    click **Add Custom Domain**, enter `nabsracing.com` (just the name, no
    `https://`) and pick port **8080** (the Railway-assigned PORT — a wrong
    port here shows as "Application failed to respond"). Add
    `www.nabsracing.com` the same way if the plan allows a third domain.
    Railway then shows the DNS records (CNAME) to set at the place where the
    domain was bought. HTTPS certificates come automatically once DNS points
    at Railway. Afterwards set the two variables to fixed values:

    ```
    CORS_ORIGIN=https://nabsracing.com
    DISCORD_REDIRECT_URI=https://nabsracing.com/auth/discord/callback
    ```

    and add `https://nabsracing.com/auth/discord/callback` as a second
    redirect in the Discord developer portal (Step 3).

## Step 3 - Your own Discord app for the login

The "Login with Discord" button needs a Discord application. That is a free
thing any Discord user can create in two minutes; it is NOT a bot and does
not join your server.

1. Go to <https://discord.com/developers/applications> and log in with your
   normal Discord account.
2. Click **New Application**, name it something like `NABS Racing Login`,
   accept, create.
3. In the left menu open **OAuth2**.
4. Copy the **Client ID** (a long number) - this goes into the
   `DISCORD_CLIENT_ID` variable in Railway.
5. Click **Reset Secret**, confirm, and copy the secret it shows you - this
   goes into `DISCORD_CLIENT_SECRET` in Railway. Discord shows it only once;
   if you lose it, just reset it again. Treat it like a password.
6. Still on the OAuth2 page, under **Redirects** click **Add Redirect** and
   enter exactly (with your address from step 2.9):

   ```
   https://YOUR-ADDRESS.up.railway.app/auth/discord/callback
   ```

   No trailing slash, and it must start with `https://`. Save.
7. Back in Railway, put the Client ID and the secret into the two variables
   and let it redeploy.

Now open the site and try **Login with Discord**. If Discord shows an
"invalid redirect" error, the URL in step 6 does not match character for
character - fix and retry.

### Will people's profiles survive the move? Yes.

A common worry, so here it is in plain words: the profile pictures, the
"which Discord account belongs to which driver" links, bans and admin rights
are all stored **in the database**, keyed to each member's Discord user ID.
That ID is a property of the person's Discord account and never changes. It
does not matter that the login now runs through your app instead of Malte's.

So after the database is moved over (next step), everything is exactly as
before. The only thing everyone has to do is **log in once again** on the
new address - the new site cannot reuse login sessions from the old one.
After that one login, their profile picture and everything else is back
automatically.

## Step 4 - Moving the data (do this together with Malte)

Right now the new site is an empty shell. The real database (drivers, teams,
results, member accounts) and the images have to be copied over once from the
old site. This is the one step that needs Malte's command line tools, so the
easiest way is: get on Discord together, he pushes the data over, done in a
few minutes. (For the technically curious, the exact commands are in
`DEPLOYMENT.md` under "Getting the data onto the volume".)

The **big download files** (tracks, car packs and so on) are NOT part of
that move. You upload those yourself later, from the browser: **Admin ->
Downloads tab -> upload**, no command line needed. Or register them as
external links (Google Drive etc.) - recommended for multi-GB files, see the
cost note below.

## Step 5 - First checks

After the data move, go through this list once:

1. Open the site, log in with Discord, check that your profile picture and
   driver link are there.
2. Check a few pages: standings, a race result, a driver profile.
3. **Change the admin PIN immediately** (Admin -> settings). The default PIN
   is public knowledge from the seed data.
4. Download a first full backup: **Admin -> Health -> Download full backup**.
   Keep that zip somewhere safe outside the server.
5. The link-preview address in the code (the `og:image` lines) is already set
   to `nabsracing.com`. If the site ever moves to a different domain, ask
   Malte to update it - a one-line code change on his side.
6. Post the new address on your Discord server and tell everyone to log in
   once.

---

## Day-to-day life after the takeover

**Updates:** Malte pushes a change to GitHub, your Railway notices and
rebuilds automatically, one or two minutes later the site is updated. You do
nothing. You can watch it happen under **Deployments** in Railway if you are
curious.

**Backups:** the single most important habit. After every race (or at least
regularly): **Admin -> Health -> Download full backup** and keep the zip on
your PC or in a cloud. If Railway ever loses the volume, that zip is
everything needed to rebuild the site.

**Downloads for members:** upload files in the admin Downloads tab or add
external links. Members see them immediately.

**Feedback from the drivers:** the site has a small **Feedback** button
(bottom right on a computer, in the menu on a phone) that anyone can use to
report a bug or ask for a feature. Everything written there lands in
**Admin -> Feedback**, and the number next to that tab is how many still need
something from you. Mark an entry planned, done or won't do to file it away;
that on its own tells the sender nothing.

To answer somebody, press **Reply** on their entry. They get a notification
with your answer and can write back from their own **Your messages** page,
which brings the entry back to the top of your list with a "new reply" mark
(the **Waiting on you** filter shows only those). This only works for reports
sent by someone who was signed in; a logged-out visitor has no account for an
answer to arrive in, so their entry shows whatever contact line they left and
you reach them there.

**Incident reports (stewarding):** drivers can send you an incident privately,
from the report button (bottom right on a computer, in the menu on a phone) or
from a round on the Races page. Each one is a private thread: only the driver
who filed it, the driver it names and the admins can read it, and you can let
one more person in per thread (a witness, a team mate) by picking their name.
Everything lands in **Admin -> Reports**, grouped by race, and the number next
to the tab is how many are still waiting on you.

Working through one: read it, write in the thread if you need to ask
something, then set the outcome, the seconds and a sentence of reasoning and
press **Save decision**. Both drivers get told once, with what you wrote.
Nothing is sent until you press save.

**You cannot change who a report is about.** That is the reporter's to say,
from their own page, and only while nobody is named yet. An accusation
belongs to the person making it: a steward who could re-point one would be
able to make a case against a driver nobody complained about, in a thread
that then reads as if the first driver wrote it. A report with nobody named
(one from the in-game app, or somebody who wrote "the blue car") shows
"Nobody named yet" and stays private to the stewards until the driver who
filed it says who it was.

**Deciding a penalty does not put it on the driver.** That is deliberate: the
points come from the results editor and only from there, so two screens can
never disagree about a championship. Under the table in **Edit Results** there
is a list of every penalty the stewards decided for that round and whether the
seconds are actually in the table, so nothing gets agreed and then forgotten.

A report reads as a conversation: what was reported is the first message, and
everyone on the thread writes underneath it. Pictures, clips and PDFs can be
attached to any message, up to **20 MB each and four at a time**, and links
typed into a message become clickable. Those files are private like the rest
of the thread: they are not in the public uploads folder and can only be
opened by somebody the thread lets in. Deleting a report deletes its files.

Clips are the biggest thing this site stores, and Railway charges for storage
and traffic, so this is the one part of Reports with a running cost. At the
bottom of the Reports tab, **Pictures on finished reports** lets you set how
long a DECIDED report keeps them: forever (the default), or 1, 7, 30, 90, 180
or 365 days. The conversation always stays; only the files go, and the thread
then says a picture was there. Counted from when the decision was last
touched, so an argument that is still running keeps its evidence however old
the crash is. Deleting a report deletes its files immediately, whatever this
is set to.

**Stewards without admin access:** in **Admin -> Members** you can press
**Make steward** on somebody. They can then read and answer EVERY incident
report from their own **My reports** page, and nothing else changes for them:
no results editor, no settings, no admin area. Judging incidents and running
a league are different jobs, and handing over the PIN so somebody can look at
a report hands over the championship with it. Admins are stewards already and
do not need adding.

Every driver has a **My reports** page. It shows the reports they filed or
are named in, anything the stewards let them read, and, for a steward, the
rest of the league. The report buttons around the site lead there.

If your league uses the in-game **webPenalty** app, the bottom of the Reports
tab switches on a door for it and gives you a URL to paste into the app's
settings. Off until you switch it on. Treat the URL like a password.

**Cost:** the Hobby plan is $5/month. On top, Railway charges for storage
and **outgoing traffic**. Database and images are tiny; the danger is
members downloading multi-GB car packs from the site, which can make a month
noticeably more expensive. Rule of thumb: small files (skins, apps, configs)
host directly, huge files (track packs, F1 2007) register as external links
to Google Drive or similar, where traffic is free. Keep an eye on the
**Usage** page in Railway during the first month.

**If something looks broken:** first check Railway -> your service ->
**Deployments**: is the latest one green? If a deploy is red, or the site
shows errors, screenshot it and send it to Malte. Do not delete or recreate
anything in Railway on your own - especially never the volume, that is where
the database lives.

---

## Quick reference

| Thing                    | Where                                            | Owner |
| ------------------------ | ------------------------------------------------ | ----- |
| Code                     | GitHub, repo `nabs-racing`                       | Malte |
| Hosting, domain, bill    | railway.app, your project                        | You   |
| Login app                | discord.com/developers, `NABS Racing Login`      | You   |
| Database + images        | Railway volume at `/data`                        | You   |
| Backups                  | Admin -> Health -> Download full backup          | You   |
| Admin PIN + Discord admins | Admin area on the site                         | You   |

Secrets to guard: the `JWT_SECRET` variable, the Discord client secret, and
the admin PIN. None of them should ever be posted in Discord chats.
