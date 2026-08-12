import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { SmoothHeight } from "./ui.jsx";
import SlidingTabs from "./SlidingTabs.jsx";
import { TAB_GROUPS, tabInfo } from "../data/adminIndex.js";
import { NAV_RAIL, NAV_TABS } from "../hooks/useAdminNavMode.js";
import { FEEDBACK_CHANGED_EVENT } from "./AdminFeedback.jsx";
import { REPORTS_CHANGED_EVENT } from "./AdminReports.jsx";
import { MEMBERS_CHANGED_EVENT } from "./AdminMembers.jsx";
import { MARKET_CHANGED_EVENT } from "../hooks/useAdminAttention.js";

// ---------------------------------------------------------------------------
// The admin's navigation, in two shapes that show the SAME twenty-two tabs.
//
//  * "tabs" — the strip that has always been at the top of the page: five
//    little groups of buttons, everything visible at once, and about two lines
//    tall by the time it wraps.
//  * "rail" — a list down the left: the five group names, each folding open to
//    its tabs, with the panel beside it. Nothing scrolls out of reach and the
//    place you are is written down the side while you work.
//
// Neither one changes what a tab CONTAINS. The choice is remembered per
// browser, so an admin who prefers the old strip only says so once.
//
// The counts on Feedback and Reports are fetched here, once, rather than by the
// buttons themselves: the rail can fold a group away, and a report waiting on a
// decision must not disappear with it. The group header carries the total of
// whatever it has hidden.
//
// Which of the two is in use is remembered by hooks/useAdminNavMode.js.
// ---------------------------------------------------------------------------

// How many things are waiting in each tab. Three numbers, all of which mean
// "somebody is waiting on you": a new bug report, an incident report with no
// decision yet, a login sitting there without a driver.
function useAdminBadges() {
  const feedback = useApi(useCallback(() => api.adminFeedback(), []));
  const reports = useApi(useCallback(() => api.adminReports(), []));
  const members = useApi(useCallback(() => api.adminMembersPending(), []));
  // The market's number comes off the shared attention count rather than the
  // market list: a seat waiting on a decision is one integer, and the list is
  // every offer of the season with its interested reserves attached.
  const attention = useApi(useCallback(() => api.adminAttention(), []));
  const reloadFeedback = feedback.reload;
  const reloadReports = reports.reload;
  const reloadMembers = members.reload;
  const reloadAttention = attention.reload;
  // Working through an entry in the panel must take the number down with it.
  useEffect(() => {
    window.addEventListener(FEEDBACK_CHANGED_EVENT, reloadFeedback);
    return () => window.removeEventListener(FEEDBACK_CHANGED_EVENT, reloadFeedback);
  }, [reloadFeedback]);
  useEffect(() => {
    window.addEventListener(REPORTS_CHANGED_EVENT, reloadReports);
    return () => window.removeEventListener(REPORTS_CHANGED_EVENT, reloadReports);
  }, [reloadReports]);
  useEffect(() => {
    window.addEventListener(MEMBERS_CHANGED_EVENT, reloadMembers);
    return () => window.removeEventListener(MEMBERS_CHANGED_EVENT, reloadMembers);
  }, [reloadMembers]);
  useEffect(() => {
    window.addEventListener(MARKET_CHANGED_EVENT, reloadAttention);
    return () => window.removeEventListener(MARKET_CHANGED_EVENT, reloadAttention);
  }, [reloadAttention]);
  return {
    feedback: feedback.data?.newCount || 0,
    reports: reports.data?.open || 0,
    members: members.data?.unlinked || 0,
    market: attention.data?.market || 0,
  };
}

function Badge({ n }) {
  if (!n) return null;
  return (
    <span className="ml-1.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-brand px-1 font-mono text-[10px] font-bold leading-none text-ink">
      {n > 9 ? "9+" : n}
    </span>
  );
}

