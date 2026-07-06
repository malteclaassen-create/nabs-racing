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
    api
      .seasons()
      .then((list) => {
        setSeasons(list);
        setSeason((cur) => {
          if (cur != null) return cur;
          const active = list.find((s) => s.isActive) || list[0];
          return active ? active.number : null;
        });
      })
      .catch(() => setSeasons([]));
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
