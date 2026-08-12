import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "./useAuth.js";
import { useVisiblePoll } from "./useVisiblePoll.js";

// How much is waiting on an admin, for the parts of the site that are not the
// admin area.
//
// The league is run in evenings. Nobody sits on the admin page waiting for work
// to appear; they come to the site as a driver, and the things that need a
// decision (an incident report, a bug someone wrote in, a login with no driver
// row, a seat somebody wants) sit unseen behind a menu until somebody thinks to
// look. The dot is there so nobody has to think to look.
//
// One request, four numbers and their sum, and only for an admin: everyone else
// never calls it. The admin's own navigation keeps its own per-tab counts,
// because it has the lists in hand anyway; this is only the total for a dot.
//
// The dot itself is components/AttentionDot.jsx — this file stays free of JSX
// so it can be a plain .js hook like the rest of them.

// Anything that can change how many seats are waiting on an admin. A reserve
// putting their hand up MAKES admin work, so the members' side of the market
// fires it too, not just the admin panel. Same trick the feedback and reports
// tabs use to keep their badge honest without polling for it.
//
// It lives here rather than in either component so that neither owns it and
// both can import it without importing each other.
export const MARKET_CHANGED_EVENT = "nabs-market-changed";

// The events the admin tabs already fire when a piece of work is dealt with.
//
// Written out rather than imported from AdminFeedback / AdminReports /
// AdminMembers on purpose: this hook runs on every page an admin opens, and
// importing those would pull the whole admin area into the bundle everyone
// downloads. The cost is that renaming one of them over there silently stops
// matching here. It fails softly — the dot then clears on the next poll rather
// than at once — but if you rename one, rename it here. (Note the members one
// uses a colon where the other two use a hyphen. That is how it is written.)
const CLEARED_EVENTS = [
  MARKET_CHANGED_EVENT,
  "nabs-feedback-changed", // AdminFeedback.jsx FEEDBACK_CHANGED_EVENT
  "nabs-reports-changed", // AdminReports.jsx REPORTS_CHANGED_EVENT
  "nabs:members-changed", // AdminMembers.jsx MEMBERS_CHANGED_EVENT
];

// Slower than the notification bell's minute. What this counts arrives over
// hours, not seconds, and it rides on every page an admin opens.
const POLL_MS = 120_000;

export function useAdminAttention() {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [counts, setCounts] = useState(null);

  useVisiblePoll(
    (alive) => {
      api
        .adminAttention()
        .then((d) => alive() && setCounts(d || null))
        .catch(() => {});
    },
    POLL_MS,
    isAdmin
  );

  // Two minutes is fine for work ARRIVING. Work being FINISHED is a different
  // matter: an admin who has just dealt with the last seat should not walk away
  // from a page still wearing the dot that sent them there. So the same events
  // the admin tabs use to drop their own badges refresh this too.
  useEffect(() => {
    if (!isAdmin) return undefined;
    let alive = true;
    const refresh = () => {
      api
        .adminAttention()
        .then((d) => alive && setCounts(d || null))
        .catch(() => {});
    };
    for (const ev of CLEARED_EVENTS) window.addEventListener(ev, refresh);
    return () => {
      alive = false;
      for (const ev of CLEARED_EVENTS) window.removeEventListener(ev, refresh);
    };
  }, [isAdmin]);

  // Signing out has to take the dot with it, or it hangs there against a
  // profile chip that is no longer an admin's.
  useEffect(() => {
    if (!isAdmin) setCounts(null);
  }, [isAdmin]);

  return {
    isAdmin,
    total: counts?.total || 0,
    feedback: counts?.feedback || 0,
    reports: counts?.reports || 0,
    members: counts?.members || 0,
    market: counts?.market || 0,
  };
}
