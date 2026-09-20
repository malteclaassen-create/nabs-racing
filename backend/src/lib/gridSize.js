// ---------------------------------------------------------------------------
// How many seats a round's sign-up counts up to, per series.
//
// The number lives on the race (Race.capacity, "Accepted 28/40" on the card and
// in the Discord post), because a round that has already run should keep the
// grid it actually ran with. But nobody wants to type it per round: a league
// moves to a bigger server and from then on every round has the new number.
//
// So this is the series' current grid size. Setting it stamps every round that
// has not been run yet, and new rounds are created with it. Finished rounds are
// left alone.
// ---------------------------------------------------------------------------

const KEY = "attendance_grid_size";

// What a league gets before anyone touches this, and what Race.capacity has
// defaulted to since the column existed.
export const DEFAULT_GRID_SIZE = 40;
// Room for any sim's grid without letting a typo ("400") through.
export const MIN_GRID_SIZE = 1;
export const MAX_GRID_SIZE = 128;

async function readAll(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    const obj = row?.value ? JSON.parse(row.value) : null;
    if (!obj || typeof obj !== "object") return {};
    const out = {};
    for (const [slug, n] of Object.entries(obj)) {
      const v = Number(n);
      if (typeof slug === "string" && Number.isInteger(v) && v >= MIN_GRID_SIZE && v <= MAX_GRID_SIZE) out[slug] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function gridSizeFor(prisma, seriesSlug) {
  if (!seriesSlug) return DEFAULT_GRID_SIZE;
  const all = await readAll(prisma);
  return all[String(seriesSlug)] ?? DEFAULT_GRID_SIZE;
}

// Returns { error } or the number, validated.
export function parseGridSize(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < MIN_GRID_SIZE || n > MAX_GRID_SIZE) {
    return { error: `Grid size must be a whole number between ${MIN_GRID_SIZE} and ${MAX_GRID_SIZE}` };
  }
  return { value: n };
}

// Store the series' number. Callers do the stamping of existing rounds, since
// only the route knows which races belong to the series.
export async function setGridSize(prisma, seriesSlug, size) {
  const slug = String(seriesSlug || "");
  if (!slug) return DEFAULT_GRID_SIZE;
  const all = await readAll(prisma);
  all[slug] = size;
  const value = JSON.stringify(all);
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return size;
}
