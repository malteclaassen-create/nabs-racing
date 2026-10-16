// Stand-in for src/api/client.js (swapped in by vite.config.mjs, resolve.alias).
// Answers the calls the recap page and the series context make from the mock
// data; anything else rejects, which the page treats like a failed request.
import { recap, laps, SERIES } from "./mockData.js";

const later = (value, ms = 0) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

const handlers = {
  series: () => later(SERIES),
  // The page normally gets the recap handed over in the location state; these
  // are the fallbacks it uses when it is opened without one.
  myRaceRecapFor: () => later({ recap }),
  adminRaceRecapPreview: () => later({ recap }),
  markRaceRecapSeen: () => later({ ok: true }),
  // The lap chart lands a beat after the page, as it does on the live site.
  raceLaps: (id) => later(laps[id] || { available: false, maxLap: 0, drivers: [] }, 250),
  hit: () => later(null),
};

export const api = new Proxy(handlers, {
  get(target, key) {
    if (key in target) return target[key];
    return () => Promise.reject(new Error(`Not available in this preview (${String(key)})`));
  },
});

let selected = null;
let primary = null;
export function setSelectedSeries(slug) {
  selected = slug || null;
}
export function getSelectedSeries() {
  return selected;
}
export function setPrimarySeries(slug) {
  primary = slug || null;
}
export function getPrimarySeries() {
  return primary;
}
export function getToken() {
  return null;
}
export function setToken() {}
export function myDiscordId() {
  return null;
}
export function withApiBase(path) {
  return path;
}
export function peekCached() {
  return undefined;
}
