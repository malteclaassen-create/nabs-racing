import { useSeries } from "../context/SeriesContext.jsx";

// The NABS Points mark. One image for every size it appears in: the nav bar
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

export default function TokenIcon({ className = "h-4 w-4" }) {
  // The mark takes the colour of the series you are looking at. Keyed on
  // whether that series carries an accent colour of its own, NOT on its slug:
  // a slug written into the code stops matching the moment an admin creates
  // the series with a different one (utils/seriesColor.js learned that the
  // hard way). The primary series has no colour set and keeps the league pink.
  const { current } = useSeries();
  const cyan = !!current?.accentColor;
  return (
    <img
      src={cyan ? "/nabs-star-cyan.webp" : "/nabs-star.webp"}
      alt=""
      aria-hidden="true"
      draggable="false"
      className={`inline-block shrink-0 select-none object-contain ${DEEPEN_IN_LIGHT} ${className}`}
    />
  );
}

