import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useAsk } from "./overlay.jsx";

// The attendance reminder, shared by the three places that offer it: the race
// list under "Who can sign up", the "Still to answer" view, and the nudge in
// the Notifications tab.
//
// The reminder used to be a broadcast every member got, answered or not, and
// the button fired it without a word. It now reaches only the drivers who have
// not answered (the "Still to answer" list, same rule on the server), so the
// one thing worth knowing before pressing is who that is — the confirmation
// asks the server first and says the numbers, including the people it cannot
// reach at all. Those are the ones who need a DM instead, and finding that out
// only afterwards was the other half of the problem.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "just now" / "5 min ago" / "2 h ago" / "3 days ago". Coarse on purpose: the
// question is "did somebody already chase them today", not the exact minute —
// that is in the tooltip.
export function fmtAgo(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

export function LastReminder({ at, className = "" }) {
  if (!at) return null;
  return (
    <span className={className} title={new Date(at).toLocaleString("en-GB")}>
      Last reminder: {fmtAgo(at)}
    </span>
  );
}

// What a reminder for this race is called in the dialog.
const raceName = (race) =>
  race ? `${race.type === "TRAINING" ? "the training session" : `Round ${race.number}`} at ${race.track}` : "this race";

// remind(race) asks, sends and resolves to { ok, text, lastSentAt } — or to
// null when the admin said no. `busyId` is the race being reminded right now,
// so the button that started it can say so and every other one can wait.
export function useAttendanceReminder() {
  const ask = useAsk();
  const [busyId, setBusyId] = useState(null);

  const remind = useCallback(
    async (race) => {
      if (!race?.id) return null;
      setBusyId(race.id);
      try {
        const pre = await api.adminAttendancePingPreview(race.id);
        const last = pre.lastSentAt ? ` The last reminder went out ${fmtAgo(pre.lastSentAt)}.` : "";
        if (pre.silent === 0) {
          await ask({ title: "Everyone has answered", body: `Nobody is left to remind for ${raceName(race)}.`, alert: true });
          return null;
        }
        if (pre.reachable === 0) {
          await ask({
            title: "Nobody here to remind",
            body: `${plural(pre.silent, "driver")} haven't answered ${raceName(race)}, and none of them has ever logged in on the site, so the bell can't reach them. Their Discord handles are under Attendance → Still to answer.`,
            alert: true,
          });
          return null;
        }
        const yes = await ask({
          title: `Remind ${plural(pre.silent, "driver")} who haven't answered?`,
          body:
            (pre.withoutLogin
              ? `${pre.withoutLogin} of them ${pre.withoutLogin === 1 ? "has" : "have"} never logged in and can't be reached here. `
              : "") +
            `${pre.reachable === pre.silent ? "Each of them" : `The other ${pre.reachable}`} ${pre.reachable === 1 ? "gets" : "get"} a personal note in the bell for ${raceName(race)}. Drivers who have answered hear nothing.${last}`,
          confirmLabel: `Remind ${pre.reachable}`,
        });
        if (!yes) return null;
        const res = await api.adminAttendancePing(race.id);
        return {
          ok: true,
          lastSentAt: res.lastSentAt,
          text: res.repeated
            ? `That reminder already went out ${fmtAgo(res.lastSentAt)}, to ${plural(res.sent, "driver")}.`
            : `Reminder sent to ${plural(res.sent, "driver")} for ${raceName(race)}.` +
              (res.withoutLogin ? ` ${res.withoutLogin} can't be reached here; their handles are under Still to answer.` : ""),
        };
      } catch (e) {
        return { ok: false, text: e.message };
      } finally {
        setBusyId(null);
      }
    },
    [ask]
  );

  return { remind, busyId };
}
