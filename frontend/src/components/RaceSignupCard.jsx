import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Hourglass, Fingerprint, Copy, Check, Undo2 } from "lucide-react";
import { NoData } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";
import SeatMarket from "./SeatMarket.jsx";
import Flag from "./Flag.jsx";
import { countryFor } from "../data/driverCountries.js";
import { api } from "../api/client.js";
import { copyText } from "../utils/copyText.js";
import { useAsk } from "./overlay.jsx";
import { threeLetterMonths } from "../utils/format.js";

// Quiet by default, colour only where it means something: the three answer
// buttons are neutral outlines with a tinted icon, and fill with their status
// colour once picked. The race identity itself lives in the hero above this
// card on the Attendance page, so the header only carries the question.
// Exported: UpcomingRacePanel's "final entry list" card reuses the exact
// column look (icons, titles, colours) so the outcome reads as the same
// feature the members answered on.
export const STATUS_UI = {
  ACCEPTED: {
    label: "Accept",
    title: "Accepted",
    icon: "M4.5 12.5l5 5L19.5 7",
    idle: "border-border bg-card text-medium hover:border-green-600/60 hover:text-dark",
    idleIcon: "text-ok",
    active: "border-green-600 bg-green-600 text-white",
    bar: "bg-green-600",
  },
  DECLINED: {
    label: "Decline",
    title: "Declined",
    icon: "M6 6l12 12M18 6L6 18",
    idle: "border-border bg-card text-medium hover:border-red-600/60 hover:text-dark",
    idleIcon: "text-bad",
    active: "border-red-600 bg-red-600 text-white",
    bar: "bg-red-600",
  },
  TENTATIVE: {
    label: "Tentative",
    title: "Tentative",
    icon: "M9 9.2a3 3 0 115.4 1.8c-.8 1-2.4 1.5-2.4 3M12 17.5h.01",
    idle: "border-border bg-card text-medium hover:border-amber-500/60 hover:text-dark",
    idleIcon: "text-warn",
    active: "border-amber-500 bg-amber-500 text-white",
    bar: "bg-amber-500",
  },
};

// The waiting list.
//
// Not a fourth answer button and not one of the admin's three columns: it is
// what Accept turns into once the grid is full, and it gets its own numbered
// block under the columns because a queue is an order, not a set. Blue, because
// it is neither a yes nor a no: it is "next, if a seat comes free".
export const WAITLIST = "WAITLIST";

const WAITLIST_UI = {
  label: "Join waiting list",
  title: "Waiting list",
  Icon: Hourglass,
  idle: "border-border bg-card text-medium hover:border-sky-500/60 hover:text-dark",
  idleIcon: "text-link",
  active: "border-sky-600 bg-sky-600 text-white",
};

export function StatusIcon({ d, className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 ${className}`} fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// Substitution mark, the football convention: a green arrow going up for the
// stand-in coming on, a red one going down for the driver sitting the round
// out. Only ever shown for a seat somebody has actually taken over — an offer
// still looking for a taker is the Driver Market's business, below.
//
// The logo beside the name already shows the stand-in in the car they will
// drive, so the arrow is what says it is a swap and not their own seat.
// Exported: the frozen entry list on the Races page shows the same mark.
export function SubMark({ sub }) {
  if (!sub) return null;
  const inbound = sub.direction === "IN";
  const label = inbound
    ? `Standing in${sub.forName ? ` for ${sub.forName}` : ""}${sub.teamName ? ` at ${sub.teamName}` : ""}`
    : `Sitting this one out${sub.forName ? `, ${sub.forName} takes the seat` : ""}`;
  return (
    <span title={label} aria-label={label} className="shrink-0 leading-none">
      <svg
        viewBox="0 0 24 24"
        className={`h-3.5 w-3.5 ${inbound ? "text-ok" : "text-bad"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {inbound ? <path d="M12 20V5M6 11l6-6 6 6" /> : <path d="M12 4v15M6 13l6 6 6-6" />}
      </svg>
    </span>
  );
}

// When an answer was given, short. The date is in there because a sign-up that
// opened five days ago is five days of "19:42" otherwise.
function answerTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return threeLetterMonths(d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }));
}

