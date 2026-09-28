import { useEffect, useState } from "react";
import { CHANGELOG_LATEST } from "../data/changelog.js";

// Whether this browser has opened /changelog since its newest entry went up.
// Kept in this browser like the other settings: it only drives a small "New"
// mark, and a phone and a laptop each deserve to be told once.
const KEY = "nabs_changelog_seen";

function read() {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

let seen = read();
const listeners = new Set();

export function markChangelogSeen() {
  if (seen === CHANGELOG_LATEST) return;
  seen = CHANGELOG_LATEST;
  try {
    localStorage.setItem(KEY, seen);
  } catch {
    // Private mode: the mark just comes back next visit.
  }
  listeners.forEach((notify) => notify(seen));
}

export function useChangelogUnseen() {
  const [value, setValue] = useState(seen);
  useEffect(() => {
    setValue(seen);
    listeners.add(setValue);
    return () => listeners.delete(setValue);
  }, []);
  // Dates as YYYY-MM-DD compare correctly as strings.
  return !!CHANGELOG_LATEST && value < CHANGELOG_LATEST;
}
