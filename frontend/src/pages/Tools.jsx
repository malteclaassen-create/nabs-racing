import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Activity } from "../components/icons/filled.jsx";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import SeasonPicker from "../components/SeasonPicker.jsx";
import { seasonLabelOf } from "../utils/pageTitle.js";
import TelemetryCompare from "../components/TelemetryCompare.jsx";

// ---------------------------------------------------------------------------
// /tools — the telemetry page for members: laps recorded by the in-game
// nabsTelemetry app, compared against the field's. Deliberately NOT in the
// main nav: reachable from the upcoming-race panel (Races page), the private
// profile's member bar and the bell's "telemetry is open" announcement.
//
// This used to be the race-prep page as well, with a fuel calculator, a
// practice analysis in front of the telemetry
// card. The league asked for the telemetry alone; the calculators are in the
// history of this file should they ever be wanted back. The path stays /tools
// so every bookmark, bell link (/tools#telemetry) and ?tab=tools keeps landing.
// ---------------------------------------------------------------------------

// The page's tools. One today, so no tab strip is drawn; a second entry here
// is all it takes for the strip under the title to appear.
const TOOLS = [
  { key: "compare", label: "Lap comparison", icon: Activity, render: () => <TelemetryCompare /> },
];

// The title, and beside it which season the laps are from. The season is the
// site's own switcher (the telemetry reads follow it), so picking one here is
// the same as picking it in the bar at the top.
function ToolsHeader({ tools, tool, onTool }) {
  const { seasons, current } = useSeason();
  const label = seasonLabelOf(current);
  return (
    <header className="mb-4 border-b border-border sm:mb-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow sm:text-[13px] sm:tracking-[0.2em]">Members</p>
          <h1 className="mt-1 font-display text-3xl font-black uppercase tracking-tight text-dark sm:text-5xl">Telemetry</h1>
        </div>
        {label && (
          // The picker's menu opens to the left from sm up, where this sits on
          // the right edge of the page.
          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm font-semibold text-dark shadow-card sm:[&_[role=menu]]:left-auto sm:[&_[role=menu]]:right-0">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow">Season</span>
            {seasons.length > 1 ? <SeasonPicker compact /> : <span>{label}</span>}
            {current?.game && <span className="hidden truncate text-light sm:inline">{current.game}</span>}
          </div>
        )}
      </div>
      <p className={`mt-2 max-w-xl text-[15px] text-light ${tools.length > 1 ? "" : "pb-4 sm:pb-5"}`}>
        Your recorded laps against the field's, from the in-game NABS telemetry app.
      </p>
      {tools.length > 1 && (
        <nav aria-label="Telemetry tools" className="-mx-4 mt-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex min-w-max gap-6 text-sm font-semibold">
            {tools.map((t) => {
              const on = t.key === tool;
              return (
                <li key={t.key}>
                  <button type="button" aria-current={on ? "page" : undefined} onClick={() => onTool(t.key)}
                    className={`flex items-center gap-2 border-b-[3px] pb-3 transition ${on ? "border-primary text-dark" : "border-transparent text-light hover:text-dark"}`}>
                    <t.icon className={`h-4 w-4 ${on ? "text-eyebrow" : ""}`} aria-hidden="true" />{t.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}

// `embedded`: rendered as a section inside the /profile member bar — the page
// around it already has a header, so this skips its own.
export default function Tools({ embedded = false }) {
  // `null` until the answer arrives, so the card cannot flash into view on a
  // page load and then vanish for a member who is not meant to have it.
  const { data: tel } = useApi(useCallback(() => api.telemetryIsPublic().catch(() => ({ public: false })), []));
  const telemetryOpen = tel?.public === true;
  const [toolKey, setToolKey] = useState(TOOLS[0].key);
  const tool = TOOLS.find((t) => t.key === toolKey) || TOOLS[0];
  // "/tools#telemetry" (the bell's announcement) should land on the card, not
  // the top of the page. The browser cannot do this itself: the card is only
  // drawn once the visibility answer is in, so the anchor does not exist at
  // load time. Waits for exactly that, then scrolls once.
  const { hash } = useLocation();
  useEffect(() => {
    if (!telemetryOpen || hash !== "#telemetry") return;
    const t = requestAnimationFrame(() =>
      document.getElementById("telemetry")?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
    return () => cancelAnimationFrame(t);
  }, [telemetryOpen, hash]);

  return (
    <div className={embedded ? "space-y-6" : "content-in space-y-6"}>
      {!embedded && <ToolsHeader tools={telemetryOpen ? TOOLS : []} tool={tool.key} onTool={setToolKey} />}
      {/* The lap comparison, once the league has opened it. Until then this
          asks one cheap question and says so, rather than drawing a card
          whose every request would come back 401. The switch is in
          Admin -> League -> Telemetry; the endpoints check for themselves. */}
      {telemetryOpen ? (
        tool.render()
      ) : (
        tel && (
          <div className="card p-5 text-sm text-medium">
            The telemetry comparison is not open to members yet. It appears here as soon as the league switches it on.
          </div>
        )
      )}
      <div>
        <Link to="/races" className="transition text-sm font-semibold text-link hover:underline">Race calendar</Link>
      </div>
    </div>
  );
}
