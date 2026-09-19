import { useEffect, useState } from "react";
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

// Which mark this series used last time, remembered per slug.
//
// On a cold load the series list is a round trip away, so the mark for a series
// with its own logo went: default pink NABS, then nothing while the real file
// downloaded, then the right one. Three pictures in the top-left corner for one
// page view. The slug is known from the address before anything is fetched, so
// the last mark is the right guess, and the load below corrects it if an admin
// has since uploaded another. Same trick as the nav's attendance row.
const REMEMBER_KEY = (slug) => `nabs_logo_dark_${slug || "@primary"}`;

function remembered(slug) {
  try {
    return localStorage.getItem(REMEMBER_KEY(slug)) || null;
  } catch {
    return null; // private mode: one default-mark paint, exactly as before
  }
}

function remember(slug, url) {
  try {
    if (url) localStorage.setItem(REMEMBER_KEY(slug), url);
    else localStorage.removeItem(REMEMBER_KEY(slug));
  } catch {
    /* nothing to do — the mark is right on screen either way */
  }
}

export default function Logo({ size = 40, className = "" }) {
  const { current, slug, loaded } = useSeries();
  // What this series' mark SHOULD be, once the list is in. Until then, whatever
  // it was last time.
  const wanted = loaded ? current?.logoDarkUrl || "/logo-dark.png" : remembered(slug) || "/logo-dark.png";
  // What is on screen. The new mark is only put up once it has actually
  // decoded: pointing an <img> at a file it does not have yet empties it first,
  // which is the blank beat between two series' logos.
  const [shown, setShown] = useState(wanted);

  useEffect(() => {
    if (loaded) remember(slug, current?.logoDarkUrl || null);
  }, [loaded, slug, current?.logoDarkUrl]);

  useEffect(() => {
    if (wanted === shown) return;
    let alive = true;
    const pre = new Image();
    pre.onload = () => alive && setShown(wanted);
    // A remembered file an admin has since deleted, or a broken upload: fall
    // back to the shared mark rather than leaving the old series' one up.
    pre.onerror = () => alive && setShown("/logo-dark.png");
    pre.src = wanted;
    return () => {
      alive = false;
    };
  }, [wanted, shown]);

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
        src={shown}
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
