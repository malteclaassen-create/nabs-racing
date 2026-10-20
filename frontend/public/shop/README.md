# Pictures for the token shop

Drop a picture in here named after the entry it belongs to and the shop uses it
instead of the drawn placeholder. Nothing else to change, no restart needed in a
built site beyond the usual deploy.

    shop/<key>.webp     (or .jpg, or .png — the page tries all three, in that order)

The keys are the ones in `backend/src/lib/tokens.js`:

| file                        | what it illustrates              |
| --------------------------- | -------------------------------- |
| `card_background.webp`      | the card design                  |
| `helmet.webp`               | the custom helmet                |
| `special_livery.webp`       | the special livery               |
| `car_skin.webp`             | the custom team skin             |
| `profile_flair.webp`        | the profile flair                |
| `discord_role.webp`         | the Discord role                 |
| `hall_of_fame.webp`         | the hall of fame entry           |
| `profile_studio.webp`       | the profile studio               |

Shape and size: the tile shows the whole picture rather than cropping it to
fill (`object-contain`), so a cut-out render on a transparent background is the
ideal shape. Keep the longest side around 500 pixels: the biggest the shop ever
draws one is about 200 pixels wide, and seven untouched renders were a ten
megabyte page. WebP (or PNG) rather than JPG, because the transparent background
is what lets the tile show through in both the dark and the light theme; WebP
keeps the transparency at a fraction of PNG's size (quality 85-90 looks the same
at the size the shop draws it).

Anything without a file keeps the drawn placeholder, so a half-filled folder is
a perfectly normal state.
