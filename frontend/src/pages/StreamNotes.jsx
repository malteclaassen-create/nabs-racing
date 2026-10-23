import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeries } from "../context/SeriesContext.jsx";
import { ErrorBox, PageHeader, PageHeaderSkeleton, TableSkeleton } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import SessionPlan from "../components/SessionPlan.jsx";
import { countryFor } from "../data/driverCountries.js";
import { flagFor } from "../data/circuits.js";
import { fmtRaceTime } from "../utils/raceTime.js";
import { fmtLap, fmtRaceDate, NO_VALUE } from "../utils/format.js";
import { nextUpcomingRace } from "../utils/raceFormat.js";
import { hasRaced } from "../utils/standingsRow.js";
import { copyText } from "../utils/copyText.js";
import { useSpecificTitle } from "../utils/pageTitle.js";
import {
  DEFAULT_POINTS_TABLE,
  buildTalkingPoints,
  driverSeason,
  plainFact,
  titleMath,
  tonight,
} from "../utils/streamNotes.js";

// ---------------------------------------------------------------------------
// /s/<series>/stream — the streamer's read-off sheet. One page with everything
// worth saying mid-race about the round being run: where the title stands and
// what tonight can do to it, the circuit's history, and a crib line for every
// driver on the grid. Read-only and built from the same data the standings,
// the calendar and the track pages use; the sentences themselves come from
// utils/streamNotes.js.
// ---------------------------------------------------------------------------

const GROUPS = [
  { key: "title", label: "Championship" },
  { key: "track", label: "This circuit" },
  { key: "season", label: "The season so far" },
];

// Names arrive in **double stars**: set them bold.
function Rich({ text }) {
  return String(text)
    .split("**")
    .map((part, i) =>
      i % 2 ? (
        <strong key={i} className="font-bold text-dark">
          {part}
        </strong>
      ) : (
        part
      )
    );
}

function CardHeader({ title, right }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-surface2/50 px-5 py-3">
      <h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">{title}</h2>
      {right}
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="-ml-px -mt-px min-w-0 border-l border-t border-border bg-card p-4 sm:p-5">
      <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-light">{label}</div>
      <div className="mt-1.5 font-display text-3xl font-black tabular-nums leading-none text-dark">{value}</div>
      {note && <div className="mt-1.5 truncate font-mono text-[11px] uppercase tracking-wider text-light">{note}</div>}
    </div>
  );
}

function CopyButton({ text }) {
  const [state, setState] = useState(null);
  return (
    <button
      type="button"
      className="btn-secondary px-3 py-1.5 text-xs"
      disabled={!text}
      onClick={async () => {
        setState((await copyText(text)) ? "Copied" : "Copy failed");
        setTimeout(() => setState(null), 1800);
      }}
      title="The talking points as plain text, e.g. for a stream deck or a notes app"
    >
      {state || "Copy talking points"}
    </button>
  );
}

