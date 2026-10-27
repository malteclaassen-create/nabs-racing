import { useSyncExternalStore } from "react";
import { circuitFor, trackKey } from "./circuits.js";

// ---------------------------------------------------------------------------
// Outlines an admin uploaded (Admin > Tracks > Outline) for the circuits the
// site has no outline of its own for: a line drawing on a transparent
// background, by track key (backend lib/trackInfo.js). App.jsx loads them once
// at boot (GET /api/tracks/outlines); CircuitMap draws one wherever it would
// otherwise draw nothing. A store with subscribers rather than a plain map, so
// a card that rendered before the answer arrived picks the outline up after.
// ---------------------------------------------------------------------------
let OUTLINES = {};
const listeners = new Set();

export function setTrackOutlines(map) {
  OUTLINES = map && typeof map === "object" ? map : {};
  for (const fn of listeners) fn();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const snapshot = () => OUTLINES;

// Every uploaded outline as loaded, { <trackKey>: url }.
export function uploadedOutlines() {
  return OUTLINES;
}

// The uploaded outline of a track, or null.
export function uploadedOutlineFor(track) {
  return (track && OUTLINES[trackKey(track)]) || null;
}

// Whether the site can draw this track: a built-in outline or an uploaded one.
export function hasOutline(track) {
  return !!circuitFor(track) || !!uploadedOutlineFor(track);
}

// Re-renders the caller once the uploaded outlines are in.
export function useTrackOutlines() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
