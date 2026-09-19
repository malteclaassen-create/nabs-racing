import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, setSelectedSeason } from "../api/client.js";
import { useSeries } from "./SeriesContext.jsx";

// Holds the season the public site is viewing. Defaults to the active season;
// the NavBar switcher changes it. Season-scoped API reads pick it up via the
// api client, and App remounts the page subtree on change so data refetches.
//
// The list is kept PER SERIES, and the provider follows the series itself
// rather than being thrown away and rebuilt on every switch. It used to be
// remounted by a `key` in App, which meant the season was unknown again for
// one round trip after every switch — and since the whole site chrome sits
// inside here, the nav bar was rebuilt with it: the logo fell back to the
// default mark before the series' own one loaded, and the points pill blinked
// out and back in, resizing the bar twice. Switching back to a series you have
// already looked at now needs no request at all.
const SeasonCtx = createContext({ seasons: [], season: null, setSeason: () => {}, current: null, active: null });

export function useSeason() {
  return useContext(SeasonCtx);
}

export function SeasonProvider({ children }) {
  const { slug } = useSeries();
  const key = slug || "@primary"; // no /s/<slug> in the address = the primary series
  // slug -> the season list, and slug -> the round number being viewed. Two
  // maps rather than two plain values, because both belong to a series.
  const [lists, setLists] = useState({});
  const [picks, setPicks] = useState({});

  const seasons = lists[key] || [];
  const season = picks[key] ?? null; // null until the list for this series is in

  useEffect(() => {
    let alive = true;
    const load = (retry = true) =>
      api
        .seasons()
        .then((list) => {
          if (!alive) return;
          setLists((m) => ({ ...m, [key]: list }));
          setPicks((m) => {
            const cur = m[key];
            // Keep the current pick only while it's still in the list: an admin
            // who logs out while viewing a PRIVATE season loses access to it,
            // so snap back to the active season instead of an empty site.
            if (cur != null && list.some((s) => s.number === cur)) return m;
            const active = list.find((s) => s.isActive) || list[0];
            return { ...m, [key]: active ? active.number : null };
          });
        })
        .catch(() => {
          if (!alive) return;
          // A cold server (right after a deploy) can refuse the first read
          // while its boot-time schema upkeep holds the database; one more
          // try a moment later is what a refresh would have done by hand.
          if (retry) setTimeout(() => load(false), 1500);
          else setLists((m) => ({ ...m, [key]: [] }));
        });
    load();
    // Refetch when auth changes (admin login/logout, Discord login): the list
    // includes private seasons only for admins, so the admin switcher must
    // update without a manual reload. The series on screen keeps its list until
    // the new one lands (no blank season name for a round trip); the others are
    // dropped so they are asked for again rather than answering from what an
    // admin was allowed to see a moment ago.
    const reload = () => {
      setLists((m) => (m[key] ? { [key]: m[key] } : {}));
      load();
    };
    window.addEventListener("nabs-auth", reload);
    return () => {
      alive = false;
      window.removeEventListener("nabs-auth", reload);
    };
  }, [key]);

  // Keep the api client in sync synchronously, so reads in children that fire
  // on this same render already use the selected season.
  setSelectedSeason(season);

  const setSeason = useCallback((n) => setPicks((m) => ({ ...m, [key]: n })), [key]);

  const current = seasons.find((s) => s.number === season) || null;
  // The running season, independent of what the switcher is viewing. The
  // newcomer/Welcome page always speaks about this one.
  const active = seasons.find((s) => s.isActive) || null;

  return (
    <SeasonCtx.Provider value={{ seasons, season, setSeason, current, active }}>
      {children}
    </SeasonCtx.Provider>
  );
}
