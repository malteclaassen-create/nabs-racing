import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TeamDot, NoData} from "./ui.jsx";
import SeatMarket from "./SeatMarket.jsx";
import Flag from "./Flag.jsx";
import { countryFor } from "../data/driverCountries.js";

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

export function StatusIcon({ d, className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 ${className}`} fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
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
  const myStatus = ["ACCEPTED", "DECLINED", "TENTATIVE"].find((s) =>
    ev.rsvps[s].some((r) => myIds.has(r.driverId))
  );
  // A seat handed to the Driver Market has answered the question already: the
  // offer files a DECLINED with it (routes/market.js) and the server refuses
  // anything else while it stands. So the buttons go quiet rather than pretend.
  // CANCELLED offers never reach the page, and a FILLED one counts doubly —
  // somebody else is in that car.
  const myOffer = (marketRace?.offers || []).find((o) => myIds.has(o.offeredBy.driverId));
  const capacity = ev.capacity ?? 40;
  const accepted = ev.rsvps.ACCEPTED.length;

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
    opensAt.toLocaleString("en-GB", {
      weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      timeZoneName: "short",
    });

  return (
    <div className={`card reveal flex flex-col overflow-hidden ${className}`}>
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
            {Object.entries(STATUS_UI).map(([status, ui]) => {
              const active = myStatus === status;
              return (
                <button
                  key={status}
                  onClick={() => onSetStatus(ev.id, status)}
                  disabled={!!myOffer || busy === `${ev.id}:${status}`}
                  aria-pressed={active}
                  // The one it is stuck on keeps its colour, so the card still
                  // says what the answer IS. The other two go flat: greying the
                  // lot would leave the question looking unanswered.
                  title={myOffer ? "Your seat is offered in the Driver Market" : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    active ? ui.active : ui.idle
                  } ${myOffer ? (active ? "cursor-not-allowed" : "cursor-not-allowed opacity-40") : "disabled:opacity-50"}`}
                >
                  <StatusIcon d={ui.icon} className={active ? "" : ui.idleIcon} />
                  {ui.label}
                </button>
              );
            })}
            {/* Taking the answer back, which is a real option and used to hide
                behind the word "Remove" — next to three answer buttons that is
                as easily read as "remove me from the league". Gone while a seat
                offer stands: that DECLINED is not the member's to withdraw, and
                the server says the same. */}
            {myStatus && !myOffer && (
              <button
                onClick={() => onClear(ev.id)}
                disabled={busy === `${ev.id}:clear`}
                className="btn-secondary"
              >
                Clear my answer
              </button>
            )}
            {myOffer && (
              <p className="w-full text-sm leading-relaxed text-light sm:w-auto sm:max-w-[22rem]">
                You offered your seat, so you&rsquo;re down as declined. Withdraw the offer below to
                answer for yourself again.
              </p>
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

      {/* grid fill: how many of the available seats are taken */}
      {!notYetOpen && visible.includes("ACCEPTED") && (
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-wider text-light">
          <span>Grid</span>
          <span className="tabular-nums text-medium">{accepted}/{capacity} seats taken</span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface2">
          <div
            className="h-full rounded-full bg-green-600 transition-all"
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
                <li key={r.driverId} style={{ "--i": i }} className="flex min-w-0 items-center gap-1.5 text-sm sm:gap-2">
                  <TeamDot color={r.team.color} />
                  <span className={`truncate ${r.driverId === driverId ? "font-bold text-dark" : "text-dark"}`}>
                    {r.name}
                  </span>
                  <Flag code={countryFor(r.driverId, r.country)} w={16} h={12} className="hidden sm:inline-block" />
                </li>
              ))}
              {ev.rsvps[status].length === 0 && <li className="text-sm text-faint"><NoData className="text-sm" /></li>}
            </ul>
          </div>
        ))}
      </div>
      )}

      {/* meHere is the market context of the RACE's season (a member can be
          full-time in one season and a reserve in the next), worked out at the
          top because the sign-up buttons need it too. */}
      <SeatMarket race={marketRace} me={meHere} reload={reloadMarket} />
    </div>
  );
}
