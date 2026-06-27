import { useEffect, useState } from "react";
import { raceTarget } from "../utils/raceTime.js";

// Ticking countdown to a race kickoff. Returns null until there's a valid date,
// otherwise the corrected target plus a live flag and the d/h/m/s breakdown.
// Shared by the nav-bar chip and the home "Next Race" card so the kickoff logic
// lives in exactly one place.
export function useRaceCountdown(date) {
  const target = raceTarget(date);
  const targetTime = target ? target.getTime() : null;

  const [remaining, setRemaining] = useState(() => (targetTime ? targetTime - Date.now() : 0));

  useEffect(() => {
    if (targetTime == null) return;
    setRemaining(targetTime - Date.now());
    const id = setInterval(() => setRemaining(targetTime - Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetTime]);

  if (targetTime == null) return null;

  const live = remaining <= 0;
  const total = Math.max(0, Math.floor(remaining / 1000));
  return {
    target,
    live,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    mins: Math.floor((total % 3600) / 60),
    secs: total % 60,
  };
}
