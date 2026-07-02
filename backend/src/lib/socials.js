// Per-driver social links. Stored on Driver.socials as a JSON string keyed by
// platform; read everywhere as a clean { platform: url } object. Kept in one
// place so the self-service editor (me.js) and the public profile
// (driverProfileService.js) agree on the platforms and validation rules.

// Platforms a driver can link, in display order. Discord is intentionally
// excluded — it's the login identity, not a public link.
export const SOCIAL_KEYS = ["twitch", "youtube", "instagram", "tiktok", "x"];

// Parse the stored JSON blob into a clean { platform: url } object (or {}).
// Anything malformed, unknown, or non-string is dropped — never throws.
export function parseSocials(raw) {
  if (!raw) return {};
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const k of SOCIAL_KEYS) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

// Validate a { platform: url } object coming from the editor and return the
// JSON string to persist (or null when nothing valid remains). Throws an Error
// with a user-facing message on bad input.
export function serializeSocials(input) {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("socials must be an object of platform → URL");
  }
  const out = {};
  for (const k of SOCIAL_KEYS) {
    let v = input[k];
    if (v == null) continue;
    v = String(v).trim();
    if (!v) continue;
    if (v.length > 200) throw new Error("Each link must be 200 characters or fewer");
    if (!/^https?:\/\/.+/i.test(v)) {
      throw new Error(`The ${k} link must be a full URL starting with http(s)://`);
    }
    out[k] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}
