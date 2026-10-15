# Test pages

Pages to try out on the live site before they are finished. Nothing on the
site links here, and each page asks search engines not to list it.

- `wrapped/`: a Season 8 Wrapped story (sample driver, Brawn GP films), at
  `/test/wrapped/index.html`. A ready-built copy, not built from `src/`.
  It takes four parts from v2 through `app/addons.js` (built from
  `frontend/labs/wrapped-v1-addons/`): the ribbons on the intro (behind the
  car) and the summary, v2's block wall as the second slide, and v2's
  climb slide without its chevrons.
- `wrapped-v2/`: Season Wrapped reworked, with a 3D scene to play with on
  every slide, at `/test/wrapped-v2/index.html`. Built from
  `frontend/labs/wrapped-v2/` (`npx vite build --config
  labs/wrapped-v2/vite.config.js` in `frontend/`). It plays the films in
  `wrapped/`, so it needs that folder.

To remove them, delete this folder (and `frontend/labs/wrapped-v2/` and
`frontend/labs/wrapped-v1-addons/`).
