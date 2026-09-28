# Race control - how it fits together

Race control watches a race while it happens. It has its own role next to admin
and steward: stewards judge the reports afterwards, race control sits on the
server during the race. Admins count as race control without being listed.

## Who gets it

Admin -> Community -> Members -> **Make race control**. That person then gets:

- the **Race control** button on the Live page's TV board (bursts on the map
  for every contact, who is off track, who stopped),
- an admin area with one page in it: their **pairing code** for the game app.
  Nothing else of the admin area, no results, no reports.

Taking the role away also kills their code, the app gets nothing more.

## Where the data comes from

The race servers run on Emperor. Their race-control socket, which our backend
holds open all the time for the live timing, sends every collision the server
sees (EventType 108): driver, other driver or "environment", impact speed,
world position. It reaches our backend about 0.2 s after the hit (measured on
the first evening). The game itself can't see other cars' contacts, CSP says so
in its own SDK, which is why the app gets them from us.

- **Contacts**: from the server, exact. Small ones under the threshold (default
  15 km/h, on the TV board) are dropped. A car sliding along a wall is one
  contact, not ten.
- **Stopped cars**: worked out by us from positions. Out of the pit lane, under
  8 km/h for 3 s, and only after the car has been over 40 km/h once.
- **Off track**: an estimate off Emperor's track map, which paints the road in
  its real width. Centre of the car more than 2.5 m beside the tarmac for most
  of a second. Kerbs the map doesn't paint can count as off.

## The game app

`ac-apps/NABS_RaceControl_HUD` (v1.2) goes into
`assettocorsa/apps/lua/`. Open its window in the game, type the code from the
race control page once. From then on every contact over the threshold opens
the camera tiles for that car by itself. The window says whether it is
connected.

The older `NABS_RaceControl_PiP` is in the repo too, unchanged. Don't run both.

### The line the app uses

Long polling over plain HTTPS. The app asks "anything after N?", the site
answers at once if there is, otherwise it holds the question up to 20 s and
answers the moment a contact comes in. So there is no delay from polling, and
nearly nothing goes over the line while nothing happens.

```
GET https://nabsracing.com/api/race-control/app/next?code=HHN6GB
```

Without `after`: answered straight away with where the feed stands now. Old
contacts are not sent.

```json
{ "ok": true, "cursor": 41, "collisions": [] }
```

Then, in a loop:

```
GET https://nabsracing.com/api/race-control/app/next?code=HHN6GB&after=41&wait=20
```

`wait` is seconds, at most 25 (CSP gives up on an answer after 30). The code
can also go in a header, `X-Race-Control-Code: HHN6GB`, instead of the URL.

```json
{
  "ok": true,
  "cursor": 42,
  "collisions": [
    {
      "seq": 42,
      "id": "5c0f...",
      "server": "nabs1",
      "track": "vhe_interlagos",
      "kind": "car",
      "carId": 24,
      "driver": "simau",
      "otherCarId": 7,
      "other": "Darin Ejin",
      "kmh": 82.3,
      "pos": { "x": -224.8, "y": 4.3, "z": 399.9 },
      "at": 1790614115000,
      "raceMs": 1832000
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `cursor` | Send it back as `after` next time. |
| `kind` | `car` (car against car) or `env` (wall, barrier, anything else). |
| `carId` / `otherCarId` | The server slot, which CSP calls `sessionID`. `ac.getCar.serverSlot(carId)` finds the car. `otherCarId` is null for `env`. |
| `driver` / `other` | Names as the server has them. The app checks the name too, so a contact from the league's other server never lands on the wrong car. |
| `kmh` | Impact speed. |
| `pos` | World position of the hit, metres. |
| `at` | When, epoch ms (server clock). |
| `raceMs` | Milliseconds into the session, null if unknown. |

Answers other than 200:

| Status | Meaning | What the app does |
| --- | --- | --- |
| 401 | Code unknown, or the person lost the role | Says "code not accepted", tries again in 30 s |
| 429 | Twenty wrong codes from this address in 10 minutes | Waits |
| anything else / no connection | | Tries again after a few seconds, up to 30 |

If the site restarted, the next answer carries a smaller cursor. Just take it.

## What it costs on a race night

Railway charges about 5 cents per GB going out.

- Emperor to us: nothing new, the backend listens anyway for the live timing.
- Us to one game app: one question every 20 s while nothing happens, a few
  hundred bytes each, plus a few hundred bytes per contact. For a 90 minute
  race with 150 contacts that is roughly **0.2 to 0.3 MB**.
- One TV board with race control on: asks every 2 s for what changed, so about
  **2 to 3 MB** per evening (mostly the HTTP headers).

Three people doing race control on a race night come to under 10 MB, which is
well under a cent.
