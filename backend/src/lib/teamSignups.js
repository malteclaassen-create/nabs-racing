// ---------------------------------------------------------------------------
// Team sign-ups for a coming season ("Season 7 of the Sunday league: which
// team do you want to drive for, and who with?").
//
// One sign-up runs at a time. The admin opens it for a series and gives it a
// name ("Season 7"); while it is open, that series' home page carries a small
// form. A member signed in with Discord fills in the team they want and the
// two drivers. Someone on their own fills in only themselves, and the second
// seat stays empty ("looking for a teammate").
//
// One entry per Discord account per sign-up: sending the form again changes
// the entry instead of adding a second one, and the member can take it back.
// The admin reads them in the Team sign-ups tab and ticks them off once dealt
// with. Nothing here is shown publicly, except that a signed-in member
// filling in the form sees which teams still have a free seat (team name and
// the one driver, openSeatsFrom) and who has no team yet (name only,
// freeAgentsFrom), and nothing rings the bell: the
// admins look in the tab when they want to.
//
// Raw SQL like Feedback (the running dev server locks the generated Prisma
// client on Windows). Keep the columns in sync with the TeamSignup model in
// prisma/schema.prisma and the migration team_signups.
// ---------------------------------------------------------------------------
import { randomUUID } from "crypto";

export const TEAM_SIGNUP_SETTING = "team_signup";
export const SIGNUP_STATUSES = ["NEW", "DONE"];

const MAX_TEAM = 60;
const MAX_NAME = 60;
const MAX_NOTE = 500;
const MAX_LABEL = 60;
const DEFAULT_LABEL = "Next season";
// The form's dropdown choices that are not a team. Same words as
// frontend/src/data/signupTeams.js; keep the two in step.
export const NOT_A_TEAM = ["No team yet", "Looking for a team"];

export async function ensureTeamSignupTable(prisma) {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TeamSignup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "senderName" TEXT,
    "teamName" TEXT NOT NULL,
    "driver1" TEXT NOT NULL,
    "driver2" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME
  )`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "TeamSignup_seriesId_label_discordId_key" ON "TeamSignup"("seriesId", "label", "discordId")`
  );
}

// Text from a form field: one line, trimmed, capped. Empty is null.
export function cleanLine(v, max) {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s || null;
}

function cleanNote(v) {
  const s = String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_NOTE);
  return s || null;
}

// --- The switch ------------------------------------------------------------

// { open, seriesId, label }. Closed with no series until an admin opens one.
export function parseSignupSettings(raw) {
  let v = null;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    v = null;
  }
  return {
    open: !!v?.open,
    seriesId: typeof v?.seriesId === "string" && v.seriesId ? v.seriesId : null,
    label: cleanLine(v?.label, MAX_LABEL) || DEFAULT_LABEL,
  };
}

export async function readSignupSettings(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: TEAM_SIGNUP_SETTING } });
    return parseSignupSettings(row?.value);
  } catch {
    return parseSignupSettings(null);
  }
}

export async function writeSignupSettings(prisma, patch) {
  const now = await readSignupSettings(prisma);
  const next = {
    open: patch && "open" in patch ? !!patch.open : now.open,
    seriesId: patch && "seriesId" in patch ? (patch.seriesId ? String(patch.seriesId) : null) : now.seriesId,
    label: patch && "label" in patch ? cleanLine(patch.label, MAX_LABEL) || DEFAULT_LABEL : now.label,
  };
  if (next.open && !next.seriesId) {
    const err = new Error("Pick the series the sign-up is for first.");
    err.status = 400;
    throw err;
  }
  const value = JSON.stringify(next);
  await prisma.setting.upsert({
    where: { key: TEAM_SIGNUP_SETTING },
    create: { key: TEAM_SIGNUP_SETTING, value },
    update: { value },
  });
  return next;
}

// --- Entries ---------------------------------------------------------------

function shape(r) {
  if (!r) return null;
  return {
    id: r.id,
    seriesId: r.seriesId || null,
    label: r.label,
    discordId: r.discordId,
    senderName: r.senderName ?? null,
    teamName: r.teamName,
    driver1: r.driver1,
    driver2: r.driver2 ?? null,
    note: r.note ?? null,
    status: SIGNUP_STATUSES.includes(r.status) ? r.status : "NEW",
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
  };
}

// What the member themself sees of their entry: no Discord id, no status.
export function shapeForSender(entry) {
  if (!entry) return null;
  const { id, teamName, driver1, driver2, note, createdAt, updatedAt } = entry;
  return { id, teamName, driver1, driver2, note, createdAt, updatedAt };
}