// Points right when shut and down when open. Both turns are named rather than
// stacked on top of a base rotation: two rotate-* classes on one element do not
// add up (they set the same variable, and the stylesheet decides which wins),
// so the phone's chevron — down when shut, up when open — has to say both.
function Chevron({ open, className = "h-4 w-4", shut = "", turned = "rotate-90" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} shrink-0 transition-transform duration-base ease-out-soft ${open ? turned : shut}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// --- the switch between the two shapes --------------------------------------
// A segmented control like every other view switcher on the site. The words are
// hidden on phones, where the two glyphs have the row to themselves anyway.
export function AdminNavToggle({ mode, onChange }) {
  const item = (key, label, icon) => ({
    key,
    title: key === NAV_RAIL ? "Menu down the left side" : "Tabs across the top",
    label: (
      <span className="flex items-center gap-1.5">
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </span>
    ),
  });
  return (
    <SlidingTabs
      items={[
        item(
          NAV_RAIL,
          "Sidebar",
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4.5" width="18" height="15" rx="2" />
            <path d="M9.5 4.5v15" />
          </svg>
        ),
        item(
          NAV_TABS,
          "Tabs",
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4.5" width="18" height="15" rx="2" />
            <path d="M3 10h18" />
          </svg>
        ),
      ]}
      value={mode}
      onChange={onChange}
      btnClassName="px-3 py-1.5 text-sm"
    />
  );
}

// --- the strip that was always there ----------------------------------------
function TabStrip({ tab, onPick, badges }) {
  return (
    <div className="mb-6 flex flex-wrap gap-x-7 gap-y-3 border-b border-border">
      {TAB_GROUPS.map((g) => (
        <div key={g.label}>
          <div className="mb-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
            {g.label}
          </div>
          <div className="flex flex-wrap gap-1">
            {g.tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => onPick(t.id)}
                className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold transition ${
                  tab === t.id
                    ? "border-primary text-link"
                    : "border-transparent text-light hover:text-medium"
                }`}
              >
                {t.label}
                {t.id === "feedback" && <Badge n={badges.feedback} />}
                {t.id === "reports" && <Badge n={badges.reports} />}
                {t.id === "members" && <Badge n={badges.members} />}
                {t.id === "market" && <Badge n={badges.market} />}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- the list down the left -------------------------------------------------
function SideRail({ tab, onPick, badges }) {
  const active = tabInfo(tab);
  // Which groups are folded open. Only the one holding the current tab starts
  // open: five groups open at once is the tab strip again, just taller.
  const [open, setOpen] = useState(() => (active?.group ? [active.group] : []));
  // On a phone the whole rail hides behind one line, so the panel is not pushed
  // a screen and a half down the page.
  const [drawer, setDrawer] = useState(false);

  // Landing on a tab from somewhere else (the admin search, a notification
  // link, the season switcher) has to open the group it lives in, otherwise the
  // rail says nothing about where the panel on the right came from.
  useEffect(() => {
    const g = tabInfo(tab)?.group;
    if (g) setOpen((o) => (o.includes(g) ? o : [...o, g]));
  }, [tab]);

  // Five groups open at once is taller than the screen, so the rail scrolls
  // inside itself — and a jump can then land on a row that is off its bottom
  // edge. This nudges the rail (never the page: setting scrollTop by hand
  // instead of scrollIntoView, which would drag every scrollable ancestor
  // along and move the panel out from under the reader) just far enough to
  // bring the current row back. It runs after the fold above has opened, so
  // the row it looks for exists.
  const railRef = useRef(null);
  useEffect(() => {
    const rail = railRef.current;
    const row = rail?.querySelector('[aria-current="true"]');
    if (!rail || !row) return;
    if (rail.scrollHeight <= rail.clientHeight + 1) return; // nothing to scroll
    // Measured as rectangles rather than offsetTop: the rail is not a
    // positioned element, so offsetTop is counted from whatever ancestor
    // happens to be, and the two numbers would only agree by luck.
    const box = rail.getBoundingClientRect();
    const here = row.getBoundingClientRect();
    if (here.top < box.top) rail.scrollTop -= box.top - here.top + 12;
    else if (here.bottom > box.bottom) rail.scrollTop += here.bottom - box.bottom + 12;
  }, [tab, open]);

  const countFor = (id) => badges[id] || 0;

  function pick(id) {
    onPick(id);
    setDrawer(false); // phones: get out of the way of what was just picked
  }

  return (
    <aside className="mb-6 lg:sticky lg:top-28 lg:mb-0 lg:self-start">
      {/* Phones: one line saying where you are, which opens the list. */}
      <button
        type="button"
        onClick={() => setDrawer((d) => !d)}
        aria-expanded={drawer}
        aria-controls="admin-rail"
        className="mb-2 flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5 text-left shadow-sm transition hover:bg-surface2 lg:hidden"
      >
        <span className="min-w-0">
          <span className="block font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
            {active?.group || "Admin"}
          </span>
          <span className="block truncate font-display text-base font-extrabold uppercase leading-tight tracking-tight text-dark">
            {active?.label || "Pick a section"}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-light">
          <Badge n={badges.feedback + badges.reports + badges.members + badges.market} />
          <Chevron open={drawer} className="h-5 w-5" shut="rotate-90" turned="-rotate-90" />
        </span>
      </button>

      <nav
        id="admin-rail"
        ref={railRef}
        aria-label="Admin sections"
        className={`card scrollbar-slim overflow-hidden lg:block lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto ${
          drawer ? "block" : "hidden"
        }`}
      >
        {TAB_GROUPS.map((g, gi) => {
          const isOpen = open.includes(g.label);
          const holdsActive = g.tabs.some((t) => t.id === tab);
          const hidden = g.tabs.reduce((n, t) => n + countFor(t.id), 0);
          return (
            <div key={g.label} className={gi ? "border-t border-border" : ""}>
              <h3>
                <button
                  type="button"
                  onClick={() => setOpen((o) => (o.includes(g.label) ? o.filter((x) => x !== g.label) : [...o, g.label]))}
                  aria-expanded={isOpen}
                  aria-controls={`admin-rail-${slug(g.label)}`}
                  className={`flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-surface2 ${
                    holdsActive ? "text-dark" : "text-light hover:text-medium"
                  }`}
                >
                  <Chevron open={isOpen} className="h-3.5 w-3.5" />
                  <span className="flex-1 font-mono text-[11px] font-bold uppercase tracking-wider">
                    {g.label}
                  </span>
                  {/* Folded away, but not gone: a dot for "the panel you are
                      looking at is in here", and the waiting count for
                      whatever the fold is hiding. */}
                  {!isOpen && holdsActive && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                  )}
                  {!isOpen && <Badge n={hidden} />}
                </button>
              </h3>
              {/* The fold is carried between its two heights rather than cut,
                  the same way the rest of the site opens a panel. */}
              <div id={`admin-rail-${slug(g.label)}`}>
                <SmoothHeight>
                  {isOpen && (
                    <ul className="pb-1.5">
                      {g.tabs.map((t) => {
                        const on = tab === t.id;
                        return (
                          <li key={t.id}>
                            <button
                              type="button"
                              onClick={() => pick(t.id)}
                              aria-current={on ? "true" : undefined}
                              className={`flex w-full items-center border-l-2 py-1.5 pl-5 pr-3 text-left text-sm transition ${
                                on
                                  ? "border-brand bg-surface2 font-bold text-dark"
                                  : "border-transparent font-semibold text-light hover:bg-surface2/60 hover:text-dark"
                              }`}
                            >
                              <span className="flex-1 truncate">{t.label}</span>
                              <Badge n={countFor(t.id)} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </SmoothHeight>
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export default function AdminNav({ mode, tab, onPick }) {
  const badges = useAdminBadges();
  return mode === NAV_RAIL ? (
    <SideRail tab={tab} onPick={onPick} badges={badges} />
  ) : (
    <TabStrip tab={tab} onPick={onPick} badges={badges} />
  );
}
