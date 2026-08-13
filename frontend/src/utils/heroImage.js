// The hero photo of the main card. Four levels, most specific wins:
//   0. race.heroImageUrl — the photo uploaded for the ROUND the card is about
//      (admin: Discord & Events → Season races → Edit). The Home hero leads
//      with the latest round, so it can wear a picture of that place; the
//      moment the next round's results are in, the card is about that round
//      and takes its photo, or falls through to the season's.
//   1. season.heroImageUrl — admin-uploaded (Seasons tab), works with no
//      file-system access (e.g. Railway).
//   2. public/heroes/s<number>.jpg — drop-a-file convention for anyone who DOES
//      have file access; still works, untouched by the upload feature. The
//      season number has to be listed in SEASONS_WITH_OWN_HERO below.
//   3. the shared /hero.jpg.
export const DEFAULT_HERO = "/hero.jpg";

// Which seasons really have their own file in public/heroes/. The folder ships
// with s1..s8 as eight byte-identical copies of /hero.jpg, and pointing six
// season cards at six URLs holding the same bytes costs six downloads: the
// browser caches per URL, not per picture. Naming the exceptions here lets
// everyone else share the one URL — same pixels, one download, five cache
// hits. This cannot be sniffed at runtime: asking for a file to find out
// whether it exists is the request we are trying to avoid.
// Dropped a real photo in as s4.jpg? Add 4 (see public/heroes/README.txt).
const SEASONS_WITH_OWN_HERO = new Set([]);

// `race` is the round the card is currently about, where there is one — pass
// nothing for a card that speaks about the season as a whole (the landing page,
// the season-complete hero), which is what everyone did before per-round photos
// existed.
export function heroFor(season, race = null) {
  if (race?.heroImageUrl) return race.heroImageUrl;
  if (season?.heroImageUrl) return season.heroImageUrl;
  // Number(): season numbers arrive as numbers today, but a Set lookup would
  // silently miss a "4" from a hand-written entry. The file name is built from
  // that same normalised value, or a "07" would pass the lookup and then ask
  // for s07.jpg, a file nobody has. (NaN/undefined are never in the Set.)
  const n = Number(season?.number);
  if (SEASONS_WITH_OWN_HERO.has(n)) return `/heroes/s${n}.jpg`;
  return DEFAULT_HERO;
}

// Per-season car image (an Assetto Corsa showroom shot of the season's mod on
// a black background). Admin upload (Season.carImageUrl) wins; else the
// public/cars/s<number>.jpg drop-a-file convention. Seasons with neither show
// no car panel at all (no placeholder — see CarReveal).
export function carFor(season) {
  if (season?.carImageUrl) return season.carImageUrl;
  return season?.number ? `/cars/s${season.number}.jpg` : null;
}

// onError chain for a hero <img>: a missing photo swaps to the default hero;
// if that is missing too, the image hides itself (as before).
//
// A card carrying a ROUND's photo can name the season's as the step in
// between (data-hero-fallback): a round photo that has gone missing from disk
// should land on the season's picture, not skip past it to the league default.
// Each step is tried once — dataset.fellBack keeps a broken chain from looping.
export function heroOnError(e) {
  const img = e.currentTarget;
  const next = img.dataset.heroFallback;
  if (next && !img.dataset.fellBack && !img.src.endsWith(next)) {
    img.dataset.fellBack = "1";
    img.src = next;
    return;
  }
  if (img.dataset.fellBackDefault || img.src.endsWith(DEFAULT_HERO)) {
    img.style.display = "none";
    return;
  }
  img.dataset.fellBackDefault = "1";
  img.src = DEFAULT_HERO;
}