function TalkingPoints({ facts }) {
  let n = 0;
  return (
    <div className="card overflow-hidden">
      <CardHeader title="Talking points" />
      <div className="grid gap-x-10 px-5 lg:grid-cols-3">
        {GROUPS.map((g) => {
          const items = facts.filter((f) => f.group === g.key);
          if (!items.length) return null;
          return (
            <div key={g.key} className="border-b border-border py-4 last:border-0 lg:border-0">
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow">{g.label}</div>
              <ol className="mt-2 space-y-2.5">
                {items.map((f) => (
                  <li key={f.key} className="flex gap-3 text-[15px] leading-snug text-medium sm:text-base">
                    <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-xs font-bold tabular-nums text-faint">
                      {++n}
                    </span>
                    <span className="min-w-0">
                      <Rich text={f.text} />
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DriverCell({ d }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <Link
          to={`/drivers/${d.driverId}`}
          className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark transition hover:text-brand"
        >
          {d.name}
        </Link>
        <Flag code={countryFor(d.driverId, d.country)} w={16} h={12} />
      </div>
      {d.team && (
        <TeamLogo
          id={d.team.id}
          name={d.team.name}
          color={d.team.color}
          logoUrl={d.team.logoUrl}
          size={14}
          showName
          nameClassName="truncate text-xs text-light"
        />
      )}
    </div>
  );
}

// The top of the table as the maths sees it: points, the gap, the best total
// each driver can still reach, and what tonight means for them.
function TitleTable({ math, night, standings }) {
  const rows = math
    ? math.rows.slice(0, 8).map((r) => ({ d: r.d, cur: r.cur, best: r.best, alive: math.alive.includes(r) }))
    : standings.slice(0, 8).map((d) => ({ d, cur: d.total, best: null, alive: null }));
  if (!rows.length) return null;
  const top = rows[0].cur;
  const risk = new Set((night?.atRisk || []).map((r) => r.d.driverId));
  const note = (r, i) => {
    if (math?.decided) return i === 0 ? "Champion" : "";
    if (r.alive === false) return "Out of the title fight";
    if (i === 0 && night?.clinchPosition) return `Champion tonight with P${night.clinchPosition}+${night.sprint ? " ×2" : ""}`;
    if (i === 0 && night?.clinchPossible) return "Could clinch tonight";
    if (risk.has(r.d.driverId)) return "Could be out tonight";
    return "";
  };
  return (
    <div className="card overflow-hidden">
      <CardHeader
        title="Championship"
        right={
          math && !math.decided ? (
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">
              {math.alive.length} can still win it
            </span>
          ) : null
        }
      />
      <div className="divide-y divide-border">
        {rows.map((r, i) => (
          <div key={r.d.driverId} className={`flex items-center gap-3 px-5 py-2.5 ${r.alive === false ? "opacity-60" : ""}`}>
            <span className="w-7 shrink-0 font-mono text-sm font-bold tabular-nums text-light">P{i + 1}</span>
            <div className="min-w-0 flex-1">
              <DriverCell d={r.d} />
              {note(r, i) && (
                <div className="mt-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-eyebrow">{note(r, i)}</div>
              )}
            </div>
            <div className="w-16 shrink-0 text-right">
              <div className="font-mono text-base font-bold tabular-nums text-dark">{r.cur}</div>
              <div className="font-mono text-[11px] tabular-nums text-light">{i === 0 ? "leader" : `−${top - r.cur}`}</div>
            </div>
            {math && (
              <div className="hidden w-16 shrink-0 text-right sm:block" title="The most points this driver can still finish the season on">
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">Max</div>
                <div className="font-mono text-sm font-bold tabular-nums text-medium">{r.best}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Every earlier running of tonight's circuit, newest first, plus its records.
function TrackHistory({ history, loading, track }) {
  const editions = history?.editions || [];
  const s = history?.stats || {};
  const records = [
    s.mostWins && { label: "Most wins", name: s.mostWins.name, value: `${s.mostWins.count}` },
    s.mostPoles && { label: "Most poles", name: s.mostPoles.name, value: `${s.mostPoles.count}` },
    s.fastestLap && { label: `Fastest race lap${s.fastestLap.seasonNumber ? ` · S${s.fastestLap.seasonNumber}` : ""}`, name: s.fastestLap.name, value: fmtLap(s.fastestLap.ms) },
    s.mostCrashes && { label: "Most crashes", name: s.mostCrashes.name, value: `${s.mostCrashes.count}` },
  ].filter(Boolean);
  return (
    <div className="card overflow-hidden">
      <CardHeader title={`History at ${history?.track || track}`} />
      {loading && !history ? (
        <div className="px-5 py-8 text-center text-sm text-light">Loading history…</div>
      ) : !editions.length ? (
        <div className="px-5 py-8 text-center text-sm text-light">First time here. No history at this track yet.</div>
      ) : (
        <>
          {records.length > 0 && (
            <div className="grid grid-cols-2 border-b border-border">
              {records.map((r) => (
                <div key={r.label} className="-ml-px -mt-px min-w-0 border-l border-t border-border px-5 py-3">
                  <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{r.label}</div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark">{r.name}</span>
                    <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-medium">{r.value}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="font-mono text-[10px] uppercase tracking-wider text-light">
                  <th className="px-5 py-2 text-left font-bold">When</th>
                  <th className="px-2 py-2 text-left font-bold">Winner</th>
                  <th className="px-2 py-2 text-left font-bold">Pole</th>
                  <th className="px-5 py-2 text-right font-bold">Fastest lap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {editions.map((e, i) => (
                  <tr key={`${e.seasonNumber}-${e.raceNumber}-${i}`}>
                    <td className="whitespace-nowrap px-5 py-2 font-mono text-xs font-bold text-light">
                      S{e.seasonNumber ?? "?"}
                      {e.raceNumber != null ? ` · R${e.raceNumber}` : ""}
                    </td>
                    <td className="px-2 py-2 font-semibold text-dark">{e.winner?.name || NO_VALUE}</td>
                    <td className="px-2 py-2 text-medium">{e.poleman?.name || NO_VALUE}</td>
                    <td className="px-5 py-2 text-right font-mono text-xs tabular-nums text-medium">{fmtLap(e.fastestLapMs) || NO_VALUE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// One crib line per driver: where they stand, what their season looks like,
// how the last three rounds went, and what they have done at this circuit.
// Without a grid to go by, the whole field is the reserve pool too: the top of
// the table first, the rest one click away.
const FIELD_PREVIEW = 20;

function FieldSheet({ standings, completedNumbers, grid, history }) {
  const [onlyGrid, setOnlyGrid] = useState(true);
  const [allRows, setAllRows] = useState(false);
  const raced = standings.filter(hasRaced);
  const gridIds = grid ? new Set(grid.map((g) => g.driverId)) : null;
  const showGrid = !!gridIds && gridIds.size > 0 && onlyGrid;
  // Tonight's grid in championship order; anybody signed up who has not raced
  // yet this season goes to the end.
  const rows = showGrid
    ? [
        ...standings.filter((d) => gridIds.has(d.driverId)),
        ...grid.filter((g) => !standings.some((d) => d.driverId === g.driverId)),
      ]
    : raced;
  const shown = showGrid || allRows ? rows : rows.slice(0, FIELD_PREVIEW);
  const leaderTotal = standings[0]?.total ?? 0;
  // Wins and poles at this circuit, by the current display name the track
  // history uses.
  const here = new Map();
  for (const e of history?.editions || []) {
    for (const [who, kind] of [[e.winner, "wins"], [e.poleman, "poles"]]) {
      if (!who) continue;
      const m = here.get(who.name) || { wins: 0, poles: 0 };
      m[kind]++;
      here.set(who.name, m);
    }
  }
  const hereText = (name) => {
    const m = here.get(name);
    if (!m) return "";
    return [m.wins && `${m.wins}× winner`, m.poles && `${m.poles}× pole`].filter(Boolean).join(" · ");
  };
  if (!rows.length) return null;
  return (
    <div className="card overflow-hidden">
      <CardHeader
        title={showGrid ? `Tonight's grid · ${rows.length}` : `The field · ${rows.length}`}
        right={
          gridIds && gridIds.size > 0 ? (
            <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setOnlyGrid((v) => !v)}>
              {onlyGrid ? "Show whole field" : "Show tonight's grid"}
            </button>
          ) : null
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-wider text-light">
              <th className="px-5 py-2 text-left font-bold">Pos</th>
              <th className="px-2 py-2 text-left font-bold">Driver</th>
              <th className="px-2 py-2 text-right font-bold">Pts</th>
              <th className="px-2 py-2 text-right font-bold">Gap</th>
              <th className="px-2 py-2 text-right font-bold" title="Sprint wins count">Wins</th>
              <th className="px-2 py-2 text-right font-bold" title="Sprint podiums count">Podiums</th>
              <th className="px-2 py-2 text-right font-bold" title="Started a round from grid slot 1">Poles</th>
              <th className="px-2 py-2 text-left font-bold">Last 3</th>
              <th className="px-5 py-2 text-left font-bold">Here before</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((d) => {
              const inTable = d.perRace !== undefined;
              const s = inTable ? driverSeason(d, completedNumbers) : null;
              return (
                <tr key={d.driverId} className="align-middle">
                  <td className="px-5 py-2 font-mono text-sm font-bold tabular-nums text-light">
                    {inTable && hasRaced(d) ? `P${d.position}` : NO_VALUE}
                  </td>
                  <td className="max-w-[14rem] px-2 py-2">
                    <DriverCell d={d} />
                  </td>
                  <td className="px-2 py-2 text-right font-mono font-bold tabular-nums text-dark">{inTable ? d.total : NO_VALUE}</td>
                  <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-light">
                    {!inTable ? NO_VALUE : d.position === 1 ? "leader" : `−${leaderTotal - d.total}`}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-medium">{s ? s.wins : NO_VALUE}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-medium">{s ? s.podiums : NO_VALUE}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-medium">{s ? s.poles : NO_VALUE}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs tabular-nums text-medium">
                    {s ? s.form.join("  ") : NO_VALUE}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-eyebrow">
                    {hereText(d.name)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length < rows.length && (
        <button
          type="button"
          onClick={() => setAllRows(true)}
          className="w-full border-t border-border px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:bg-surface2 hover:text-dark"
        >
          Show all {rows.length} drivers
        </button>
      )}
    </div>
  );
}

export default function StreamNotes() {
  const { current: season } = useSeason();
  const { current: series } = useSeries();
  useSpecificTitle("Streamer notes · NABS Racing League");

  const drivers = useApi(useCallback(() => api.driverStandings(), []));
  const races = useApi(useCallback(() => api.races(), []));
  const t1 = useApi(useCallback(() => api.t1Standings(), []));
  const t2 = useApi(useCallback(() => api.t2Standings(), []));
  const events = useApi(useCallback(() => api.events(), []));

  const race = useMemo(() => {
    const next = nextUpcomingRace(races.data || []);
    return next && (next.type || "CHAMPIONSHIP") === "CHAMPIONSHIP" ? next : null;
  }, [races.data]);
  const history = useApi(
    useCallback(() => (race?.track ? api.trackHistory(race.track) : Promise.resolve(null)), [race?.track])
  );

  const standings = drivers.data?.standings || [];
  const champRounds = (races.data || []).filter((r) => !r.isSpecialEvent && r.number != null && (r.type || "CHAMPIONSHIP") === "CHAMPIONSHIP");
  const completedNumbers = champRounds.filter((r) => r.isCompleted).map((r) => r.number).sort((a, b) => a - b);
  const totalRounds = champRounds.length;
  const fastestLapPoints = drivers.data?.fastestLapPoints ?? season?.fastestLapPoints ?? 0;
  const table = Array.isArray(season?.pointsTable) && season.pointsTable.length ? season.pointsTable : DEFAULT_POINTS_TABLE;

  // Cheap enough to work out on every render, which keeps every input current.
  const math = drivers.data
    ? titleMath({
        standings,
        raceNumbers: drivers.data.raceNumbers || [],
        dropWorst: drivers.data.dropWorst ?? 0,
        completedNumbers,
        totalRounds,
        tableMax: table[0] + (fastestLapPoints || 0),
        sprintRounds: drivers.data.sprintRounds || [],
        customPoints: drivers.data.customPoints || {},
      })
    : null;
  const night = math && race ? tonight(math, race.number, { table, fastestLapPoints }) : null;
  // Single-class seasons have no Tier 2: their one table is just "the constructors".
  const hasT2 = (t2.data?.standings?.length || 0) > 0;
  const facts = buildTalkingPoints({
    standings,
    races: races.data || [],
    math,
    night,
    race,
    history: race ? history.data : null,
    constructors: [
      { label: hasT2 ? "Tier 1" : "", standings: t1.data?.standings || [] },
      ...(hasT2 ? [{ label: "Tier 2", standings: t2.data.standings }] : []),
    ],
  });
  const copyable = facts.map((f) => `- ${plainFact(f.text)}`).join("\n");

  const ev = race ? (events.data || []).find((e) => e.id === race.id) : null;
  const grid = ev?.rsvps?.ACCEPTED || null;

  const loading = (drivers.loading && !drivers.data) || (races.loading && !races.data);
  const error = drivers.error || races.error;
  const flag = race ? flagFor(race.track, race.country) : null;
  const afterTonight = race ? champRounds.filter((r) => !r.isCompleted && r.number > race.number).length : 0;
  const leaderGap = math && math.rows.length > 1 ? math.rows[0].cur - math.rows[1].cur : null;

  if (error && !drivers.data && !races.data) {
    return (
      <ErrorBox
        message={error}
        onRetry={() => {
          drivers.reload();
          races.reload();
        }}
      />
    );
  }
  if (loading) {
    return (
      <div>
        <PageHeaderSkeleton />
        <TableSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div className="content-in space-y-6">
      <PageHeader
        eyebrow={`For the broadcast${series?.name ? ` · ${series.name}` : ""}`}
        title="Streamer notes"
        subtitle="Facts to read out during the race: the title maths, this circuit's history and every driver's season at a glance. Built from the saved results, so it moves on by itself after every round."
        right={<CopyButton text={copyable} />}
      />

      {race ? (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 p-5 sm:p-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                {flag && <Flag code={flag.country} w={26} h={19} />}
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
                  Round {race.number} of {totalRounds}
                  {race.raceFormat === "SPRINT_FEATURE" ? " · Sprint weekend" : ""}
                </span>
              </div>
              <h2 className="mt-1 font-display text-3xl font-black uppercase tracking-tight text-dark sm:text-4xl">{race.track}</h2>
              <div className="mt-1 font-mono text-[13px] font-bold uppercase tracking-wider text-medium">
                {race.date ? (
                  <>
                    {fmtRaceDate(race.date)} <span className="text-light">· {fmtRaceTime(race.date)}</span>
                  </>
                ) : (
                  "Date to be confirmed"
                )}
              </div>
              <SessionPlan race={race} className="mt-1.5 text-medium" />
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-border sm:grid-cols-4">
            <Stat label="Rounds left" value={afterTonight} note={afterTonight ? "after this one" : "season finale"} />
            <Stat label="Points tonight" value={night ? `${night.pointsTonight}` : NO_VALUE} note="max for one driver" />
            <Stat label="Still on the table" value={math && !math.decided ? math.potential : NO_VALUE} note="tonight included" />
            <Stat
              label="Title lead"
              value={leaderGap != null ? leaderGap : NO_VALUE}
              note={math ? (math.decided ? `${math.leader.d.name} is champion` : math.leader.d.name) : ""}
            />
          </div>
        </div>
      ) : (
        <div className="card p-5 text-sm text-light">
          No championship round coming up in this season. The notes below are the season as it ended.
        </div>
      )}

      {facts.length > 0 && <TalkingPoints facts={facts} />}

      <div className={`grid gap-6 ${race ? "lg:grid-cols-2" : ""}`}>
        <TitleTable math={math} night={night} standings={standings.filter(hasRaced)} />
        {race && <TrackHistory history={history.data} loading={history.loading} track={race.track} />}
      </div>

      <FieldSheet standings={standings} completedNumbers={completedNumbers} grid={grid} history={race ? history.data : null} />
    </div>
  );
}
