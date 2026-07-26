// What counts as a personal Steam account id (SteamID64).
//
// 17 digits alone is not enough: a Discord user id is a 17 to 19 digit number
// too, and pasting one into the Steam field is the mistake this is here to
// catch. Steam's individual accounts live in a fixed band, so the check is
// exact. Mirrors isIndividualSteamId in backend/src/routes/steamAuth.js, which
// is the one that actually guards the save; this copy exists so the warning
// appears while typing rather than after a rejected round trip.
const MIN = 76561197960265728n;
const MAX = 76561202255233024n;

export function isSteamId64(value) {
  const v = String(value || "").trim();
  if (!/^\d{17}$/.test(v)) return false;
  const n = BigInt(v);
  return n >= MIN && n < MAX;
}
