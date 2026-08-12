# webPenalty NABS

A league fork of **webPenalty v0.5 by TeTeMaTeTe**
(<https://ko-fi.com/offsentreracing>). The reporting mechanism and the replay
clock are their work; this copy adds the league's own website as a destination
and a jump-to-the-incident panel for stewards.

Do not pass this off as the original, and do not redistribute it as if it were.

## Installing

Copy the whole `webPenaltyNABS` folder into

```
assettocorsa/apps/lua/webPenaltyNABS/
```

then enable **NABS PENALTIES** in Content Manager under Settings → Custom
Shaders Patch → New Lua Apps, and open it from the in-game app bar.

## For whoever relays the reports

1. On the website: Admin → Reports → *Reports from inside the race* → **Switch
   on and make a key**. It prints a URL.
2. In the app's settings panel (the spanner on the window), paste that URL into
   **report URL** and tick **relay reports from this PC**.
3. Press **Test Report**. A report appears on the site within a second, and the
   app's main window says `report sent (HTTP 200)`.

If it says `report FAILED: HTTP 401` the URL is wrong or truncated — the field
is masked, so paste it in one go rather than typing it.

Two or three people may relay at once when pointed at the website: the site
collapses the same driver's press into a single report, so the feature no longer
dies when one particular person isn't racing. Pointed at a **Discord webhook**
it has no such protection — keep that to one person.

## For stewards, in a replay

Open the round's replay, then the app.

1. On the website, open the report. The chip in its header reads something like
   `12:34 into the race`. Click it to copy.
2. Paste into **position** in the app and press **Jump**.

The panel always shows `now`, `target` and `delta`, so even if a build cannot
seek you can drag the replay slider until `delta` reads `0:00`.

### If jumps land consistently early or late

The website measures "into the race" from the first thing recorded in the result
file; Assetto Corsa's own timeline starts fractionally elsewhere. Measure the
difference once and put it in **jump offset** in the settings. It is one number
for the whole league, not one per race.

## What was changed from the original

- Reports can post to the league site as well as to Discord. The wire format is
  untouched, so the site reads Discord's own shape.
- A steward panel: paste a position, see target/current/delta, press Jump.
  Seeking uses `ac.setReplayPosition`, guarded so an older build degrades to the
  readout instead of erroring.
- The jump is driven by **session time**, never the wall clock, so no timezone,
  date or PC clock can put it an hour out.
- The original's hard-coded `+2738` on the replay clock became a settings field.
- Crash guards: the web callback no longer indexes a nil response, the replay
  blob no longer feeds nil into arithmetic, and a server-sent message no longer
  calls a method on a nil sender.
- The send result is shown in game.

**Not changed:** the `ac.OnlineEvent` struct and its key. Whatever script fires
the report for the drivers declares the same struct, and changing it on one side
only would stop reporting entirely.

## Untested in game

Every API call here exists in the CSP SDK shipped on the league admin's machine
(checked against `extension/internal/lua-sdk/ac_apps/lib.lua`), and the file
parses, but nobody has run it in Assetto Corsa yet. The first session with it
should be a test session: press **Test Report**, then open a replay and try one
**Jump**.
