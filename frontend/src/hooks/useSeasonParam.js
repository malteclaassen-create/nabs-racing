import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useSeason } from "../context/SeasonContext.jsx";

// Consume a `?season=<number>` deep link on a season-scoped page: steer the
// season switcher to it once the season list has loaded, then strip the param
// so a later manual pick isn't overridden. Mirrors the inline logic the Races
// page already uses (Races.jsx) — shared here so standings/constructor links
// from the global search land on the right season too.
export function useSeasonParam() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { season, setSeason } = useSeason();
  const want = searchParams.get("season");
  useEffect(() => {
    if (!want || season == null) return;
    const n = Number(want);
    const next = new URLSearchParams(searchParams);
    next.delete("season");
    setSearchParams(next, { replace: true });
    if (Number.isFinite(n) && n !== season) setSeason(n);
  }, [want, season, setSeason, searchParams, setSearchParams]);
}
