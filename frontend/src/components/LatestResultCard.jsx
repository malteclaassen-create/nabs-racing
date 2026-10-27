import { useState } from "react";
import { Link } from "react-router-dom";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { DriverAvatar, MEDAL_TEXT } from "./ui.jsx";
import { fmtDateLong, isLapTime } from "../utils/format.js";

// ---------------------------------------------------------------------------
// The latest result as the home page's right-hand column, beside the news.
//
// The round's photo as a narrow strip with the track written up it, and the
// top ten beside it: every driver with their picture and team logo, how many
// places they made up or lost from the grid, and what the round paid them.
// The rows share the card's height, so the card is as tall as the news column
// without a gap under P10. On a phone the strip stands down and the track
// moves into the line above the table.
//
// A sprint weekend gets a switcher between its two races, feature first, the
// one the championship is decided on.
// ---------------------------------------------------------------------------

const MEDAL = MEDAL_TEXT;

// A results payload's classified top ten, in finishing order. A DSQ/DNF row
// keeps the raw place it crossed the line in and must not stand in the table.
// The fastest lap is the admin-recorded one when there is one, else the
// quickest stored lap, the same rule the results table applies.
export function topTen(payload) {
  const race = payload?.race || null;
  const all = payload?.results || [];
  const rows = all
    .filter((r) => r.position != null && (!r.status || r.status === "FINISHED"))
    .sort((a, b) => a.position - b.position)
    .slice(0, 10)
    .map((r) => ({
      ...r,
      team: (r.isSub && r.subForTeam) || r.effectiveTeam || r.team || {},
      gained: r.grid != null ? r.grid - r.position : null,
    }));
  const laps = all.filter((r) => isLapTime(r.bestLapMs));
  const fastestMs = laps.length ? Math.min(...laps.map((r) => r.bestLapMs)) : null;
  const fastestId = race?.fastestLapDriverId || laps.find((r) => r.bestLapMs === fastestMs)?.driverId || null;
  return {
    race,
    rows,
    fastestId,
    scores: race?.scores ?? (race?.type || "CHAMPIONSHIP") === "CHAMPIONSHIP",
  };
}

export function Gained({ value }) {
  if (value == null) return <span className="w-8" />;
  const title = value === 0 ? "Finished where they started" : `${Math.abs(value)} place${Math.abs(value) === 1 ? "" : "s"} ${value > 0 ? "gained" : "lost"} from the grid`;
  return (
    <span title={title} className={`w-8 text-right font-mono text-[11px] font-bold ${value > 0 ? "text-ok" : value < 0 ? "text-bad" : "text-faint"}`}>
      {value > 0 ? `▲${value}` : value < 0 ? `▼${-value}` : "–"}
    </span>
  );
}

function Row({ r, i, result }) {
  return (
    <li className="flex min-h-[3.5rem] flex-1">
      <Link to={`/drivers/${r.driverId}`} className="group flex flex-1 items-center gap-3">
        <span className={`w-6 text-center font-display text-base font-black tabular-nums ${i < 3 ? "" : "text-light"}`} style={{ color: MEDAL[i] }}>
          {r.position}
        </span>
        <span className="relative shrink-0">
          <DriverAvatar name={r.name} photoUrl={r.photoUrl} color={r.team.color} size={34} />
          <TeamLogo
            id={r.team.id}
            name={r.team.name}
            color={r.team.color}
            logoUrl={r.team.logoUrl}
            size={16}
            className="absolute -bottom-1 -right-1.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
          />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-bold text-dark group-hover:text-brand">{r.name}</span>
            {result.fastestId === r.driverId && (
              <span title="Fastest lap" className="rounded bg-fl/15 px-1.5 py-px font-mono text-[9px] font-bold text-fl">
                FL
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-light">{r.team.name}</span>
        </span>
        <Gained value={r.gained} />
        {result.scores && (
          <span className="min-w-[2rem] text-right font-display text-base font-black tabular-nums text-dark">{r.points ?? 0}</span>
        )}
      </Link>
    </li>
  );
}

// `feature` / `sprint` are raceResults payloads (`sprint` only on a sprint
// weekend, null otherwise); `race` the round's calendar row; `reportTo` the
// incident-report link while the report window is open, else null.
export default function LatestResultCard({ race, circuit, feature, sprint = null, photo, photoFallback, onPhotoError, reportTo = null }) {
  const [tab, setTab] = useState("feature");
  const tabs = [
    { key: "feature", label: "Feature", result: topTen(feature) },
    sprint && { key: "sprint", label: "Sprint", result: topTen(sprint) },
  ].filter((t) => t && t.result.rows.length > 0);
  const open = tabs.find((t) => t.key === tab) || tabs[0] || null;
  const result = open?.result;
  const resultsTo = result?.race?.id ? `/races?race=${result.race.id}` : race?.id ? `/races?race=${race.id}` : "/races";

  return (
    <div className="relative flex flex-1 overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-card">
      <div className="relative hidden w-[34%] shrink-0 overflow-hidden sm:block">
        <img
          src={photo}
          alt=""
          data-hero-fallback={photoFallback}
          onError={onPhotoError}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-black/70" />
        <div className="absolute left-4 top-5">{circuit && <Flag code={circuit.country} title={circuit.countryName} w={28} h={20} />}</div>
        <div className="absolute inset-x-0 bottom-6 flex justify-center">
          <span className="block rotate-180 whitespace-nowrap font-display text-6xl font-black uppercase leading-none tracking-tight text-white [writing-mode:vertical-rl]">
            {race?.track}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5 whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-eyebrow">
            {circuit && (
              <span className="sm:hidden">
                <Flag code={circuit.country} title={circuit.countryName} w={22} h={16} />
              </span>
            )}
            <span className="truncate sm:hidden">{race?.track} ·</span>
            <span>Round {race?.number ?? "–"}</span>
            {race?.date && <span className="hidden truncate opacity-70 sm:inline">{fmtDateLong(race.date)}</span>}
          </div>
          {tabs.length > 1 && (
            <div className="inline-flex shrink-0 rounded-lg border border-border bg-surface2 p-0.5" role="tablist" aria-label="Race">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={open?.key === t.key}
                  onClick={() => setTab(t.key)}
                  className={`rounded-md px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition ${
                    open?.key === t.key ? "bg-brand text-onbrand" : "text-light hover:text-dark"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {result ? (
          <ol className="flex flex-1 flex-col divide-y divide-border/60">
            {result.rows.map((r, i) => (
              <Row key={r.driverId} r={r} i={i} result={result} />
            ))}
          </ol>
        ) : feature ? (
          <p className="flex flex-1 items-center justify-center py-10 text-sm text-light">The classification is on its way.</p>
        ) : (
          // Still loading: hold the rows' place so the buttons do not jump.
          <div className="flex flex-1 flex-col gap-3 py-2" aria-hidden="true">
            {Array.from({ length: 10 }).map((_, i) => (
              <span key={i} className="skeleton h-9 w-full rounded-lg" />
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2.5">
          <Link
            to={resultsTo}
            className="shine group inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-brand px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-ink transition hover:brightness-105"
          >
            Full results <span className="transition group-hover:translate-x-0.5">→</span>
          </Link>
          <Link
            to="/drivers"
            className="inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-border px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-dark transition hover:bg-surface2"
          >
            Standings
          </Link>
          {reportTo && (
            <Link
              to={reportTo}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-red-700 transition hover:bg-red-500/25 dark:text-red-200"
            >
              Report an incident
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
