import { useEffect, useRef, useState } from "react";
import { useLiveFeatureNotice } from "../hooks/useLiveFeatureNotice.js";
import { NavLink, useLocation } from "react-router-dom";
import { useSeriesPath } from "../context/SeriesContext.jsx";
import { useAuth } from "../hooks/useAuth.js";
import { useTransfersVisible } from "../hooks/useTransfersVisible.js";
import { useVisiblePoll } from "../hooks/useVisiblePoll.js";
import { useAdminAttention } from "../hooks/useAdminAttention.js";
import { useReserveSeats } from "../hooks/useReserveSeats.js";
import AttentionDot from "./AttentionDot.jsx";
import { api } from "../api/client.js";
import Logo from "./Logo.jsx";
import SeasonPicker from "./SeasonPicker.jsx";
import SeriesSwitcher from "./SeriesSwitcher.jsx";
import NotificationBell from "./NotificationBell.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import { openFeedback } from "./FeedbackWidget.jsx";
import { REPORTS_OPEN_TO_MEMBERS, reportsPath } from "../reportsAccess.js";
import { useTour } from "./Tour.jsx";
import { DriverAvatar } from "./ui.jsx";
import { useTokenBalance, takeTokenGain } from "../hooks/useTokenBalance.js";
import TokenIcon from "./TokenIcon.jsx";
import { useSlidingHighlight } from "./SlidingTabs.jsx";

// The token count, sitting against the profile chip. Only there while the trial
// is switched on (the hook returns null otherwise) and only for a signed-in
// member, so a visitor's bar looks exactly as it always did. Links to the panel
// the number comes from, because a number you cannot click is a number you have
// to go looking for.
//
// It also carries the news. Somebody who raced on Friday should not have to go
// hunting for the reward: the first time they open the site after the result is
// in, the count steps aside, a "+100" rises through its place, and the number
// then climbs from what they had to what they have. Once. The server decides
// what counts as news (unseenGain in backend/src/lib/tokens.js) and is told
// when it has been shown, so it is never played twice for the same race.
const GAIN_ANNOUNCE_MS = 1500; // the "+100" floating through
const GAIN_COUNT_MS = 1100; // the climb to the new total

// Straight to the answer when the site is asked not to move: the same two
// switches every other animation here respects.
function motionOff() {
  return (
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
    document.documentElement.classList.contains("fx-lite")
  );
}

