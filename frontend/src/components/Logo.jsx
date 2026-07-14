import { useSeries } from "../context/SeriesContext.jsx";

// The original league's slug (see the series backfill in backend's
// ensureAppSchema — it's the fixed, permanent default series id/slug). It
// seeds the SAME logo-dark.png every other series falls back to anyway, so it
// never needs a slug-suffixed file of its own. Comparing the URL slug against
// this constant directly (rather than against the async-loaded series list's
// `active` flag) means the right file is known on the very FIRST render, not
// only once the /api/series fetch resolves — otherwise that one render with
// the wrong guess already fires the failed request the fix is meant to avoid.
const DEFAULT_SERIES_SLUG = "friday-f1";

// NABS logo — uses the real logo images. Two versions swap by theme:
//   logo-light.png (black mark) on light mode, logo-dark.png (pink mark) on dark.
// Any OTHER series can override the DARK-mode mark (e.g. Sunday GT's blue
// one): drop /logo-dark-<slug>.png into frontend/public/ and it's picked up
// automatically, no code change needed — same drop-a-file convention as the
// per-season hero/car images (utils/heroImage.js). A missing override 404s
// once and falls back to the default logo-dark.png; `key` forces a fresh
// <img> per slug so that fallback never gets stuck after switching series
// (see heroOnError there for the same pattern).
// The default league never attempts an override — it just IS logo-dark.png,
// so switching back to it (or loading it directly) is instant: no failed
// request, so no gap where the browser shows the alt text before a fallback
// image lands.
// The `dark` class lives on <html>, so Tailwind's dark: variants do the swap.
// Pass `size` (px) and optional `className`.
export default function Logo({ size = 40, className = "" }) {
  const { slug } = useSeries();
  const darkSrc = !slug || slug === DEFAULT_SERIES_SLUG ? "/logo-dark.png" : `/logo-dark-${slug}.png`;
  return (
    <>
      <img
        src="/logo-light.png"
        width={size}
        height={size}
        alt="NABS Racing"
        className={`block dark:hidden ${className}`}
      />
      <img
        key={darkSrc}
        src={darkSrc}
        width={size}
        height={size}
        alt="NABS Racing"
        className={`hidden dark:block ${className}`}
        onError={(e) => {
          const img = e.currentTarget;
          if (!img.src.endsWith("/logo-dark.png")) img.src = "/logo-dark.png";
        }}
      />
    </>
  );
}
