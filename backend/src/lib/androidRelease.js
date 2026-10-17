// ---------------------------------------------------------------------------
// The Android app as a download (the APK), outside the Play Store.
//
// The app's version is android/release.json. The app is built from it (the
// Gradle build reads it), the release workflow (.github/workflows/android.yml)
// publishes the APK as a GitHub release named after it, and this file reads it
// to tell an app on a phone whether there is a newer one. The site and the APK
// come out of the same merge to main, so they agree; the release follows the
// deploy by the few minutes the build takes.
//
// The APK itself is served by GitHub, not by this server: the repository is
// public, its releases are free to download, and the file never has to be
// copied onto the server. /android.apk is the short address to hand out.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_FILE = join(dirname(fileURLToPath(import.meta.url)), "../../../android/release.json");

// Where the workflow puts it. "latest" is GitHub's own pointer to the newest
// release; the APK releases are the only releases this repository makes.
export const APK_URL =
  process.env.ANDROID_APK_URL || "https://github.com/malteclaassen-create/nabs-racing/releases/latest/download/nabs-racing.apk";

// { versionCode, versionName } from the file's text, or null when it is not a
// version (a missing or broken file must not take a page down).
export function parseRelease(text) {
  try {
    const j = JSON.parse(text);
    const versionCode = Number(j?.versionCode);
    const versionName = typeof j?.versionName === "string" ? j.versionName.trim() : "";
    if (!Number.isInteger(versionCode) || versionCode < 1 || !versionName) return null;
    return { versionCode, versionName };
  } catch {
    return null;
  }
}

let cached;

// The file only changes with a deploy, so it is read once.
export function androidRelease() {
  if (cached === undefined) {
    try {
      cached = parseRelease(readFileSync(RELEASE_FILE, "utf8"));
    } catch {
      cached = null;
    }
  }
  return cached ? { ...cached, url: APK_URL } : null;
}
