# nabsTelemetry

Records throttle, brake, steering, speed and gear over every lap you drive,
and sends your **fastest clean laps per track** to the league website, where
two drivers' laps can be laid over each other, pedal for pedal.

Why an in-game app at all: the race server's own data (Stracker, the server
manager) has lap times and sectors, but throttle/brake/steering never leave
your PC. This is the only place they can be read.

## What leaves your PC, and when

One JSON post per clean lap (or only on a session-best, which is the default),
to the league URL you paste in, and nowhere else. It contains: your SteamID,
driver name, car, track, the lap time, and ~800 samples of speed/gas/brake/
steering/gear across the lap. Laps with four wheels off track or through the
pit lane are never sent. The site keeps your fastest three laps per track per
season and discards anything slower. Untick "record and send my laps" and
nothing is recorded at all.

## Installing (by hand)

Copy the whole `nabsTelemetry` folder into

```
assettocorsa/apps/lua/nabsTelemetry/
```

enable **NABS TELEMETRY** in Content Manager under Settings → Custom Shaders
Patch → New Lua Apps, open it once from the in-game app bar, and in its
settings (spanner):

1. paste the **league URL**. An admin makes it under Admin → League →
   Telemetry → *Telemetry from inside the car* → **Switch on and make a key**,
   and hands out the "hand-install URL" the card prints under the snippet;
2. tick **record and send my laps**;
3. press **Test connection** — it should say `HTTP 200`.

That's it. The app loads with every session from then on (no window needed)
and posts automatically when you set a clean session best.

## Serving it from the league server (the real path)

Nobody is meant to install this by hand. The site serves a windowless variant
of this same recorder at `/api/telemetry-laps/app.lua?key=…`, and the admin
card prints a ready-made `[SCRIPT_NABS_TELEMETRY]` snippet for the race
server's `csp_extra_options.ini` — CSP's standard server-script delivery.
Once that snippet is in, drivers do nothing: the script records and posts on
its own. It draws nothing in the game — no window, no toast — so whatever
drivers are told about the recording, they are told in Discord and on the
site, not by the script.

Know what this snippet is for the league: its FIRST server-delivered script.
An earlier version of this file claimed the penalty tooling already used this
mechanism — it does not: webPenalty and the replay tools are hand-installed
apps on individual PCs, and they work whether or not extra options ever leave
the server. So nothing about them proves the delivery path, and two things
must be true on the hosting panel before any of this reaches a car: the race
form's "Required Minimum CSP Version" must be above 0 (at 0, ACSM does not
send extra options at all), and the snippet must sit in the race actually
being driven. One more thing learned the hard way: a driver's game caches the
downloaded script BY URL, essentially forever — which is why the snippet's
URL carries `&v=<version>` and must be re-pasted whenever that version
changes.

This folder remains for testing (one person, before the server snippet goes
in) and for anyone whose CSP is too old for server scripts.

## First-version honesty

This has not run inside the game yet. It is written against the same CSP API
surface as webPenaltyNABS (which does run), everything engine-touching is
guarded, and any error prints inside the app window instead of vanishing —
but expect to fix a field name or two on first contact. `ac.debug` lines are
tagged `nabsTelemetry`.
