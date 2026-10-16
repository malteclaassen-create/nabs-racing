# Race Recap preview (lab, not part of the site)

A standalone preview of the reworked Race Recap page ("race replay" with the
smooth animation package, site-style chapter headers, the Pace tiles that
compare you with the field, the tier switch and the NABS Tokens card), shown
on a real round: F1 Friday, Season 8, Round 9, Singapore, from Maltegoat's
seat.

Nothing here is wired into the app. The site keeps its current recap until
this is moved into `frontend/src/pages/RaceRecapPage.jsx` on purpose.

## Run it on your PC

From the repository root:

```
cd frontend
npm install                                   # once
node labs/race-recap-preview/build.mjs --no-mock
npx vite preview --config labs/race-recap-preview/vite.config.mjs --port 4173
```

Then open http://localhost:4173 . `--no-mock` keeps the saved payload in
`mock/real-recap.js`; without it, `mock/build-real.mjs` rebuilds the payload
from the saved public API answers in `api-cache/` (no network).

For live editing instead of a build, run the build once (it fills
`harness/public/` and writes `harness/fonts.css`), then:

```
npx vite --config labs/race-recap-preview/vite.config.mjs
```

## What is where

- `harness/main.jsx`: mounts the page in a router with the site's providers.
- `harness/variants/replay/`: the reworked page (`RaceRecapPage.jsx`), the
  replay player (`RaceReplay.jsx`), cards, the tier switch (`cmp.jsx`) and
  the styles (`replay.css`, `polish.css`, `g3.css`, `cmp.css`).
- `harness/mockClient.js`: stands in for `src/api/client.js` (aliased in
  `vite.config.mjs`), answering from the saved payload.
- `harness/publicTokens.js`: the NABS Tokens a round pays under the league's
  public token rules. The preview shows it as on race night: the clean-race
  bonus stays pending until the stewards have been through the reports. The
  balance and the next card are sample values (the real ledger is private).
- `mock/real-recap.js`: the recap payload of the real round (built by
  `mock/build-real.mjs` from `api-cache/`, public data only). Rating,
  incidents and lap times are not public, so those parts are empty here.

Everything else (components, Tailwind config, global CSS, fonts, flags, team
logos) comes straight from `frontend/`.
