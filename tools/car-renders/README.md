# The league's car, filmed for Season Wrapped

Season Wrapped plays short films of the car the league actually raced, in
the driver's team livery: the intro, the climb through the field, and the
final table (on the podium, or on the grid). The car is a mod built on
somebody else's model, so the model itself never goes on the site: anything a
browser can draw in 3D, anyone can download. Instead it is rendered here into
videos, and only the videos are committed (`frontend/public/cars/`). No
model, texture or skin file is.

The story plays them in `frontend/src/components/WrappedStory.jsx`
(`CarFilm`); `frontend/src/utils/carFilms.js` picks the season's car and the
driver's livery from `frontend/public/cars/index.json`. A season without films
keeps the story's own 3D scenes.

## What gets rendered

Per livery, 720 x 900 at 24 frames a second, on the colour of the slide it
plays on and fading into it at the edges:

- `intro.mp4` (6.5 s): out of the dark, the camera swinging round the nose.
- `climb.mp4` (8.5 s): at speed, passing three other liveries.
- `podium.mp4` (8 s): on a stage under the lights, confetti in the team's
  colour.
- `grid.mp4` (8 s): from high above the grid down to the car in its slot.
- `still.png` (1080 x 820, clear background): the car from the front three
  quarters, for the share picture and the summary on a computer.

## On a Windows PC with a graphics card

Much the quickest way (minutes; on a processor alone it is hours):
`render-windows.bat`. Double-click it; the first time it checks for Node.js,
Python and ffmpeg (and says where to get whichever is missing), installs what
it needs, asks for the car's folder (the Assetto Corsa one by default), then
renders every livery in `liveries/season-8.json` in a browser window that has
to stay open, and packs the result into `tools/car-renders/nabs-wrapped-films.zip`.
Stopped half way, it carries on where it was when started again.

## Doing it by hand

Needs Python 3 with Pillow and numpy, ffmpeg, and Playwright's Chromium.
`--gpu` draws on the graphics card.

1. Unpack the car's folder from Assetto Corsa (`content/cars/<model>`, with
   `skins/`) somewhere outside the repository.
2. Write the season's livery list, like `liveries/season-8.json`: per livery
   its `key`, its `skin` folder, the team `colour` (lights and glow), the
   `teams` that ran it (team ids), and `drivers` where it is one driver's
   own. A driver's own livery can play its team's films instead: `"of":
   "<team livery key>"`, no skin.
3. Render (a few minutes per film; a stopped run picks up where it was):

   ```
   NODE_PATH=$(npm root -g) node tools/car-renders/render.mjs <car folder> tools/car-renders/liveries/season-8.json <work dir>
   ```

4. Pack into the site:

   ```
   python3 tools/car-renders/pack.py tools/car-renders/liveries/season-8.json <work dir> frontend/public/cars
   ```

`kn5.py` reads the model (`.kn5`), `kn5_to_glb.py` turns it plus one skin into
a GLB for the film page (`video.html`, three.js from `frontend/`).
