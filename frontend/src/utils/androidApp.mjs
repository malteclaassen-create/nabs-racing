// The Android app opens the site with ?app=android&appv=<its version>, on start
// and from its widgets (android/, WidgetSpec.kt). These helpers read that mark
// and decide whether the app on the phone is behind the newest APK, which the
// server names at /api/app/android (backend/src/lib/androidRelease.js).

// { version, rest }: the app's version from the address (null when the visit
// is not from the app), and the query string without the two marks, so they
// can be taken out of the address bar's history.
export function readAppMark(search) {
  const q = new URLSearchParams(search || "");
  if (q.get("app") !== "android") return { version: null, rest: null };
  const v = Number(q.get("appv"));
  q.delete("app");
  q.delete("appv");
  const rest = q.toString();
  return { version: Number.isInteger(v) && v > 0 ? v : null, rest: rest ? `?${rest}` : "" };
}

// Is there a newer app than this one? Only when both numbers are known.
export function appIsBehind(version, latest) {
  return Number.isInteger(version) && Number.isInteger(latest?.versionCode) && latest.versionCode > version;
}
