import { useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import CircuitMap from "./CircuitMap.jsx";
import Flag from "./Flag.jsx";
import RaceCountdown from "./RaceCountdown.jsx";
import { circuitFor } from "../data/circuits.js";
import { exportSvgToPng } from "../utils/svgExport.js";
import { fmtRaceTime } from "../utils/raceTime.js";

const MAX_LAP_MS = 1_800_000;
function fmtLap(ms) {
  if (!ms || ms <= 0 || ms > MAX_LAP_MS) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

const RECORD_ICONS = {
  trophy: "M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3",
  stopwatch: "M12 13V9M9 2h6M19 6l-1.5 1.5M12 21a8 8 0 100-16 8 8 0 000 16z",
  flag: "M5 21V4M5 4c3-1.5 6 1.5 9 0s4-1 4-1v9s-1 .5-4 1-6-1.5-9 0",
  burst: "M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5L19 19M19 5l-2.5 2.5M7.5 16.5L5 19",
  cut: "M6 6l12 12M6 18L18 6",
  info: "M12 8h.01M11 12h1v4h1",
};

function RecordRow({ icon, label, name, driverId, value }) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-2.5 last:border-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface2 text-light">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={RECORD_ICONS[icon] || RECORD_ICONS.info} />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{label}</div>
        {driverId ? (
          <Link to={`/drivers/${driverId}`} className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark hover:text-brand">
            {name}
          </Link>
        ) : (
          <div className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark">{name}</div>
        )}
      </div>
      <div className="shrink-0 font-mono text-xs font-bold tabular-nums text-medium">{value}</div>
    </div>
  );
}

// Slim ruled-line header used by both cards, matching the Race Facts panel.
function CardHeader({ title, children }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-surface2/50 px-5 py-3">
      <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-light">{title}</h3>
      {children}
    </div>
  );
}

