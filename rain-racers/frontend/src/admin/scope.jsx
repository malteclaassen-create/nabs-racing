import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api.js";

// The series and season the admin is working on, shared by every tab that
// works on one (races, entry list, teams, attendance, ...).
const ScopeContext = createContext(null);

export function AdminScope({ children }) {
  const [series, setSeries] = useState(null);
  const [seriesId, setSeriesId] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null);

  const reloadSeries = useCallback(async () => {
    const list = await api.get("/admin/series");
    setSeries(list);
    setSeriesId((cur) => (list.some((s) => s.id === cur) ? cur : list[0]?.id ?? null));
    return list;
  }, []);

  const reloadSeasons = useCallback(async () => {
    if (!seriesId) {
      setSeasons([]);
      setSeasonId(null);
      return [];
    }
    const list = await api.get(`/admin/seasons?series=${seriesId}`);
    setSeasons(list);
    setSeasonId((cur) => (list.some((s) => s.id === cur) ? cur : (list.find((s) => s.isCurrent) || list[0])?.id ?? null));
    return list;
  }, [seriesId]);

  useEffect(() => {
    reloadSeries();
  }, [reloadSeries]);
  useEffect(() => {
    reloadSeasons();
  }, [reloadSeasons]);

  const value = {
    series: series || [],
    loaded: series !== null,
    seriesId,
    setSeriesId,
    currentSeries: (series || []).find((s) => s.id === seriesId) || null,
    seasons,
    seasonId,
    setSeasonId,
    currentSeason: seasons.find((s) => s.id === seasonId) || null,
    reloadSeries,
    reloadSeasons,
  };
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export const useScope = () => useContext(ScopeContext);
