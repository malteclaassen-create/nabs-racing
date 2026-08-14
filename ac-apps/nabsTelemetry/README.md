# nabsTelemetry

Records throttle, brake, steering, speed and gear over every lap you drive,
and sends your **fastest clean lap per track** to the league website — where
two drivers' laps can be laid over each other, pedal for pedal.

Why an in-game app at all: the race server's own data (Stracker, the server
manager) has lap times and sectors, but throttle/brake/steering never leave
your PC. This is the only place they can be read.

## What leaves your PC, and when

One JSON post per clean lap (or only on a session-best — the default), to the
league URL you paste in, and nowhere else. It contains: your SteamID, driver
name, car, track, the lap time, and ~800 samples of speed/gas/brake/steering/
gear across the lap. Laps with four wheels off track or through the pit lane
are never sent. The site keeps only your fastest lap per track and discards
slower posts. Untick "record and send my laps" and nothing is recorded at all.

## Installing (by hand)

Copy the whole `nabsTelemetry` folder into

```
assettocorsa/apps/lua/nabsTelemetry/
```

enable **NABS TELEMETRY** in Content Manager under Settings → Custom Shaders
Patch → New Lua Apps, open it once from the in-game app bar, and in its
settings (spanner):

1. paste the **league URL** — an admin makes it under Admin → Reports →
   *Telemetry from inside the car* → **Switch on and make a key**;
2. tick **record and send my laps**;
3. press **Test connection** — it should say `HTTP 200`.

That's it. The app loads with every session from then on (no window needed)
and posts automatically when you set a clean session best.

## Serving it from the league server

CSP can hand Lua scripts to everyone who joins a server, which is how the
penalty app reaches drivers without a download. The same should work here —
but the exact server-side setup depends on the hosting panel, and whether a
server-delivered script may post to an outside URL has to be confirmed in
that setup before promising it. Until then, the manual install above works.

## First-version honesty

This has not run inside the game yet. It is written against the same CSP API
surface as webPenaltyNABS (which does run), everything engine-touching is
guarded, and any error prints inside the app window instead of vanishing —
but expect to fix a field name or two on first contact. `ac.debug` lines are
tagged `nabsTelemetry`.
