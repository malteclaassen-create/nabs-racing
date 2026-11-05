// The admin log: who changed what, and what it was before.
//
// One JSON line per successful admin change, in logs/admin-activity.log. A file
// on purpose: no migration, it survives a database restore (the one moment you
// most want to know what happened), and nothing in the admin area can edit or
// delete a line of it.
//
// Lines written before names were recorded have no `who`. They stay readable:
// what a line MEANS is worked out when it is read, not when it is written, so
// they get the same labels as the new ones.
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync } from "fs";
import { join } from "path";
import { LOGS_DIR } from "./dataDirs.js";

const ACTIVITY_LOG = join(LOGS_DIR, "admin-activity.log");

// How far back the log view reaches. At a few hundred bytes a line this is a
// few MB at worst, read only when an admin opens the page.
const MAX_LINES_READ = 20000;
const MAX_CHANGES = 80;
const MAX_TEXT = 160;

export const ACTIVITY_AREAS = [
  { key: "penalties", label: "Penalties & reports" },
  { key: "results", label: "Results" },
  { key: "drivers", label: "Drivers & teams" },
  { key: "members", label: "Members & roles" },
  { key: "calendar", label: "Seasons & events" },
  { key: "tokens", label: "Tokens" },
  { key: "site", label: "Site & settings" },
];

// ---------------------------------------------------------------------------
// Who
// ---------------------------------------------------------------------------

// The PIN is shared, so a PIN session cannot say who is behind it. It is shown
// as exactly that rather than as anybody's name.
export function actorOf(admin) {
  if (!admin) return null;
  if (admin.role === "admin") return { kind: "pin", name: "PIN login" };
  const id = admin.loginDiscordId || admin.discordId || null;
  return { kind: "discord", id, name: admin.discordName || admin.driverName || id || "Unknown account" };
}

// ---------------------------------------------------------------------------
// What the request was
// ---------------------------------------------------------------------------

const verb = (method, words) => words[method] || words.other;
const saved = { POST: "created", PUT: "updated", PATCH: "updated", DELETE: "deleted", other: "changed" };

