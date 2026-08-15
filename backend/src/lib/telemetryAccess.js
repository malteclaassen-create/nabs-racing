// ---------------------------------------------------------------------------
// Who may READ a recorded lap.
//
// Two separate switches, and keeping them separate is the point:
//
//   telemetry_ingest_key   is the feature ON — the app downloads itself, the
//                          cars record, laps arrive. Minting it is a decision
//                          about the race server.
//   telemetry_public       may EVERYONE look at what arrived. Nothing to do
//                          with recording; purely about who reads.
//
// The league switches recording on first and looks at the laps from the
// stewards' desk. When the comparison has proved itself, the second switch
// opens the same view to the members' side, and no code moves — a page that
// was hidden becomes a page that is shown.
//
// The default is admin-only, and deliberately so: a lap is a driver's inputs,
// and a feature that arrives public by default has made a decision on the
// league's behalf that the league should make itself.
// ---------------------------------------------------------------------------
import { requireAdmin } from "../middleware/auth.js";

export const TELEMETRY_PUBLIC_KEY = "telemetry_public";

// Read often (every list request on the members' page once it is open), changed
// about twice in the lifetime of the feature. Thirty seconds is the same bargain
// the steward list makes: a flip takes hold on the next page, not the next
// request, and nobody notices either way.
const CACHE_MS = 30_000;
let cache = { at: 0, value: null };

export function invalidateTelemetryVisibility() {
  cache = { at: 0, value: null };
}

export async function isTelemetryPublic(prisma) {
  const now = Date.now();
  if (cache.value !== null && now - cache.at < CACHE_MS) return cache.value;
  let on = false;
  try {
    const row = await prisma.setting.findUnique({ where: { key: TELEMETRY_PUBLIC_KEY } });
    on = String(row?.value || "") === "1";
  } catch {
    // A database that cannot answer is not permission to show it to everyone.
    on = false;
  }
  cache = { at: now, value: on };
  return on;
}

export async function setTelemetryPublic(prisma, on) {
  const value = on ? "1" : "";
  await prisma.setting.upsert({
    where: { key: TELEMETRY_PUBLIC_KEY },
    create: { key: TELEMETRY_PUBLIC_KEY, value },
    update: { value },
  });
  invalidateTelemetryVisibility();
  return !!on;
}

// The gate on the read endpoints: everybody when the league has opened it,
// admins only until then.
//
// Note which way round the fallback runs. Public lets the request through
// without asking who is asking; otherwise it is requireAdmin, unchanged and
// with its own 401. There is no third state where a signed-in member gets in —
// "the league" and "the stewards" are the only two answers this question has.
export function telemetryReadGate(prisma) {
  return async function gate(req, res, next) {
    if (await isTelemetryPublic(prisma)) return next();
    return requireAdmin(req, res, next);
  };
}
