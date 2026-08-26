// The Android app's identity, and the file that ties it to this domain.
//
// A Trusted Web Activity (the wrapper that puts this site in the Play Store) is
// just Chrome showing the site full screen. Chrome only agrees to hide its
// address bar if the DOMAIN vouches for the app: it fetches
// https://<domain>/.well-known/assetlinks.json and looks for the app's package
// name together with the SHA-256 fingerprint of the key the app was signed
// with. No file, or a fingerprint that does not match, and the app opens with a
// browser bar across the top, looking exactly like the cheap web wrapper it is
// trying not to be.
//
// Both values are decisions made in Play Console, not in this repository, and
// the fingerprint changes if the league ever re-signs the app. So they live in
// the Setting table and are edited in the admin (Site content -> Privacy & app),
// like the privacy contact next to them.
//
// Two fingerprints is the normal state, not an edge case: Play App Signing
// re-signs the upload with Google's own key, so the app on a member's phone
// carries a different fingerprint from the one built locally. Both belong in
// the list or one of the two stops verifying.

export const ANDROID_APP_KEY = "android_app";

export const ANDROID_APP_EMPTY = { packageName: "", fingerprints: [] };

// com.example.thing — letters, digits and underscores in each dot-separated
// part, and at least one dot. Deliberately strict: a typo here fails silently
// on a phone weeks later, which is the worst way to find out.
const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const FINGERPRINT_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

// Accepts what people actually paste: lowercase, spaces, line breaks, and the
// bare 64-character hex form some tools print instead of the colon-separated
// one. Returns the canonical AA:BB:… form, or null if it is not a SHA-256 at
// all.
export function normalizeFingerprint(raw) {
  const s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  if (/^[0-9A-F]{64}$/.test(s)) return s.match(/.{2}/g).join(":");
  return FINGERPRINT_RE.test(s) ? s : null;
}

// Strict, unlike the other blob editors: everything here either verifies or
// quietly does not, so a bad value is worth an error message in the admin
// rather than a save that looks like it worked.
export function sanitizeAndroidApp(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const packageName = String(input.packageName ?? "").trim();
  if (packageName && !PACKAGE_RE.test(packageName)) {
    throw Object.assign(new Error("That is not a package name (expected something like com.nabsracing.app)"), {
      status: 400,
    });
  }
  const raw = Array.isArray(input.fingerprints)
    ? input.fingerprints
    : String(input.fingerprints ?? "").split(/[\n,]/);
  const fingerprints = [];
  for (const line of raw) {
    if (!String(line ?? "").trim()) continue;
    const fp = normalizeFingerprint(line);
    if (!fp) {
      throw Object.assign(
        new Error(`"${String(line).trim().slice(0, 40)}" is not a SHA-256 fingerprint`),
        { status: 400 }
      );
    }
    if (!fingerprints.includes(fp)) fingerprints.push(fp);
  }
  return { packageName, fingerprints: fingerprints.slice(0, 8) };
}

export async function readAndroidApp(prisma) {
  const row = await prisma.setting.findUnique({ where: { key: ANDROID_APP_KEY } });
  if (!row) return { ...ANDROID_APP_EMPTY };
  try {
    return sanitizeAndroidApp(JSON.parse(row.value)) || { ...ANDROID_APP_EMPTY };
  } catch {
    return { ...ANDROID_APP_EMPTY };
  }
}

export async function writeAndroidApp(prisma, info) {
  const clean = sanitizeAndroidApp(info ?? ANDROID_APP_EMPTY) || { ...ANDROID_APP_EMPTY };
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: ANDROID_APP_KEY },
    update: { value },
    create: { key: ANDROID_APP_KEY, value },
  });
  return clean;
}

// The Digital Asset Links document itself. Null while either half is missing:
// a file naming an app with no fingerprints verifies nothing, and publishing an
// empty one would only make it harder to tell "not set up yet" from "set up
// wrong".
export function buildAssetLinks({ packageName, fingerprints }) {
  if (!packageName || !fingerprints?.length) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}