// First match wins, so the specific paths sit above the general ones.
const RULES = [
  [/^\/reports\/[^/]+\/accused/, "penalties", "Accused driver changed on a report"],
  [/^\/reports\/[^/]+\/messages/, "penalties", "Steward message in a report"],
  [/^\/reports\/[^/]+\/split/, "penalties", "Report split in two"],
  [/^\/reports\/[^/]+\/(viewers|blocks)/, "penalties", "Report access changed"],
  [/^\/reports\/bulk-delete/, "penalties", "Reports deleted"],
  [/^\/reports-(retention|ingest)/, "penalties", "Report settings changed"],
  [/^\/reports\//, "penalties", (m) => (m === "DELETE" ? "Report deleted" : "Report decided")],
  [/^\/races\/[^/]+\/report-penalties\/applied/, "penalties", "Steward penalties entered into the results"],
  [/^\/import-server-penalties/, "penalties", "Server penalty setting changed"],

  [/^\/races\/[^/]+\/results-post|^\/standings-post/, "site", "Results posted to Discord"],
  [/^\/races\/commit/, "results", "Race results imported"],
  [/^\/races\/[^/]+\/results/, "results", (m) => (m === "DELETE" ? "Race results deleted" : "Race results edited")],
  [/^\/races\/[^/]+\/quali/, "results", (m) => (m === "DELETE" ? "Qualifying deleted" : "Qualifying imported")],
  [/^\/races\/[^/]+\/driver-of-the-day/, "results", "Driver of the day set"],
  [/^\/races\/[^/]+\/honours/, "results", "Race honours changed"],
  [/^\/seasons\/[^/]+\/manual-points/, "results", "Manual points changed"],
  [/^\/live-best-laps/, "results", "Practice best laps changed"],
  [/^\/telemetry-laps/, "results", "Telemetry lap deleted"],

  [/^\/drivers\/bulk-delete/, "drivers", "Drivers removed"],
  [/^\/drivers\/from-db/, "drivers", "Driver added from the database"],
  [/^\/drivers\/[^/]+\/transfers/, "drivers", "Team transfer undone"],
  [/^\/drivers\/[^/]+\/transfer/, "drivers", "Driver moved to another team"],
  [/^\/drivers\/[^/]+\/merge/, "drivers", "Drivers merged"],
  [/^\/drivers\/[^/]+\/progress/, "drivers", "Driver progress label set"],
  [/^\/drivers/, "drivers", (m) => `Driver ${verb(m, saved)}`],
  [/^\/teams\/import/, "drivers", "Teams brought over from another season"],
  [/^\/teams\/[^/]+\/logo/, "drivers", "Team logo uploaded"],
  [/^\/team-art/, "drivers", "Team artwork changed"],
  [/^\/teams/, "drivers", (m) => `Team ${verb(m, saved)}`],
  [/^\/persons/, "drivers", "Driver identities linked"],
  [/^\/market/, "drivers", "Driver Market changed"],

  [/^\/members\/[^/]+\/ban/, "members", "Member ban changed"],
  [/^\/members\/[^/]+\/admin/, "members", "Admin access changed"],
  [/^\/members\/[^/]+\/steward/, "members", "Steward role changed"],
  [/^\/members\/[^/]+\/race-control/, "members", "Race control role changed"],
  [/^\/members\/[^/]+\/create-driver/, "members", "Driver created from an account"],
  [/^\/members\/[^/]+\/second-account/, "members", "Second account changed"],
  [/^\/members\/[^/]+\/(un)?link/, "members", "Account link to a driver changed"],
  [/^\/members/, "members", "Member changed"],
  [/^\/settings\/pin/, "members", "Admin PIN changed"],

  [/^\/seasons\/[^/]+\/activate/, "calendar", "Season activated"],
  [/^\/seasons\/[^/]+\/clone-/, "calendar", "Roster cloned from another season"],
  [/^\/seasons\/[^/]+\/(hero|car)/, "calendar", "Season picture changed"],
  [/^\/seasons/, "calendar", (m) => `Season ${verb(m, saved)}`],
  [/^\/series\/[^/]+\/activate/, "calendar", "Main series changed"],
  [/^\/series/, "calendar", (m) => `Series ${verb(m, saved)}`],
  [/^\/events\/[^/]+\/announce/, "calendar", "Event posted to Discord"],
  [/^\/events/, "calendar", (m) => `Event ${verb(m, saved)}`],
  [/^\/attendance|^\/races\/[^/]+\/attendance/, "calendar", "Attendance changed"],
  [/^\/races\/[^/]+\/(photos|hero|hotlaps)/, "calendar", "Race media changed"],

  [/^\/tokens\/adjust/, "tokens", "Tokens adjusted by hand"],
  [/^\/tokens\/orders/, "tokens", "Token order updated"],
  [/^\/tokens\/referral/, "tokens", "Referral removed"],
  [/^\/tokens\/enabled/, "tokens", "Tokens switched on or off"],
  [/^\/tokens\/earning/, "tokens", "Token earning switched on or off"],
  [/^\/tokens\/tuning/, "tokens", "Token rules changed"],
  [/^\/tokens/, "tokens", "Tokens changed"],

  [/^\/backups/, "site", (m, p) => (m === "DELETE" || /prune/.test(p) ? "Backups deleted" : "Backup created")],
  [/^\/discord/, "site", "Discord settings changed"],
  [/^\/announcements/, "site", "Announcement sent"],
  [/^\/ratings\/weights/, "site", "Rating weights changed"],
  [/^\/social/, "site", "Social links changed"],
  [/^\/download/, "site", "Downloads changed"],
  [/^\/race-info|^\/welcome-faq|^\/help|^\/privacy-info/, "site", "Site text changed"],
  [/^\/feedback/, "site", "Feedback handled"],
  [/^\/tracks/, "site", "Track info changed"],
  [/^\/live-(links|servers)/, "site", "Live settings changed"],
];

// A readable name and an area for one logged request.
export function describeAction(method, path) {
  const p = String(path || "").split("?")[0];
  for (const [re, area, out] of RULES) {
    if (re.test(p)) return { area, label: typeof out === "function" ? out(method, p) : out };
  }
  // Everything else is a switch or a text somewhere in the settings.
  const word = p.split("/")[1]?.replace(/-/g, " ") || "Setting";
  return { area: "site", label: `${word.charAt(0).toUpperCase()}${word.slice(1)} changed` };
}

// These change nothing that lasts. They read a file, look something up or send
// a test, and would bury the real changes.
const NOT_A_CHANGE = [
  /\/preview$/,
  /^\/races\/import/,
  /^\/results\/remote\/import/,
  /^\/social-feed\/lookup/,
  /^\/discord\/test/,
  /^\/briefing\/watch/,
];
export function isLogged(method, path) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  return !NOT_A_CHANGE.some((re) => re.test(path));
}