// The Steam id, on the same line as the name and pushed to the right of it.
// The sign-up usually runs with two columns rather than three (a league that
// has switched Tentative off), which leaves the room for it — it went under the
// name first and turned a grid of 43 into 86 lines to scroll past.
//
// The whole thing is the copy button: one click and the id is on the clipboard,
// which is what an admin is here for. When they answered rides along as the
// name's tooltip instead of a line of its own.
function SteamTag({ steamId }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(t);
  }, [done]);
  if (!steamId) {
    return <span className="shrink-0 font-mono text-[10px] text-faint">no ID</span>;
  }
  return (
    <button
      type="button"
      title="Copy this Steam ID"
      onClick={async () => setDone(await copyText(steamId))}
      className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-light transition hover:text-dark"
    >
      {done ? (
        <Check className="h-3 w-3 shrink-0 text-ok" aria-hidden="true" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 opacity-40" aria-hidden="true" />
      )}
      {steamId}
    </button>
  );
}

// One upcoming race: attendance buttons (when signed in) + the three status
// columns + the embedded Driver Market. State/actions are owned by the parent.
export default function RaceSignupCard({
  ev,
  marketRace,
  me,
  reloadMarket,
  driverId,
  canSignUp,
  isLoggedIn,
  raceRequest,
  onRequestSeat,
  busy,
  onSetStatus,
  onClear,
  // Lets the page place the card — the attendance layout hands it `lg:grow` so
  // it fills whatever height the video beside it leaves over.
  className = "",
  // Reserve nudge: whether to mark the free seats, and a handle on the market
  // block so the page can scroll to it and notice when it is on screen.
  seatHighlight = false,
  seatRef = null,
  // Unlocks the Steam-id view in the header. The ids themselves are fetched
  // separately and only when asked for — see the header strip below.
  isAdmin = false,
}) {
  // The market context of the RACE's season — see the note further down at
  // SeatMarket for why it is read this way even when null.
  const meHere = marketRace && "me" in marketRace ? marketRace.me : me;
  // Both rows count as "me". A login points at ONE driver row and a race can
  // belong to another season, where the same person has a different row — which
  // is the row the server files the answer and the offer under. Matching only
  // the login's row left a member looking at their own answer with no way to
  // take it back, because the card did not recognise it as theirs.
  const myIds = new Set([driverId, meHere?.driverId].filter(Boolean));
  const myStatus = ["ACCEPTED", "DECLINED", "TENTATIVE", WAITLIST].find((s) =>
    (ev.rsvps[s] || []).some((r) => myIds.has(r.driverId))
  );
  // A seat handed to the Driver Market has answered the question already: the
  // offer files a DECLINED with it (routes/market.js) and the server refuses
  // anything else while it stands. So the buttons go quiet rather than pretend.
  // CANCELLED offers never reach the page, and a FILLED one counts doubly —
  // somebody else is in that car.
  const myOffer = (marketRace?.offers || []).find((o) => myIds.has(o.offeredBy.driverId));
  // The other side of the same coin: an offer somebody else made that I was
  // given. The buttons above cannot answer for it, so it gets its own way out.
  const mySeat = (marketRace?.offers || []).find(
    (o) => o.status === "FILLED" && myIds.has(o.filledBy?.driverId)
  );
  const [standingDown, setStandingDown] = useState(false);
  const ask = useAsk();
  async function standDown() {
    if (!mySeat) return;
    const yes = await ask({
      title: "Give this seat back?",
      body: `You are down to drive ${mySeat.team?.name || "this car"} for ${mySeat.offeredBy?.name || "another driver"}. Giving it back puts the seat on the market again, takes you off the entry list, and tells the stewards.`,
      confirmLabel: "Yes, I can't take it",
      danger: true,
    });
    if (!yes) return;
    setStandingDown(true);
    try {
      await api.standDownFromSeat(mySeat.id);
      await reloadMarket?.();
    } finally {
      setStandingDown(false);
    }
  }
  const capacity = ev.capacity ?? 40;
  const accepted = ev.rsvps.ACCEPTED.length;
  // The queue, in join order (the server sorts it, and promotes in the same
  // order). `gridFull` is the server's verdict rather than a sum worked out
  // here, so the button and what happens when you press it always agree: a car
  // being handed over in the Driver Market still counts as taken.
  const waiting = ev.rsvps[WAITLIST] || [];
  const gridFull = !!ev.gridFull;
  const myWaitingPlace = waiting.findIndex((r) => myIds.has(r.driverId)) + 1;

  // Giving up a seat on a full grid is a one-way door, and it did not used to
  // look like one. The moment the answer changes, the front of the queue is
  // moved onto the grid and the seat is gone — so the Accept button that was
  // there a second ago is a waiting-list button by the time anybody realises
  // they meant to press something else. One question before that happens.
  //
  // Only ever asked of somebody who actually HAS a seat to lose, and only when
  // losing it costs something: a round with an empty queue and a seat spare
  // takes them straight back, and a dialog for that is noise.
  const seatIsPrecious = myStatus === "ACCEPTED" && (waiting.length > 0 || gridFull);
  async function confirmLeavingTheGrid(how) {
    if (!seatIsPrecious) return true;
    const next = waiting[0];
    return ask({
      title: how === "clear" ? "Take your answer back?" : "Give up your seat?",
      body: waiting.length
        ? `The grid is full and ${waiting.length} ${waiting.length === 1 ? "driver is" : "drivers are"} waiting, so your seat goes to ${next?.name || "the first of them"} straight away. You can't take it back — the most you can do is join the waiting list behind everyone in it.`
        : "The grid is full, so the seat you give up is open to the next person who answers. If somebody takes it, the most you can do is join the waiting list.",
      confirmLabel: how === "clear" ? "Yes, take it back" : "Yes, I'm out",
      danger: true,
    });
  }
  async function answer(status) {
    if (status !== "ACCEPTED" && !(await confirmLeavingTheGrid(status))) return;
    onSetStatus(ev.id, status);
  }
  async function clearAnswer() {
    if (!(await confirmLeavingTheGrid("clear"))) return;
    onClear(ev.id);
  }

  // Admin view: Steam ids + answer times beside the names. Fetched on the first
  // ask and kept for as long as the card stays on this race, so flicking it on
  // and off does not hit the server every time. Reset when the race changes —
  // the ids belong to that entry list and nobody else's.
  const [adminView, setAdminView] = useState(false);
  const [steamIds, setSteamIds] = useState(null);
  const [steamError, setSteamError] = useState(null);
  const [copyNote, setCopyNote] = useState(null);
  useEffect(() => {
    setAdminView(false);
    setSteamIds(null);
    setSteamError(null);
  }, [ev.id]);
  useEffect(() => {
    if (!copyNote) return undefined;
    const t = setTimeout(() => setCopyNote(null), 2000);
    return () => clearTimeout(t);
  }, [copyNote]);
  async function toggleAdminView() {
    if (adminView) {
      setAdminView(false);
      return;
    }
    setAdminView(true);
    if (steamIds) return;
    try {
      const res = await api.raceSteamIds(ev.id);
      setSteamIds(res?.ids || {});
    } catch (e) {
      setSteamError(e.message);
    }
  }
  // The whole accepted column as a list of ids, which is the shape an entry
  // list for the server wants. Names left out on purpose: this is the thing
  // that gets pasted, and a name beside it only has to be deleted again.
  const acceptedSteamIds = useMemo(
    () => ev.rsvps.ACCEPTED.map((r) => steamIds?.[r.driverId]).filter(Boolean),
    [ev.rsvps.ACCEPTED, steamIds]
  );
  async function copyAllSteamIds() {
    const ok = await copyText(acceptedSteamIds.join("\n"));
    setCopyNote(ok ? `${acceptedSteamIds.length} Steam IDs copied` : "This browser blocked the clipboard");
  }

  // Sign-up window (admin-configured): before it opens, the buttons make way
  // for a note saying when. Which answer columns show is also the admin's call.
  const opensAt = ev.attendanceOpensAt ? new Date(ev.attendanceOpensAt) : null;
  // The lock has to expire on its own. This was read once during render and
  // nothing re-rendered the card when the moment arrived, so a member sitting
  // on the page as sign-ups opened — which is exactly what the "sign-ups are
  // open" notification produces — kept looking at the padlock until they
  // reloaded. One timer, armed for the opening moment and only while it is
  // still ahead of us.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!opensAt) return;
    const ms = opensAt.getTime() - Date.now();
    if (ms <= 0) return;
    // setTimeout clamps above ~24.8 days; re-arm daily until we are inside range.
    const t = setTimeout(() => forceTick((n) => n + 1), Math.min(ms + 250, 6 * 60 * 60 * 1000));
    return () => clearTimeout(t);
  }, [opensAt?.getTime()]);
  // Two ways to be shut: not open YET (a countdown to a known moment), or shut
  // by an admin for this race (no moment to name — it opens when they say so).
  const closedByAdmin = !!ev.attendanceClosed;
  // `locked` = no answering. `notYetOpen` additionally hides the entry list,
  // because before a sign-up opens there is nothing in it worth showing. A race
  // an admin CLOSED is the opposite case: the list is the whole point — it's
  // the final grid — so it stays, only the buttons go.
  const notYetOpen = !closedByAdmin && !!opensAt && opensAt.getTime() > Date.now();
  const locked = closedByAdmin || notYetOpen;
  const visible = ["ACCEPTED", "DECLINED", "TENTATIVE"].filter(
    (s) => !Array.isArray(ev.visibleStatuses) || ev.visibleStatuses.includes(s)
  );
  // Shown in the viewer's own timezone with its abbreviation ("08:00 CEST"),
  // matching how the site presents kickoff times everywhere else.
  const opensLabel =
    opensAt &&
    threeLetterMonths(opensAt.toLocaleString("en-GB", {
      weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      timeZoneName: "short",
    }));

  const gridRow = !notYetOpen && visible.includes("ACCEPTED");

  return (
    <div data-tour="signup-card" className={`card reveal flex flex-col overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border px-5 py-4">
        <div>
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">Sign-Up</h3>
          <p className="mt-0.5 font-display text-lg font-extrabold uppercase tracking-tight text-dark">
            Are you on the grid?
          </p>
        </div>
        {locked ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface2/60 px-3 py-2 text-sm font-semibold text-medium">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-light" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 118 0v3" />
            </svg>
            {closedByAdmin ? "Sign-up closed" : `Sign-up opens ${opensLabel}`}
          </div>
        ) : canSignUp ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* Only the answers the admin offers get a button (the same list
                that decides the columns below). The server refuses the rest.

                On a full grid the Accept button becomes the waiting list: the
                seat it promises does not exist, and a button that answers with
                an error is worse than one that says what it can actually do.
                Somebody who already holds a seat keeps their Accept, however
                full the round is. */}
            {Object.entries(STATUS_UI)
              .filter(([status]) => visible.includes(status))
              .map(([status, ui]) =>
                status === "ACCEPTED" && gridFull && myStatus !== "ACCEPTED"
                  ? [WAITLIST, WAITLIST_UI]
                  : [status, ui]
              )
              .map(([status, ui]) => {
              const active = myStatus === status;
              return (
                <button
                  key={status}
                  onClick={() => answer(status)}
                  disabled={!!myOffer || busy === `${ev.id}:${status}`}
                  aria-pressed={active}
                  // The one it is stuck on keeps its colour, so the card still
                  // says what the answer IS. The other two go flat: greying the
                  // lot would leave the question looking unanswered.
                  title={myOffer ? "Your seat is offered in the Driver Market" : undefined}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition sm:flex-none ${
                    active ? ui.active : ui.idle
                  } ${myOffer ? (active ? "cursor-not-allowed" : "cursor-not-allowed opacity-40") : "disabled:opacity-50"}`}
                >
                  {ui.Icon ? (
                    <ui.Icon className={`h-4 w-4 ${active ? "" : ui.idleIcon}`} aria-hidden="true" />
                  ) : (
                    <StatusIcon d={ui.icon} className={active ? "" : ui.idleIcon} />
                  )}
                  {active && status === WAITLIST && myWaitingPlace ? `Waiting, no. ${myWaitingPlace}` : ui.label}
                </button>
              );
            })}
            {/* Taking the answer back, which is a real option and used to hide
                behind the word "Remove" — next to three answer buttons that is
                as easily read as "remove me from the league". Gone while a seat
                offer stands: that DECLINED is not the member's to withdraw, and
                the server says the same. */}
            {myStatus && !myOffer && (
              // Just the icon on a phone, so it fits on the row with the answers
              <button
                onClick={clearAnswer}
                disabled={busy === `${ev.id}:clear`}
                className="btn-secondary px-3"
                title="Clear my answer"
                aria-label="Clear my answer"
              >
                <Undo2 className="h-4 w-4 sm:hidden" aria-hidden="true" />
                <span className="hidden sm:inline">Clear my answer</span>
              </button>
            )}
            {myOffer && (
              <p className="w-full text-sm leading-relaxed text-light sm:w-auto sm:max-w-[22rem]">
                You offered your seat, so you&rsquo;re down as declined. Withdraw the offer below to
                answer for yourself again.
              </p>
            )}
            {/* A reserve who was GIVEN a seat is entered by somebody else, so
                "Clear my answer" is not the way out: the seat would still be
                theirs and the grid would still expect them. This puts the car
                back on the market and tells the admins, because by now one of
                them has built a grid around it. */}
            {mySeat && (
              <button
                onClick={standDown}
                disabled={busy === `${ev.id}:stand-down` || standingDown}
                className="btn-secondary"
              >
                {standingDown ? "…" : "I can't take this seat"}
              </button>
            )}
          </div>
        ) : isLoggedIn ? (
          // Logged in, but no driver profile anywhere: they can't RSVP yet,
          // but they can raise a hand — the league admin gets it in the
          // Members tab and can create their driver from there.
          raceRequest?.pending ? (
            <div className="text-sm leading-relaxed text-medium">
              <span className="font-semibold text-ok">Request sent.</span> The league admin will set up your
              driver profile and get back to you. Once that's done, the sign-up buttons appear here.
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => onRequestSeat?.(ev.id)}
                disabled={busy === `${ev.id}:request`}
                className="btn-primary"
              >
                I want to race
              </button>
              <span className="text-sm text-light">
                You haven't raced with us yet. Ask for a seat and the admin will set you up.
              </span>
            </div>
          )
        ) : (
          <Link to="/profile" className="transition text-sm font-semibold text-link hover:underline">
            Sign in to respond
          </Link>
        )}
      </div>

      {/* The admin's own row. Off by default and off again as soon as the card
          moves to another race: it puts Steam ids on screen, which is not
          something to leave lying around on a page with a league in it. */}
      {isAdmin && !notYetOpen && (adminView || !gridRow) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface2/40 px-5 py-2.5">
          <button
            type="button"
            onClick={toggleAdminView}
            aria-pressed={adminView}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition ${
              adminView ? "border-brand bg-brand text-ink" : "border-border bg-card text-medium hover:text-dark"
            }`}
          >
            <Fingerprint className="h-3.5 w-3.5" aria-hidden="true" />
            Steam IDs
          </button>
          {adminView && (
            <>
              <button
                type="button"
                onClick={copyAllSteamIds}
                disabled={!acceptedSteamIds.length}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-medium transition hover:text-dark disabled:opacity-40"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy accepted ({acceptedSteamIds.length})
              </button>
              <span className="text-xs text-light">
                {copyNote || steamError || "Steam IDs beside every name, click one to copy it. Admins only."}
              </span>
            </>
          )}
        </div>
      )}

      {/* grid fill: how many of the available seats are taken */}
      {gridRow && (
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center justify-between gap-3 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
          <span>Grid</span>
          <span className="flex items-center gap-2">
            <span className={`tabular-nums ${gridFull ? "text-warn" : "text-medium"}`}>
              {gridFull ? `Full · ${accepted}/${capacity} seats taken` : `${accepted}/${capacity} seats taken`}
            </span>
            {/* Admins: the Steam ID switch lives here instead of a row of its own */}
            {isAdmin && !adminView && (
              <button
                type="button"
                onClick={toggleAdminView}
                aria-pressed={false}
                title="Show Steam IDs beside every name (admins only)"
                aria-label="Show Steam IDs"
                className="-my-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-medium transition hover:text-dark"
              >
                <Fingerprint className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface2">
          <div
            className={`h-full rounded-full transition-all ${gridFull ? "bg-amber-500" : "bg-green-600"}`}
            style={{ width: `${Math.min(100, (accepted / capacity) * 100)}%` }}
          />
        </div>
      </div>
      )}

      {notYetOpen ? (
        <div className="p-5 text-sm leading-relaxed text-light">
          The attendance list opens {opensLabel}. You&rsquo;ll find the sign-up
          buttons and everyone&rsquo;s answers right here once it does.
        </div>
      ) : (
      // The answer columns sit side by side on EVERY width (they used to
      // stack on phones, which made the card a long scroll): three narrow
      // columns with the names truncating beats three screens of list.
      <div className={`grid gap-3 p-4 sm:gap-4 sm:p-5 ${visible.length === 1 ? "" : visible.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {visible.map((status) => (
          <div key={status} className="min-w-0">
            <div className="mb-2 flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
              <StatusIcon d={STATUS_UI[status].icon} className={`h-3.5 w-3.5 shrink-0 ${STATUS_UI[status].idleIcon}`} />
              {/* On phones the count alone labels the column — the coloured
                  icon already says which answer it is, and the words don't fit. */}
              <span className="hidden sm:inline">{STATUS_UI[status].title}</span>
              <span className="text-light">({ev.rsvps[status].length})</span>
            </div>
            {/* The grid filling up is the thing members come back to this page
                for, so the names arrive one after another instead of as a block. */}
            <ul className="cascade space-y-1.5">
              {ev.rsvps[status].map((r, i) => (
                <li key={r.driverId} style={{ "--i": i }} className="min-w-0 text-sm">
                  {/* Wraps rather than squeezes. With Tentative switched off the
                      admin's Steam id sits beside the name on one line; with
                      three columns there isn't the room, so it drops underneath
                      instead of shortening the name to a letter and a dot. */}
                  <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 sm:gap-x-2">
                  {/* The team's mark rather than a coloured dot: on a grid
                      with two cars per team the colour alone was a quiz, and
                      the logo says who at a glance. Falls back to the
                      colour-tinted monogram for a team without one. */}
                  <TeamLogo
                    id={r.team.id}
                    name={r.team.name}
                    color={r.team.color}
                    logoUrl={r.team.logoUrl}
                    size={18}
                  />
                  {/* The full name is a hover away: the grid is three columns
                      on a laptop and longer names get cut. In the admin view the
                      tooltip carries when they answered as well, which is what
                      says who was the last one in. */}
                  <span
                    className={`min-w-[3.5rem] truncate ${r.driverId === driverId ? "font-bold text-dark" : "text-dark"}`}
                    title={adminView && r.answeredAt ? `${r.name} · answered ${answerTime(r.answeredAt)}` : r.name}
                  >
                    {r.name}
                  </span>
                  <SubMark sub={r.sub} />
                  <Flag code={countryFor(r.driverId, r.country)} w={16} h={12} className="hidden sm:inline-block" />
                  {adminView && (
                    <span className="ml-auto">
                      <SteamTag steamId={steamIds?.[r.driverId]} />
                    </span>
                  )}
                  </div>
                </li>
              ))}
              {ev.rsvps[status].length === 0 && <li className="text-sm text-faint"><NoData className="text-sm" /></li>}
            </ul>
          </div>
        ))}
      </div>
      )}

      {/* The queue, under the columns rather than beside them: it is an order,
          not a fourth answer, and a fourth narrow column of truncated names on
          a phone would have said neither. Numbered, because the number is the
          whole information — first in line is first onto the grid. */}
      {!notYetOpen && waiting.length > 0 && (
        <div className="border-t border-border px-4 py-4 sm:px-5">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
              <Hourglass className="h-3.5 w-3.5 shrink-0 text-link" aria-hidden="true" />
              Waiting list
              <span className="text-light">({waiting.length})</span>
            </span>
            <span className="text-xs text-light">
              The grid is full. First in line moves up the moment a seat comes free.
            </span>
          </div>
          <ol className="cascade grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {waiting.map((r, i) => (
              <li key={r.driverId} style={{ "--i": i }} className="min-w-0 text-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 sm:gap-x-2">
                  <span className="w-5 shrink-0 text-right font-mono text-[11px] tabular-nums text-faint">{i + 1}.</span>
                  <TeamLogo
                    id={r.team.id}
                    name={r.team.name}
                    color={r.team.color}
                    logoUrl={r.team.logoUrl}
                    size={18}
                  />
                  <span
                    className={`min-w-[3.5rem] truncate ${myIds.has(r.driverId) ? "font-bold text-dark" : "text-dark"}`}
                    title={adminView && r.answeredAt ? `${r.name} · joined ${answerTime(r.answeredAt)}` : r.name}
                  >
                    {r.name}
                  </span>
                  <Flag code={countryFor(r.driverId, r.country)} w={16} h={12} className="hidden sm:inline-block" />
                  {adminView && (
                    <span className="ml-auto">
                      <SteamTag steamId={steamIds?.[r.driverId]} />
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* meHere is the market context of the RACE's season (a member can be
          full-time in one season and a reserve in the next), worked out at the
          top because the sign-up buttons need it too. */}
      <SeatMarket race={marketRace} me={meHere} reload={reloadMarket} highlight={seatHighlight} blockRef={seatRef} />
    </div>
  );
}
