// The NABS Tokens mark. One image for every size it appears in: the nav bar
// pill, the price tags in the shop, the balance card. Kept square by the
// className (h-4 w-4 and the like), so the callers did not change.
//
// A new file name rather than a new file under the old one: everything in
// public/ is served at its own path with no hash on it, so re-using the name
// would have left the old coin in people's browser caches for days.

// The file is the pale league pink, drawn against the dark theme. On a light
// card it is already faint, and on any pink-tinted surface (the nav bar pill's
// own brand/10, the profile nav's active row) it all but disappears — around
// 1.3:1 before this. Light mode therefore deepens it to roughly the rose the
// theme-aware --c-eyebrow already uses for text, and dark mode gets the file
// untouched.
//
// A filter rather than a second asset: it works for BOTH marks, so a series
// that turns the star cyan gets the same treatment without shipping a third
// file. Every caller today puts the mark on a surface that follows the theme;
// one that ever needs it on a dark chip in light mode should turn this off
// rather than fight it.
const DEEPEN_IN_LIGHT = "brightness-[0.72] saturate-[1.6] dark:brightness-100 dark:saturate-100";

// The mark takes the colour of the series you are looking at: the star's shape
// as a mask over the series' brand colour (--c-brand, which SeriesProvider sets
// from Series.accentColor and which is the league pink without one). The file
// is one flat colour, so nothing of it is lost. It used to swap between a pink
// and a cyan file, which left every other series colour with a cyan coin.
const MASK = "url(/nabs-star.webp) center / contain no-repeat";

export default function TokenIcon({ className = "h-4 w-4" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 select-none bg-brand ${DEEPEN_IN_LIGHT} ${className}`}
      style={{ WebkitMask: MASK, mask: MASK }}
    />
  );
}
