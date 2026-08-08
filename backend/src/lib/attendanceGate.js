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
// The hand always wins over the rule. Beyond that, one thing closes a race by
// itself: an hour after its start (league call, 2026-08-08). By then the grid
// is on track and an answer changes nothing — so the sign-up shuts, the entry
// list freezes as the final grid, and the Attendance nav item steps aside.
// Everything comes back the moment the RESULT is saved: isCompleted takes the
// race out of the upcoming set, the NEXT round becomes the one taking answers,
// and the nav item returns pointing at its track. (Before this, a race stayed
// answerable until its result landed; the last hour of that window was the
// race itself, which is what made the button pointless.)
//
// Stored as one Setting blob of overrides rather than a column on Race: only
// the handful of races an admin has touched appear in it, and it needs no
// migration to deploy.
// ---------------------------------------------------------------------------
import { attendanceOpensAt } from "./notifications.js";
import { raceKickoff } from "./raceKickoff.js";

// How long after lights-out the sign-up survives. Matches "about an hour": the
// stragglers who answer during the formation lap keep their minute, everyone
// else finds the sign-up gone once the race is properly under way.
export const SIGNUP_CLOSE_AFTER_START_MS = 60 * 60 * 1000;

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

// Whether a race is on the attendance page at all is a separate question,
// answered by lib/attendanceHidden.js.

// What a race's sign-up is doing right now.
//   open           — answers accepted
//   opensAt        — when it will open on its own (null when it already is, or
//                    when an admin closed it: "some time in the future" would
//                    be a lie)
//   forced         — "open" | "closed" | null, i.e. whether a person decided
//   closedForStart — the race started over an hour ago; sign-up is over and
//                    the entry list is the final grid
export function attendanceGate(race, notify, overrides = {}) {
  const forced = overrides[race?.id] || null;
  if (forced === "closed") return { open: false, opensAt: null, forced, closedForStart: false };
  if (forced === "open") return { open: true, opensAt: null, forced, closedForStart: false };
  const kick = raceKickoff(race?.date);
  if (kick && Date.now() >= kick.getTime() + SIGNUP_CLOSE_AFTER_START_MS) {
    return { open: false, opensAt: null, forced: null, closedForStart: true };
  }
  const opensAt = attendanceOpensAt(race, notify);
  return { open: !opensAt || opensAt.getTime() <= Date.now(), opensAt, forced: null, closedForStart: false };
}
