import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTheme } from "../hooks/useTheme.js";
import Logo from "./Logo.jsx";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/drivers", label: "Drivers" },
  { to: "/constructors", label: "Constructors" },
  { to: "/races", label: "Races" },
  { to: "/live", label: "Live", live: true },
  { to: "/signup", label: "Sign Up" },
];

const linkClass = ({ isActive }) =>
  `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
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

export default function NavBar() {
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the mobile menu whenever the route changes.
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <header className="sticky top-0 z-30 bg-card/95 shadow-nav backdrop-blur">
      {/* team-colour accent line */}
      <div className="h-1 w-full bg-gradient-to-r from-primary via-amber-500 to-sky-600" />
      <nav className="container-page flex h-20 items-center justify-between">
        <NavLink to="/" className="flex items-center gap-3">
          <Logo size={46} />
          <span className="leading-tight">
            <span className="block text-base font-extrabold tracking-tight text-dark">
              NABS Racing League
            </span>
            <span className="block text-xs font-semibold uppercase tracking-widest text-light">
              Season 7
            </span>
          </span>
        </NavLink>

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
          <button
            onClick={toggle}
            aria-label="Toggle dark mode"
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-light transition hover:bg-surface2"
          >
            {theme === "dark" ? "☀️" : "🌙"}
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
            {theme === "dark" ? "☀️" : "🌙"}
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

      {/* Mobile menu panel */}
      {open && (
        <div className="border-t border-border bg-card lg:hidden">
          <div className="container-page flex flex-col gap-1 py-3">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
                {l.live && <LiveDot />}
                {l.label}
              </NavLink>
            ))}
            <NavLink to="/admin" className={adminClass}>
              Admin
            </NavLink>
          </div>
        </div>
      )}
    </header>
  );
}
