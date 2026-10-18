import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "./useAuth.js";

// Has the signed-in member signed up for this special event's race? The nav
// names the entry list after it: "Sign up" until they have, "Attendance" once
// they are in (or waiting, or tentative). A decline counts as not in.
//
// Asked again whenever an answer changes (the attendance page fires
// RSVP_CHANGED), so the label turns over the moment somebody signs up instead
// of on the next page load.
export const RSVP_CHANGED = "nabs:rsvp-changed";

export function announceRsvpChanged() {
  try {
    window.dispatchEvent(new Event(RSVP_CHANGED));
  } catch {
    /* no window (tests) */
  }
}

export function useMyEventEntry(raceId) {
  const { isLoggedIn } = useAuth();
  const [signedUp, setSignedUp] = useState(false);
  useEffect(() => {
    if (!raceId || !isLoggedIn) {
      setSignedUp(false);
      return undefined;
    }
    let alive = true;
    const ask = () =>
      api
        .myCar(raceId)
        .then((r) => alive && setSignedUp(["ACCEPTED", "TENTATIVE", "WAITLIST"].includes(r?.status)))
        .catch(() => {});
    ask();
    window.addEventListener(RSVP_CHANGED, ask);
    return () => {
      alive = false;
      window.removeEventListener(RSVP_CHANGED, ask);
    };
  }, [raceId, isLoggedIn]);
  return signedUp;
}
