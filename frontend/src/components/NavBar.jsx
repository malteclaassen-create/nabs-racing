import { NavLink } from "react-router-dom";
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

export default function NavBar() {
  const { theme, toggle } = useTheme();
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

        <div className="flex items-center gap-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  isActive ? "bg-primary/10 text-primary" : "text-medium hover:bg-surface2"
                }`
              }
            >
              {l.live && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
              )}
              {l.label}
            </NavLink>
          ))}
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `ml-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                isActive ? "bg-ink text-white" : "text-light hover:bg-surface2"
              }`
            }
          >
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
      </nav>
    </header>
  );
}
