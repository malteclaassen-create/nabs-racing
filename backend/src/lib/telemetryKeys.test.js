// One recorder key per series, and what that key is allowed to be.
//
// The key is how a lap says which league's race server it came from, so the
// rules that matter are the ones that keep two leagues from sharing one: a
// series holds its key for life, a typed-in key another series already holds
// is refused, and the one key the site had before it had series goes to the
// league that was using it — once, and never over a key minted since.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./series.js", () => ({
  dbListSeries: vi.fn(async () => [
    { slug: "friday-f1", name: "NABS Racing League", isActive: true, isPublic: true },
    { slug: "sunday-gt", name: "Sunday GT", isActive: false, isPublic: false },
  ]),
}));

const {
  readIngestConfig,
  seriesForKey,
  anyIngestKey,
  setIngestPaused,
  ensureIngestKey,
  adoptBareIngestKey,
  invalidateTelemetryKeys,
  keySettingOf,
  offSettingOf,
} = await import("./telemetryKeys.js");

// The Setting table as a Map — the three calls the module makes, and nothing
// a real database would not also do.
function fakePrisma(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    setting: {
      findUnique: vi.fn(async ({ where }) => (store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null)),
      findMany: vi.fn(async ({ where }) =>
        [...store].filter(([k]) => where.key.in.includes(k)).map(([key, value]) => ({ key, value }))
      ),
      upsert: vi.fn(async ({ where, create, update }) => {
        store.set(where.key, store.has(where.key) ? update.value : create.value);
        return { key: where.key, value: store.get(where.key) };
      }),
    },
  };
}

const KEY = "f00dcafef00dcafef00dcafef00dcafe";
const KEY2 = "0123456789abcdef0123456789abcdef";

beforeEach(() => invalidateTelemetryKeys());

describe("a key names its series", () => {
  it("is minted for one series and opens that series alone", async () => {
    const prisma = fakePrisma();
    expect(await anyIngestKey(prisma)).toBe(false);
    const made = await ensureIngestKey(prisma, "friday-f1");
    expect(made.ok).toBe(true);
    expect(made.key).toMatch(/^[a-f0-9]{32}$/);
    expect(await seriesForKey(prisma, made.key)).toEqual({ slug: "friday-f1", paused: false });
    expect(await anyIngestKey(prisma)).toBe(true);
    // The other league has nothing yet, and a key nobody holds opens nothing.
    expect(await readIngestConfig(prisma, "sunday-gt")).toEqual({ key: "", paused: false });
    expect(await seriesForKey(prisma, KEY2)).toBeNull();
  });

  it("gives each series its own key, and tells their laps apart by it", async () => {
    const prisma = fakePrisma();
    const f1 = await ensureIngestKey(prisma, "friday-f1");
    const gt = await ensureIngestKey(prisma, "sunday-gt");
    expect(f1.key).not.toBe(gt.key);
    expect((await seriesForKey(prisma, gt.key)).slug).toBe("sunday-gt");
    expect((await seriesForKey(prisma, f1.key)).slug).toBe("friday-f1");
  });

  it("adopts a typed-in key while the series holds none, lower-cased", async () => {
    const prisma = fakePrisma();
    const made = await ensureIngestKey(prisma, "sunday-gt", ` ${KEY.toUpperCase()} `);
    expect(made).toEqual({ ok: true, key: KEY });
    expect(prisma.store.get(keySettingOf("sunday-gt"))).toBe(KEY);
  });
});

describe("what a key may not be", () => {
  it("refuses a malformed key", async () => {
    const prisma = fakePrisma();
    const made = await ensureIngestKey(prisma, "friday-f1", "not-a-key");
    expect(made.ok).toBe(false);
    expect(made.status).toBe(400);
    expect(await anyIngestKey(prisma)).toBe(false);
  });

  it("refuses to replace the key a series already holds — it is permanent", async () => {
    const prisma = fakePrisma();
    await ensureIngestKey(prisma, "friday-f1", KEY);
    const made = await ensureIngestKey(prisma, "friday-f1", KEY2);
    expect(made.ok).toBe(false);
    expect(made.status).toBe(409);
    expect((await readIngestConfig(prisma, "friday-f1")).key).toBe(KEY);
  });

  it("refuses a key another series already holds — two leagues on one key are one league", async () => {
    const prisma = fakePrisma();
    await ensureIngestKey(prisma, "friday-f1", KEY);
    const made = await ensureIngestKey(prisma, "sunday-gt", KEY);
    expect(made.ok).toBe(false);
    expect(made.status).toBe(409);
    expect((await readIngestConfig(prisma, "sunday-gt")).key).toBe("");
  });
});

describe("pausing", () => {
  it("goes dark for that series alone and keeps the key underneath", async () => {
    const prisma = fakePrisma();
    const f1 = await ensureIngestKey(prisma, "friday-f1");
    const gt = await ensureIngestKey(prisma, "sunday-gt");
    await setIngestPaused(prisma, "friday-f1", true);
    expect(await seriesForKey(prisma, f1.key)).toEqual({ slug: "friday-f1", paused: true });
    expect(await seriesForKey(prisma, gt.key)).toEqual({ slug: "sunday-gt", paused: false });
    expect(await readIngestConfig(prisma, "friday-f1")).toEqual({ key: f1.key, paused: true });
  });

  it("comes back with the same key when switched on again", async () => {
    const prisma = fakePrisma();
    const first = await ensureIngestKey(prisma, "friday-f1");
    await setIngestPaused(prisma, "friday-f1", true);
    const again = await ensureIngestKey(prisma, "friday-f1");
    expect(again.key).toBe(first.key);
    expect(await seriesForKey(prisma, first.key)).toEqual({ slug: "friday-f1", paused: false });
  });
});

describe("the one key from before there were series", () => {
  it("is handed to the primary series, pause flag and all, exactly once", async () => {
    const prisma = fakePrisma({ telemetry_ingest_key: KEY, telemetry_ingest_off: "1" });
    expect(await adoptBareIngestKey(prisma, "friday-f1")).toBe(true);
    expect(prisma.store.get(keySettingOf("friday-f1"))).toBe(KEY);
    expect(prisma.store.get(offSettingOf("friday-f1"))).toBe("1");
    // The line already in that league's server config keeps working.
    expect(await seriesForKey(prisma, KEY)).toEqual({ slug: "friday-f1", paused: true });
    expect(await adoptBareIngestKey(prisma, "friday-f1")).toBe(false);
  });

  it("never overwrites a key the series has minted since", async () => {
    const prisma = fakePrisma({ telemetry_ingest_key: KEY, [keySettingOf("friday-f1")]: KEY2 });
    expect(await adoptBareIngestKey(prisma, "friday-f1")).toBe(false);
    expect((await readIngestConfig(prisma, "friday-f1")).key).toBe(KEY2);
  });

  it("does nothing when there was no bare key, or no series to give it to", async () => {
    expect(await adoptBareIngestKey(fakePrisma(), "friday-f1")).toBe(false);
    expect(await adoptBareIngestKey(fakePrisma({ telemetry_ingest_key: KEY }), null)).toBe(false);
  });
});
