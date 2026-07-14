import { createContext, useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, setSelectedSeries } from "../api/client.js";
import { deriveSeriesAccent } from "../utils/seriesColor.js";

// Holds the racing SERIES the site is viewing — the level above SeasonContext,
// same pattern one step up. The slug comes from the URL (/s/<slug>/…); pages
// without a prefix (Profile, Admin, Downloads, …) keep the last-viewed series
// so navigating away and back doesn't lose context. Series-scoped API reads
// pick the slug up via the api client, and App remounts the SeasonProvider
// subtree on change so the season list refetches for the new series.
const SeriesCtx = createContext({
  seriesList: [],
  slug: null,
  current: null,
  active: null,
  loaded: false,
  unknownSlug: false,
  setSlug: () => {},
});

export function useSeries() {
  return useContext(SeriesCtx);
}

// Builds series-prefixed page paths: seriesPath("/drivers") -> "/s/<slug>/drivers".
// Falls back to the flat path while no series is known yet — the App's legacy
// redirect then normalises it, so links never break.
export function useSeriesPath() {
  const { slug, active } = useSeries();
  const s = slug || active?.slug || null;
  const seriesPath = (sub = "") => (s ? `/s/${s}${sub}` : sub || "/");
  return { seriesPath, slug: s };
}

// The /s/<slug> prefix of the current URL, or null on unprefixed pages.
export function slugFromPath(pathname) {
  const m = /^\/s\/([^/]+)/.exec(pathname || "");
  return m ? decodeURIComponent(m[1]) : null;
}

export function SeriesProvider({ children }) {
  const location = useLocation();
  const urlSlug = slugFromPath(location.pathname);
  const [seriesList, setSeriesList] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // Sticky selection: the URL wins while a /s/<slug> page is open; on global
  // pages the last pick survives so "Downloads and back" stays in the series.
  const [slug, setSlug] = useState(urlSlug);

  useEffect(() => {
    if (urlSlug && urlSlug !== slug) setSlug(urlSlug);
  }, [urlSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const load = () =>
      api
        .series()
        .then((list) => {
          setSeriesList(list);
          setLoaded(true);
        })
        .catch(() => {
          setSeriesList([]);
          setLoaded(true);
        });
    load();
    // Refetch when auth changes (admin login/logout): private series are in
    // the list only for admins, so the switcher must update without a reload.
    window.addEventListener("nabs-auth", load);
    return () => window.removeEventListener("nabs-auth", load);
  }, []);

  const active = seriesList.find((s) => s.isActive) || seriesList[0] || null;
  const current = (slug && seriesList.find((s) => s.slug === slug)) || null;
  // A slug that survived the list load without matching anything: a typo, a
  // deleted series or a private one without rights. App redirects on this.
  const unknownSlug = loaded && !!slug && !current;

  // Keep the api client in sync synchronously, so reads in children that fire
  // on this same render already carry the right ?series= param. While the
  // list is still loading, trust the URL slug as-is.
  const effective = current?.slug || (!loaded && slug) || (unknownSlug ? active?.slug || null : slug) || null;
  setSelectedSeries(effective);

  // Stamp the slug onto <html> as [data-series="..."], same synchronous spot
  // as setSelectedSeries above (so the very first paint already carries it).
  if (effective) document.documentElement.dataset.series = effective;
  else delete document.documentElement.dataset.series;

  // Apply this series' admin-picked accent colour (Series.accentColor) by
  // setting the --c-*-dynamic custom properties the tokens in index.css fall
  // back from — NOT a CSS rule keyed to the slug (that broke the moment
  // production's real slug differed from the one tested locally). No colour
  // set -> clear the properties, which restores the default pink via the
  // var(..., <default>) fallback.
  const html = document.documentElement.style;
  const derived = deriveSeriesAccent((current || (loaded ? active : null))?.accentColor);
  const apply = (prop, value) => (value ? html.setProperty(prop, value) : html.removeProperty(prop));
  apply("--c-brand-dynamic", derived?.brandRgb);
  apply("--c-eyebrow-light-dynamic", derived?.eyebrowLightTheme);
  apply("--c-accent-light-dynamic", derived?.accentLightThemeRgb);
  apply("--c-eyebrow-dark-dynamic", derived?.eyebrowDarkTheme);
  apply("--c-accent-dark-dynamic", derived?.accentDarkThemeRgb);

  // Mobile address-bar tint: read back whatever --c-brand resolved to (after
  // the properties above), so a new series' colour picks this up automatically
  // without touching this file again.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const rgb = getComputedStyle(document.documentElement).getPropertyValue("--c-brand").trim().split(/\s+/).map(Number);
    if (rgb.length === 3 && rgb.every(Number.isFinite)) {
      meta.content = `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    }
  }

  return (
    <SeriesCtx.Provider
      value={{
        seriesList,
        slug: effective,
        current: current || (loaded ? active : null),
        active,
        loaded,
        unknownSlug,
        // Explicit picker for pages OUTSIDE the /s/<slug> prefix (the admin):
        // on prefixed pages the URL wins on the next navigation anyway.
        setSlug,
      }}
    >
      {children}
    </SeriesCtx.Provider>
  );
}