function TokenPill({ mobile = false, segment = false }) {
  const balance = useTokenBalance();
  // The news being played right now (with the total it is climbing to), and the
  // number on the pill while it climbs.
  const [play, setPlay] = useState(null);
  const [counting, setCounting] = useState(null);
  // Guards the animation, not the news: whichever of the two pills the bar
  // renders (the strip and the open menu on a phone) asks first gets it, and
  // the hook hands it out exactly once.
  const playing = useRef(false);

  // Picking the news up. Runs whenever the balance changes, which is also how a
  // member who leaves the site open gets their reward the moment it lands.
  useEffect(() => {
    if (balance === null || playing.current) return;
    // DEVELOPMENT ONLY: ?tokendemo=250 plays the whole thing with a made-up
    // gain, as often as you like, without a race being scored first. It touches
    // nothing — no ledger row, no "seen" mark — and the branch is compiled out
    // of a built site, because import.meta.env.DEV is a literal false there.
    const demo = import.meta.env.DEV
      ? Number(new URLSearchParams(window.location.search).get("tokendemo"))
      : 0;
    const news = demo > 0
      ? { gained: demo, from: balance - demo, reasons: [{ title: "Raced a round", detail: "Demo" }] }
      : takeTokenGain();
    if (!news) return;
    // Nothing to play: hand the member the new number and tell the server it
    // has been shown, so it is not saved up for the next visit either.
    if (motionOff()) {
      if (!demo) api.markTokensSeen().catch(() => {});
      return;
    }
    playing.current = true;
    setPlay({ ...news, to: balance, demo: demo > 0 });
    setCounting(news.from);
  }, [balance]);

  // Playing it. Deliberately its OWN effect, keyed on the news rather than on
  // the balance: the first version hung both on the balance, so the refetch
  // that delivered the new total also tore down the animation it had just
  // started, and the pill sat there showing "+250" for good.
  useEffect(() => {
    if (!play) return;
    let raf = 0;
    const timer = setTimeout(() => {
      const startedAt = performance.now();
      const tick = (t) => {
        const p = Math.min(1, (t - startedAt) / GAIN_COUNT_MS);
        const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic, like every count on this site
        setCounting(Math.round(play.from + (play.to - play.from) * eased));
        if (p < 1) {
          raf = requestAnimationFrame(tick);
          return;
        }
        playing.current = false;
        setPlay(null);
        setCounting(null);
        if (!play.demo) api.markTokensSeen().catch(() => {});
      };
      raf = requestAnimationFrame(tick);
    }, GAIN_ANNOUNCE_MS);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [play]);

  if (balance === null) return null;
  const announcing = play && counting === play.from;
  const shown = counting ?? balance;
  // What the tokens were for, for the tooltip: "Raced a round, Spa" reads
  // better than a bare number when somebody wonders where it came from.
  const why = play?.reasons?.length
    ? play.reasons.map((r) => [r.title, r.detail].filter(Boolean).join(", ")).join(" · ")
    : null;

  return (
    <NavLink
      to="/profile?tab=tokens"
      title={why ? `+${play.gained} points: ${why}` : "Your NABS Points"}
      className={`inline-flex items-center gap-1.5 font-mono text-[15px] font-bold tabular-nums transition ${
        segment
          ? // the right half of the identity capsule: shares its border with the chip
            "border-l border-border bg-brand/10 py-1.5 pl-2.5 pr-3 text-dark hover:bg-brand/20"
          : `rounded-lg border border-border px-2.5 py-1.5 text-dark hover:bg-surface2 ${mobile ? "" : "ml-1"}`
      } ${play ? "token-pill-celebrating" : ""}`}
    >
      <TokenIcon className="h-5 w-5" />
      {/* The count and the "+100" share one slot: the number steps aside while
          the news rises through its place, then comes back and climbs. */}
      <span className="relative inline-flex min-w-[2ch] items-center justify-end leading-none">
        <span className={announcing ? "invisible" : undefined}>{shown}</span>
        {announcing && (
          // Green, not the league's pink: this is the one place on the bar
          // where a colour means "you gained something", and the site keeps
          // green for exactly that (the same --c-ok every "done" uses).
          <span className="token-gain absolute inset-0 flex items-center justify-end whitespace-nowrap leading-none text-ok">
            +{play.gained}
          </span>
        )}
      </span>
      <span className="sr-only"> points{play ? `, ${play.gained} earned since your last visit` : ""}</span>
    </NavLink>
  );
}

function AuthControl({ mobile = false }) {
  const { user, isLoggedIn } = useAuth();
  // Nothing for anyone but an admin, and nothing at all when the office is
  // clear. See hooks/useAdminAttention.js for why it lives on the profile chip.
  const { total } = useAdminAttention();
  if (isLoggedIn) {
    const name = user.driverName || user.discordName || "Profile";
    const chip = (
      <NavLink
        to={user.driverId ? `/drivers/${user.driverId}` : "/profile"}
        title="Your driver profile"
        data-tour="nav-profile"
        className={({ isActive }) =>
          // `relative` is new: the dot below is positioned against this chip,
          // and without it the nearest positioned ancestor is the whole nav
          // strip, which would park it somewhere else entirely.
          // The picture sits in an even 4px of space on all four sides: pl-1 and
          // py-1 for three of them, pr-1 for the gap to the dividing line. That
          // also puts the round avatar exactly in the middle of the capsule's
          // round left end. The name only appears from xl up, and once it is
          // there the line needs proper room after the text instead.
          `relative flex items-center gap-2 text-sm font-semibold transition ${
            mobile ? "w-full rounded-lg px-2 py-1.5" : "py-1 pl-1 pr-1 xl:pr-2.5"
          } ${isActive ? "bg-brand/20 text-dark" : "text-medium hover:bg-surface2"}`
        }
      >
        <DriverAvatar name={name} photoUrl={user.avatarUrl} color="#4251a8" size={26} />
        <span className={`max-w-[8rem] truncate ${mobile ? "" : "hidden xl:inline"}`}>{name}</span>
        <AttentionDot total={total} className="absolute right-1 top-1" />
      </NavLink>
    );
    return mobile ? (
      // On the phone the chip is a full-width row, so the pill goes beside it
      // rather than after it and the two share the line.
      <div className="flex w-full items-center gap-2">
        {chip}
        <TokenPill mobile />
      </div>
    ) : (
      // One capsule: who you are on the left, what you have on the right.
      <div className="nav-identity ml-1 inline-flex items-stretch overflow-hidden rounded-full border border-border bg-card shadow-sm">
        {chip}
        <TokenPill segment />
      </div>
    );
  }
  return (
    <NavLink
      to="/profile"
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-brand/40 bg-brand/10 px-3.5 py-2 text-sm font-bold text-dark transition hover:bg-brand/20 ${
        mobile ? "w-full" : ""
      }`}
    >
      Sign in
    </NavLink>
  );
}

// The season switcher lives on the Home page (season ticker line); on the
// season-scoped standings pages below it ALSO docks into the bar (compact
// pill on desktop, a row in the mobile menu) so you can hop seasons without
// going back Home. The docked pill fades in/out as you move on/off these
// pages — see .nav-season-dock. (Paths are checked with the /s/<slug> series
// prefix stripped.)
const SEASON_PAGES = ["/drivers", "/constructors", "/races", "/transfers"];

// Nav links, built per render: series-scoped pages carry the /s/<slug> prefix
// of the series being viewed; Race Info (downloads) is global and has none.
function navLinks(p) {
  return [
    // `alsoActiveOn`: the root renders the primary series' home ITSELF rather
    // than redirecting to /s/<slug>, so the address stays "/" while this link
    // points at "/s/<slug>". NavLink compares the two, finds no match, and left
    // the nav with nothing highlighted on the one page everybody lands on and
    // shares. Both addresses are the same page, so both light the same item.
    { to: p(""), label: "Home", end: true, alsoActiveOn: "/" },
    // Drivers + Constructors are folded into one "Standings" item with a
    // hover flyout (see StandingsNav); on mobile they show as two links.
    { standings: true, label: "Standings" },
    // `tour` marks the ones the newcomer tour walks you along (see Tour.jsx).
    { to: p("/races"), label: "Races", tour: "nav-races" },
    { to: p("/attendance"), label: "Attendance", tour: "nav-attendance" },
    { to: p("/live"), label: "Live", tour: "nav-live" },
    { to: "/downloads", label: "Race Info" },
  ];
}

// Desktop variant: the active page's highlight is ONE pill that GLIDES between
// the items (see the sliding span in the desktop nav), so the item itself only
// switches its text colour and carries the `is-active` marker the pill follows.
const desktopLinkClass = ({ isActive }) =>
  `relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-[13px] font-semibold transition xl:px-3 xl:text-sm ${
    isActive ? "is-active text-dark" : "text-medium hover:bg-surface2"
  }`;

// Mobile menu row: a quiet line-list item with a small stroke icon, so the
// pages stop reading as one indistinguishable text column. Colour only with
// meaning: the active page gets the usual brand tint, everything else is calm.
// `alsoActiveOn` mirrors the desktop nav: the root and /s/<slug> are the same
// page, so both have to light the Home row (see navLinks).
function MobileRow({ to, end, icon, label, sub, alsoActiveOn, badge = null }) {
  const { pathname } = useLocation();
  const forced = alsoActiveOn === pathname;
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-2 py-2.5 transition ${
          isActive || forced ? "bg-brand/20 ring-1 ring-inset ring-brand/50" : "hover:bg-surface2"
        }`
      }
    >
      {({ isActive: active }) => {
        const isActive = active || forced;
        return (
        <>
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isActive ? "bg-brand text-ink" : "bg-surface2 text-medium"}`}>
            <StandIcon d={icon} />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-sm font-semibold ${isActive ? "text-dark" : "text-medium"}`}>{label}</span>
            {sub && <span className="mt-0.5 block truncate font-mono text-[10px] text-light">{sub}</span>}
          </span>
          {badge}
        </>
        );
      }}
    </NavLink>
  );
}

