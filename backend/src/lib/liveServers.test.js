import { describe, it, expect } from "vitest";
import {
  resolveServerKey,
  serverKeyForSeries,
  isValidServerKey,
  DEFAULT_SERVER_KEY,
  LIVE_SERVERS,
} from "./liveServers.js";

// The assignment lives in one Setting row as JSON, so a fake prisma only has to
// answer that one read. `null` stands for a database that has never been
// written to, which is the state of a fresh checkout.
const fakePrisma = (map) => ({
  setting: {
    findUnique: async () => (map == null ? null : { value: JSON.stringify(map) }),
  },
});

// A second real key to switch to, whatever the list happens to contain.
const OTHER = LIVE_SERVERS.find((s) => s.key !== DEFAULT_SERVER_KEY)?.key;

describe("isValidServerKey", () => {
  it("accepts the configured keys and nothing else", () => {
    for (const s of LIVE_SERVERS) expect(isValidServerKey(s.key)).toBe(true);
    expect(isValidServerKey("nabs99")).toBe(false);
    expect(isValidServerKey("")).toBe(false);
    expect(isValidServerKey(null)).toBe(false);
    expect(isValidServerKey(undefined)).toBe(false);
  });
});

describe("serverKeyForSeries", () => {
  it("falls back to the first server when nothing is assigned", async () => {
    expect(await serverKeyForSeries(fakePrisma(null), "friday-f1")).toBe(DEFAULT_SERVER_KEY);
    expect(await serverKeyForSeries(fakePrisma({}), "friday-f1")).toBe(DEFAULT_SERVER_KEY);
  });

  it("uses the admin's assignment when there is one", async () => {
    expect(await serverKeyForSeries(fakePrisma({ "sunday-gt": OTHER }), "sunday-gt")).toBe(OTHER);
  });

  it("ignores an assignment naming a server that no longer exists", async () => {
    expect(await serverKeyForSeries(fakePrisma({ "sunday-gt": "nabs99" }), "sunday-gt")).toBe(
      DEFAULT_SERVER_KEY
    );
  });

  it("survives an unreadable settings row rather than throwing", async () => {
    const broken = { setting: { findUnique: async () => ({ value: "{not json" }) } };
    expect(await serverKeyForSeries(broken, "friday-f1")).toBe(DEFAULT_SERVER_KEY);
  });
});

describe("resolveServerKey", () => {
  it("lets an explicit server win over the series' assignment", async () => {
    const prisma = fakePrisma({ "sunday-gt": OTHER });
    // The viewer is on a series assigned to OTHER but asked for the default.
    expect(await resolveServerKey(prisma, { series: "sunday-gt", server: DEFAULT_SERVER_KEY })).toBe(
      DEFAULT_SERVER_KEY
    );
    // ...and the other way round.
    expect(await resolveServerKey(prisma, { series: "friday-f1", server: OTHER })).toBe(OTHER);
  });

  it("falls back to the series when no server is asked for", async () => {
    const prisma = fakePrisma({ "sunday-gt": OTHER });
    expect(await resolveServerKey(prisma, { series: "sunday-gt" })).toBe(OTHER);
    expect(await resolveServerKey(prisma, { series: "friday-f1" })).toBe(DEFAULT_SERVER_KEY);
  });

  it("ignores a made-up server instead of erroring on it", async () => {
    // A stale link or a hand-edited URL must show the normal board, because
    // this decorates a public page rather than gating anything.
    const prisma = fakePrisma({ "sunday-gt": OTHER });
    expect(await resolveServerKey(prisma, { series: "sunday-gt", server: "nabs99" })).toBe(OTHER);
    expect(await resolveServerKey(prisma, { series: "sunday-gt", server: "" })).toBe(OTHER);
    expect(await resolveServerKey(prisma, { series: "sunday-gt", server: null })).toBe(OTHER);
  });

  it("answers with the default when it is given nothing at all", async () => {
    expect(await resolveServerKey(fakePrisma(null), {})).toBe(DEFAULT_SERVER_KEY);
    expect(await resolveServerKey(fakePrisma(null))).toBe(DEFAULT_SERVER_KEY);
  });
});
