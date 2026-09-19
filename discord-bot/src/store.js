// state.json: { days: { "YYYY-MM-DD": { userId: { messages, minutes } } }, invites, referrals }
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { config } from "./config.js";
import { isStale, leagueDay } from "./day.js";

const EMPTY = { days: {}, invites: {}, referrals: [] };

export function load() {
  try {
    const raw = JSON.parse(readFileSync(config.statePath, "utf8"));
    return { ...EMPTY, ...raw, days: raw.days || {}, invites: raw.invites || {}, referrals: raw.referrals || [] };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function save(state) {
  const tmp = `${config.statePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, config.statePath);
}

export function bumpMessages(state, userId, n = 1, day = leagueDay()) {
  const row = rowFor(state, day, userId);
  row.messages += n;
  return row;
}

export function bumpMinutes(state, userId, n = 1, day = leagueDay()) {
  const row = rowFor(state, day, userId);
  row.minutes += n;
  return row;
}

function rowFor(state, day, userId) {
  const d = (state.days[day] ||= {});
  return (d[userId] ||= { messages: 0, minutes: 0 });
}

// only rows that changed since the last ack
export function pendingActivity(state) {
  const out = [];
  for (const [day, users] of Object.entries(state.days)) {
    for (const [discordId, row] of Object.entries(users)) {
      if (row.sentMessages === row.messages && row.sentMinutes === row.minutes) continue;
      out.push({ discordId, day, messages: row.messages, minutes: row.minutes });
    }
  }
  return out;
}

export function markSent(state, entries) {
  for (const e of entries) {
    const row = state.days?.[e.day]?.[e.discordId];
    if (!row) continue;
    row.sentMessages = e.messages;
    row.sentMinutes = e.minutes;
  }
}

// old days go, unless the site never took them. a week of the site being
// unreachable should not quietly throw away what people did in it.
export function forgetOldDays(state, now = Date.now()) {
  let dropped = 0;
  for (const [day, users] of Object.entries(state.days)) {
    if (!isStale(day, now)) continue;
    const unsent = Object.values(users).some((r) => r.sentMessages !== r.messages || r.sentMinutes !== r.minutes);
    if (unsent) continue;
    delete state.days[day];
    dropped++;
  }
  return dropped;
}
