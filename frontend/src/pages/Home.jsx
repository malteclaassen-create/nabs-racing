import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { Skeleton, TableSkeleton, CountUp } from "../components/ui.jsx";
import { useParallax, useTilt, useMagnetic } from "../hooks/motion.js";
import Flag from "../components/Flag.jsx";
import PointsChart from "../components/PointsChart.jsx";
import RaceCountdown from "../components/RaceCountdown.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import { circuitFor } from "../data/circuits.js";
import { countryFor } from "../data/driverCountries.js";
import { fmtRaceTime } from "../utils/raceTime.js";

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
  const { current: season } = useSeason();
  const drivers = useApi(useCallback(() => api.driverStandings(), []));
  const t1 = useApi(useCallback(() => api.t1Standings(), []));
  const t2 = useApi(useCallback(() => api.t2Standings(), []));
  const races = useApi(useCallback(() => api.races(), []));
  const [latest, setLatest] = useState(null);

  // Hero motion: the photo drifts slowly on scroll; the primary CTA is magnetic.
  const heroImgRef = useParallax(0.08);
  const ctaRef = useMagnetic({ strength: 0.25 });

  // Championship rounds only (special events have no round number / aren't scored).
  const champRaces = (races.data || []).filter((r) => !r.isSpecialEvent && r.number != null);
  const completedRaces = champRaces.filter((r) => r.isCompleted);
  const lastRace = completedRaces[completedRaces.length - 1];
  const nextRace = champRaces.find((r) => !r.isCompleted);

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
  const nextDate = nextRace?.date ? new Date(nextRace.date) : null;
  const roundNo = lastRace?.number ?? completedRaces.length;
  const lastCircuit = circuitFor(lastRace?.track);
  const nextCircuit = circuitFor(nextRace?.track);
  const completedNumbers = completedRaces.map((r) => r.number).sort((a, b) => a - b);
  // Championship rounds in this season (excludes non-scoring special events).
  const totalRounds = (races.data || []).filter((r) => !r.isSpecialEvent && r.number != null).length;

  // Season "by the numbers" band.
  const standings = drivers.data?.standings || [];
  const driverCount = standings.length;
  const constructorCount = (t1.data?.standings?.length || 0) + (t2.data?.standings?.length || 0);
  const runnerUp = standings[1];
  const titleGap = leader && runnerUp ? leader.total - runnerUp.total : 0;

  return (
    <div className="space-y-16">
      {/* ===================== SEASON TICKER + COUNTDOWN ===================== */}
      <div className="-mt-2 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[13px] font-semibold uppercase tracking-[0.2em] text-light">
          <span className="flex items-center gap-2 text-dark">
            {season ? `${season.name} · Live` : "Live"}
          </span>
          {season?.game && (
            <>
              <span className="hidden h-3 w-px bg-border sm:inline-block" />
              <span className="hidden sm:inline">{season.game}</span>
            </>
          )}
          <span className="hidden h-3 w-px bg-border sm:inline-block" />
          <span className="text-medium">
            Round {pad2(roundNo)} <span className="text-faint">/ {totalRounds || "—"}</span>
          </span>
        </div>
      </div>

      {/* ===================== LEAD FEATURE ===================== */}
      <section className="relative overflow-hidden rounded-[1.75rem] bg-ink shadow-xl shadow-ink/20 ring-1 ring-black/5 dark:shadow-card dark:ring-white/10">
        <img
          ref={heroImgRef}
          src="/hero.jpg"
          alt=""
          onError={(e) => (e.currentTarget.style.display = "none")}
          className="absolute inset-0 h-full w-full scale-[1.12] object-cover object-center will-change-transform"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-card via-card/80 to-card/0 dark:bg-gradient-to-tr dark:from-ink dark:via-ink/75 dark:to-ink/0" />
        <div className="absolute inset-0 bg-gradient-to-t from-transparent via-transparent to-transparent dark:from-ink/95" />
        <div
          className="speed-hatch absolute inset-y-0 right-0 w-[18%]"
          style={{
            WebkitMaskImage: "linear-gradient(to left, #000 35%, transparent 100%)",
            maskImage: "linear-gradient(to left, #000 35%, transparent 100%)",
          }}
        />
        {/* brand accent rail */}
        <div className="absolute left-0 top-0 h-full w-1.5 bg-gradient-to-b from-brand via-brand/40 to-transparent" />

        <div className="relative flex min-h-[460px] flex-col gap-8 p-7 sm:p-12 lg:flex-row lg:gap-10">
          {/* LEFT — latest race */}
          <div className="flex flex-1 flex-col justify-end">
            <div className="hero-anim flex items-center gap-3 font-mono text-[13px] font-bold uppercase tracking-[0.25em] text-rose-600 dark:text-brand" style={{ animationDelay: "0.05s" }}>
              {lastCircuit && <Flag code={lastCircuit.country} title={lastCircuit.countryName} w={26} h={19} />}
              <span>Latest Race</span>
              <span className="h-px w-10 bg-rose-500/50 dark:bg-brand/60" />
              <span className="text-ink/40 dark:text-white/50">Round {roundNo}</span>
            </div>

            <h1 className="hero-anim mt-4 max-w-3xl font-display text-5xl font-black uppercase leading-[0.92] tracking-tight text-ink dark:text-white sm:text-7xl" style={{ animationDelay: "0.12s" }}>
              {lastRace?.track || "Season opener"}
            </h1>
            <p className="hero-anim mt-3 font-mono text-sm uppercase tracking-wider text-ink/70 dark:text-white/65" style={{ animationDelay: "0.2s" }}>
              {lastCircuit ? `${lastCircuit.circuit} · ` : ""}
              {fmtFull(lastRace?.date)}
            </p>

            {/* podium strip */}
            {podium.length > 0 && (
              <div className="hero-anim mt-8 grid max-w-2xl gap-2 sm:grid-cols-3" style={{ animationDelay: "0.28s" }}>
                {podium.map((p, i) => (
                  <Link
                    key={p.driverId}
                    to={`/drivers/${p.driverId}`}
                    className="shine group relative flex items-center gap-3 overflow-hidden rounded-xl border border-black/10 bg-white/70 px-4 py-3 backdrop-blur-md transition hover:-translate-y-0.5 hover:border-brand/50 hover:bg-white/90 dark:border-white/10 dark:bg-white/[0.07] dark:hover:bg-white/[0.12]"
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
                      <span className="flex items-center gap-1.5 text-base font-bold leading-tight text-ink transition group-hover:text-brand dark:text-white">
                        <span className="truncate">{p.name}</span>
                        <Flag code={countryFor(p.driverId, p.country)} w={16} h={12} />
                      </span>
                      {p.isSub && p.subForTeam ? (
                        <TeamLogo
                          id={p.subForTeam.id}
                          name={`${p.subForTeam.name} (sub)`}
                          color={p.subForTeam.color}
                          logoUrl={p.subForTeam.logoUrl}
                          size={16}
                          showName
                          className="mt-0.5"
                          nameClassName="truncate text-[13px] leading-tight text-ink/55 dark:text-white/60"
                        />
                      ) : (
                        <TeamLogo
                          id={p.team.id}
                          name={p.team.name}
                          color={p.team.color}
                          logoUrl={p.team.logoUrl}
                          size={16}
                          showName
                          className="mt-0.5"
                          nameClassName="truncate text-[13px] leading-tight text-ink/55 dark:text-white/60"
                        />
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            )}

            <div className="hero-anim mt-9 flex flex-wrap gap-3" style={{ animationDelay: "0.36s" }}>
              <Link
                ref={ctaRef}
                to="/races"
                className="shine group inline-flex items-center gap-2 rounded-lg bg-brand px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink shadow-lg shadow-brand/30 transition hover:brightness-105"
              >
                Full Results
                <span className="transition group-hover:translate-x-0.5">→</span>
              </Link>
              <Link
                to="/drivers"
                className="inline-flex items-center rounded-lg border border-ink/15 bg-ink/[0.03] px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink backdrop-blur-sm transition hover:bg-ink/[0.06] dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/15"
              >
                Standings
              </Link>
            </div>
          </div>

          {/* RIGHT — next race panel */}
          {nextRace && (
            <div className="flex shrink-0 flex-col justify-end lg:w-72">
              <div className="hero-anim rounded-2xl border border-black/10 bg-white/75 p-5 shadow-xl shadow-ink/10 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.08]" style={{ animationDelay: "0.22s" }}>
                <div className="flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-sky-600 dark:text-sky-300">
                  {nextCircuit && <Flag code={nextCircuit.country} title={nextCircuit.countryName} w={22} h={16} />}
                  <span>Next Race</span>
                  <span className="ml-auto text-ink/40 dark:text-white/50">Round {nextRace.number}</span>
                </div>

                <div className="mt-3 font-display text-3xl font-black uppercase leading-none tracking-tight text-ink dark:text-white sm:text-4xl">
                  {nextRace.track}
                </div>
                {nextCircuit && (
                  <div className="mt-2 font-mono text-xs uppercase tracking-wider text-ink/60 dark:text-white/65">
                    {nextCircuit.circuit}
                  </div>
                )}

                <RaceCountdown date={nextRace.date} className="mt-5" />

                {nextDate && (
                  <div className="mt-3 flex items-center justify-center gap-2 font-mono text-xs uppercase tracking-wider text-ink/65 dark:text-white/70">
                    <span className="font-bold text-ink/80 dark:text-white/85">
                      {nextDate.getDate()} {MONTHS[nextDate.getMonth()]}
                    </span>
                    <span className="h-3 w-px bg-ink/20 dark:bg-white/25" />
                    <span>{fmtRaceTime(nextRace.date)}</span>
                  </div>
                )}

                <Link
                  to="/signup"
                  className="shine group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:brightness-105"
                >
                  Sign Up
                  <span className="transition group-hover:translate-x-0.5">→</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ===================== SEASON BY THE NUMBERS ===================== */}
      <section className="cascade grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <NumberTile
          index={0}
          to="/races"
          label="Rounds Done"
          value={completedRaces.length}
          sub={`of ${totalRounds || "—"}`}
          accent="#f4afc6"
        />
        <NumberTile index={1} to="/drivers" label="Drivers" value={driverCount} sub="on the grid" accent="#38bdf8" />
        <NumberTile
          index={2}
          to="/constructors"
          label="Constructors"
          value={constructorCount}
          sub="teams scoring"
          accent="#a78bfa"
        />
        <NumberTile
          index={3}
          to={leader ? `/drivers/${leader.driverId}` : undefined}
          label="Leader"
          value={leader?.total ?? "—"}
          sub={leader?.name || "TBA"}
          accent={leader?.team?.color || "#EAB308"}
        />
        <NumberTile
          index={4}
          to="/drivers"
          label="Title Gap"
          value={titleGap > 0 ? titleGap : "Level"}
          prefix={titleGap > 0 ? "+" : ""}
          sub="P1 to P2"
          accent="#fbbf24"
        />
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
        <PointsChart standings={t1.data?.standings || []} completed={completedNumbers} allRounds={t1.data?.raceNumbers || []} />
      </section>

      <section className="reveal" style={{ animationDelay: "0.4s" }}>
        <Heading index="05" eyebrow="Tier 2" title="Points Progression" to="/constructors" />
        <PointsChart standings={t2.data?.standings || []} completed={completedNumbers} allRounds={t2.data?.raceNumbers || []} />
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- */

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

function NumberTile({ label, value, sub, accent = "#f4afc6", to, index = 0, prefix = "" }) {
  const tiltRef = useTilt({ max: 6, lift: 4 });
  const cls =
    "shine tilt group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-card" +
    (to ? " hover:border-brand/40 hover:shadow-xl" : "");
  const body = (
    <>
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: accent }} />
      <div className="flex items-center gap-2 pl-1">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-light">{label}</span>
        {to && (
          <span className="ml-auto text-light opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100">
            →
          </span>
        )}
      </div>
      <div className="mt-3 pl-1 font-display text-4xl font-black leading-none tabular-nums text-dark">
        {typeof value === "number" ? <CountUp end={value} prefix={prefix} /> : value}
      </div>
      {sub && (
        <div className="mt-1.5 truncate pl-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
          {sub}
        </div>
      )}
    </>
  );
  return to ? (
    <Link ref={tiltRef} to={to} className={cls} style={{ "--i": index }}>
      {body}
    </Link>
  ) : (
    <div ref={tiltRef} className={cls} style={{ "--i": index }}>
      {body}
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
                    <Link
                      to={`/drivers/${d.driverId}`}
                      className="font-display text-lg font-bold uppercase tracking-tight text-dark transition hover:text-brand"
                    >
                      {d.name}
                    </Link>
                    <Flag code={countryFor(d.driverId, d.country)} className="ml-0.5" />
                  </div>
                </td>
                <td className="hidden py-4 sm:table-cell">
                  <Link to={`/teams/${d.team.id}`} className="inline-flex transition hover:opacity-80">
                    <TeamLogo
                      id={d.team.id}
                      name={d.team.name}
                      color={d.team.color}
                      logoUrl={d.team.logoUrl}
                      size={20}
                      showName
                      nameClassName="truncate text-[15px] text-medium"
                    />
                  </Link>
                </td>
                <td className="py-4 pr-5 text-right">
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="font-mono text-lg font-bold tabular-nums text-dark">{d.total}</span>
                    <span className="hidden h-1 w-20 overflow-hidden rounded-full bg-border sm:block">
                      <span
                        className="bar-fill block h-full rounded-full"
                        style={{ "--w": `${pct}%`, backgroundColor: d.team.color }}
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
              <tr key={t.teamId} className="group border-b border-border last:border-0 transition hover:bg-surface2">
                <td className="w-12 py-4 pl-5 text-center font-display text-lg font-black tabular-nums text-faint">
                  {t.position}
                </td>
                <td className="py-4 pl-1">
                  <Link to={`/teams/${t.teamId}`} className="flex items-center gap-3">
                    <TeamLogo id={t.teamId} name={t.name} color={t.color} logoUrl={t.logoUrl} size={32} />
                    <div className="min-w-0">
                      <span className="block truncate font-display text-lg font-bold uppercase tracking-tight text-dark transition group-hover:text-brand">
                        {t.name}
                      </span>
                      <span className="mt-1.5 block h-1 w-24 overflow-hidden rounded-full bg-border">
                        <span
                          className="bar-fill block h-full rounded-full"
                          style={{ "--w": `${pct}%`, backgroundColor: t.color }}
                        />
                      </span>
                    </div>
                  </Link>
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
