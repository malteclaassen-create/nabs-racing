import { beforeEach, describe, expect, it, vi } from "vitest";

// Admin rights come from their own cached setting; the tests decide who has
// them.
vi.mock("./adminUsers.js", () => ({ getAdminDiscordIds: async () => new Set(["admin-1"]) }));

const push = await import("./push.js");
const {
  buildPushPayload,
  categoryOf,
  cleanSubscription,
  deviceLabel,
  isPushEndpoint,
  parsePushPrefs,
  pushAvailableTo,
  pushNotification,
  pushUrlFor,
  sanitizePushPrefs,
  setPushMode,
  getVapidKeys,
  PUSH_CATEGORIES,
} = push;

const P256 = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString("base64url");
const AUTH = Buffer.alloc(16, 1).toString("base64url");
const FCM = (id) => `https://fcm.googleapis.com/fcm/send/${id}`;

// A database with just enough of the push tables to watch what delivery does.
function fakeDb({ subs = [], members = {} } = {}) {
  const settings = new Map();
  const rows = new Map(subs.map((s) => [s.endpoint, { failures: 0, ...s }]));
  const log = [];
  const prisma = {
    setting: {
      findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, create }) => settings.set(where.key, create.value),
      update: async ({ where, data }) => settings.set(where.key, data.value),
    },
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "PushSubscription" s')) {
        const recipient = sql.includes('s."discordId" = ?') ? values[0] : null;
        return [...rows.values()]
          .filter((r) => !recipient || r.discordId === recipient)
          .filter((r) => !members[r.discordId]?.banned)
          .map((r) => ({ ...r, prefs: members[r.discordId]?.prefs ?? null }));
      }
      if (sql.includes('FROM "PushSubscription" WHERE "discordId" = ?')) {
        return [...rows.values()].filter((r) => r.discordId === values[0]);
      }
      return [];
    },
    $executeRaw: async (strings, ...values) => {
      const sql = strings.join("?");
      if (sql.includes('INSERT OR IGNORE INTO "Setting"')) {
        if (!settings.has(values[0])) settings.set(values[0], values[1]);
      } else if (sql.includes('SET "lastSuccessAt"')) {
        log.push(["delivered", values[1]]);
        const r = rows.get(values[1]);
        if (r) r.failures = 0;
      } else if (sql.includes('"failures" = "failures" + 1')) {
        log.push(["failed", values[0]]);
        const r = rows.get(values[0]);
        if (r) r.failures++;
      } else if (sql.includes('"failures" >= ?')) {
        const r = rows.get(values[0]);
        if (r && r.failures >= values[1]) rows.delete(values[0]);
      } else if (sql.includes('DELETE FROM "PushSubscription" WHERE "endpoint" = ?')) {
        log.push(["dropped", values[0]]);
        rows.delete(values[0]);
      }
      return 1;
    },
  };
  return { prisma, rows, log, settings };
}

function fakeSend(outcomes = {}) {
  const sent = [];
  const send = async (sub, payload, opts) => {
    sent.push({ endpoint: sub.endpoint, payload, opts });
    return outcomes[sub.endpoint] || { ok: true, status: 201, gone: false };
  };
  return { send, sent };
}

const sub = (id, discordId, extra = {}) => ({ endpoint: FCM(id), p256dh: P256, auth: AUTH, discordId, loginId: discordId, ...extra });

describe("what gets pushed under which switch", () => {
  it("maps every bell type to a category, and admin to-dos to none", () => {
    expect(categoryOf("REMINDER")).toBe("reminders");
    expect(categoryOf("RESULTS")).toBe("results");
    expect(categoryOf("PHOTOS")).toBe("results");
    expect(categoryOf("MARKET")).toBe("seat");
    expect(categoryOf("ATTENDANCE")).toBe("seat");
    expect(categoryOf("REPORT")).toBe("messages");
    expect(categoryOf("FEEDBACK")).toBe("messages");
    expect(categoryOf("AWARD")).toBe("awards");
    expect(categoryOf("CARD")).toBe("awards");
    expect(categoryOf("ANNOUNCE")).toBe("news");
    expect(categoryOf("ADMIN")).toBeNull();
    expect(categoryOf(null)).toBeNull();
    // A kind nobody listed yet still reaches people, under the broadest switch.
    expect(categoryOf("SOMETHING_NEW")).toBe("news");
  });

  it("starts with everything on and keeps only real switches", () => {
    const all = Object.fromEntries(PUSH_CATEGORIES.map((c) => [c.key, true]));
    expect(sanitizePushPrefs(null)).toEqual(all);
    expect(sanitizePushPrefs({ news: false, bogus: false })).toEqual({ ...all, news: false });
    expect(parsePushPrefs('{"reminders":false}')).toEqual({ ...all, reminders: false });
    expect(parsePushPrefs("not json")).toEqual(all);
  });

  it("is offered by the league's switch", () => {
    expect(pushAvailableTo("off", true)).toBe(false);
    expect(pushAvailableTo("admins", false)).toBe(false);
    expect(pushAvailableTo("admins", true)).toBe(true);
    expect(pushAvailableTo("all", false)).toBe(true);
  });
});