// ---------------------------------------------------------------------------
// What was sent, when nothing better is known
// ---------------------------------------------------------------------------

// Never copied into the log: anything secret, whatever it is called.
const SECRET_FIELD = /pin|pass|secret|token|webhook|key|auth|cookie|code|url/i;
// Whole routes whose body stays out. Secrets and connection details, and the
// report threads: a private conversation should not turn up in a second place.
const QUIET_BODY = /^\/(settings|discord|live-servers|telemetry-ingest|reports-ingest|android-app|reports\/[^/]+\/messages|feedback)/;
// Plumbing the request carries along. Ids mean nothing to a reader.
const NOISE_FIELD = /^(series|season|session|overwrite)$|Id$|^id$/;

const clip = (s) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}...` : s);

// The plain values of a request body, safe to keep. Lists and objects are left
// out rather than dumped: a results list or a page of site text is no use here.
export function safeFields(path, body) {
  if (!body || typeof body !== "object" || QUIET_BODY.test(String(path))) return [];
  const out = [];
  for (const [key, value] of Object.entries(body)) {
    if (SECRET_FIELD.test(key) || NOISE_FIELD.test(key)) continue;
    if (Array.isArray(value) && /bulk-delete/.test(path)) {
      out.push({ field: "How many", to: String(value.length) });
      continue;
    }
    if (!["string", "number", "boolean"].includes(typeof value) || value === "") continue;
    out.push({ field: fieldLabel(key), to: show(value) });
    if (out.length >= 12) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Before and after
// ---------------------------------------------------------------------------

// "penaltySeconds" -> "Penalty seconds"
const FIELD_NAMES = { delta: "Amount", isAdmin: "Admin", isSteward: "Steward", isRaceControl: "Race control" };

export function fieldLabel(key) {
  if (FIELD_NAMES[key]) return FIELD_NAMES[key];
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function show(value) {
  if (value === null || value === undefined || value === "") return "none";
  if (value instanceof Date) {
    return value.toLocaleString("en-GB", {
      timeZone: "Europe/Berlin", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return "changed";
  return clip(String(value));
}

// Columns that change by themselves or say nothing to a reader.
const UNTRACKED = /^(id|createdAt|updatedAt|seasonId|seriesId|teamId|discordAvatar|photoUrl|logoUrl)$/;

// What differs between two rows of the same table.
export function diffRows(before, after) {
  if (!before || !after) return [];
  const changes = [];
  for (const key of Object.keys(after)) {
    if (UNTRACKED.test(key)) continue;
    const a = before[key];
    const b = after[key];
    const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : (a ?? null) === (b ?? null);
    if (same || (typeof b === "object" && b !== null && !(b instanceof Date))) continue;
    changes.push({ field: fieldLabel(key), from: show(a), to: show(b) });
  }
  return changes;
}

const place = (r) => (r.position == null ? "none" : `P${r.position}`);
const penalty = (r) => `${r.penaltySeconds || 0}s`;

// Results saved over results, per driver: the only way to see afterwards that
// somebody's five seconds became ten, or that a DSQ was quietly taken back.
export function diffResults(before, after) {
  const was = new Map(before.map((r) => [r.driverId, r]));
  const now = new Map(after.map((r) => [r.driverId, r]));
  if (!before.length) {
    return after.length ? [{ field: "Results", from: "none", to: `${after.length} drivers` }] : [];
  }
  if (!after.length) return [{ field: "Results", from: `${before.length} drivers`, to: "none" }];
  const changes = [];
  for (const r of after) {
    const old = was.get(r.driverId);
    if (!old) {
      changes.push({ field: r.name, from: "not in the results", to: `${place(r)}, ${r.status}` });
      continue;
    }
    if ((old.penaltySeconds || 0) !== (r.penaltySeconds || 0)) {
      changes.push({ field: `${r.name}: penalty`, from: penalty(old), to: penalty(r) });
    }
    if (old.status !== r.status) changes.push({ field: `${r.name}: status`, from: old.status, to: r.status });
    if ((old.position ?? null) !== (r.position ?? null)) {
      changes.push({ field: `${r.name}: position`, from: place(old), to: place(r) });
    }
    if ((old.points ?? null) !== (r.points ?? null)) {
      changes.push({ field: `${r.name}: points`, from: show(old.points), to: show(r.points) });
    }
  }
  for (const r of before) {
    if (!now.has(r.driverId)) changes.push({ field: r.name, from: `${place(r)}, ${r.status}`, to: "removed" });
  }
  // Penalties first: a five second penalty shuffles half the field, and the
  // reason for all those moved places should not end up below them.
  const rank = (c) => (/penalty$/.test(c.field) ? 0 : /status$/.test(c.field) ? 1 : 2);
  return changes.sort((a, b) => rank(a) - rank(b));
}

export function diffReport(before, after) {
  const pick = (r) => ({
    Decision: r.status,
    "Penalty type": r.penaltyKind,
    "Penalty seconds": r.penaltySeconds,
    Verdict: r.verdict,
  });
  const a = pick(before);
  const b = pick(after);
  return Object.keys(b)
    .filter((k) => (a[k] ?? null) !== (b[k] ?? null))
    .map((k) => ({ field: k, from: show(a[k]), to: show(b[k]) }));
}

// ---------------------------------------------------------------------------
// Reading the database for names
// ---------------------------------------------------------------------------

export function raceLabel(race, { sprint = false } = {}) {
  if (!race) return null;
  const round = race.number != null ? `R${race.number} ` : "";
  const season = race.season?.name ? ` (${race.season.name})` : "";
  return `${round}${race.track}${sprint ? " sprint" : ""}${season}`;
}

// The same label for a race row in hand. A sprint row has no round number of its
// own, it goes by the event it belongs to.
export async function raceTarget(prisma, race, sprintOf = null) {
  const season = race.seasonId
    ? await prisma.season.findUnique({ where: { id: race.seasonId }, select: { name: true } }).catch(() => null)
    : null;
  return raceLabel({ ...race, number: sprintOf?.number ?? race.number, season }, { sprint: !!sprintOf });
}

export async function readResultRows(prisma, raceId) {
  const rows = await prisma.raceResult.findMany({
    where: { raceId },
    select: {
      driverId: true, position: true, status: true, penaltySeconds: true, points: true,
      driver: { select: { name: true } },
    },
  });
  return rows.map(({ driver, ...r }) => ({ ...r, name: driver?.name || r.driverId }));
}

async function memberName(prisma, discordId) {
  const rows = await prisma.$queryRaw`SELECT "username", "displayName" FROM "MemberAccount" WHERE "discordId" = ${String(discordId)} LIMIT 1`;
  return rows[0]?.displayName || rows[0]?.username || String(discordId);
}

// A row as it stands, in the shape it is compared in. Which tables are worth a
// before and after; the driver's team is named, because a team id reads as noise.
const SNAPSHOTS = {
  drivers: async (prisma, id) => {
    const row = await prisma.driver.findUnique({ where: { id }, include: { team: { select: { name: true } } } });
    if (!row) return null;
    const { team, ...rest } = row;
    return { ...rest, team: team?.name ?? null };
  },
  teams: (prisma, id) => prisma.team.findUnique({ where: { id } }),
  events: (prisma, id) => prisma.race.findUnique({ where: { id } }),
  seasons: (prisma, id) => prisma.season.findUnique({ where: { id } }),
};

// The name of the thing a request is about, read BEFORE the handler runs: once
// a driver is deleted there is nothing left to ask.
async function targetOf(prisma, path, body) {
  const [, kind, id] = String(path).split("?")[0].split("/");
  if (kind === "tokens") {
    const member = body?.discordId || /^\/tokens\/referral\/([^/]+)/.exec(path)?.[1];
    return member ? memberName(prisma, member) : null;
  }
  if (!id) return null;
  const key = decodeURIComponent(id);
  if (kind === "races" || kind === "events") {
    if (key === "commit" || key === "import" || key === "preview") return null;
    const race = await prisma.race.findUnique({ where: { id: key }, include: { season: { select: { name: true } } } });
    return raceLabel(race);
  }
  if (kind === "attendance") {
    const race = await prisma.race.findUnique({ where: { id: key }, include: { season: { select: { name: true } } } });
    return raceLabel(race);
  }
  if (kind === "drivers") return (await prisma.driver.findUnique({ where: { id: key }, select: { name: true } }))?.name ?? null;
  if (kind === "teams") return (await prisma.team.findUnique({ where: { id: key }, select: { name: true } }))?.name ?? null;
  if (kind === "seasons") return (await prisma.season.findUnique({ where: { id: key }, select: { name: true } }))?.name ?? null;
  if (kind === "series") return (await prisma.series.findUnique({ where: { id: key }, select: { name: true } }))?.name ?? null;
  if (kind === "members") return memberName(prisma, key);
  if (kind === "reports") {
    const rows = await prisma.$queryRawUnsafe(`SELECT "raceId", "reporterName", "accusedName" FROM "Report" WHERE "id" = ?`, key);
    const r = rows[0];
    if (!r) return null;
    const race = r.raceId
      ? await prisma.race.findUnique({ where: { id: r.raceId }, include: { season: { select: { name: true } } } })
      : null;
    const people = [r.reporterName, r.accusedName].filter(Boolean).join(" against ");
    return [people, raceLabel(race)].filter(Boolean).join(", ") || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The log itself
// ---------------------------------------------------------------------------

// Mounted on an admin router, after its auth. `prefix` is the part of the url
// in front of the router's own paths that the log leaves out ("/tokens" for the
// tokens router, so its lines read the same as everybody else's).
//
// A handler that knows better than the generic reading, the results editor
// above all, says so through res.locals.activity = { target?, changes? }.
export function activityLogger(prisma, { prefix = "" } = {}) {
  return async (req, res, next) => {
    const path = `${prefix}${req.path}`;
    const url = `${prefix}${req.url}`;
    if (!isLogged(req.method, path)) return next();

    // None of this may ever cost an admin their save.
    let target = null;
    let before = null;
    let snapshot = null;
    try {
      target = await targetOf(prisma, path, req.body);
      const m = /^\/(drivers|teams|events|seasons)\/([^/]+)(\/transfer)?$/.exec(path);
      if (m && req.method !== "DELETE") {
        const id = decodeURIComponent(m[2]);
        snapshot = () => SNAPSHOTS[m[1]](prisma, id);
        before = await snapshot();
      }
    } catch {
      /* a missing name is not worth a failed request */
    }

    res.on("finish", async () => {
      if (res.statusCode >= 300) return; // only what actually happened
      const t = new Date().toISOString();
      try {
        const told = res.locals.activity || {};
        let changes = told.changes;
        if (!changes && snapshot) changes = diffRows(before, await snapshot().catch(() => null));
        if (!changes?.length && !told.changes) {
          changes = safeFields(path, req.body);
          const driverId = req.body?.driverId;
          if (typeof driverId === "string" && !QUIET_BODY.test(path)) {
            const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true } }).catch(() => null);
            if (d) changes.unshift({ field: "Driver", to: d.name });
          }
        }
        const entry = { t, method: req.method, path: url, who: actorOf(req.admin) };
        const about = told.target || target;
        if (about) entry.target = about;
        if (changes?.length) {
          entry.changes = changes.slice(0, MAX_CHANGES);
          if (changes.length > MAX_CHANGES) entry.more = changes.length - MAX_CHANGES;
        }
        mkdirSync(LOGS_DIR, { recursive: true });
        appendFileSync(ACTIVITY_LOG, `${JSON.stringify(entry)}\n`);
      } catch {
        /* logging must never break the request */
      }
    });
    next();
  };
}

// The log only ever grows and the view only ever shows its newest lines, so it
// is read from the end: a chunk off the tail, grown fourfold until it holds
// enough lines or the whole file has been covered. Same lines, same order, but
// the request does not pull the entire history onto the heap.
function readTailLines(path, wantLines) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    let chunk = 64 * 1024;
    for (;;) {
      const start = Math.max(0, size - chunk);
      const buf = Buffer.alloc(size - start);
      // readSync may come back short; keep going, a truncated tail would hide
      // the newest entries.
      let filled = 0;
      while (filled < buf.length) {
        const n = readSync(fd, buf, filled, buf.length - filled, start + filled);
        if (!n) break;
        filled += n;
      }
      let text = buf.subarray(0, filled).toString("utf-8");
      if (start > 0) {
        // A chunk starting mid-file also starts mid-line, and possibly mid
        // UTF-8 character (an umlaut in a driver name would decode to garbage).
        // Everything up to the first newline is therefore dropped; only a chunk
        // that reaches byte 0 keeps its first line.
        const nl = text.indexOf("\n");
        text = nl === -1 ? "" : text.slice(nl + 1).replace(/\s+$/, "");
      } else {
        text = text.trim();
      }
      const lines = text.split("\n");
      if (lines.length >= wantLines || start === 0) return lines;
      chunk *= 4;
    }
  } finally {
    closeSync(fd);
  }
}

// The key a person is filtered by. Lines from before names were recorded share
// one, so they can be told from everything else.
const whoKey = (who) => (!who ? "none" : who.kind === "pin" ? "pin" : `d:${who.id}`);

// Filters the parsed lines, newest first. Pure so the rules can be tested.
export function queryEntries(lines, { who, area, q, offset = 0, limit = 100 } = {}) {
  const people = new Map();
  const needle = String(q || "").trim().toLowerCase();
  const matches = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (!raw?.path) continue;
    const entry = { ...raw, ...describeAction(raw.method, raw.path) };
    const key = whoKey(raw.who);
    // Newest first, so this keeps the name the person goes by now.
    if (!people.has(key)) people.set(key, { key, name: raw.who?.name || "Not recorded" });
    if (who && key !== who) continue;
    if (area && entry.area !== area) continue;
    if (needle) {
      const text = [
        entry.label, entry.target, entry.who?.name,
        ...(entry.changes || []).flatMap((c) => [c.field, c.from, c.to]),
      ].filter(Boolean).join(" ").toLowerCase();
      if (!text.includes(needle)) continue;
    }
    matches.push(entry);
  }
  return {
    entries: matches.slice(offset, offset + limit),
    total: matches.length,
    people: [...people.values()],
    areas: ACTIVITY_AREAS,
  };
}

export function readActivity(filters) {
  if (!existsSync(ACTIVITY_LOG)) return queryEntries([], filters);
  const lines = readTailLines(ACTIVITY_LOG, MAX_LINES_READ).slice(-MAX_LINES_READ).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  });
  return queryEntries(lines, filters);
}
