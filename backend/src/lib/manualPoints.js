// ---------------------------------------------------------------------------
// MANUAL POINTS — the admin's hand on a driver's season total.
//
// Some leagues pay points the site cannot compute from a classification: the
// Indycar season's bonus points (pole award, leading a lap, most laps led),
// a stewards' deduction, or an old sheet whose totals simply are what they
// are. Rather than model every such rule, each driver row carries two
// optional numbers, edited per season in the admin Seasons tab:
//
//   pointsAdjust    added to the computed season total. Negative is allowed
//                   (a points penalty). The race results, the drop rule and
//                   every per-round cell stay exactly as they were, so the
//                   bonus keeps working as new rounds come in.
//   pointsOverride  the total, full stop. Wins over the computation AND over
//                   the adjustment — for a season whose figures are typed in
//                   from a sheet.
//
// Both are per DRIVER ROW, which is per season (a driver has one row per
// season), and both only touch the DRIVER standings: constructor points stay
// traced to the rounds their drivers scored them in, because a season-level
// bonus cannot be attributed to a round.
//
// Like hideFromStandings / role / steamId, the columns live outside the
// generated Prisma client (ensureAppSchema, raw SQL — the running dev server
// holds the client lock on Windows), so every read and write goes through
// here. Mirrored by migration driver_manual_points for production.
// ---------------------------------------------------------------------------

// How far the two fields may go. An adjustment is a bonus or a penalty, so it
// has a sign; a total never has one.
export const MAX_POINTS_ADJUST = 1000;
export const MAX_POINTS_OVERRIDE = 100000;

// Map driverId -> { adjust, override } for one season's drivers. Only rows
// that actually carry a value appear, so the common case (nothing set) is an
// empty map and every caller below no-ops. Empty map when the columns don't
// exist yet (fresh checkout before ensureAppSchema).
export async function readManualPoints(prisma, seasonId) {
  if (!seasonId) return new Map();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "pointsAdjust", "pointsOverride" FROM "Driver"
        WHERE "seasonId" = ? AND ("pointsAdjust" IS NOT NULL OR "pointsOverride" IS NOT NULL)`,
      seasonId
    );
    const out = new Map();
    for (const r of rows) {
      const adjust = r.pointsAdjust == null ? 0 : Number(r.pointsAdjust);
      const override = r.pointsOverride == null ? null : Number(r.pointsOverride);
      if (!Number.isFinite(adjust) && override == null) continue;
      out.set(r.id, {
        adjust: Number.isFinite(adjust) ? adjust : 0,
        override: override != null && Number.isFinite(override) ? override : null,
      });
    }
    return out;
  } catch {
    return new Map();
  }
}

// Write one driver row's manual points. `adjust` 0 and `override` null clear
// the respective column (nothing set is the normal state, and a stored 0 would
// read as "a hand-set total of zero" on the next line).
export async function writeManualPoints(prisma, driverId, { adjust, override }) {
  if (adjust !== undefined) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Driver" SET "pointsAdjust" = ? WHERE "id" = ?`,
      adjust ? Number(adjust) : null,
      driverId
    );
  }
  if (override !== undefined) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Driver" SET "pointsOverride" = ? WHERE "id" = ?`,
      override == null ? null : Number(override),
      driverId
    );
  }
}

// Validate one admin-supplied entry. "" / null / undefined mean "clear it";
// anything else must be a whole number inside the bounds above. Returns
// { ok, value: { adjust, override } } or { error }.
export function parseManualPointsEntry(raw = {}) {
  const num = (v, label, min, max) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      return { error: `${label} must be a whole number between ${min} and ${max}, or blank` };
    }
    return n;
  };
  const adjust = num(raw.adjust, "Bonus points", -MAX_POINTS_ADJUST, MAX_POINTS_ADJUST);
  if (adjust && adjust.error) return adjust;
  const override = num(raw.override, "A hand-set total", 0, MAX_POINTS_OVERRIDE);
  if (override && override.error) return override;
  return { ok: true, value: { adjust: adjust ?? 0, override: override ?? null } };
}

// The total a standings row ends up with. An override replaces everything; an
// adjustment rides on top of the computed figure. Never below zero — a penalty
// bigger than the points scored takes a driver to 0, not into the negative,
// which is how league sheets record one.
export function applyManualPoints(total, manual) {
  if (!manual) return total;
  if (manual.override != null) return manual.override;
  return Math.max(0, total + (manual.adjust || 0));
}
