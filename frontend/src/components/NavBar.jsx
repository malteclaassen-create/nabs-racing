import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useSeason } from "../context/SeasonContext.jsx";
import { useAuth } from "../hooks/useAuth.js";
import Logo from "./Logo.jsx";
import NextRaceTimer from "./NextRaceTimer.jsx";
import SeasonPicker from "./SeasonPicker.jsx";
import SettingsButton from "./SettingsPanel.jsx";
import { DriverAvatar } from "./ui.jsx";

// Auth-aware control that replaces the old "Sign Up" nav item: a "Log in" button
// when logged out, or the driver's avatar + name (linking to /profile) when in.
function AuthControl({ mobile = false }) {
  const { user, isLoggedIn } = useAuth();
  if (isLoggedIn) {
    const name = user.driverName || user.discordName || "Profile";
    return (
      <NavLink
        to="/profile"
        title="Your profile"
        className={({ isActive }) =>
          `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold transition ${
            mobile ? "w-full" : ""
          } ${isActive ? "bg-brand/20 text-dark ring-1 ring-brand/50" : "text-medium hover:bg-surface2"}`
        }
      >
        <DriverAvatar name={name} photoUrl={user.avatarUrl} color="#4251a8" size={26} />
        <span className="max-w-[8rem] truncate">{name}</span>
      </NavLink>
    );
  }
  return (
    <NavLink
      to="/profile"
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-brand/40 bg-brand/10 px-3.5 py-2 text-sm font-bold text-dark transition hover:bg-brand/20 ${
        mobile ? "w-full" : ""
      }`}
    >
      Log in
    </NavLink>
  );
}

// The season switcher lives on the Home page (season ticker line); on the
// season-scoped standings pages below it ALSO docks into the bar (compact
// pill on desktop, a row in the mobile menu) so you can hop seasons without
// going back Home.
const SEASON_PAGES = ["/drivers", "/constructors", "/races"];

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/drivers", label: "Drivers" },
  { to: "/constructors", label: "Constructors" },
  { to: "/races", label: "Races" },
  { to: "/attendance", label: "Attendance" },
  { to: "/live", label: "Live" },
  { to: "/downloads", label: "Race Info" },
];

const linkClass = ({ isActive }) =>
  `nav-link flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition ${
    isActive ? "bg-brand/20 text-dark ring-1 ring-brand/50" : "text-medium hover:bg-surface2"
  }`;

export default function NavBar() {
  const { current } = useSeason();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the mobile menu whenever the route changes.
  useEffect(() => setOpen(false), [location.pathname]);

  // Scroll-linked progress (0→1) that floats the next-race chip up from the
  // inline home countdown into the bar. On inner pages it's simply parked (1).
  const isHome = location.pathname === "/";
  const onSeasonPage = SEASON_PAGES.some((p) => location.pathname.startsWith(p));
  const [p, setP] = useState(isHome ? 0 : 1);
  useEffect(() => {
    if (!isHome) {
      setP(1);
      return;
    }
    const START = 40;
    const END = 180;
    let raf = 0;
    const update = () => {
      raf = 0;
      const t = (window.scrollY - START) / (END - START);
      setP(Math.min(1, Math.max(0, t)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isHome]);
  const showDocked = !isHome || p > 0.001;

  return (
    <header className="sticky top-0 z-30">
      {/* Blurred, tinted backdrop for the bar only. Its bottom edge is masked
          out (nav-fade) so the bar melts into the page with no hard line. The
          84px height = 4px accent line + 80px (h-20) nav row. */}
      <div aria-hidden className="nav-fade pointer-events-none absolute inset-x-0 top-0 h-[84px] bg-card/95 backdrop-blur" />
      <div className="relative">
        {/* team-colour accent line */}
        <div className="h-1 w-full bg-gradient-to-r from-primary via-amber-500 to-sky-600" />
        <nav className="container-page flex h-20 items-center justify-between">
        {/* Logo + chip share the left edge so the chip hugs the wordmark
            rather than floating out toward the centre. */}
        <div className="flex min-w-0 items-center">
          <NavLink to="/" className="flex shrink-0 items-center gap-3">
            <Logo size={46} />
            {/* On phones the wordmark steps aside for the docked chip so nothing
                gets squeezed; it stays put from sm up and whenever undocked. */}
            <span className={`leading-tight ${showDocked ? "hidden sm:block" : "block"}`}>
              <span className="block text-base font-extrabold tracking-tight text-dark">
                NABS Racing League
              </span>
              <span className="block text-xs font-semibold uppercase tracking-widest text-light">
                {current ? current.name : "NABS"}
              </span>
            </span>
          </NavLink>

          {/* Next-race chip floats up into the bar as you scroll (p: 0→1);
              on inner pages it just eases in once. */}
          {showDocked && (
            <div
              /* between lg and xl the nav links need every pixel, so the
                 docked chip sits this range out. On season pages the switcher
                 pill takes the xl slot, so the chip waits until 2xl there. */
              className={`ml-3 flex shrink-0 sm:ml-4 lg:hidden ${onSeasonPage ? "2xl:flex" : "xl:flex"}`}
              style={{
                opacity: p,
                transform: `translateY(${(1 - p) * 24}px) scale(${0.92 + 0.08 * p})`,
                transition: isHome ? undefined : "opacity .35s ease-out, transform .35s ease-out",
              }}
            >
              <NextRaceTimer compact className="shrink-0" />
            </div>
          )}

          {/* On season-scoped pages the season switcher docks into the bar too
              (it stays on the Home ticker line as before). Like the chip it
              sits out the packed lg→xl range; phones get it in the burger menu. */}
          {onSeasonPage && (
            <div className="ml-3 hidden shrink-0 xl:flex">
              <SeasonPicker compact />
            </div>
          )}
        </div>

        {/* Desktop nav */}
        <div className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
          <AuthControl />
          <SettingsButton className="ml-1 h-9 w-9" />
        </div>

        {/* Mobile controls */}
        <div className="flex items-center gap-1 lg:hidden">
          <SettingsButton className="h-10 w-10" />
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
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
          link closes it. Both fade/slide in (see .nav-scrim / .nav-drop). */}
      {open && (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="nav-scrim fixed inset-x-0 bottom-0 top-[84px] z-20 bg-ink/40 backdrop-blur-sm"
          />
          <div className="nav-drop absolute inset-x-0 top-full z-30 origin-top border-t border-border bg-card shadow-xl shadow-ink/20">
            <div className="container-page flex flex-col gap-1 py-3">
              <AuthControl mobile />
              {onSeasonPage && (
                <div className="px-2 py-1.5">
                  <SeasonPicker onPick={() => setOpen(false)} />
                </div>
              )}
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
                  {l.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
