// Per-season hero photo. Three levels, most specific wins:
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

export function heroFor(season) {
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

// onError chain for a hero <img>: a missing season photo swaps to the default
// hero; if that is missing too, the image hides itself (as before).
export function heroOnError(e) {
  const img = e.currentTarget;
  if (img.dataset.fellBack || img.src.endsWith(DEFAULT_HERO)) {
    img.style.display = "none";
    return;
  }
  img.dataset.fellBack = "1";
  img.src = DEFAULT_HERO;
}
