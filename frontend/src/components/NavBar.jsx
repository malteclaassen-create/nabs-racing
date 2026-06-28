import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTheme } from "../hooks/useTheme.js";
import { useSeason } from "../context/SeasonContext.jsx";
import Logo from "./Logo.jsx";
import NextRaceTimer from "./NextRaceTimer.jsx";
import { useSocial, SocialIcon } from "./SocialLinks.jsx";

// Blurple "Join Discord" call-to-action, shown when a Discord link is set.
function JoinDiscord({ url, className = "" }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#5865F2] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#4752c4] ${className}`}
    >
      <SocialIcon name="discord" className="h-4 w-4" />
      Join Discord
    </a>
  );
}

// Dropdown to switch the viewed season (only shown when more than one exists).
function SeasonSwitcher({ className = "" }) {
  const { seasons, season, setSeason } = useSeason();
  if (seasons.length <= 1) return null;
  return (
    <select
      aria-label="Season"
      value={season ?? ""}
      onChange={(e) => setSeason(Number(e.target.value))}
      className={`rounded-lg border border-border bg-surface2 px-2.5 py-2 text-sm font-semibold text-medium transition hover:text-dark focus:outline-none focus:ring-2 focus:ring-brand/40 ${className}`}
    >
      {seasons.map((s) => (
        <option key={s.id} value={s.number}>
          {s.name}
          {s.isActive ? " (current)" : ""}
        </option>
      ))}
    </select>
  );
}

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/drivers", label: "Drivers" },
  { to: "/constructors", label: "Constructors" },
  { to: "/races", label: "Races" },
  { to: "/live", label: "Live Timing", live: true },
  { to: "/signup", label: "Sign Up" },
];

const linkClass = ({ isActive }) =>
  `nav-link flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
    isActive ? "bg-brand/20 text-dark ring-1 ring-brand/50" : "text-medium hover:bg-surface2"
  }`;

const adminClass = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-semibold transition ${
    isActive ? "bg-ink text-white" : "text-light hover:bg-surface2"
  }`;

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
    </span>
  );
}

// Clean line-style sun/moon for the theme toggle (instead of OS emoji glyphs, so
// it matches the rest of the nav and inherits the current text colour).
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export default function NavBar() {
  const { theme, toggle } = useTheme();
  const { current } = useSeason();
  const social = useSocial();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the mobile menu whenever the route changes.
  useEffect(() => setOpen(false), [location.pathname]);

  // Scroll-linked progress (0→1) that floats the next-race chip up from the
  // inline home countdown into the bar. On inner pages it's simply parked (1).
  const isHome = location.pathname === "/";
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
              className="ml-3 flex shrink-0 sm:ml-4"
              style={{
                opacity: p,
                transform: `translateY(${(1 - p) * 24}px) scale(${0.92 + 0.08 * p})`,
                transition: isHome ? undefined : "opacity .35s ease-out, transform .35s ease-out",
              }}
            >
              <NextRaceTimer compact className="shrink-0" />
            </div>
          )}
        </div>

        {/* Desktop nav */}
        <div className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
              {l.live && <LiveDot />}
              {l.label}
            </NavLink>
          ))}
          <NavLink to="/admin" className={adminClass}>
            Admin
          </NavLink>
          <JoinDiscord url={social.data?.discord} className="ml-1" />
          <SeasonSwitcher className="ml-1" />
          <button
            onClick={toggle}
            aria-label="Toggle dark mode"
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-light transition hover:bg-surface2"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>

        {/* Mobile controls */}
        <div className="flex items-center gap-1 lg:hidden">
          <button
            onClick={toggle}
            aria-label="Toggle dark mode"
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-light transition hover:bg-surface2"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
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

      {/* Mobile menu panel */}
      {open && (
        <div className="relative border-t border-border bg-card lg:hidden">
          <div className="container-page flex flex-col gap-1 py-3">
            <JoinDiscord url={social.data?.discord} className="mb-1 w-full" />
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
                {l.live && <LiveDot />}
                {l.label}
              </NavLink>
            ))}
            <NavLink to="/admin" className={adminClass}>
              Admin
            </NavLink>
            <SeasonSwitcher className="mt-1 w-full" />
          </div>
        </div>
      )}
    </header>
  );
}
