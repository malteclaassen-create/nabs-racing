import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { TAB_GROUPS, tabInfo } from "./tabs.js";

// The admin's menu, in two shapes with the same tabs:
//
//  * "tabs": across the top, the four groups side by side with their names
//    over them.
//  * "rail": a list down the left, each group folding open to its tabs, the
//    panel beside it.
//
// The choice is remembered per browser and only applies on a wide screen.
// Phones and tablets always get one line saying where you are, which opens
// the list.

export const NAV_TABS = "tabs";
export const NAV_RAIL = "rail";
const NAV_KEY = "rr_admin_nav";

export function useNavMode() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem(NAV_KEY) === NAV_RAIL ? NAV_RAIL : NAV_TABS;
    } catch {
      return NAV_TABS;
    }
  });
  const change = (m) => {
    setMode(m);
    try {
      localStorage.setItem(NAV_KEY, m);
    } catch {
      // private window: the choice lasts until the page is closed
    }
  };
  return [mode, change];
}

// How many things wait in a tab: a red count, like a notification.
export function Badge({ n }) {
  if (!n) return null;
  return (
    <span className="ml-1.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
      {n > 9 ? "9+" : n}
    </span>
  );
}

function Chevron({ open, className = "h-4 w-4", shut = "", turned = "rotate-90" }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0 transition-transform duration-200 ${open ? turned : shut}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function NavToggle({ mode, onChange }) {
  const item = (key, label, path) => (
    <button
      key={key}
      type="button"
      onClick={() => onChange(key)}
      title={key === NAV_RAIL ? "Menu down the left side" : "Tabs across the top"}
      aria-pressed={mode === key}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold transition ${mode === key ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4.5" width="18" height="15" rx="2" />
        <path d={path} />
      </svg>
      {label}
    </button>
  );
  return (
    <div className="flex rounded-full border border-line bg-card p-0.5">
      {item(NAV_RAIL, "Sidebar", "M9.5 4.5v15")}
      {item(NAV_TABS, "Tabs", "M3 10h18")}
    </div>
  );
}

// Across the top: every tab visible at once, under its group's name.
function TabStrip({ badges }) {
  return (
    <div className="mb-6 hidden flex-wrap gap-x-6 gap-y-3 border-b border-line lg:flex">
      {TAB_GROUPS.map((g) => (
        <div key={g.label}>
          <div className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted/70">{g.label}</div>
          <div className="flex flex-wrap gap-1">
            {g.tabs.map((t) => (
              <NavLink
                key={t.id}
                to={`/admin/${t.id}`}
                className={({ isActive }) =>
                  `-mb-px flex items-center whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-bold transition ${isActive ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`
                }
              >
                {t.label}
                <Badge n={badges[t.id]} />
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Down the left (or, below lg, behind one line over the panel).
function SideRail({ tab, badges, phoneOnly = false }) {
  const active = tabInfo(tab);
  // only the group of the open tab starts open
  const [open, setOpen] = useState(() => (active ? [active.group] : []));
  const [drawer, setDrawer] = useState(false);
  // arriving on a tab from elsewhere (the search, the to-do card) opens its group
  useEffect(() => {
    const g = tabInfo(tab)?.group;
    if (g) setOpen((o) => (o.includes(g) ? o : [...o, g]));
    setDrawer(false);
  }, [tab]);
  const total = Object.values(badges).reduce((a, b) => a + (b || 0), 0);

  return (
    <aside className={`mb-4 sm:mb-6 ${phoneOnly ? "lg:hidden" : "lg:sticky lg:top-24 lg:mb-0 lg:self-start"}`}>
      <button
        type="button"
        onClick={() => setDrawer((d) => !d)}
        aria-expanded={drawer}
        aria-controls="admin-rail"
        className="mb-2 flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-2.5 text-left lg:hidden"
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{active?.group || "Admin"}</span>
          <span className="display block truncate text-base leading-tight">{active?.label || "Pick a section"}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-muted">
          {!drawer && <Badge n={total} />}
          <Chevron open={drawer} className="h-5 w-5" shut="rotate-90" turned="-rotate-90" />
        </span>
      </button>

      <nav id="admin-rail" aria-label="Admin sections" className={`card overflow-hidden lg:block ${drawer ? "block" : "hidden"}`}>
        {TAB_GROUPS.map((g, gi) => {
          const isOpen = open.includes(g.label);
          const holdsActive = g.tabs.some((t) => t.id === tab);
          const hidden = g.tabs.reduce((n, t) => n + (badges[t.id] || 0), 0);
          return (
            <div key={g.label} className={gi ? "border-t border-line" : ""}>
              <button
                type="button"
                onClick={() => setOpen((o) => (o.includes(g.label) ? o.filter((x) => x !== g.label) : [...o, g.label]))}
                aria-expanded={isOpen}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-white/5 ${holdsActive ? "text-ink" : "text-muted hover:text-ink"}`}
              >
                <Chevron open={isOpen} className="h-3.5 w-3.5" />
                <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.18em]">{g.label}</span>
                {!isOpen && holdsActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
                {!isOpen && <Badge n={hidden} />}
              </button>
              {isOpen && (
                <ul className="pb-1.5">
                  {g.tabs.map((t) => (
                    <li key={t.id}>
                      <NavLink
                        to={`/admin/${t.id}`}
                        className={({ isActive }) =>
                          `flex w-full items-center border-l-2 py-1.5 pl-5 pr-3 text-sm transition ${
                            isActive ? "border-accent bg-white/5 font-bold text-ink" : "border-transparent font-semibold text-muted hover:bg-white/5 hover:text-ink"
                          }`
                        }
                      >
                        <span className="flex-1 truncate">{t.label}</span>
                        <Badge n={badges[t.id]} />
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export default function AdminNav({ mode, tab, badges }) {
  return mode === NAV_RAIL ? (
    <SideRail tab={tab} badges={badges} />
  ) : (
    <>
      <SideRail tab={tab} badges={badges} phoneOnly />
      <TabStrip badges={badges} />
    </>
  );
}
