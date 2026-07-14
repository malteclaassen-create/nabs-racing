import { useSeries } from "../context/SeriesContext.jsx";

// NABS logo — uses the real logo images. Two versions swap by theme:
//   logo-light.png (black mark) on light mode, logo-dark.png (pink mark) on dark.
// A series can override the DARK-mode mark via an admin upload (Seasons tab ->
// Racing series -> Logo): Series.logoDarkUrl, read straight off the resolved
// series object. null -> the shared default logo-dark.png. Light mode always
// uses logo-light.png — a plain black mark reads fine regardless of a
// series' own colour, so it has no override.
// Deliberately an ADMIN UPLOAD, not a /logo-dark-<slug>.png drop-in file: that
// convention silently failed whenever a series' real slug differed from the
// one a file was named after (the exact same lesson as the accent-colour fix
// in utils/seriesColor.js — see that file's comment for the full story).
// The `dark` class lives on <html>, so Tailwind's dark: variants do the swap.
// Pass `size` (px) and optional `className`.
export default function Logo({ size = 40, className = "" }) {
  const { current } = useSeries();
  const darkSrc = current?.logoDarkUrl || "/logo-dark.png";
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