// Same row, but it DOES something instead of going somewhere (the feedback
// panel). Never "active", so it stays in the calm idle style.
function MobileActionRow({ icon, label, sub, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-surface2"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface2 text-medium">
        <StandIcon d={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-medium">{label}</span>
        {sub && <span className="mt-0.5 block truncate font-mono text-[10px] text-light">{sub}</span>}
      </span>
    </button>
  );
}

// Section eyebrow inside the mobile menu — same mono label style as the page
// eyebrows, with a hairline running out to the right edge.
function MobileMenuLabel({ children }) {
  return (
    <div className="flex items-center gap-3 px-2 pb-1 pt-4">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

// Stroke icons for the mobile menu rows (24×24 viewBox, drawn by StandIcon).
const NAV_ICONS = {
  home: <><path d="M3 10.5L12 3l9 7.5" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" /></>,
  races: <><path d="M5 3v18" /><path d="M5 4h13l-3 4 3 4H5" /></>,
  attendance: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /><path d="M9 15l2 2 4-4" /></>,
  live: <><circle cx="12" cy="12" r="2.5" /><path d="M7.5 7.5a6.5 6.5 0 000 9M16.5 7.5a6.5 6.5 0 010 9" /><path d="M4.7 4.7a10.5 10.5 0 000 14.6M19.3 4.7a10.5 10.5 0 010 14.6" /></>,
  info: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></>,
  drivers: <><path d="M12 12a4 4 0 100-8 4 4 0 000 8z" /><path d="M4 21a8 8 0 0116 0" /></>,
  constructors: <><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M24 21v-2a4 4 0 00-3-3.87" /><path d="M18 3.13a4 4 0 010 7.75" /></>,
  records: <><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 5H4v2a3 3 0 003 3M17 5h3v2a3 3 0 01-3 3" /></>,
  transfers: <><path d="M7 17V5" /><path d="M3 9l4-4 4 4" /><path d="M17 7v12" /><path d="M13 15l4 4 4-4" /></>,
  // Four rows at the bottom of the phone menu used to share this one speech
  // bubble, which made them read as one thing said four times. They are four
  // different errands, so they get four marks: say something, read a reply,
  // report a crash, look up what was decided.
  feedback: <><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></>,
  messages: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 7l8.5 6 8.5-6" /></>,
  incident: <><path d="M10.3 3.9L1.9 18a2 2 0 001.7 3h16.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /><path d="M12 9.5v4M12 17.2h.01" /></>,
  myReports: <><path d="M9 4H7a2 2 0 00-2 2v13a2 2 0 002 2h10a2 2 0 002-2V6a2 2 0 00-2-2h-2" /><rect x="9" y="2.2" width="6" height="3.6" rx="1" /><path d="M9 13.5l2 2 4-4" /></>,
};

// The two pages the "Standings" item covers (matched with the series prefix
// stripped, so it lights up inside every series).
const STANDINGS_PAGES = ["/drivers", "/constructors", "/transfers", "/records"];

function StandIcon({ d }) {
  // overflow-visible so a stroke sitting right at the viewBox edge (the group
  // icon's outer shoulder) is never clipped — not even mid-entrance-animation,
  // when the menu card is briefly scaled/translated.
  return <svg viewBox="0 0 24 24" className="h-4 w-4 overflow-visible" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
}

// "Standings" nav item: one entry that opens a flyout to Drivers / Constructors
// on hover (and on click, for touch/keyboard). Highlighted while on either page.
function StandingsNav({ seriesPath }) {
  const [open, setOpen] = useState(false);
  // The transfer market is held back from the public for now (hooks/useTransfersVisible.js).
  const transfers = useTransfersVisible();
  const location = useLocation();
  const ref = useRef(null);
  const closeTimer = useRef(null);
  // A running tour holds this open. Everything that normally shuts it — the
  // pointer leaving on its way somewhere else, a press anywhere outside — is
  // exactly what a reader does during the step that talks about these three
  // links: they move to the coach-mark and press its button. The flyout shut
  // itself before they got there, the tour lost its target, and the step that
  // was supposed to show the standings quietly became a step about nothing.
  // Only a navigation closes it while a tour is on, which is the one case that
  // means the reader is done with it.
  const { active: tourActive } = useTour();
  const pathNoSeries = location.pathname.replace(/^\/s\/[^/]+/, "") || "/";
  const active = STANDINGS_PAGES.some((p) => pathNoSeries.startsWith(p));

  // Hover open with a short close delay, so slipping off the button on the way
  // down to the menu doesn't snap it shut (the transparent bridge below also
  // keeps the pointer inside the hover region across the gap).
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const openNow = () => { cancelClose(); setOpen(true); };
  const closeSoon = () => {
    if (tourActive) return;
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => () => cancelClose(), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!tourActive && ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open, tourActive]);

  // One flyout row, styled to match the series/season switcher menus exactly:
  // an icon badge (brand-filled while active), a display title, and a mono
  // sub-line, with the same accent active ring and check mark.
  const itemCls = ({ isActive }) =>
    `flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
      isActive ? "bg-accent/10 ring-1 ring-inset ring-accent/40" : "hover:bg-surface2"
    }`;
  const row = (to, icon, title, sub, tour) => (
    <NavLink to={to} role="menuitem" data-tour={tour} className={itemCls}>
      {({ isActive }) => (
        <>
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isActive ? "bg-brand text-ink" : "bg-surface2 text-medium"}`}>
            <StandIcon d={icon} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-sm font-bold uppercase tracking-tight text-dark">{title}</span>
            <span className="mt-0.5 block truncate font-mono text-[11px] text-light">{sub}</span>
          </span>
          {isActive && (
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-eyebrow" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 6" /></svg>
          )}
        </>
      )}
    </NavLink>
  );

  return (
    <div ref={ref} className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tour="nav-standings"
        className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-2 text-[13px] font-semibold transition xl:px-3 xl:text-sm ${
          active ? "is-active text-dark" : "text-medium hover:bg-surface2"
        }`}
      >
        Standings
        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {/* The menu stays mounted and fades/scales in and out (same transition as
          the series & season switchers), so it matches them in look AND motion.
          Closed, it's `invisible` + `pointer-events-none` so it captures nothing
          and leaves no phantom hover zone below the button. The outer wrapper
          starts flush with the button (top-full) and carries the visual gap as
          TRANSPARENT padding, so the pointer never leaves the hover region on
          the way down to the card. */}
      <div className={`absolute left-0 top-full z-dropdown pt-2 ${open ? "" : "pointer-events-none"}`}>
        <div
          role="menu"
          data-tour="nav-standings-menu"
          className={`w-64 origin-top-left rounded-2xl border border-border bg-card p-1.5 shadow-xl shadow-ink/10 transition-[opacity,transform,visibility] duration-quick ${
            open ? "visible scale-100 opacity-100" : "invisible scale-[0.97] opacity-0"
          }`}
        >
          {row(seriesPath("/drivers"), <><path d="M12 12a4 4 0 100-8 4 4 0 000 8z" /><path d="M4 21a8 8 0 0116 0" /></>, "Drivers", "Driver standings", "nav-drivers")}
          {row(seriesPath("/constructors"), <><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M24 21v-2a4 4 0 00-3-3.87" /><path d="M18 3.13a4 4 0 010 7.75" /></>, "Constructors", "Constructor standings")}
          {transfers && row(seriesPath("/transfers"), <><path d="M7 17V5" /><path d="M3 9l4-4 4 4" /><path d="M17 7v12" /><path d="M13 15l4 4 4-4" /></>, "Transfers", "Team changes, round by round")}
          {row(seriesPath("/records"), <><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 5H4v2a3 3 0 003 3M17 5h3v2a3 3 0 01-3 3" /></>, "Hall of Fame", "All-time records")}
        </div>
      </div>
    </div>
  );
}

// The accent line under the nav doubles as the page's scroll indicator (the
// native scrollbar is hidden, see index.css): a full-width strip slides in from
// the left as you scroll, so the colour reveals instead of stretching. Written
// via transform from a rAF-throttled passive scroll handler — no React
// re-renders, no layout work, compositor-only motion.
//
// TWO KINDS OF CHANGE, and the line has to tell them apart.
//
// Scrolling is the line's whole job: it follows the wheel exactly, frame for
// frame, with nothing in between. A tween there would just feel like lag.
//
// But the reading also moves when the PAGE moves under it, and that is not
// scrolling: a click on a nav item jumps to the top (see AppRoutes), and a
// shorter page suddenly makes the same scrollTop a much larger fraction of it —
// pick a finished race, scroll into the results, then open an upcoming round,
// which has a fraction of the content. The line used to snap to the new reading
// between two frames, which read as it being yanked away rather than as the
// page having changed. Those are eased instead, over about a third of a second
// — long enough to be read as the line travelling rather than as a cut, short
// enough that it has finished before the eye reaches the new page's first line.
//
// HOW IT TELLS THEM APART, given that a scroll event looks identical either
// way — the browser reports the same thing whether a wheel turned or the page
// scrolled itself. It asks about the READER, not about the page: was there a
// wheel, a finger, one of the scroll keys, or is a pointer being held down
// (which is what dragging the custom scrollbar in ScrollBar.jsx looks like)?
// If yes, this is the reader and the line follows exactly. If nothing at all
// came from the reader, nobody asked for this and the line travels.
//
// A held pointer counts, a click does not: the button is still down while a
// scrollbar is being dragged, and already up by the time a click on a nav link
// turns into a scroll to the top. Same event, opposite answers, told apart by
// when the scroll actually happens.
//
// Momentum is why the quarter-second window RENEWS on every scroll event that
// is already the reader's: a trackpad flick or a finger on a phone keeps the
// page moving long after the input stopped, and that is still their scroll.
// One unbroken chain from the wheel to the last pixel of coasting; a pause of
// a quarter second ends it.
//
// TWO EARLIER ATTEMPTS AT THIS QUESTION, both wrong, both worth not repeating:
//
//   "Was there a route change?" — misses the Races page entirely. Picking
//   another round there is not a navigation: the panel is local state (see
//   Races.jsx), the address never changes, and the page then puts the scroll
//   position right itself.
//
//   "Did the page change length?" — right idea, and it disarmed itself. The
//   body's ResizeObserver below fires BEFORE the scroll event does, and it
//   noted the new height as it went; the scroll event that followed compared
//   against that and found nothing changed, called itself the reader, snapped,
//   and cancelled the very hold the observer had just started. The line ended
//   up exactly where it should be, instantly, which is what it was doing
//   before any of this was written.
//
// AND IT WAITS FOR THE PAGE TO STOP MOVING FIRST. A page swap is not one event
// but a burst of them: the outgoing panel unmounts, the browser clamps the
// scroll position to a page that is briefly the wrong length, the new panel
// mounts, images and data land. Every one of those is a different reading, and
// easing to each in turn is visible — pick a finished race, scroll into the
// results, then open an upcoming round, and the line ran PAST where it belonged
// and crept back. So a page-driven change starts a hold instead: the line keeps
// showing what it showed, and only once nothing has moved for a beat does it
// travel, once, to the reading that is actually true. Capped, in case something
// on the page never stops resizing.
const PROGRESS_EASE_MS = 320;
const PROGRESS_HOLD_MS = 110; // quiet needed before committing to a new reading
const PROGRESS_HOLD_MAX_MS = 400; // …but never hold longer than this
const PROGRESS_INPUT_MS = 250; // how long a wheel/finger/key keeps the line instant

function ScrollProgressLine() {
  const innerRef = useRef(null);
  // No route awareness in here on purpose. A navigation is just one of the many
  // ways the page can move without the reader touching anything, and the rule
  // above covers all of them at once.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    let raf = 0; // the scroll-event throttle
    let tween = 0; // the running ease, if any
    let shown = null; // what the line currently reads, 0..1
    let lastInput = 0; // when the reader last did something that scrolls
    let pointerDown = false; // a button held down — a scrollbar drag, or a text selection

    const target = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      // Unscrollable pages show the full line, like the old static accent.
      return max > 4 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 1;
    };
    const paint = (p) => {
      shown = p;
      el.style.transform = `translateX(${(p - 1) * 100}%)`;
    };
    const stopTween = () => {
      if (tween) cancelAnimationFrame(tween);
      tween = 0;
    };
    // Ease-out cubic: leaves at speed, arrives without a bump. Re-aimed rather
    // than restarted if something moves again mid-ease (data landing right
    // after a navigation does exactly that), so it never stacks.
    const easeTo = (to) => {
      const from = shown ?? to;
      if (Math.abs(to - from) < 0.004) { stopTween(); paint(to); return; }
      stopTween();
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / PROGRESS_EASE_MS);
        paint(from + (to - from) * (1 - (1 - t) ** 3));
        tween = t < 1 ? requestAnimationFrame(step) : 0;
      };
      tween = requestAnimationFrame(step);
    };
    // Lite graphics and reduced motion get the old instant behaviour.
    const still = () =>
      document.documentElement.classList.contains("fx-lite") ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // The hold: what turns a burst of page motion into one movement.
    let hold = 0;
    let holdSince = 0;
    const commit = () => {
      clearTimeout(hold);
      hold = 0;
      holdSince = 0;
      easeTo(target());
    };
    const dropHold = () => {
      clearTimeout(hold);
      hold = 0;
      holdSince = 0;
    };
    const aimSoon = () => {
      const now = performance.now();
      if (!holdSince) holdSince = now;
      // Something is still moving after the cap — commit to what we have rather
      // than leave the line frozen on a reading that stopped being true.
      if (now - holdSince >= PROGRESS_HOLD_MAX_MS) { commit(); return; }
      clearTimeout(hold);
      hold = setTimeout(commit, PROGRESS_HOLD_MS);
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const now = performance.now();
        const byReader = pointerDown || now - lastInput < PROGRESS_INPUT_MS;
        if (!still() && !byReader) { aimSoon(); return; }
        // Their scroll, and still going: keep the chain alive through the
        // coasting, and follow it exactly. This also beats anything the page
        // was in the middle of doing — someone scrolling a panel that is still
        // growing under them is scrolling.
        lastInput = now;
        dropHold();
        stopTween();
        paint(target());
      });
    };
    const onReflow = () => {
      if (still()) { dropHold(); stopTween(); paint(target()); return; }
      aimSoon();
    };

    // The scroll keys, and only those: any other key press is somebody typing,
    // which moves nothing. (Space scrolls a page, but not while it is being
    // typed into a message — hence the check for what has focus.)
    const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"]);
    const noteInput = () => { lastInput = performance.now(); };
    const onKey = (e) => {
      const t = e.target;
      const typing = t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || "");
      if (!typing && SCROLL_KEYS.has(e.key)) noteInput();
    };
    const onPointerDown = () => { pointerDown = true; };
    const onPointerUp = () => { pointerDown = false; };

    paint(target());
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onReflow);
    window.addEventListener("wheel", noteInput, { passive: true });
    // touchMOVE, not touchstart: a tap starts a touch too, and tapping a round
    // on the Races page is exactly the case this has to keep its hands off. A
    // finger that has actually travelled is a scroll; one that has only landed
    // is a click waiting to happen.
    window.addEventListener("touchmove", noteInput, { passive: true });
    window.addEventListener("keydown", onKey);
    // Capture, so a handler that stops the event on its way down the tree
    // cannot leave the flag stuck on.
    window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true, passive: true });
    window.addEventListener("pointercancel", onPointerUp, { capture: true, passive: true });
    // Content growing/shrinking (data loading in, a route swapping pages) moves
    // the scroll range without a scroll event — watch the body's size too.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onReflow) : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("wheel", noteInput);
      window.removeEventListener("touchmove", noteInput);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("pointerup", onPointerUp, { capture: true });
      window.removeEventListener("pointercancel", onPointerUp, { capture: true });
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      dropHold();
      stopTween();
    };
  }, []);
  return (
    <div className="h-1 w-full overflow-hidden">
      {/* The house accent, and only it. The gradient it replaces ran through
          amber into sky blue, which is three colours the site uses nowhere else
          and which made the busiest 4px on the page look like a loading bar
          from somewhere else. Follows a series' own accent via --c-brand. */}
      <div
        ref={innerRef}
        className="h-full w-full bg-brand will-change-transform"
        style={{ transform: "translateX(-100%)" }}
      />
    </div>
  );
}

