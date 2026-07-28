// ---------------------------------------------------------------------------
// Who may answer which race.
//
// There are two ways a race's sign-up opens, and they layer:
//
//   1. The rule. "Sign-up opens N days before the race at HH:00", set once in
//      the notification settings and applied to every race. With no rule
//      configured (the default), every upcoming race is open.
//   2. The admin's hand. A race can be forced open or forced closed regardless
//      of the rule — for the round you want answers on NOW, or the one you'd
//      rather nobody committed to three months early.
//
// The hand always wins over the rule, and nothing here ever closes a race by
// itself: a race leaves the attendance page when its RESULT is saved
// (isCompleted), not when its start time passes. A race that ran an hour ago
// with no result yet is still there, still answerable — which is exactly the
// window in which someone realises they never answered.
//
// Stored as one Setting blob of overrides rather than a column on Race: only
// the handful of races an admin has touched appear in it, and it needs no
// migration to deploy.
// ---------------------------------------------------------------------------
import { attendanceOpensAt } from "./notifications.js";

const KEY = "attendance_overrides";
export const ATTENDANCE_STATES = ["auto", "open", "closed"];

export async function readAttendanceOverrides(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    const obj = row?.value ? JSON.parse(row.value) : null;
    if (!obj || typeof obj !== "object") return {};
    const out = {};
    for (const [raceId, state] of Object.entries(obj)) {
      if (typeof raceId === "string" && (state === "open" || state === "closed")) out[raceId] = state;
    }
    return out;
  } catch {
    return {};
  }
}

// state "auto" (or anything unknown) drops the override and hands the race back
// to the rule. Returns the full map as saved.
export async function writeAttendanceOverride(prisma, raceId, state) {
  const current = await readAttendanceOverrides(prisma);
  if (state === "open" || state === "closed") current[raceId] = state;
  else delete current[raceId];
  const json = JSON.stringify(current);
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: json }, update: { value: json } });
  return current;
}

// What a race's sign-up is doing right now.
//   open    — answers accepted
//   opensAt — when it will open on its own (null when it already is, or when an
//             admin closed it: "some time in the future" would be a lie)
//   forced  — "open" | "closed" | null, i.e. whether a person decided this
export function attendanceGate(race, notify, overrides = {}) {
  const forced = overrides[race?.id] || null;
  if (forced === "closed") return { open: false, opensAt: null, forced };
  if (forced === "open") return { open: true, opensAt: null, forced };
  const opensAt = attendanceOpensAt(race, notify);
  return { open: !opensAt || opensAt.getTime() <= Date.now(), opensAt, forced: null };
}
