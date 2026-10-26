import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api.js";
import { hexToRgb } from "./format.js";

// What every page needs: the league's settings, who is signed in, the seasons
// and which one is being looked at.
const SiteContext = createContext(null);

export function SiteProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [me, setMe] = useState({ user: null, isAdmin: false, discordEnabled: false });
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null); // null = the current season

  const reload = useCallback(async () => {
    const [s, m, list] = await Promise.all([api.get("/settings"), api.get("/me"), api.get("/seasons")]);
    setSettings(s);
    setMe(m);
    setSeasons(list);
  }, []);

  useEffect(() => {
    reload().catch(() => setSettings((s) => s || { leagueName: "Rain Racers", pointsTable: [] }));
  }, [reload]);

  useEffect(() => {
    const rgb = hexToRgb(settings?.accentColor);
    if (!rgb) return;
    const root = document.documentElement.style;
    root.setProperty("--accent", rgb);
    // black text on a light league colour, white on a dark one
    const [r, g, b] = rgb.split(" ").map(Number);
    root.setProperty("--accent-ink", 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "0 0 0" : "255 255 255");
  }, [settings?.accentColor]);

  return (
    <SiteContext.Provider value={{ settings, me, seasons, seasonId, setSeasonId, reload }}>
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
