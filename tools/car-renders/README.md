# The league's car, as pictures for Season Wrapped

Season Wrapped's 3D scenes (`frontend/src/utils/wrappedScenes.js`) show the
car the league actually raced, in the driver's team livery. The car is a mod
built on somebody else's model, so the model itself never goes on the site:
anything a browser can draw in 3D, anyone can download. Instead it is rendered
here, from every side the scenes need, into pictures, and the scenes stand the
right picture up where the car is (`frontend/src/utils/carImposter.js`). No
model, texture or skin file is committed; only the rendered pictures under
`frontend/public/cars/`.

A season without pictures keeps the scenes' own 3D car.

## What gets rendered

Per livery:

- `<key>.hero.webp`: 79 frames, 640 x 275, from 24 degrees off the nose round
  the car's left side to 30 degrees past the tail, every 3 degrees, seen from
  12 degrees up. The driver's own car, up close; neighbouring frames are
  faded into each other as it turns.
- a field strip: 16 frames all the way round at 15 and 55 degrees up, 128 x
  128. The rest of the grid, and the driver's car from high up. All the team
  liveries' strips are packed into one `field.webp`.

`frontend/public/cars/index.json` names the car each season raced and, per
livery, the teams (by team id) and the drivers (by name, where a livery is
one driver's own) it belongs to (`frontend/src/utils/carArt.js`).

## Doing it

Needs Python 3 with Pillow and numpy, and Playwright's Chromium.

1. Unpack the car's folder from Assetto Corsa (`content/cars/<model>`, with
   `skins/`) somewhere outside the repository.
2. Write the season's livery list, like `liveries/season-8.json`: a `key` per
   livery, its `skin` folder, the `teams` that ran it, and `drivers` where it
   is one driver's own. A driver's own livery points at its team's with
   `"of": "<team livery key>"`.
3. Render (about two minutes per livery):

   ```
   NODE_PATH=$(npm root -g) node tools/car-renders/render.mjs <car folder> tools/car-renders/liveries/season-8.json <work dir>
   ```

4. Pack into the site:

   ```
   python3 tools/car-renders/pack.py tools/car-renders/liveries/season-8.json <work dir> frontend/public/cars
   ```

`kn5.py` reads the model (`.kn5`), `kn5_to_glb.py` turns it plus one skin into
a GLB for the render page (`render.html`, three.js from `frontend/`).