describe("only ever a push service", () => {
  it("accepts the browsers' push services", () => {
    expect(isPushEndpoint(FCM("abc"))).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAA")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGuQyavXut")).toBe(true);
    expect(isPushEndpoint("https://wns2-db5p.notify.windows.com/w/?token=abc")).toBe(true);
  });

  it("refuses anything that could point the server somewhere else", () => {
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("https://evilpush.apple.com/x")).toBe(false);
    expect(isPushEndpoint("https://localhost/x")).toBe(false);
    expect(isPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isPushEndpoint("https://user:pw@fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
  });

  it("checks the keys a browser sends with its address", () => {
    const ok = { endpoint: FCM("abc"), keys: { p256dh: P256, auth: AUTH } };
    expect(cleanSubscription(ok)).toEqual({ endpoint: FCM("abc"), p256dh: P256, auth: AUTH });
    expect(cleanSubscription({ ...ok, keys: { p256dh: "short", auth: AUTH } })).toBeNull();
    expect(cleanSubscription({ ...ok, keys: { p256dh: P256, auth: "x" } })).toBeNull();
    expect(cleanSubscription({ ...ok, endpoint: "https://example.com/hook" })).toBeNull();
    expect(cleanSubscription(null)).toBeNull();
  });

  it("names a device the way its owner would", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0")).toBe("Edge on Windows");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox on Mac");
    expect(deviceLabel("")).toBe("A browser");
  });
});

describe("the message", () => {
  it("opens where the bell entry would", () => {
    expect(pushUrlFor("/s/f1/races?season=8&race=abc")).toBe("/s/f1/races?season=8&race=abc");
    expect(pushUrlFor("tour:my-rating")).toBe("/?tour=my-rating");
    expect(pushUrlFor("https://youtube.com/live/x")).toBe("https://youtube.com/live/x");
    expect(pushUrlFor("//evil.example/x")).toBe("/");
    expect(pushUrlFor("javascript:alert(1)")).toBe("/");
    expect(pushUrlFor(null)).toBe("/");
  });

  it("keeps it short and lets a race's reminders replace each other", () => {
    const p = buildPushPayload({
      id: "n1",
      type: "REMINDER",
      title: "Race day: Round 4 at Spa",
      body: "x".repeat(400),
      link: "/s/f1/races?race=r4",
      dedupeKey: "reminder:r4:24",
    });
    expect(p.title).toBe("Race day: Round 4 at Spa");
    expect(p.body.length).toBeLessThanOrEqual(240);
    expect(p.tag).toBe("reminder:r4");
    expect(buildPushPayload({ id: "n2", type: "REMINDER", title: "t", dedupeKey: "reminder:r4:1" }).tag).toBe("reminder:r4");
    // Everything else stands on its own.
    expect(buildPushPayload({ id: "n3", type: "RESULTS", title: "t", dedupeKey: "results:r4" }).tag).toBe("n:n3");
    expect(JSON.stringify(p).length).toBeLessThan(3000);
  });
});

