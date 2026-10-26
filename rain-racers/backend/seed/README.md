# The league's history

`rain-racers-history.json` is loaded into an empty database on the first start
and from the admin (Settings → Load the Rain Racers history). See
`src/lib/history.js`.

Where it comes from (collected on 26 October 2026):

- **Grid Finder** (<https://www.gridfinder.com/c/rain-racers-2>): Formula
  International Series 2, Sahara Saturdays and the Rain Racers RX8 Cup with
  their rounds, start times, sessions, points tables, dropped rounds and the
  league's own posters (`images/`, scaled to 1600 px).
- **YouTube** (<https://www.youtube.com/@rainracers>): the series playlists
  and stream recordings for the seasons Grid Finder does not list (FIS 1, DTM
  2002, Japanese Summer, GT4 World Series, Vacation Tour, Fictional F3,
  Ultimate Touring Challenge, Protosprint). A round's date is the series'
  race evening before the recording went up; names, tracks and cars are the
  ones in the titles and on the thumbnails. Rounds without a recording are
  only in when a poster names them (DTM 2002 round 9, Lausitzring).

Not in it: results (Grid Finder does not show them publicly) and the
broadcasts the channel did for other communities. The RX8 Cup's first three
rounds have Grid Finder placeholder times; they are set to the usual Sunday
evening the streams show.

| Image | Used for |
| --- | --- |
| `fis-2.jpg` | FIS season 2 banner |
| `fis-2-r5.jpg`, `fis-2-r6.jpg` | FIS 2 rounds 5 and 6 |
| `sahara.jpg` | Sahara Saturdays banner |
| `sahara-r1.jpg` … `sahara-r4.jpg` | Sahara Saturdays rounds 1 to 4 |
| `rx8.jpg` | RX8 Cup banner |
| `rx8-r4.jpg`, `rx8-r5.jpg`, `rx8-r7.jpg` | RX8 Cup rounds 4, 5 and 7 |
