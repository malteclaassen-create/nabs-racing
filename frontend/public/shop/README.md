# Pictures for the token shop

Drop a picture in here named after the entry it belongs to and the shop uses it
instead of the drawn placeholder. Nothing else to change, no restart needed in a
built site beyond the usual deploy.

    shop/<key>.jpg      (or .png, or .webp — the page tries all three)

The keys are the ones in `backend/src/lib/tokens.js`:

| file                        | what it illustrates              |
| --------------------------- | -------------------------------- |
| `card_background.jpg`       | the card design                  |
| `helmet.jpg`                | the custom helmet                |
| `profile_flair.jpg`         | the profile flair                |
| `discord_role.jpg`          | the Discord role                 |
| `hall_of_fame.jpg`          | the hall of fame entry           |

Shape and size: the tile shows the whole picture rather than cropping it to
fill (`object-contain`), so a cut-out render on a transparent background is the
ideal shape. Keep the longest side around 500 pixels: the biggest the shop ever
draws one is about 200 pixels wide, and seven untouched renders were a ten
megabyte page. PNG rather than JPG, because the transparent background is what
lets the tile show through in both the dark and the light theme.

Anything without a file keeps the drawn placeholder, so a half-filled folder is
a perfectly normal state.