describe("delivery", () => {
  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 9)]).toString("base64url");
    process.env.VAPID_PRIVATE_KEY = Buffer.alloc(32, 3).toString("base64url");
  });

  const entry = (extra = {}) => ({ id: "n1", type: "RESULTS", title: "Round 4 results are in", body: "Spa", link: "/races", recipientId: null, ...extra });

  it("sends nothing while the switch is off", async () => {
    const db = fakeDb({ subs: [sub("a", "member-1")] });
    await setPushMode(db.prisma, "off");
    const { send, sent } = fakeSend();
    const out = await pushNotification(db.prisma, entry(), { send });
    expect(sent).toHaveLength(0);
    expect(out.sent).toBe(0);
  });

  it("reaches only the admins' devices while it is admins only", async () => {
    const db = fakeDb({ subs: [sub("a", "member-1"), sub("b", "admin-1")] });
    await setPushMode(db.prisma, "admins");
    const { send, sent } = fakeSend();
    await pushNotification(db.prisma, entry(), { send });
    expect(sent.map((s) => s.endpoint)).toEqual([FCM("b")]);
  });

  it("broadcasts to everyone whose switches allow it, once open", async () => {
    const db = fakeDb({
      subs: [sub("a", "member-1"), sub("b", "member-2"), sub("c", "member-3")],
      members: { "member-2": { prefs: JSON.stringify({ results: false }) }, "member-3": { banned: true } },
    });
    await setPushMode(db.prisma, "all");
    const { send, sent } = fakeSend();
    const out = await pushNotification(db.prisma, entry(), { send });
    expect(sent.map((s) => s.endpoint)).toEqual([FCM("a")]);
    expect(out.sent).toBe(1);
    expect(sent[0].payload).toMatchObject({ title: "Round 4 results are in", url: "/races" });
  });

  it("sends a personal entry to that member's devices only", async () => {
    const db = fakeDb({ subs: [sub("a", "member-1"), sub("a2", "member-1"), sub("b", "member-2")] });
    await setPushMode(db.prisma, "all");
    const { send, sent } = fakeSend();
    await pushNotification(db.prisma, entry({ type: "MARKET", recipientId: "member-1" }), { send });
    expect(sent.map((s) => s.endpoint).sort()).toEqual([FCM("a"), FCM("a2")]);
  });

  it("never pushes an admin to-do", async () => {
    const db = fakeDb({ subs: [sub("b", "admin-1")] });
    await setPushMode(db.prisma, "all");
    const { send, sent } = fakeSend();
    await pushNotification(db.prisma, entry({ type: "ADMIN", recipientId: "admin-1" }), { send });
    expect(sent).toHaveLength(0);
  });

  it("forgets a device the push service calls gone and counts the rest", async () => {
    const db = fakeDb({ subs: [sub("ok", "m1"), sub("gone", "m2"), sub("flaky", "m3")] });
    await setPushMode(db.prisma, "all");
    const { send } = fakeSend({
      [FCM("gone")]: { ok: false, status: 410, gone: true },
      [FCM("flaky")]: { ok: false, status: 500, gone: false },
    });
    const out = await pushNotification(db.prisma, entry(), { send });
    expect(out).toEqual({ sent: 1, failed: 1, removed: 1 });
    expect(db.rows.has(FCM("gone"))).toBe(false);
    expect(db.rows.get(FCM("flaky")).failures).toBe(1);
    expect(db.log).toContainEqual(["delivered", FCM("ok")]);
  });

  it("drops a device after failing too often in a row", async () => {
    const db = fakeDb({ subs: [sub("flaky", "m3", { failures: 7 })] });
    await setPushMode(db.prisma, "all");
    const { send } = fakeSend({ [FCM("flaky")]: { ok: false, status: 400, gone: false } });
    await pushNotification(db.prisma, entry(), { send });
    expect(db.rows.has(FCM("flaky"))).toBe(false);
  });

  it("never posts to an address that is not a push service, even one already stored", async () => {
    const db = fakeDb({ subs: [{ endpoint: "https://intranet.example/hook", p256dh: P256, auth: AUTH, discordId: "m1", loginId: "m1" }] });
    await setPushMode(db.prisma, "all");
    const { send, sent } = fakeSend();
    const out = await pushNotification(db.prisma, entry(), { send });
    expect(sent).toHaveLength(0);
    expect(out.removed).toBe(1);
    expect(db.rows.size).toBe(0);
  });

  it("passes a reminder's lifetime on to the push service", async () => {
    const db = fakeDb({ subs: [sub("a", "m1")] });
    await setPushMode(db.prisma, "all");
    const { send, sent } = fakeSend();
    await pushNotification(db.prisma, entry({ type: "REMINDER" }), { send, ttl: 1800, urgency: "high" });
    expect(sent[0].opts).toMatchObject({ ttl: 1800, urgency: "high" });
  });
});

describe("the server's own key pair", () => {
  it("is made once and then always the same, even when two requests race for it", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    vi.resetModules();
    const fresh = await import("./push.js");
    const db = fakeDb();
    const [a, b] = await Promise.all([fresh.getVapidKeys(db.prisma), fresh.getVapidKeys(db.prisma)]);
    expect(a).toEqual(b);
    expect(Buffer.from(a.publicKey, "base64url")).toHaveLength(65);
    expect(JSON.parse(db.settings.get("push_vapid_keys")).publicKey).toBe(a.publicKey);
    // A restart reads the stored pair back instead of making a new one.
    vi.resetModules();
    const again = await import("./push.js");
    expect(await again.getVapidKeys(db.prisma)).toEqual(a);
  });

  it("prefers a pair from the environment", async () => {
    process.env.VAPID_PUBLIC_KEY = "PUB";
    process.env.VAPID_PRIVATE_KEY = "PRIV";
    expect(await getVapidKeys(fakeDb().prisma)).toEqual({ publicKey: "PUB", privateKey: "PRIV" });
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });
});

describe("the bell hands new entries to push", () => {
  it("queues a push for a row that was written, and none for a deduped one", async () => {
    vi.resetModules();
    const queued = [];
    vi.doMock("./push.js", () => ({ queuePush: (_p, n, opts) => queued.push({ n, opts }) }));
    const { dbCreateNotification } = await import("./notifications.js");
    let affected = 1;
    const prisma = { $executeRaw: async () => affected };
    expect(await dbCreateNotification(prisma, { type: "RESULTS", title: "t", dedupeKey: "results:r1" })).toBe(true);
    affected = 0;
    expect(await dbCreateNotification(prisma, { type: "RESULTS", title: "t", dedupeKey: "results:r1" })).toBe(false);
    expect(queued).toHaveLength(1);
    expect(queued[0].n).toMatchObject({ type: "RESULTS", title: "t", dedupeKey: "results:r1", recipientId: null });
    // A writer's push options travel along; the row itself never stores them.
    affected = 1;
    await dbCreateNotification(prisma, { type: "REMINDER", title: "t", push: { ttl: 600, urgency: "high" } });
    expect(queued[1].opts).toEqual({ ttl: 600, urgency: "high" });
    vi.doUnmock("./push.js");
  });
});
