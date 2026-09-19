# Discord bot for the NABS Points

Small bot that sits on the league Discord and sends two things to the website:

- messages + voice minutes per person per day (that's the activity multiplier)
- who invited a new member (so the inviter gets their points automatically)

That's all it does. It doesn't read messages (doesn't even have the permission for it), doesn't post anything, doesn't touch roles. It just counts.

Voice minutes only count when you're actually there: not muted, not deafened, not alone in the channel, not parked in the AFK one. Otherwise leaving the client running overnight buys the whole multiplier. All three are switches in `.env` if the league wants it looser.

## Setup

**1. Create the bot**

- https://discord.com/developers/applications -> New Application, call it whatever (e.g. NABS Points)
- Bot tab -> Privileged Gateway Intents -> turn on **Server Members Intent**. Leave the other two off.
- Bot tab -> Reset Token -> copy it. Only shown once, keep it like a password.

**2. Add it to the server**

- OAuth2 tab -> Scopes: `bot` -> Bot Permissions: **Manage Server** + **View Channels**
- copy the generated URL, open it, pick the server, authorise

Manage Server is the only way discord lets a bot read the invite counters. If you don't want to give it, everything except invite tracking still works.

**3. Config**

Copy `.env.example` to `.env` and fill in:

```
DISCORD_TOKEN=   from step 1
GUILD_ID=        right-click the server -> Copy Server ID (needs developer mode in discord settings -> advanced)
SITE_URL=        the website address
TOKEN_KEY=       Admin -> NABS Points -> Discord bot
```

**4. Run**

```
npm install
npm run check
npm start
```

`npm run check` only talks to the website and tells you if the key / url is wrong. Do that first.

Running log looks like this:

```
2026-09-18 19:04:11 Signed in as NABS Points#4417
2026-09-18 19:04:11 Watching NABS Racing, day 2026-09-18
2026-09-18 19:04:12 Website ok: https://...
2026-09-18 19:09:12 -> 14 day rows sent
2026-09-18 19:21:40 + newdriver joined through 328529037716619264
```

## Keeping it running

Has to run on something that's on most of the time (server, the pc that runs other league stuff, or next to the website as a second service, needs no port). If it's down for a while nothing already counted is lost, you just miss those hours. Ctrl+C stops it, it sends what it has first.

The bot can run before the points are switched on for members. Good idea actually: start it a month early and the multipliers are already filled when the feature goes live. It can't count backwards.

## If something's off

- `could not read the invites` -> no Manage Server permission, rest still works
- `website not reachable` -> site down, it retries
- `Bad key` -> copy the key again from the admin
- `inviter unknown` -> two people joined at the same time, or via the public link, or it's the bot's first look at the invites after a restart. Not credited to anyone, on purpose
