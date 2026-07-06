// Per-season hero photo. Each season can have its own era image at
// public/heroes/s<number>.jpg (e.g. an F1 1990 shot for Season 4); seasons
// without one fall back to the shared /hero.jpg. Convention-based, so adding a
// season image is just dropping a file — no code or admin change needed.
export const DEFAULT_HERO = "/hero.jpg";

export function heroFor(season) {
  return season?.number ? `/heroes/s${season.number}.jpg` : DEFAULT_HERO;
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