// The form's fields, checked. Throws a 400 with words a member can act on.
export function parseSignupForm(body) {
  const teamName = cleanLine(body?.teamName, MAX_TEAM);
  const driver1 = cleanLine(body?.driver1, MAX_NAME);
  const driver2 = cleanLine(body?.driver2, MAX_NAME);
  const note = cleanNote(body?.note);
  const fail = (msg) => {
    const err = new Error(msg);
    err.status = 400;
    return err;
  };
  if (!teamName) throw fail("Write down which team you want to drive for.");
  if (!driver1) throw fail("Write down at least one driver.");
  if (driver2 && driver2.toLowerCase() === driver1.toLowerCase()) throw fail("The two drivers are the same name.");
  return { teamName, driver1, driver2, note };
}

export async function dbGetOwnSignup(prisma, { seriesId, label, discordId }) {
  if (!discordId) return null;
  const rows = await prisma.$queryRaw`
    SELECT * FROM "TeamSignup"
    WHERE "seriesId" = ${seriesId || ""} AND "label" = ${label} AND "discordId" = ${discordId}
    LIMIT 1`;
  return shape(rows[0]);
}

// Send or change this member's entry. Returns { entry, created }.
export async function dbSaveSignup(prisma, { seriesId, label, discordId, senderName, form }) {
  const existing = await dbGetOwnSignup(prisma, { seriesId, label, discordId });
  const now = new Date().toISOString();
  if (existing) {
    // A changed entry is worth another look, so it goes back to NEW.
    await prisma.$executeRaw`
      UPDATE "TeamSignup" SET
        "teamName" = ${form.teamName}, "driver1" = ${form.driver1}, "driver2" = ${form.driver2},
        "note" = ${form.note}, "senderName" = ${senderName || null}, "status" = 'NEW', "updatedAt" = ${now}
      WHERE "id" = ${existing.id}`;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "TeamSignup"
        ("id","seriesId","label","discordId","senderName","teamName","driver1","driver2","note","status","createdAt","updatedAt")
      VALUES (${randomUUID()}, ${seriesId || ""}, ${label}, ${discordId}, ${senderName || null},
        ${form.teamName}, ${form.driver1}, ${form.driver2}, ${form.note}, 'NEW', ${now}, NULL)`;
  }
  return { entry: await dbGetOwnSignup(prisma, { seriesId, label, discordId }), created: !existing };
}

export async function dbWithdrawSignup(prisma, { seriesId, label, discordId }) {
  await prisma.$executeRaw`
    DELETE FROM "TeamSignup"
    WHERE "seriesId" = ${seriesId || ""} AND "label" = ${label} AND "discordId" = ${discordId}`;
}

// Every entry, newest first. The admin view groups them by series and name,
// and folds away the ones markCovered marks.
export async function dbListSignups(prisma) {
  const rows = await prisma.$queryRaw`SELECT * FROM "TeamSignup" ORDER BY "createdAt" DESC LIMIT 1000`;
  return markCovered(rows.map(shape));
}

// Entries that say the same thing as another one, folded into it so the
// admin deals with each pair once:
//   - the same two drivers sent twice (each put the other down as teammate):
//     the entry with a real team wins over "No team yet", else the newest;
//   - a driver who signed up on their own and is now named in a pair's entry:
//     their own entry is spent, the pair's entry wins.
// Nothing is deleted (an entry could be taken back, or name someone by
// mistake), only marked: the folded one gets `coveredBy: { id, teamName,
// with }` (the entry it went into, and the other driver there), and that entry
// gets `alsoSent: [{ id, senderName, teamName, note }]`, so the admin still
// reads every note. The admin list and the lists members see leave folded
// entries out. Entries are matched within one sign-up (series + name),
// drivers by name in any case.
export function markCovered(entries) {
  const list = (entries || []).filter(Boolean).map((e) => ({ ...e }));
  const norm = (v) => String(v || "").trim().toLowerCase();
  const group = (e) => `${e.seriesId || ""}::${e.label}`;
  const stamp = (e) => e.updatedAt || e.createdAt || "";
  const notTeam = new Set(NOT_A_TEAM.map((n) => n.toLowerCase()));
  const realTeam = (e) => !notTeam.has(norm(e.teamName));
  const byId = new Map(list.map((e) => [e.id, e]));
  const fold = (e, into, me) => {
    const partner = me ? (norm(into.driver1) === me ? into.driver2 : into.driver1) : null;
    e.coveredBy = { id: into.id, teamName: into.teamName, with: partner };
  };

  // The same pair more than once.
  const pairs = new Map();
  for (const e of list) {
    if (!norm(e.driver1) || !norm(e.driver2)) continue;
    const key = `${group(e)}::${[norm(e.driver1), norm(e.driver2)].sort().join("|")}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(e);
  }
  const keepers = [];
  for (const same of pairs.values()) {
    same.sort((a, b) => Number(realTeam(b)) - Number(realTeam(a)) || (stamp(b) > stamp(a) ? 1 : stamp(b) < stamp(a) ? -1 : 0));
    const [keep, ...rest] = same;
    keepers.push(keep);
    for (const e of rest) fold(e, keep, null);
  }

  // A solo entry whose driver is now in a pair.
  for (const e of list) {
    if (norm(e.driver2)) continue;
    const me = norm(e.driver1);
    if (!me) continue;
    let best = null;
    for (const p of keepers) {
      if (p.id === e.id || group(p) !== group(e)) continue;
      if (norm(p.driver1) !== me && norm(p.driver2) !== me) continue;
      if (!best || stamp(p) > stamp(best)) best = p;
    }
    if (best) fold(e, best, me);
  }

  for (const e of list) {
    if (!e.coveredBy) continue;
    const into = byId.get(e.coveredBy.id);
    if (!into) continue;
    (into.alsoSent ||= []).push({ id: e.id, senderName: e.senderName ?? null, teamName: e.teamName, note: e.note ?? null });
  }
  return list;
}

// Teams in this sign-up with one driver so far, so someone on their own can
// pick one in the form and take the free seat. Teams are matched by name
// (any case); a team counts as full once two different drivers are down for
// it, across all its entries. The asker's own entry is left out, as is
// anything that is not a team ("No team yet"). Sorted by team name.
export function openSeatsFrom(entries, excludeDiscordId) {
  const notTeam = new Set(NOT_A_TEAM.map((n) => n.toLowerCase()));
  const teams = new Map();
  for (const e of entries || []) {
    if (!e?.teamName || e.coveredBy || (excludeDiscordId && e.discordId === excludeDiscordId)) continue;
    const key = e.teamName.trim().toLowerCase();
    if (!key || notTeam.has(key)) continue;
    if (!teams.has(key)) teams.set(key, { teamName: e.teamName.trim(), drivers: new Map() });
    for (const d of [e.driver1, e.driver2]) {
      const name = String(d || "").trim();
      if (name && !teams.get(key).drivers.has(name.toLowerCase())) teams.get(key).drivers.set(name.toLowerCase(), name);
    }
  }
  return [...teams.values()]
    .filter((t) => t.drivers.size === 1)
    .map((t) => ({ teamName: t.teamName, driver: [...t.drivers.values()][0] }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
}

// Drivers in this sign-up with no team and no teammate yet ("No team yet" or
// "Looking for a team", second seat empty), so the people on their own can
// find each other. Name and which of the two they picked, oldest first; never
// the note, which is written for the admins. The asker's own entry is left out.
export function freeAgentsFrom(entries, excludeDiscordId) {
  const notTeam = new Map(NOT_A_TEAM.map((n) => [n.toLowerCase(), n]));
  const out = [];
  const seen = new Set();
  for (const e of entries || []) {
    if (!e || e.coveredBy || (excludeDiscordId && e.discordId === excludeDiscordId)) continue;
    const choice = notTeam.get(String(e.teamName || "").trim().toLowerCase());
    const name = String(e.driver1 || "").trim();
    if (!choice || !name || String(e.driver2 || "").trim()) continue;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, choice });
  }
  return out;
}

async function listEntries(prisma, { seriesId, label }) {
  const rows = await prisma.$queryRaw`
    SELECT * FROM "TeamSignup"
    WHERE "seriesId" = ${seriesId || ""} AND "label" = ${label}
    ORDER BY "createdAt" ASC`;
  return markCovered(rows.map(shape));
}

// What a signed-in member filling in the form gets to see of the others:
// teams with a free seat, and the drivers still on their own.
export async function dbListForMembers(prisma, { seriesId, label, excludeDiscordId }) {
  const entries = await listEntries(prisma, { seriesId, label });
  return {
    openSeats: openSeatsFrom(entries, excludeDiscordId),
    freeAgents: freeAgentsFrom(entries, excludeDiscordId),
  };
}

export async function dbSetSignupStatus(prisma, id, status) {
  const s = String(status || "").toUpperCase();
  if (!SIGNUP_STATUSES.includes(s)) {
    const err = new Error("Unknown status");
    err.status = 400;
    throw err;
  }
  await prisma.$executeRaw`UPDATE "TeamSignup" SET "status" = ${s} WHERE "id" = ${id}`;
}

export async function dbDeleteSignup(prisma, id) {
  await prisma.$executeRaw`DELETE FROM "TeamSignup" WHERE "id" = ${id}`;
}