export default function NavBar() {
  const { isNew: liveFeatureNew } = useLiveFeatureNotice();
  const { seriesPath } = useSeriesPath();
  // Members get the extra menu row to their own feedback threads; a visitor has
  // no threads to read (there is no account for an answer to land in).
  const { isLoggedIn } = useAuth();
  const transfersVisible = useTransfersVisible();
  // …and neither has a member who has never written one. "Your messages" only
  // earns its row once there is a message in it, otherwise it is a row that
  // leads to an empty page.
  const [hasThreads, setHasThreads] = useState(false);
  // Same question for stewarding: "My reports" is worth a row once somebody is
  // actually in a report — either one they filed or one that names them.
  const [hasReports, setHasReports] = useState(false);
  // One state machine, so open/closing can never contradict each other:
  // "closed" -> "open" (panel mounts, drop-in plays) -> "closing" (stays
  // mounted while the drop-out plays) -> "closed" (unmount). Tapping the
  // burger mid-close reopens straight from "closing".
  const [menu, setMenu] = useState("closed");
  const open = menu === "open";
  const closing = menu === "closing";
  const location = useLocation();

  // Cars on track right now, for the dot on the Live item. Its own tiny endpoint
  // rather than the timing board (that is the whole grid, and this runs on every
  // page of the site). 45s is plenty: the point is "there is something on", not
  // a live feed. Paused while the tab is in the background (see useVisiblePoll)
  // — the dot is only worth a request when somebody can see it.
  const [liveNow, setLiveNow] = useState(0);
  useVisiblePoll((alive) => {
    api
      .liveStatus()
      .then((d) => alive() && setLiveNow(d?.onTrack || 0))
      // A decoration must never make noise: unreachable simply means no dot.
      .catch(() => alive() && setLiveNow(0));
  }, 45_000);

  // Asked the moment the menu opens, and only for a member — a menu row is not
  // a reason to hit the API on every page load for every visitor. Re-asked on
  // each open while the answer is still "none", so the row turns up right after
  // somebody writes their first one; once it is there it stays for the session.
  useEffect(() => {
    if (!open || !isLoggedIn || hasThreads) return;
    let alive = true;
    api
      .myFeedback()
      .then((d) => alive && setHasThreads((d?.items || []).length > 0))
      // A missing row is the quiet failure here, which is the right one.
      .catch(() => {});
    return () => { alive = false; };
  }, [open, isLoggedIn, hasThreads]);

  // Same shape, same reasoning. Two small reads on the first open of the menu
  // for a signed-in member, and none at all for a visitor.
  useEffect(() => {
    if (!open || !isLoggedIn || hasReports || !REPORTS_OPEN_TO_MEMBERS) return;
    let alive = true;
    api
      .myReports()
      .then((d) => alive && setHasReports((d?.reports || []).length > 0))
      .catch(() => {});
    return () => { alive = false; };
  }, [open, isLoggedIn, hasReports]);

  const openMenu = () => setMenu("open");
  // Functional update: only an OPEN menu starts closing, so a stray second
  // call (scrim + button both firing, ghost clicks) can't restart the exit.
  const closeMenu = () => setMenu((m) => (m === "open" ? "closing" : m));
  // Unmount when the drop-out finishes. The animationend event is the real
  // signal; the timer is a backstop for when the animation never runs
  // (reduced motion, lite graphics mode) — slightly longer than the 0.2s
  // animation so it never cuts off the last frame.
  const finishClose = () => setMenu((m) => (m === "closing" ? "closed" : m));
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(finishClose, 300);
    return () => clearTimeout(t);
  }, [closing]);

  // Escape closes the menu, like every other overlay on the site.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Hold the page still behind the open menu. Without this the content kept
  // scrolling under the panel, which on a phone reads as the menu sliding
  // around. Reinstating the previous overflow (rather than clearing it) keeps
  // this safe if another overlay ever locks scrolling at the same time.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // The Attendance item only earns its nav slot while a race is actually
  // taking answers: the sign-up window is open (always, when no window is
  // configured) and the result isn't saved yet. Checked per series, and
  // re-checked on every route change so saving a result or a window opening
  // is picked up on the next click without a reload.
  // Seeded from the last known answer (localStorage) so a reload doesn't
  // flash the item in or out while the request is in flight.
  const seriesSlug = location.pathname.startsWith("/s/") ? location.pathname.split("/")[2] : "";
  const attCacheKey = `nav-attendance-open:${seriesSlug}`;
  const [attendanceOpen, setAttendanceOpen] = useState(() => {
    try { return localStorage.getItem(attCacheKey) === "1"; } catch { return false; }
  });
  // Switching series: show that series' remembered answer until the fresh one lands.
  useEffect(() => {
    try { setAttendanceOpen(localStorage.getItem(attCacheKey) === "1"); } catch { /* private mode */ }
  }, [attCacheKey]);
  useEffect(() => {
    let alive = true;
    api.attendanceOpen()
      .then((r) => {
        if (!alive) return;
        setAttendanceOpen(!!r?.open);
        try { localStorage.setItem(attCacheKey, r?.open ? "1" : "0"); } catch { /* private mode */ }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [attCacheKey, location.pathname]);

  const links = navLinks(seriesPath).filter((l) => l.label !== "Attendance" || attendanceOpen);
  // Reserve drivers only, and only until they have looked or applied.
  const seats = useReserveSeats();
  // Handed to GlobalSearch so its expanded field + dropdown line up their left
  // edge with the "Live" nav item.
  const liveRef = useRef(null);
  // The gliding active-page pill of the desktop nav (follows `.is-active`).
  const desktopNavRef = useRef(null);
  const navPill = useSlidingHighlight(desktopNavRef, [location.pathname]);

  // Close the mobile menu whenever the route changes — animated, like a tap on
  // the burger. `open` is read from the render where the path changed, which is
  // exactly the state we want to act on, so it stays out of the dep list.
  useEffect(() => {
    if (open) closeMenu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Season pages are matched with the series prefix stripped, so the docked
  // season pill follows the same pages inside every series.
  const pathNoSeries = location.pathname.replace(/^\/s\/[^/]+/, "") || "/";
  const onSeasonPage = SEASON_PAGES.some((p) => pathNoSeries.startsWith(p));

  // The docked season pill mounts visible (a CSS keyframe handles its fade-in);
  // on leaving a season page we keep it mounted for one beat with `shown:false`
  // so the .is-hidden fade-out can play, then unmount (see .nav-season-dock in
  // index.css; lite mode skips both animations).
  const [dock, setDock] = useState({ render: onSeasonPage, shown: onSeasonPage });
  useEffect(() => {
    if (onSeasonPage) {
      setDock({ render: true, shown: true });
      return;
    }
    setDock((d) => ({ ...d, shown: false }));
    const t = setTimeout(() => setDock({ render: false, shown: false }), 300);
    return () => clearTimeout(t);
  }, [onSeasonPage]);

  // What the PHONE menu shows is decided when it opens and then holds still
  // until the panel is gone.
  //
  // Tapping a row navigates at once, and the menu closes from an effect on the
  // path — so in the render where the route changed the panel is still fully
  // open and has not begun its exit. The season row appeared right there, in a
  // menu that was about to slide away, which reads as a glitch rather than as a
  // control arriving. Gating on "closing" is a beat too late for the same
  // reason; the gate has to be "the panel is on screen at all".
  const [menuSeason, setMenuSeason] = useState(onSeasonPage);
  useEffect(() => {
    if (menu !== "closed") return;
    setMenuSeason(onSeasonPage);
  }, [onSeasonPage, menu]);

  return (
    <header className="sticky top-0 z-30">
      {/* Blurred, tinted backdrop for the bar only. Its bottom edge is masked
          out (nav-fade) so the bar melts into the page with no hard line. The
          84px height = 4px accent line + 80px (h-20) nav row. Lite mode swaps
          this for a solid page-coloured backdrop (see .nav-backdrop rules). */}
      <div aria-hidden className="nav-backdrop nav-fade pointer-events-none absolute inset-x-0 top-0 h-[84px] bg-card/95 backdrop-blur" />
      <div className="relative">
        {/* team-colour accent line = scroll progress indicator */}
        <ScrollProgressLine />
        <nav className="container-page flex h-20 items-center justify-between gap-3">
        {/* Logo + season pill share the left edge so the pill hugs the wordmark
            rather than floating out toward the centre. The line under the
            wordmark belongs to the SERIES switcher (nothing with one series —
            the series is page identity, so the control shows on every page). */}
        <div className="flex min-w-0 items-center">
          <div className="flex shrink-0 items-center gap-3">
            <NavLink to={seriesPath("")} className="shrink-0">
              <Logo size={46} />
            </NavLink>
            <span className="leading-tight">
              {/* The wordmark is the one thing here that can go: between lg
                  and xl the bar has no room for it next to the links, and the
                  logo says the same thing. */}
              <NavLink
                to={seriesPath("")}
                className="block text-base font-extrabold tracking-tight text-dark lg:hidden xl:block"
              >
                NABS Racing League
              </NavLink>
              <SeriesSwitcher />
            </span>
          </div>

          {/* On season-scoped pages the season switcher docks into the bar too
              (it stays on the Home ticker line as before). From lg up, which is
              exactly where the burger menu — the only other place it lives —
              disappears: at xl it left the 1024–1280 range with no way to change
              season at all on the standings and races pages. The compact pill is
              about 120px and the bar has roughly 195px spare at 1100px, so it
              fits the range it was being kept out of. Phones still get it in the
              burger menu. */}
          {dock.render && (
            <div className={`nav-season-dock ml-3 hidden shrink-0 lg:flex ${dock.shown ? "" : "is-hidden"}`}>
              <SeasonPicker compact />
            </div>
          )}
        </div>

        {/* Desktop nav — the active page's pill highlight GLIDES between the
            items instead of jumping (one absolutely-positioned pill follows
            whichever item carries `.is-active`). */}
        <div ref={desktopNavRef} className="relative hidden shrink-0 items-center gap-0.5 lg:flex xl:gap-1">
          {navPill && (
            <span
              aria-hidden
              className="absolute left-0 top-0 will-change-transform rounded-lg bg-brand/20 ring-1 ring-inset ring-brand/50 transition-[transform,width,height] duration-base ease-out-soft"
              style={{ transform: `translate(${navPill.left}px, ${navPill.top}px)`, width: navPill.width, height: navPill.height }}
            />
          )}
          {links.map((l) =>
            l.standings ? (
              <StandingsNav key="standings" seriesPath={seriesPath} />
            ) : (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  desktopLinkClass({ isActive: isActive || l.alsoActiveOn === location.pathname })
                }
                ref={l.label === "Live" ? liveRef : undefined}
                data-tour={l.tour}
                title={l.label === "Live" && liveNow ? `${liveNow} on track right now` : undefined}
              >
                {l.label}
                {/* The one thing on the site that says a session is happening.
                    Keyed on cars actually ON TRACK, not on "a server answered":
                    the league's practice server is up around the clock, so a
                    connection-based marker would be lit permanently and mean
                    nothing.
                    It is the plain count in the site's own "label + number"
                    style — the same shape the Races page uses for its session
                    tabs. A pulsing dot was tried and thrown out: it is the
                    generic dashboard cliché, and it says less than the number
                    does. Fourteen cars out is the interesting fact. */}
                {l.label === "Live" && liveNow > 0 && (
                  <span className="ml-1.5 font-mono text-[11px] font-bold tabular-nums opacity-70">{liveNow}</span>
                )}
                {l.label === "Live" && liveNow > 0 && <span className="sr-only"> ({liveNow} on track)</span>}
                {l.label === "Live" && liveFeatureNew && <span className="ml-1.5 hidden rounded bg-brand px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink xl:inline">New</span>}
                {/* Same shape as Live's count, for the same reason: the number
                    is the interesting fact, not a dot. It is brand-coloured and
                    breathes because unlike cars on track this is something the
                    reader can ACT on, and it is gone the moment they have. The
                    glow is opacity only — the sliding highlight measures these
                    items with getBoundingClientRect, so anything that moves or
                    scales here would drag the pill around with it. */}
                {l.label === "Attendance" && seats.show && (
                  <span className="glow-pulse ml-1.5 font-mono text-[11px] font-bold tabular-nums text-brand">
                    {seats.openCount}
                  </span>
                )}
                {l.label === "Attendance" && seats.show && (
                  <span className="sr-only">
                    {" "}
                    ({seats.openCount === 1 ? "a seat is free" : `${seats.openCount} seats are free`})
                  </span>
                )}
              </NavLink>
            )
          )}
          {/* Global search sits just left of the profile chip; expanded, it
              reaches left to the "Live" item (liveRef) and its dropdown matches. */}
          <GlobalSearch className="ml-1 mr-1" alignLeftRef={liveRef} />
          <AuthControl />
          {/* The bell replaced the gear here; Settings lives inside its menu. */}
          <NotificationBell className="ml-1 h-9 w-9" />
        </div>

        {/* Mobile controls */}
        <div className="flex items-center gap-1 lg:hidden">
          <NotificationBell className="h-10 w-10" />
          <button
            onClick={() => (open ? closeMenu() : openMenu())}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            data-tour="nav-burger"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-dark transition hover:bg-surface2"
          >
            {open ? (
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </nav>
      </div>

      {/* Mobile menu — a drop-down panel that OVERLAYS the page (absolute, so the
          content underneath stays put) with a soft scrim. Tapping the scrim or a
          link closes it. Both fade/slide in and back out again (see .nav-scrim /
          .nav-drop and their .is-closing variants); `closing` is what keeps the
          panel mounted long enough for the way out to be seen. */}
      {menu !== "closed" && (
        <div className="lg:hidden">
          {/* pointer-events-none while closing: the fading scrim must not eat
              the very next tap (which used to make the page feel dead for a
              beat after closing — and a tap ON it re-armed the close). */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={closeMenu}
            className={`nav-scrim fixed inset-x-0 bottom-0 top-[84px] z-20 bg-ink/40 backdrop-blur-sm ${closing ? "is-closing pointer-events-none" : ""}`}
          />
          <div
            onAnimationEnd={(e) => closing && e.target === e.currentTarget && finishClose()}
            className={`nav-drop absolute inset-x-0 top-full z-30 max-h-[calc(100dvh-96px)] origin-top overflow-y-auto border-t border-border bg-card shadow-xl shadow-ink/20 ${closing ? "is-closing pointer-events-none" : ""}`}
          >
            <div className="container-page flex flex-col py-3">
              {/* You-stuff first, on ONE row: profile chip left, search right.
                  The chip keeps its natural width (name truncates via its own
                  max-w), the search field takes the rest of the line. */}
              <div className="flex items-center gap-2">
                <AuthControl mobile={false} />
                <div className="min-w-0 flex-1">
                  <GlobalSearch mobile />
                </div>
              </div>

              {/* No series switcher here — the one under the wordmark in the bar
                  covers that on every page. Only the season filter docks in,
                  and only on season-scoped pages (phones have no other one). */}
              {menuSeason && (
                <>
                  <MobileMenuLabel>Season</MobileMenuLabel>
                  <div className="px-2 py-1">
                    <SeasonPicker onPick={closeMenu} />
                  </div>
                </>
              )}

              <MobileMenuLabel>League</MobileMenuLabel>
              <MobileRow to={seriesPath("")} end alsoActiveOn="/" icon={NAV_ICONS.home} label="Home" />
              <MobileRow to={seriesPath("/races")} icon={NAV_ICONS.races} label="Races" sub="Calendar & results" />
              {attendanceOpen && (
                <MobileRow
                  to={seriesPath("/attendance")}
                  icon={NAV_ICONS.attendance}
                  label="Attendance"
                  sub={seats.show ? (seats.openCount === 1 ? "A seat is free" : `${seats.openCount} seats are free`) : "Race sign-up"}
                  badge={
                    seats.show ? (
                      <span className="glow-pulse shrink-0 font-mono text-[11px] font-bold tabular-nums text-brand">
                        {seats.openCount}
                      </span>
                    ) : null
                  }
                />
              )}
              <MobileRow
                to={seriesPath("/live")}
                icon={NAV_ICONS.live}
                label="Live"
                sub={liveFeatureNew ? "New: satellite track map" : liveNow > 0 ? `${liveNow} on track right now` : "Live timing"}
              />

              <MobileMenuLabel>Standings</MobileMenuLabel>
              <MobileRow to={seriesPath("/drivers")} icon={NAV_ICONS.drivers} label="Drivers" />
              <MobileRow to={seriesPath("/constructors")} icon={NAV_ICONS.constructors} label="Constructors" />
              {transfersVisible && <MobileRow to={seriesPath("/transfers")} icon={NAV_ICONS.transfers} label="Transfers" sub="Team changes, round by round" />}
              <MobileRow to={seriesPath("/records")} icon={NAV_ICONS.records} label="Hall of Fame" sub="All-time records" />

              <MobileMenuLabel>More</MobileMenuLabel>
              <MobileRow to="/downloads" icon={NAV_ICONS.info} label="Race Info" sub="Rules & downloads" />
              {/* The phone's way to the feedback panel: the floating button in
                  the corner is desktop-only, so this row is what opens it here. */}
              <MobileActionRow
                icon={NAV_ICONS.feedback}
                label="Feedback"
                sub="Report a bug or an idea"
                onClick={() => {
                  closeMenu();
                  openFeedback();
                }}
              />
              {isLoggedIn && hasThreads && (
                <MobileRow to="/feedback" icon={NAV_ICONS.messages} label="Your messages" sub="What the admins replied" />
              )}
              {/* Stewarding, on a phone. The corner button is desktop-only, and
                  a race night is the one evening the whole grid is on phones. */}
              {isLoggedIn && REPORTS_OPEN_TO_MEMBERS && (
                <>
                  <MobileRow
                    to={reportsPath({ nw: true })}
                    icon={NAV_ICONS.incident}
                    label="Report an incident"
                    sub="To the stewards, privately"
                  />
                  {/* Only once there is something in it. Until somebody is in
                      an argument, this is a row that leads to an empty page —
                      the same rule "Your messages" already follows. */}
                  {hasReports && (
                    <MobileRow
                      to="/reports"
                      icon={NAV_ICONS.myReports}
                      label="My reports"
                      sub="And what was decided"
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
