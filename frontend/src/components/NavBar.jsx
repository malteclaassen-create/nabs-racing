import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useSeason } from "../context/SeasonContext.jsx";
import { useAuth } from "../hooks/useAuth.js";
import Logo from "./Logo.jsx";
import NextRaceTimer from "./NextRaceTimer.jsx";
import SettingsButton from "./SettingsPanel.jsx";
import { DriverAvatar } from "./ui.jsx";
import { useSocial, SocialIcon } from "./SocialLinks.jsx";

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
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-3.5 py-2 text-sm font-bold text-dark transition hover:bg-brand/20 ${
        mobile ? "w-full" : ""
      }`}
    >
      Log in
    </NavLink>
  );
}

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

// The season switcher now lives on the Home page (SeasonTimeline), not the bar.

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/drivers", label: "Drivers" },
  { to: "/constructors", label: "Constructors" },
  { to: "/races", label: "Races" },
  { to: "/live", label: "Live Timing" },
  { to: "/downloads", label: "Race Info" },
];

const linkClass = ({ isActive }) =>
  `nav-link flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
    isActive ? "bg-brand/20 text-dark ring-1 ring-brand/50" : "text-medium hover:bg-surface2"
  }`;

export default function NavBar() {
  const { current } = useSeason();
  const social = useSocial();
  const { isLoggedIn } = useAuth();
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
              {l.label}
            </NavLink>
          ))}
          <AuthControl />
          {!isLoggedIn && <JoinDiscord url={social.data?.discord} className="ml-1" />}
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

      {/* Mobile menu panel */}
      {open && (
        <div className="relative border-t border-border bg-card lg:hidden">
          <div className="container-page flex flex-col gap-1 py-3">
            <AuthControl mobile />
            {!isLoggedIn && <JoinDiscord url={social.data?.discord} className="mb-1 w-full" />}
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
