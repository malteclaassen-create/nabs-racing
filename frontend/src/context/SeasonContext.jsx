import { createContext, useContext, useEffect, useState } from "react";
import { api, setSelectedSeason } from "../api/client.js";

// Holds the season the public site is viewing. Defaults to the active season;
// the NavBar switcher changes it. Season-scoped API reads pick it up via the
// api client, and App remounts the page subtree on change so data refetches.
const SeasonCtx = createContext({ seasons: [], season: null, setSeason: () => {}, current: null, active: null });

export function useSeason() {
  return useContext(SeasonCtx);
}

export function SeasonProvider({ children }) {
  const [seasons, setSeasons] = useState([]);
  const [season, setSeason] = useState(null); // selected round number (null until loaded)

  useEffect(() => {
    const load = () =>
      api
        .seasons()
        .then((list) => {
          setSeasons(list);
          setSeason((cur) => {
            // Keep the current pick only while it's still in the list: an admin
            // who logs out while viewing a PRIVATE season loses access to it,
            // so snap back to the active season instead of an empty site.
            if (cur != null && list.some((s) => s.number === cur)) return cur;
            const active = list.find((s) => s.isActive) || list[0];
            return active ? active.number : null;
          });
        })
        .catch(() => setSeasons([]));
    load();
    // Refetch when auth changes (admin login/logout, Discord login): the list
    // includes private seasons only for admins, so the admin switcher must
    // update without a manual reload.
    window.addEventListener("nabs-auth", load);
    return () => window.removeEventListener("nabs-auth", load);
  }, []);

  // Keep the api client in sync synchronously, so reads in children that fire
  // on this same render already use the selected season.
  setSelectedSeason(season);

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
