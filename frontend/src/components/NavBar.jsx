import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useSeries, useSeriesPath } from "../context/SeriesContext.jsx";
import { useAuth } from "../hooks/useAuth.js";
import Logo from "./Logo.jsx";
import SeasonPicker from "./SeasonPicker.jsx";
import SeriesSwitcher from "./SeriesSwitcher.jsx";
import SettingsButton from "./SettingsPanel.jsx";
import { DriverAvatar } from "./ui.jsx";

// Auth-aware control that replaces the old "Sign Up" nav item: a "Log in" button
// when logged out, or the driver's avatar + name when in. The chip links to the
// PUBLIC driver page of the current season (the editor is one click further,
// via "Edit my profile" there); a login without a linked driver row still
// lands on /profile, which explains the linking.
function AuthControl({ mobile = false }) {
  const { user, isLoggedIn } = useAuth();
  if (isLoggedIn) {
    const name = user.driverName || user.discordName || "Profile";
    return (
      <NavLink
        to={user.driverId ? `/drivers/${user.driverId}` : "/profile"}
        title="Your driver profile"
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
// going back Home. The docked pill fades in/out as you move on/off these
// pages — see .nav-season-dock. (Paths are checked with the /s/<slug> series
// prefix stripped.)
const SEASON_PAGES = ["/drivers", "/constructors", "/races"];

// Nav links, built per render: series-scoped pages carry the /s/<slug> prefix
// of the series being viewed; Race Info (downloads) is global and has none.
function navLinks(p) {
  return [
    { to: p(""), label: "Home", end: true },
    { to: p("/drivers"), label: "Drivers" },
    { to: p("/constructors"), label: "Constructors" },
    { to: p("/races"), label: "Races" },
    { to: p("/attendance"), label: "Attendance" },
    { to: p("/live"), label: "Live" },
    { to: "/downloads", label: "Race Info" },
  ];
}

const linkClass = ({ isActive }) =>
  // The active ring is INSET on purpose: an outset 1px ring sits outside the
  // pill and can round away to nothing on one edge at fractional browser zoom
  // (e.g. 90%), which made the pill look cut off at the bottom. Inside the
  // pill, a lost edge just melts into the tinted background instead.
  `nav-link flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition ${
    isActive ? "bg-brand/20 text-dark ring-1 ring-inset ring-brand/50" : "text-medium hover:bg-surface2"
  }`;

export default function NavBar() {
  const { seriesList } = useSeries();
  const { seriesPath } = useSeriesPath();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const links = navLinks(seriesPath);

  // Close the mobile menu whenever the route changes.
  useEffect(() => setOpen(false), [location.pathname]);

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

  return (
    <header className="sticky top-0 z-30">
      {/* Blurred, tinted backdrop for the bar only. Its bottom edge is masked
          out (nav-fade) so the bar melts into the page with no hard line. The
          84px height = 4px accent line + 80px (h-20) nav row. Lite mode swaps
          this for a solid page-coloured backdrop (see .nav-backdrop rules). */}
      <div aria-hidden className="nav-backdrop nav-fade pointer-events-none absolute inset-x-0 top-0 h-[84px] bg-card/95 backdrop-blur" />
      <div className="relative">
        {/* team-colour accent line */}
        <div className="h-1 w-full bg-gradient-to-r from-primary via-amber-500 to-sky-600" />
        <nav className="container-page flex h-20 items-center justify-between">
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
              <NavLink to={seriesPath("")} className="block text-base font-extrabold tracking-tight text-dark">
                NABS Racing League
              </NavLink>
              <SeriesSwitcher />
            </span>
          </div>

          {/* On season-scoped pages the season switcher docks into the bar too
              (it stays on the Home ticker line as before). It sits out the
              packed lg→xl range; phones get it in the burger menu instead. */}
          {dock.render && (
            <div className={`nav-season-dock ml-3 hidden shrink-0 xl:flex ${dock.shown ? "" : "is-hidden"}`}>
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
              {/* Series first (page identity), season below it (page filter). */}
              {seriesList.length > 1 && (
                <div className="px-2 py-1.5">
                  <SeriesSwitcher mobile onPick={() => setOpen(false)} />
                </div>
              )}
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
