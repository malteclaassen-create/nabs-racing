// ---------------------------------------------------------------------------
// The race recap's doorways. The page itself is pages/RaceRecapPage.jsx.
//
// RaceRecapHost sits at the root of the app and asks the server once per
// page load whether a recap is waiting; when one is, it takes the member to
// the recap page with the payload in hand, and arriving there counts as seen.
// RaceRecapButton is the "read it again" button on a race page. Both keep out
// of the way unless the feature is on for this member.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";

const STATE_EVENT = "nabs-race-recap-state";

export const recapPath = (recap) => `${recap.race.seriesSlug ? `/s/${recap.race.seriesSlug}` : ""}/recap/${recap.race.id}`;

// Whether the feature is on for this member, as the host's one request found
// out. Shared so the Recap button on a race page does not have to ask again.
let enabledState = null; // null = not asked yet
function setEnabled(v) {
  enabledState = v;
  window.dispatchEvent(new Event(STATE_EVENT));
}
export function useRaceRecapEnabled() {
  const [on, setOn] = useState(enabledState === true);
  useEffect(() => {
    const sync = () => setOn(enabledState === true);
    window.addEventListener(STATE_EVENT, sync);
    return () => window.removeEventListener(STATE_EVENT, sync);
  }, []);
  return on;
}

let asked = false; // once per page load, whichever page it was

// Whether the host has had its answer, so the nav bar can hold a "+50" back
// until the member is past the recap: the tokens are the ending, not
// something that plays behind the recap page on its way in.
const SETTLED_EVENT = "nabs-race-recap-settled";
let settled = false;
function settle() {
  if (settled) return;
  settled = true;
  window.dispatchEvent(new Event(SETTLED_EVENT));
}
export function useRecapSettled() {
  const [done, setDone] = useState(settled);
  useEffect(() => {
    if (settled) {
      setDone(true);
      return undefined;
    }
    const on = () => setDone(true);
    window.addEventListener(SETTLED_EVENT, on);
    return () => window.removeEventListener(SETTLED_EVENT, on);
  }, []);
  return done;
}

export default function RaceRecapHost() {
  const { isLoggedIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoggedIn) {
      asked = false; // the next login on this tab asks afresh
      return;
    }
    if (asked) return settle();
    // Not on race night: the live page is left up for hours, and being sent
    // to last week's recap in the middle of this week's timing would be
    // rude. Nor from the admin, where the office is busy saving the very
    // result, and not from the recap page itself.
    const p = location.pathname;
    if (p.startsWith("/admin") || p.startsWith("/auth") || /\/live(\/|$)/.test(p) || /\/recap\//.test(p)) return settle();
    let gone = false;
    // A beat after the page, so the hand-over happens on a settled page.
    const t = setTimeout(() => {
      asked = true;
      api
        .myRaceRecap()
        .then((r) => {
          setEnabled(!!r?.enabled);
          if (gone || !r?.recap) return;
          navigate(recapPath(r.recap), { state: { recap: r.recap, pending: true } });
        })
        .catch(() => {})
        .finally(settle);
    }, 900);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [isLoggedIn, location.pathname, navigate]);

  return null;
}

// The Recap button on a race page: the same page, read again. Only for a
// member with a seat, only when the feature is on for them, only once the
// round has a result.
//
// `session` is the tab it was pressed from. A sprint weekend's recap holds
// both races, so pressing Recap on the Sprint tab should open it on the
// sprint rather than make the reader find it again.
export function RaceRecapButton({ raceId, ready, session = null }) {
  const { user } = useAuth();
  const enabled = useRaceRecapEnabled();
  const location = useLocation();
  if (!enabled || !user?.driverId || !ready || !raceId) return null;
  const prefix = location.pathname.match(/^\/s\/[^/]+/)?.[0] || "";
  return (
    <Link
      to={`${prefix}/recap/${raceId}${session === "sprint" ? "?session=sprint" : ""}`}
      title="Your recap of this round"
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-medium transition hover:border-brand/60 hover:text-dark"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 15l3-4 3 3 4-6" />
      </svg>
      Recap
    </Link>
  );
}
