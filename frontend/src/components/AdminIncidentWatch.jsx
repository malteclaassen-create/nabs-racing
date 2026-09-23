import { useCallback, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar, ErrorBox, NoData, TeamDot, TierBadge } from "./ui.jsx";
import { FilterChip } from "./AdminFilters.jsx";

// ---------------------------------------------------------------------------
// Admin → Reports → Incident watch: who keeps turning up in the accidents.
//
// The tier reps' idea, and the stewarding counterpart of the attendance
// Activity view: that one shows who has gone quiet without opening every
// round, this one shows who keeps hitting things. Per person and season, what
// the result files counted (contacts, wall hits, cuts, in-game penalties) and
// the reports that named them; the arithmetic is backend lib/incidentWatch.js.
//
// No threshold, no flag, on purpose. A contact is two cars touching above a
// minimum impact speed, and the driver who was hit registers it just like the
// one who did the hitting, so the numbers are where a steward starts looking,
// never a verdict. The list is sorted and nothing on it is coloured red.
//
// A round without telemetry (a result file imported before the columns
// existed) is "no data", never 0, and stays out of the averages: the server
// sends null for it and this page shows a dash rather than a clean race.
// ---------------------------------------------------------------------------

const TIERS = [
  { key: "all", label: "All", pick: () => true },
  { key: "1", label: "Tier 1", pick: (d) => d.tier === 1 },
  { key: "2", label: "Tier 2", pick: (d) => d.tier === 2 },
  { key: "0", label: "Reserves", pick: (d) => d.tier !== 1 && d.tier !== 2 },
];

const PREVIEW = 15;

const WINDOWS = [
  { last: 3, label: "Last 3 rounds" },
  { last: 5, label: "Last 5 rounds" },
  { last: 0, label: "Whole season" },
];

// The sortable columns. The three result-file counts are per race started,
// because a reserve with two starts and a full-timer with ten cannot be
// compared on totals; in-game penalties and the reports are few enough to read
// as totals.
const COLUMNS = [
  { key: "contacts", label: "Contacts", sub: "per race", value: (d) => d.averages.contacts, avg: "contacts" },
  { key: "envContacts", label: "Walls", sub: "per race", value: (d) => d.averages.envContacts, avg: "envContacts" },
  { key: "cuts", label: "Cuts", sub: "per race", value: (d) => d.averages.cuts, avg: "cuts" },
  { key: "gamePenalties", label: "In-game", sub: "penalties", value: (d) => d.totals.gamePenalties },
  { key: "reports", label: "Reports", sub: "named in", value: (d) => d.reports },
  { key: "penalties", label: "Penalties", sub: "decided", value: (d) => d.penalties },
  { key: "races", label: "Races", sub: "started", value: (d) => d.races },
];

// Most first by default, the way the question is asked ("who has the most?").
// A driver with no data sinks to the bottom in either direction: sorted
// ascending, "no data" at the top would read as the cleanest on the grid.
function sortDrivers(drivers, key, dir) {
  const col = COLUMNS.find((c) => c.key === key) || COLUMNS[0];
  const sign = dir === "asc" ? 1 : -1;
  return [...drivers].sort((a, b) => {
    const va = col.value(a);
    const vb = col.value(b);
    if (va == null && vb == null) return a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * sign || a.name.localeCompare(b.name);
  });
}

// The opened driver's rounds share the row's columns from sm up, so each round's
// contacts sit under the season's contacts; on a phone they are six narrow
// figures after the round.
const BREAKDOWN_GRID =
  "grid grid-cols-[minmax(0,1fr),repeat(6,2rem)] gap-x-1 sm:grid-cols-[minmax(0,1fr),repeat(7,4.25rem)] sm:gap-x-2";

const roundLabel = (r) => `R${r.number ?? "?"}`;
const oneDecimal = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// One figure in a row. The per-race ones carry the total and how many races it
// was measured over in the tooltip, which is what an average needs next to it
// to be read fairly.
function Figure({ d, col }) {
  const v = col.value(d);
  if (v == null) return <NoData label="no data" />;
  if (!col.avg) return <span>{v}</span>;
  const n = d.measuredRaces[col.avg];
  return (
    <span title={`${d.totals[col.avg]} in ${plural(n, "measured race")}`}>{oneDecimal(v)}</span>
  );
}

