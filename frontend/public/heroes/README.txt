Per-season hero photos
======================

Each season's home + landing hero uses the image named after its season number:

    s1.jpg, s2.jpg, s3.jpg, ...  (s<number>.jpg)

To give a season its own era photo, replace the matching file here — e.g. drop
an F1 1990 shot in as s4.jpg — and add that season number to the list
SEASONS_WITH_OWN_HERO in frontend/src/utils/heroImage.js.

That second step exists for speed: all files below still hold the same default
photo, and a browser caches per address, not per picture. Six season cards
pointing at six addresses download the same photo six times. Seasons that are
not on the list share the single /hero.jpg address instead, which looks exactly
the same and is fetched once. A season on the list gets its own file back.

The easier route, and the one that needs no code at all: Admin -> Seasons ->
Upload hero. That always wins over the files here.

- Recommended size: a wide landscape image, at least 1920x800, JPG.
- If a season file is missing, the site falls back to /public/hero.jpg.
