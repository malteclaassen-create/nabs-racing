// ---------------------------------------------------------------------------
// The race recap's doorways. The page itself is pages/RaceRecapPage.jsx.
//
// RaceRecapHost sits at the root of the app and asks the server whether a
// recap is waiting: a beat after every page the member opens, every half
// minute while the tab is open and in view, and when the tab comes back into
// view. The ask is the cheap one (is one waiting, and of which round); only
// when the answer is yes and this is a page it may be shown on does the host
// fetch the recap itself and take the member to the recap page with it in
// hand. Arriving there counts as seen.
// RaceRecapButton is the "read it again" button on a race page. Both keep out
// of the way unless the feature is on for this member.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
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

let asked = false; // the server has answered at least once on this tab
let lastAsk = 0; // when the last ask went out
let busy = false; // an ask is on its way
// A recap the server said is waiting but that could not be shown where the
// member was (the live page mid-week, a form being typed in). The next page
// they open asks at once instead of waiting out the gap between two asks.
let waiting = false;

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
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const loggedInRef = useRef(isLoggedIn);
  loggedInRef.current = isLoggedIn;

  // One ask, whatever set it off. Everything is judged against where the
  // member is when the answer arrives, not where they were when it went out:
  // somebody who opens the site and taps on to the standings within a second
  // is still taken to their recap, from the standings.
  const check = useCallback(
    async (force = false) => {
      if (!loggedInRef.current || busy) return;
      // Not from the admin, where the office is busy saving the very result,
      // and not from the recap page itself; not in a tab nobody is looking at,
      // where arriving on the recap would count as seen without being seen.
      if (offLimits(pathRef.current) || document.visibilityState !== "visible") return settle();
      // The switch was off for this member the last time: no need to keep asking.
      if (asked && enabledState === false) return settle();
      if (asked && !force && Date.now() - lastAsk < ASK_MIN_GAP_MS) return settle();
      busy = true;
      lastAsk = Date.now();
      try {
        const r = await api.myRaceRecapPeek();
        asked = true;
        setEnabled(!!r?.enabled);
        // A server from before the peek answers with the recap itself.
        let recap = r?.recap || null;
        const pending = r?.pending || (recap ? { raceId: recap.race?.id, date: recap.race?.date } : null);
        waiting = false;
        if (!pending) return;
        const fits = () => loggedInRef.current && !offLimits(pathRef.current) && mayShow(pathRef.current, pending.date) && !typing();
        if (!fits()) {
          waiting = true;
          return;
        }
        if (!recap) recap = (await api.myRaceRecap())?.recap || null;
        if (!recap) return;
        // Building it took a moment: look again at where the member is now.
        if (!fits()) {
          waiting = true;
          return;
        }
        navigate(recapPath(recap), { state: { recap, pending: true } });
      } catch {
        /* offline, or the session ran out: the next ask tries again */
      } finally {
        busy = false;
        settle();
      }
    },
    [navigate]
  );

  // A beat after every page, so the hand-over happens on a settled page. Most
  // of these stop at the gap between two asks; the first one of a visit and
  // the one after a held-back recap go out.
  useEffect(() => {
    if (!isLoggedIn) {
      // The next login on this tab asks afresh.
      asked = false;
      waiting = false;
      return undefined;
    }
    const t = setTimeout(() => check(waiting), 900);
    return () => clearTimeout(t);
  }, [isLoggedIn, location.pathname, check]);

  // Somebody already on the site when the office saves the round asked on
  // arrival, before there was anything to show. So an open tab keeps asking,
  // and asks when it comes back into view.
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const tick = () => check();
    const timer = setInterval(tick, ASK_EVERY_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [isLoggedIn, check]);

  return null;
}

// How often an open tab asks, and the least time between two asks whatever
// set them off (a page change, the tab flicking in and out of view). The ask
// is a handful of small queries, so half a minute costs nothing; it is the
// longest a member on the site waits for the recap of a round just saved.
const ASK_EVERY_MS = 30_000;
const ASK_MIN_GAP_MS = 10_000;

// Where the host never takes a member away: the admin (the office saving the
// result) and the recap page itself.
const offLimits = (p) => p.startsWith("/admin") || p.startsWith("/auth") || /\/recap\//.test(p);

// Never while they are typing, so a form is not pulled away under them.
function typing() {
  const el = document.activeElement;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

// The live page is left up for hours, and being sent to last week's recap in
// the middle of this week's timing would be rude. But once tonight's round is
// saved, the live page is exactly where everybody is, so tonight's recap may
// take them from there.
const TONIGHT_MS = 12 * 3_600_000;
const onLive = (p) => /\/live(\/|$)/.test(p);
function mayShow(path, raceDate) {
  if (!onLive(path)) return true;
  const ran = raceDate ? new Date(raceDate).getTime() : NaN;
  return Number.isFinite(ran) && Date.now() - ran < TONIGHT_MS;
}

// The Recap button on a race page: the same page, read again. Only for a
// member with a seat, only when the feature is on for them, only once the
// round has a result.
//
// `session` is the tab it was pressed from. A sprint weekend's recap holds
// both races, so pressing Recap on the Sprint tab should open it on the
// sprint rather than make the reader find it again.
// `iconOnPhone`: just the icon below sm (the label stays for screen readers),
// for a row that has to share its line with a title.
export function RaceRecapButton({ raceId, ready, session = null, iconOnPhone = false }) {
  const { user } = useAuth();
  const enabled = useRaceRecapEnabled();
  const location = useLocation();
  if (!enabled || !user?.driverId || !ready || !raceId) return null;
  const prefix = location.pathname.match(/^\/s\/[^/]+/)?.[0] || "";
  return (
    <Link
      to={`${prefix}/recap/${raceId}${session === "sprint" ? "?session=sprint" : ""}`}
      title="Your recap of this round"
      className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-card font-mono text-[11px] font-bold uppercase tracking-wider text-medium transition hover:border-brand/60 hover:text-dark ${
        iconOnPhone ? "px-2 py-1.5 sm:px-2.5 sm:py-1" : "px-2.5 py-1"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 15l3-4 3 3 4-6" />
      </svg>
      <span className={iconOnPhone ? "max-sm:sr-only" : undefined}>Recap</span>
    </Link>
  );
}