// The line for one round inside an opened driver. Four numbers when the round
// was measured, "no data" across them when it was not, and "did not race" when
// they never took the start — a report can still name them there.
function RoundLine({ b }) {
  const measured = ["contacts", "envContacts", "cuts", "gamePenalties"].some((f) => b[f] != null);
  const cell = (v) => (v == null ? <NoData label="no data" /> : v);
  return (
    <li className={`${BREAKDOWN_GRID} items-center py-1.5 text-xs`}>
      <span className="min-w-0 truncate sm:pl-11" title={b.track || undefined}>
        <span className="font-mono font-bold text-medium">{roundLabel(b)}</span>{" "}
        <span className="text-light">{b.track}</span>
      </span>
      {!b.started ? (
        <span className="col-span-4 text-center text-faint">did not race</span>
      ) : measured ? (
        <>
          <span className="text-right font-mono tabular-nums text-medium">{cell(b.contacts)}</span>
          <span className="text-right font-mono tabular-nums text-medium">{cell(b.envContacts)}</span>
          <span className="text-right font-mono tabular-nums text-medium">{cell(b.cuts)}</span>
          <span className="text-right font-mono tabular-nums text-medium">{cell(b.gamePenalties)}</span>
        </>
      ) : (
        <span className="col-span-4 text-center text-faint">no data</span>
      )}
      <span className={`text-right font-mono tabular-nums ${b.reports ? "text-medium" : "text-faint"}`}>{b.reports}</span>
      <span className={`text-right font-mono tabular-nums ${b.penalties ? "text-medium" : "text-faint"}`}>
        {b.penalties}
      </span>
    </li>
  );
}