export default function UpcomingRacePanel({ race }) {
  const mapRef = useRef(null);
  const { data: history, loading } = useApi(useCallback(() => api.trackHistory(race.track), [race.track]));
  const circuit = circuitFor(race.track);
  // Training sessions have RSVP like a round; special events are announcement-
  // only (no attendance feature to sign up for) — see backend routes/events.js.
  const kind = race.type || (race.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
  const canSignUp = kind !== "SPECIAL";
  const eyebrow = race.number != null ? `Round ${race.number} · Up next` : kind === "TRAINING" ? "Training session" : "Special event";

  function downloadPng() {
    const svg = mapRef.current?.querySelector("svg");
    exportSvgToPng(svg, { fileName: `nabs-${(history?.key || race.track).toLowerCase()}.png` });
  }

  const s = history?.stats || {};
  const records = [];
  if (s.mostWins) records.push({ icon: "trophy", label: "Most wins here", ...s.mostWins, value: `${s.mostWins.count}` });
  if (s.fastestLap) records.push({ icon: "stopwatch", label: `Fastest race lap · S${s.fastestLap.seasonNumber}`, ...s.fastestLap, value: fmtLap(s.fastestLap.ms) });
  if (s.mostPoles) records.push({ icon: "flag", label: "Most poles here", ...s.mostPoles, value: `${s.mostPoles.count}` });
  if (s.mostCrashes) records.push({ icon: "burst", label: "Most crashes here", ...s.mostCrashes, value: `${s.mostCrashes.count}` });
  if (s.mostCuts) records.push({ icon: "cut", label: "Most cuts here", ...s.mostCuts, value: `${s.mostCuts.count}` });
  const customFacts = history?.customFacts || [];
  const editions = history?.editions || [];

  return (
    <div className="space-y-5">
      {/* Hero: race identity left, the live countdown clock + sign-up right —
          the same layout language as the Attendance hero. */}
      <div className="card relative overflow-hidden p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              {circuit && <Flag code={circuit.country} w={26} h={19} />}
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
                {eyebrow}
              </span>
            </div>
            <h2 className="mt-1 font-display text-3xl font-black uppercase tracking-tight text-dark sm:text-4xl">
              {race.track}
            </h2>
            <div className="mt-1 font-mono text-sm font-bold uppercase tracking-wide text-medium">
              {race.date ? (
                <>
                  {fmtDate(race.date)} <span className="text-light">· {fmtRaceTime(race.date)}</span>
                </>
              ) : (
                "Date to be confirmed"
              )}
            </div>
            {(race.qualiMinutes || race.raceLaps) && (
              <div className="mt-1.5 font-mono text-xs font-bold uppercase tracking-wide text-light">
                {[
                  race.qualiMinutes && `Qualifying ${race.qualiMinutes} min`,
                  race.raceLaps && `Race ${race.raceLaps} laps`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
          </div>
          <div className="flex w-full flex-col gap-2.5 sm:w-80">
            {race.date && <RaceCountdown date={race.date} />}
            {canSignUp && (
              <Link to={`/attendance?race=${race.id}`} className="btn-primary text-center">
                Sign up now
              </Link>
            )}
            <Link to="/tools" className="btn-secondary text-center" title="Fuel calculator, practice pace and pit strategy">
              Race tools
            </Link>
          </div>
        </div>
        {/* free-text race details (rules, mods, links) — as the admin wrote them */}
        {race.info && (
          <p className="mt-4 whitespace-pre-line border-t border-border pt-4 text-sm leading-relaxed text-medium">
            {race.info}
          </p>
        )}
      </div>

      {/* Circuit map (left) + track record (right) */}
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="card flex flex-col overflow-hidden">
          <CardHeader title="Circuit">
            {circuit && !history?.mapImageUrl && (
              <button className="btn-secondary px-3 py-1 text-xs" onClick={downloadPng} title="Export the outline as a PNG, e.g. to label the corners and upload the finished map in the admin Tracks tab.">
                Download PNG
              </button>
            )}
          </CardHeader>
          <div ref={mapRef} className="flex flex-1 items-center justify-center p-5 py-8">
            {/* An admin-uploaded map (e.g. the outline with labelled corners)
                replaces the plain generated outline entirely. */}
            {history?.mapImageUrl ? (
              <img src={history.mapImageUrl} alt={`${race.track} track map`} className="max-h-80 w-full rounded-lg object-contain" />
            ) : circuit ? (
              <CircuitMap
                track={race.track}
                rotate={history?.mapRotation || 0}
                stroke="var(--c-text)"
                strokeWidth={2}
                className="h-56 w-full text-dark sm:h-72"
              />
            ) : (
              <div className="py-10 text-center text-sm text-light">No outline for this track yet.</div>
            )}
          </div>
        </div>

        <div className="card overflow-hidden">
          <CardHeader title="Track record" />
          <div className="px-5 pb-4 pt-1">
            {loading ? (
              <div className="py-8 text-center text-sm text-light">Loading history…</div>
            ) : records.length === 0 && customFacts.length === 0 && editions.length === 0 ? (
              <div className="py-8 text-center text-sm text-light">First time here. No history at this track yet.</div>
            ) : (
              <div>
                {records.map((r) => (
                  <RecordRow key={r.label} {...r} />
                ))}
                {customFacts.map((f, i) => (
                  <RecordRow key={`c${i}`} icon="info" label={f.label} name={f.value} value="" />
                ))}
                {/* Every previous running of this circuit, newest first. */}
                {editions.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
                      Past winners here
                    </div>
                    <div className="space-y-1.5">
                      {editions.slice(0, 5).map((e, i) => (
                        <div key={i} className="flex items-center gap-2.5 text-sm">
                          <span className="pill shrink-0 bg-surface2 font-mono text-[10px] font-bold text-light">
                            S{e.seasonNumber ?? "?"}
                          </span>
                          {e.winner ? (
                            <Link to={`/drivers/${e.winner.driverId}`} className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark hover:text-brand">
                              {e.winner.name}
                            </Link>
                          ) : (
                            <span className="text-light">No result recorded</span>
                          )}
                          {e.fastestLapMs && (
                            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-light">{fmtLap(e.fastestLapMs)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
