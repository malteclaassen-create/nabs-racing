import { useEffect, useState } from "react";
import { normalizeProfileHome, profileHomePath } from "./profileHome.mjs";

// "Where does my own picture in the nav bar take me" — My Profile (the
// default) or my public driver page. Set on /settings; see profileHome.mjs for
// what the two choices mean and why the default changed.
//
// Same shape as useTheme/useGraphics: one module-level value with a listener
// set, so the nav chip, the settings page and the public page all move together
// the moment the choice changes, without a reload.
const KEY = "nabs_profile_home";

let current = normalizeProfileHome(localStorage.getItem(KEY));
const listeners = new Set();

// For the parts of the app that are not components — the tour builder reads it
// to know which door it is about to walk the reader through.
export function getProfileHome() {
  return current;
}

export function setProfileHome(mode) {
  current = normalizeProfileHome(mode);
  localStorage.setItem(KEY, current);
  listeners.forEach((notify) => notify(current));
}

export function useProfileHome() {
  const [mode, setLocal] = useState(current);

  useEffect(() => {
    // Re-sync in case the shared value changed between render and mount.
    setLocal(current);
    listeners.add(setLocal);
    return () => listeners.delete(setLocal);
  }, []);

  return {
    mode,
    setMode: setProfileHome,
    // `pathFor(driverId)`: the address the chip should carry for this login.
    pathFor: (driverId) => profileHomePath(mode, driverId),
  };
}
