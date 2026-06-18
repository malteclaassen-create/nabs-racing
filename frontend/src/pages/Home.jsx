import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { Skeleton, TableSkeleton } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import CircuitMap from "../components/CircuitMap.jsx";
import PointsChart from "../components/PointsChart.jsx";
import { circuitFor } from "../data/circuits.js";
import { countryFor } from "../data/driverCountries.js";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MEDAL = ["#EAB308", "#94A3B8", "#C2410C"]; // gold / silver / bronze

function fmtFull(d) {
  if (!d) return "Date TBA";
  return new Date(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function pad2(n) {
  return String(n ?? 0).padStart(2, "0");
}

export default function Home() {
  const drivers = useApi(useCallback(() => api.driverStandings(), []));
  const t1 = useApi(useCallback(() => api.t1Standings(), []));
  const t2 = useApi(useCallback(() => api.t2Standings(), []));
  const races = useApi(useCallback(() => api.races(), []));
  const [latest, setLatest] = useState(null);

  const completedRaces = (races.data || []).filter((r) => r.isCompleted);
  const lastRace = completedRaces[completedRaces.length - 1];
  const nextRace = (races.data || []).find((r) => !r.isCompleted);

  useEffect(() => {
    if (lastRace?.id) api.raceResults(lastRace.id).then(setLatest).catch(() => {});
  }, [lastRace?.id]);

  if (drivers.loading || t1.loading || t2.loading || races.loading)
    return (
      <div className="space-y-12">
        <Skeleton className="h-[460px] w-full rounded-[1.75rem]" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <TableSkeleton rows={8} />
      </div>
    );

  const leader = drivers.data?.standings?.[0];
  const podium = (latest?.results || [])
    .filter((r) => r.position != null)
    .sort((a, b) => a.position - b.position)
    .slice(0, 3);
  const winner = podium[0];
  const nextDate = nextRace?.date ? new Date(nextRace.date) : null;
  const roundNo = lastRace?.number ?? completedRaces.length;
  const lastCircuit = circuitFor(lastRace?.track);
  const nextCircuit = circuitFor(nextRace?.track);
  const completedNumbers = completedRaces.map((r) => r.number).sort((a, b) => a - b);

  return (
    <div className="space-y-16">
      {/* ===================== SEASON TICKER ===================== */}
      <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[13px] font-semibold uppercase tracking-[0.2em] text-light">
        <span className="flex items-center gap-2 text-dark">
          <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-brand" />
          Season 7 · Live
        </span>
        <span className="hidden h-3 w-px bg-border sm:inline-block" />
        <span className="hidden sm:inline">F1 2007 · Assetto Corsa</span>
        <span className="hidden h-3 w-px bg-border sm:inline-block" />
        <span className="text-medium">
          Round {pad2(roundNo)} <span className="text-faint">/ 12</span>
        </span>
      </div>

      {/* ===================== LEAD FEATURE ===================== */}
      <section className="reveal relative overflow-hidden rounded-[1.75rem] bg-ink shadow-card ring-1 ring-black/40">
        <img
          src="/hero.jpg"
          alt=""
          onError={(e) => (e.currentTarget.style.display = "none")}
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-ink via-ink/80 to-ink/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/95 via-transparent to-transparent" />
        <div
          className="speed-hatch absolute inset-y-0 right-0 w-[18%]"
          style={{
            WebkitMaskImage: "linear-gradient(to left, #000 35%, transparent 100%)",
            maskImage: "linear-gradient(to left, #000 35%, transparent 100%)",
          }}
        />
        {/* brand accent rail */}
        <div className="absolute left-0 top-0 h-full w-1.5 bg-gradient-to-b from-brand via-brand/40 to-transparent" />

        {/* circuit outline (or ghost round number as fallback) */}
        {lastCircuit ? (
          <CircuitMap
            track={lastRace?.track}
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={0.9}
            animate
            className="pointer-events-none absolute right-1 top-1/2 h-[74%] w-[44%] -translate-y-1/2 sm:right-4"
          />
        ) : (
          <div className="ghost-numeral pointer-events-none absolute -right-4 -top-10 select-none text-[13rem] text-white/[0.06] sm:text-[20rem]">
            {pad2(roundNo)}
          </div>
        )}

        <div className="relative flex min-h-[460px] flex-col justify-end p-7 sm:p-12">
          <div className="flex items-center gap-3 font-mono text-[13px] font-bold uppercase tracking-[0.25em] text-brand">
            {lastCircuit && <Flag code={lastCircuit.country} title={lastCircuit.countryName} w={26} h={19} />}
            <span>Latest Race</span>
            <span className="h-px w-10 bg-brand/60" />
            <span className="text-white/50">Round {roundNo}</span>
          </div>

          <h1 className="mt-4 max-w-3xl font-display text-5xl font-black uppercase leading-[0.92] tracking-tight text-white sm:text-7xl">
            {lastRace?.track || "Season opener"}
          </h1>
          <p className="mt-3 font-mono text-sm uppercase tracking-wider text-white/65">
            {lastCircuit ? `${lastCircuit.circuit} · ` : ""}
            {fmtFull(lastRace?.date)}
          </p>

          {/* podium strip */}
          {podium.length > 0 && (
            <div className="mt-8 grid max-w-2xl gap-2 sm:grid-cols-3">
              {podium.map((p, i) => (
                <div
                  key={p.driverId}
                  className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-white/[0.07] px-4 py-3 backdrop-blur-md"
                >
                  <span
                    className="absolute left-0 top-0 h-full w-1"
                    style={{ backgroundColor: MEDAL[i] }}
                  />
                  <span
                    className="font-display text-2xl font-black tabular-nums"
                    style={{ color: MEDAL[i] }}
                  >
                    P{p.position}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-base font-bold leading-tight text-white">
                      <span className="truncate">{p.name}</span>
                      <Flag code={countryFor(p.driverId)} w={16} h={12} />
                    </span>
                    <span className="block truncate text-[13px] leading-tight text-white/60">
                      {p.isSub && p.subForTeam ? `${p.subForTeam.name} (sub)` : p.team.name}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              to="/results"
              className="group inline-flex items-center gap-2 rounded-lg bg-brand px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink transition hover:brightness-105"
            >
              Full Results
              <span className="transition group-hover:translate-x-0.5">→</span>
            </Link>
            <Link
              to="/drivers"
              className="inline-flex items-center rounded-lg border border-white/20 bg-white/5 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white backdrop-blur-sm transition hover:bg-white/15"
            >
              Standings
            </Link>
          </div>
        </div>
      </section>

      {/* ===================== BROADCAST BAR ===================== */}
      <section
        className="reveal card grid divide-y divide-border overflow-hidden md:grid-cols-3 md:divide-x md:divide-y-0"
        style={{ animationDelay: "0.08s" }}
      >
        {/* leader */}
        <StatCell label="Championship Leader" accent={leader?.team?.color}>
          {leader && (
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-display text-2xl font-extrabold uppercase tracking-tight text-dark">
                  {leader.name}
                </div>
                <div className="truncate text-[15px] text-light">{leader.team.name}</div>
              </div>
              <div className="text-right leading-none">
                <span className="font-mono text-3xl font-bold tabular-nums text-dark">{leader.total}</span>
                <span className="ml-1 text-sm font-semibold text-light">PTS</span>
              </div>
            </div>
          )}
        </StatCell>

        {/* last winner */}
        <StatCell label="Last Race Winner" accent={winner?.team?.color}>
          {winner ? (
            <div className="min-w-0">
              <div className="truncate font-display text-2xl font-extrabold uppercase tracking-tight text-dark">
                {winner.name}
              </div>
              <div className="flex items-center gap-2 truncate text-[15px] text-light">
                {lastCircuit && <Flag code={lastCircuit.country} title={lastCircuit.countryName} />}
                {lastRace?.track}
              </div>
            </div>
          ) : (
            <div className="text-[15px] text-light">No races yet</div>
          )}
        </StatCell>

        {/* next race */}
        <StatCell label="Next Race" accent="#F4AFC6">
          {nextRace ? (
            <div className="flex items-center gap-4">
              {nextDate && (
                <div className="flex shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-surface2 px-3 py-1.5 leading-none">
                  <span className="font-mono text-2xl font-bold tabular-nums text-dark">{nextDate.getDate()}</span>
                  <span className="mt-0.5 font-mono text-[11px] font-bold tracking-wider text-light">
                    {MONTHS[nextDate.getMonth()]}
                  </span>
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {nextCircuit && <Flag code={nextCircuit.country} title={nextCircuit.countryName} />}
                  <span className="truncate font-display text-2xl font-extrabold uppercase tracking-tight text-dark">
                    {nextRace.track}
                  </span>
                </div>
                <div className="text-[15px] text-light">Round {nextRace.number} · 18:00 GMT</div>
              </div>
              {nextCircuit && (
                <CircuitMap
                  track={nextRace.track}
                  stroke="var(--c-faint)"
                  strokeWidth={3}
                  className="ml-auto hidden h-12 w-20 shrink-0 sm:block"
                />
              )}
            </div>
          ) : (
            <div className="text-[15px] text-light">Season complete</div>
          )}
        </StatCell>
      </section>

      {/* ===================== DRIVERS' CHAMPIONSHIP ===================== */}
      <section className="reveal" style={{ animationDelay: "0.16s" }}>
        <Heading index="01" eyebrow="Championship" title="Drivers' Standings" to="/drivers" />
        <DriversTable rows={(drivers.data?.standings || []).slice(0, 10)} leaderTotal={leader?.total ?? 0} />
      </section>

      {/* ===================== CONSTRUCTORS ===================== */}
      <section className="reveal grid gap-10 lg:grid-cols-2" style={{ animationDelay: "0.24s" }}>
        <div>
          <Heading index="02" eyebrow="Constructors" title="Tier 1" to="/constructors" />
          <ConstructorTable rows={(t1.data?.standings || []).slice(0, 5)} />
        </div>
        <div>
          <Heading index="03" eyebrow="Constructors" title="Tier 2" to="/constructors" />
          <ConstructorTable rows={(t2.data?.standings || []).slice(0, 5)} />
        </div>
      </section>

      {/* ===================== POINTS PROGRESSION ===================== */}
      <section className="reveal" style={{ animationDelay: "0.32s" }}>
        <Heading index="04" eyebrow="Tier 1" title="Points Progression" to="/constructors" />
        <PointsChart standings={t1.data?.standings || []} completed={completedNumbers} />
      </section>

      <section className="reveal" style={{ animationDelay: "0.4s" }}>
        <Heading index="05" eyebrow="Tier 2" title="Points Progression" to="/constructors" />
        <PointsChart standings={t2.data?.standings || []} completed={completedNumbers} />
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function StatCell({ label, accent, children }) {
  return (
    <div className="relative p-6">
      <span
        className="absolute left-0 top-6 h-8 w-1 rounded-r"
        style={{ backgroundColor: accent || "var(--c-border)" }}
      />
      <div className="mb-3 pl-3 font-mono text-xs font-bold uppercase tracking-[0.2em] text-light">
        {label}
      </div>
      <div className="pl-3">{children}</div>
    </div>
  );
}

function Heading({ index, eyebrow, title, to }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 border-b border-border pb-4">
      <div className="flex items-end gap-4">
        <span className="font-display text-3xl font-black leading-none text-faint">{index}</span>
        <div>
          <div className="font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-brand">{eyebrow}</div>
          <h2 className="font-display text-2xl font-extrabold uppercase tracking-tight text-dark sm:text-3xl">
            {title}
          </h2>
        </div>
      </div>
      {to && (
        <Link
          to={to}
          className="group shrink-0 font-mono text-sm font-bold uppercase tracking-wider text-light transition hover:text-dark"
        >
          Full table <span className="text-brand transition group-hover:translate-x-0.5">→</span>
        </Link>
      )}
    </div>
  );
}

function DriversTable({ rows, leaderTotal }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border text-left font-mono text-xs font-bold uppercase tracking-[0.15em] text-light">
            <th className="w-14 py-3 pl-5 text-center">Pos</th>
            <th className="py-3 pl-2">Driver</th>
            <th className="hidden py-3 sm:table-cell">Team</th>
            <th className="py-3 pr-5 text-right">Pts</th>
            <th className="hidden py-3 pr-5 text-right md:table-cell">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const isLeader = d.position === 1;
            const pct = leaderTotal > 0 ? Math.max(6, (d.total / leaderTotal) * 100) : 0;
            return (
              <tr
                key={d.driverId}
                className={`group border-b border-border last:border-0 transition hover:bg-surface2 ${
                  isLeader ? "bg-brand/5" : ""
                }`}
              >
                <td className="py-4 pl-5 text-center">
                  <span
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-md font-display text-base font-black tabular-nums ${
                      d.position <= 3 ? "text-ink" : "text-medium"
                    }`}
                    style={
                      d.position <= 3
                        ? { backgroundColor: MEDAL[d.position - 1] }
                        : undefined
                    }
                  >
                    {d.position}
                  </span>
                </td>
                <td className="py-4 pl-2">
                  <div className="flex items-center gap-3">
                    <span className="h-7 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: d.team.color }} />
                    <span className="font-display text-lg font-bold uppercase tracking-tight text-dark">
                      {d.name}
                    </span>
                    <Flag code={countryFor(d.driverId)} className="ml-0.5" />
                  </div>
                </td>
                <td className="hidden py-4 text-[15px] text-medium sm:table-cell">{d.team.name}</td>
                <td className="py-4 pr-5 text-right">
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="font-mono text-lg font-bold tabular-nums text-dark">{d.total}</span>
                    <span className="hidden h-1 w-20 overflow-hidden rounded-full bg-border sm:block">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: d.team.color }}
                      />
                    </span>
                  </div>
                </td>
                <td className="hidden py-4 pr-5 text-right font-mono text-[15px] tabular-nums text-light md:table-cell">
                  {isLeader ? "—" : `−${leaderTotal - d.total}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConstructorTable({ rows }) {
  const top = rows[0]?.total ?? 0;
  return (
    <div className="card overflow-hidden">
      <table className="w-full">
        <tbody>
          {rows.map((t) => {
            const pct = top > 0 ? Math.max(6, (t.total / top) * 100) : 0;
            return (
              <tr key={t.teamId} className="border-b border-border last:border-0 transition hover:bg-surface2">
                <td className="w-12 py-4 pl-5 text-center font-display text-lg font-black tabular-nums text-faint">
                  {t.position}
                </td>
                <td className="py-4 pl-1">
                  <div className="flex items-center gap-3">
                    <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                    <div className="min-w-0">
                      <span className="block truncate font-display text-lg font-bold uppercase tracking-tight text-dark">
                        {t.name}
                      </span>
                      <span className="mt-1.5 block h-1 w-24 overflow-hidden rounded-full bg-border">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: t.color }}
                        />
                      </span>
                    </div>
                  </div>
                </td>
                <td className="py-4 pr-5 text-right">
                  <span className="font-mono text-xl font-bold tabular-nums text-dark">{t.total}</span>
                  <span className="ml-1 text-xs font-semibold text-light">PTS</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