function DriverLine({ d, open, onToggle }) {
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        // Two lines on a phone — who, then the seven figures under their own
        // small labels — and one row of columns from sm up, under the header.
        className="grid w-full grid-cols-4 items-center gap-x-2 gap-y-1.5 px-3 py-2.5 text-left transition hover:bg-surface2/60 sm:grid-cols-[minmax(0,1fr),repeat(7,4.25rem)] sm:gap-y-0"
      >
        <span className="col-span-4 flex min-w-0 items-center gap-2 sm:col-span-1">
          <svg
            viewBox="0 0 24 24"
            className={`h-3.5 w-3.5 shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          <TeamDot color={d.teamColor || "var(--c-border)"} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-dark">{d.name}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-light">
              <TierBadge tier={d.tier} />
              <span className="truncate">{d.team || "no team"}</span>
            </span>
          </span>
        </span>
        {COLUMNS.map((col) => (
          <span key={col.key} className="flex flex-col sm:block sm:text-right">
            <span className="font-mono text-[9px] uppercase tracking-wider text-faint sm:hidden">{col.label}</span>
            <span className="font-mono text-sm tabular-nums text-dark">
              <Figure d={d} col={col} />
            </span>
          </span>
        ))}
      </button>
      {open && (
        <div className="border-t border-border bg-surface2/40 px-3 py-2">
          <div className={`${BREAKDOWN_GRID} pb-1 font-mono text-[9px] uppercase tracking-wider text-faint`}>
            <span className="sm:pl-11">Round</span>
            <span className="text-right" title="Contacts with another car">Cont.</span>
            <span className="text-right" title="Walls and off-track objects">Walls</span>
            <span className="text-right">Cuts</span>
            <span className="text-right" title="In-game penalties">Pen.</span>
            <span className="text-right" title="Reports naming them">Rep.</span>
            <span className="text-right" title="Reports decided as a penalty">Dec.</span>
          </div>
          <ul className="divide-y divide-border">
            {d.rounds.map((b) => (
              <RoundLine key={b.roundId} b={b} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export default function AdminIncidentWatch() {
  // null = the edited series' active season, as on the rest of the desk.
  const [season, setSeason] = useState(null);
  const [last, setLast] = useState(0);
  const [tier, setTier] = useState("all");
  const [sort, setSort] = useState({ key: "contacts", dir: "desc" });
  const [openKey, setOpenKey] = useState(null);
  // The top of the list is what the card is opened for; a season's whole
  // roster (seventy-odd with the reserves) is one press away.
  const [showAll, setShowAll] = useState(false);
  const { data, loading, error, reload } = useApi(
    useCallback(() => api.incidentWatch(season, last), [season, last])
  );

  const drivers = useMemo(() => data?.drivers || [], [data]);
  const seasons = data?.seasons || [];
  const shown = useMemo(() => {
    const pick = (TIERS.find((t) => t.key === tier) || TIERS[0]).pick;
    return sortDrivers(drivers.filter(pick), sort.key, sort.dir);
  }, [drivers, tier, sort]);
  const unmeasured = (data?.rounds || []).filter((r) => !r.measured);

  // A second press on the column already sorted by turns it round; a new
  // column starts at "most first".
  const sortBy = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  return (
    <div className="card overflow-hidden">
      <CardBar
        title="Incident watch"
        right={
          seasons.length > 1 ? (
            <select
              aria-label="Season"
              className="input w-auto py-1 text-sm"
              value={season ?? data?.season?.number ?? ""}
              onChange={(e) => {
                setSeason(Number(e.target.value));
                setOpenKey(null);
              }}
            >
              {[...seasons]
                .sort((a, b) => b.number - a.number)
                .map((s) => (
                  <option key={s.id} value={s.number}>
                    Season {s.number}
                  </option>
                ))}
            </select>
          ) : (
            data?.season && (
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                Season {data.season.number}
              </span>
            )
          )
        }
      />
      <div className="space-y-4 p-5">
        <p className="text-xs leading-relaxed text-light">
          Per driver, what the race result files counted: <b className="text-medium">contacts</b> with another car
          (Assetto Corsa logs a collision above a minimum impact speed, and says nothing about whose fault it was),{" "}
          <b className="text-medium">walls</b> and off-track objects hit, track <b className="text-medium">cuts</b>{" "}
          and <b className="text-medium">in-game penalties</b>, next to the steward reports that named them and how
          many were decided as a penalty. Per race means per race started. A round without imported telemetry shows
          as a dash and is left out of the averages. Tap a driver for the rounds.
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tier">
            {TIERS.map((t) => (
              <FilterChip
                key={t.key}
                on={tier === t.key}
                count={drivers.filter(t.pick).length}
                onClick={() => setTier(t.key)}
              >
                {t.label}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Rounds">
            {WINDOWS.map((w) => (
              <FilterChip
                key={w.last}
                on={last === w.last}
                onClick={() => {
                  setLast(w.last);
                  setOpenKey(null);
                }}
              >
                {w.label}
              </FilterChip>
            ))}
          </div>
          {/* The columns are the sort on a wide screen; on a phone the header
              is hidden and this is the way to reach the same orders. */}
          <select
            aria-label="Sort by"
            className="input w-auto py-1 text-sm sm:hidden"
            value={`${sort.key}:${sort.dir}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":");
              setSort({ key, dir });
            }}
          >
            {COLUMNS.flatMap((c) => [
              <option key={`${c.key}:desc`} value={`${c.key}:desc`}>
                {c.label} {c.sub}, most first
              </option>,
              <option key={`${c.key}:asc`} value={`${c.key}:asc`}>
                {c.label} {c.sub}, fewest first
              </option>,
            ])}
          </select>
        </div>

        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data && <p className="text-sm text-light">Loading…</p>}
        {data && !data.season && <p className="text-sm text-light">This series has no season to look at yet.</p>}
        {data?.season && data.rounds.length === 0 && (
          <p className="text-sm text-light">No round of season {data.season.number} has been run yet.</p>
        )}

        {data?.rounds?.length > 0 && (
          <p className="font-mono text-[11px] uppercase tracking-wider text-faint">
            {data.rounds.length === 1
              ? roundLabel(data.rounds[0])
              : `${roundLabel(data.rounds[0])}–${roundLabel(data.rounds[data.rounds.length - 1])}`}
            {unmeasured.length > 0 && ` · no telemetry for ${unmeasured.map(roundLabel).join(", ")}`}
          </p>
        )}

        {data?.rounds?.length > 0 &&
          (shown.length === 0 ? (
            <p className="text-sm text-light">Nobody in this group raced in these rounds.</p>
          ) : (
            <div className={`overflow-hidden rounded-lg border border-border ${loading ? "opacity-60" : ""}`}>
              <div className="hidden grid-cols-[minmax(0,1fr),repeat(7,4.25rem)] gap-x-2 border-b border-border px-3 py-2 sm:grid">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Driver</span>
                {COLUMNS.map((c) => {
                  const on = sort.key === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => sortBy(c.key)}
                      aria-pressed={on}
                      title={`Sort by ${c.label.toLowerCase()} ${c.sub}`}
                      className={`text-right font-mono text-[11px] font-bold uppercase leading-tight tracking-wider transition hover:text-dark ${
                        on ? "text-dark" : "text-light"
                      }`}
                    >
                      {c.label}
                      {on && <span aria-hidden="true">{sort.dir === "desc" ? " ↓" : " ↑"}</span>}
                      <span className="block text-[9px] font-normal normal-case tracking-normal text-faint">{c.sub}</span>
                    </button>
                  );
                })}
              </div>
              <ul className="divide-y divide-border">
                {(showAll ? shown : shown.slice(0, PREVIEW)).map((d) => (
                  <DriverLine
                    key={d.key}
                    d={d}
                    open={openKey === d.key}
                    onToggle={() => setOpenKey((k) => (k === d.key ? null : d.key))}
                  />
                ))}
              </ul>
              {shown.length > PREVIEW && (
                <button
                  type="button"
                  className="w-full border-t border-border px-3 py-2 text-sm font-semibold text-link transition hover:bg-surface2/60"
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll ? `Show the top ${PREVIEW}` : `Show all ${shown.length}`}
                </button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
