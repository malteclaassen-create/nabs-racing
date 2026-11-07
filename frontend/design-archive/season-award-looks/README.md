# Season awards: the looks that were not picked

Five looks were built for the Season awards section of the Hall of Fame. The
league went with the trophy cards (`src/components/SeasonAwardCards.jsx`). The
other four are kept here, unchanged, in case one of them is wanted later:

- `LookGala.jsx` / `lookGala.css`: a dark stage with a spotlight; the first
  award of the season is shown big, the others as gold-framed tiles.
- `LookMedals.jsx` / `lookMedals.css`: gold medals in a laurel wreath on a
  ribbon in the team colour.
- `LookCeremony.jsx` / `lookCeremony.css`: an awards-night programme, one
  numbered row per award with the award name in outlined type.
- `LookPlaques.jsx` / `lookPlaques.css`: engraved trophy nameplates on brushed
  metal.

This folder is outside `src/`, so none of it is built into the site or linted.

To bring one back, copy it with `shared.js` into `src/components/awardLooks/`
(their imports expect that folder), then render it in `SeasonAwards`' place in
`src/pages/HallOfFame.jsx`: `<LookGala seasons={awardSeasons} />`. It takes the
same `seasons` list as `SeasonAwardCards`. `shared.js` here is the same as
`src/components/seasonAwardWinner.js`.
