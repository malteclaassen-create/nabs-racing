import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "./useApi.js";
import { eventPhase, eventRace } from "../utils/eventPhase.js";

// The race a special event is about and where it stands (utils/eventPhase.js),
// for the event's home page and its nav bar. Re-checked every 30 seconds, so a
// page left open on race night turns live at lights out on its own, and the
// races are fetched again when the phase moves (the result landing is what
// turns "pending" into "after"). `enabled` false (a championship) asks for
// nothing.
export function useEventRace(enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [enabled]);

  const races = useApi(useCallback(() => (enabled ? api.races() : Promise.resolve(null)), [enabled]));
  const race = enabled ? eventRace(races.data, now) : null;
  const phase = enabled ? eventPhase(race, now) : "none";

  // While the result is awaited, look again every few minutes.
  const { reload } = races;
  useEffect(() => {
    if (phase !== "pending" && phase !== "live") return undefined;
    const id = setInterval(reload, 3 * 60_000);
    return () => clearInterval(id);
  }, [phase, reload]);

  return { race, phase, loading: enabled && races.loading && !races.data };
}
