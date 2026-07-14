// Per-season hero photo. Three levels, most specific wins:
//   1. season.heroImageUrl — admin-uploaded (Seasons tab), works with no
//      file-system access (e.g. Railway).
//   2. public/heroes/s<number>.jpg — drop-a-file convention for anyone who DOES
//      have file access; still works, untouched by the upload feature.
//   3. the shared /hero.jpg.
export const DEFAULT_HERO = "/hero.jpg";

export function heroFor(season) {
  if (season?.heroImageUrl) return season.heroImageUrl;
  return season?.number ? `/heroes/s${season.number}.jpg` : DEFAULT_HERO;
}

// Per-season car image (an Assetto Corsa showroom shot of the season's mod on
// a black background) at public/cars/s<number>.jpg. Same drop-a-file
// convention as the hero photos; seasons without one show no car.
export function carFor(season) {
  return season?.number ? `/cars/s${season.number}.jpg` : null;
}

// Per-season interactive 3D model at public/cars/s<number>.glb (converted
// from the real Assetto Corsa car via tools/kn5-to-glb). Same drop-a-file
// convention: a season with a GLB gets the rotatable car, one with only the
// JPG gets the flat shot, neither shows the coming-soon placeholder.
export function carModelFor(season) {
  return season?.number ? `/cars/s${season.number}.glb` : null;
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
