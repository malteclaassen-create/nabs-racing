import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { api } from "./api.js";
import { hexToRgb } from "./format.js";

// What every page needs: the league's settings, who is signed in, the series
// with their seasons, which series is being looked at (from the address, else
// the last one looked at) and which season of it.
const SiteContext = createContext(null);
const LAST_SERIES = "rr.series";

const readLast = () => {
  try {
    return localStorage.getItem(LAST_SERIES);
  } catch {
    return null;
  }
};

export function SiteProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [me, setMe] = useState({ user: null, isAdmin: false, discordEnabled: false });
  const [seriesList, setSeriesList] = useState([]);
  const [seasonBySeries, setSeasonBySeries] = useState({}); // slug -> season id
  const location = useLocation();

  const reload = useCallback(async () => {
    const [s, m, list] = await Promise.all([api.get("/settings"), api.get("/me"), api.get("/series")]);
    setSettings(s);
    setMe(m);
    setSeriesList(list);
  }, []);

  useEffect(() => {
    reload().catch(() => setSettings((s) => s || { leagueName: "Rain Racers", pointsTable: [] }));
  }, [reload]);

  const routeSlug = matchPath("/series/:slug/*", location.pathname)?.params.slug || matchPath("/series/:slug", location.pathname)?.params.slug;
  const series = useMemo(() => {
    const wanted = routeSlug || readLast();
    return seriesList.find((s) => s.slug === wanted) || seriesList.find((s) => !s.archived) || seriesList[0] || null;
  }, [seriesList, routeSlug]);

  // A link may name the season (?season=<id>, e.g. from the history).
  const urlSeason = Number(new URLSearchParams(location.search).get("season")) || null;
  useEffect(() => {
    if (routeSlug && urlSeason) setSeasonBySeries((m) => ({ ...m, [routeSlug]: urlSeason }));
  }, [routeSlug, urlSeason]);

  useEffect(() => {
    if (!routeSlug || !series) return;
    try {
      localStorage.setItem(LAST_SERIES, series.slug);
    } catch {
      // private mode: fine, the address still carries the series
    }
  }, [routeSlug, series]);

  const seasonId = series ? seasonBySeries[series.slug] ?? series.currentSeason?.id ?? null : null;
  const setSeasonId = useCallback(
    (sid) => series && setSeasonBySeries((m) => ({ ...m, [series.slug]: sid })),
    [series],
  );

  // The league colour, or the series colour on a series' own pages.
  const accent = (routeSlug && series?.color) || settings?.accentColor;
  useEffect(() => {
    const rgb = hexToRgb(accent);
    if (!rgb) return;
    const root = document.documentElement.style;
    root.setProperty("--accent", rgb);
    // black text on a light colour, white on a dark one
    const [r, g, b] = rgb.split(" ").map(Number);
    root.setProperty("--accent-ink", 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "0 0 0" : "255 255 255");
  }, [accent]);

  // "?series=rx8-cup&season=3" for the API calls of the series pages.
  const scope = series ? `?series=${encodeURIComponent(series.slug)}${seasonId ? `&season=${seasonId}` : ""}` : "";
  const seriesPath = (sub = "") => (series ? `/series/${series.slug}${sub}` : "/");

  return (
    <SiteContext.Provider value={{ settings, me, reload, seriesList, series, seasonId, setSeasonId, scope, seriesPath }}>
      {children}
    </SiteContext.Provider>
  );
}

export const useSite = () => useContext(SiteContext);

// Fetches `url` whenever it changes; { data, error, loading, reload }.
export function useApi(url) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api
      .get(url)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
  }, [url, n]);
  return { ...state, reload: () => setN((x) => x + 1) };
}
