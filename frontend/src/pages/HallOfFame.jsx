import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, TableSkeleton, Skeleton, DriverAvatar, MEDAL, MEDAL_TEXT, CountUp } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import { countryFor } from "../data/driverCountries.js";
import SlidingTabs from "../components/SlidingTabs.jsx";

// ---------------------------------------------------------------------------
// /records — the Hall of Fame: the champions gallery (drivers ⇄ teams), the
// single records, and ONE big all-time top list with a category switcher.
// Categories come data-driven from the backend's lists array, so new ones
// (poles once quali data lands, new telemetry) appear as buttons by themselves.
// ---------------------------------------------------------------------------

function SectionHead({ eyebrow, title, right }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-eyebrow sm:text-[11px] sm:tracking-[0.25em]">{eyebrow}</div>
        <h2 className="mt-1 font-display text-2xl font-extrabold uppercase tracking-tight text-dark sm:text-3xl">{title}</h2>
      </div>
      {right}
    </div>
  );
}

// --- Champions -------------------------------------------------------------

function DriverChampions({ champions }) {
  const [latest, ...earlier] = champions;
  return (
    <div className="card overflow-hidden">
      {/* reigning champion — the section's centrepiece */}
      <Link
        to={`/drivers/${latest.driver.driverId}?season=${latest.seasonNumber}`}
        className="relative block overflow-hidden border-b border-border p-6 transition hover:bg-surface2 sm:p-8"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.1]"
          style={{ background: `radial-gradient(110% 150% at 90% 0%, ${MEDAL[0]}, transparent 55%)` }}
        />
        <div className="relative flex flex-wrap items-center gap-4 sm:gap-6">
          <DriverAvatar
            name={latest.driver.name}
            photoUrl={latest.driver.photoUrl}
            color={latest.driver.team?.color || MEDAL[0]}
            size={92}
            className="text-3xl ring-2 ring-[color:var(--medal-1)]"
          />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] sm:text-[11px] sm:tracking-[0.25em]" style={{ color: MEDAL_TEXT[0] }}>
              Reigning champion · {latest.seasonName || `Season ${latest.seasonNumber}`}
            </div>
            <div className="mt-1.5 flex items-center gap-2 sm:gap-3">
              <span className="truncate font-display text-[26px] font-black uppercase leading-tight tracking-tight text-dark sm:text-5xl">
                {latest.driver.name}
              </span>
              <Flag code={countryFor(latest.driver.driverId, latest.driver.country)} w={30} h={22} />
            </div>
            {latest.driver.team?.name && (
              <div className="mt-2">
                <TeamLogo
                  id={latest.driver.team.id}
                  name={latest.driver.team.name}
                  color={latest.driver.team.color}
                  logoUrl={latest.driver.team.logoUrl}
                  size={20}
                  showName
                  nameClassName="text-sm font-semibold text-medium"
                />
              </div>
            )}
          </div>
          {/* On phones the number takes its own full row (baseline with the
              unit) — as a fixed right column it crushed the name to a letter. */}
          <div className="flex w-full items-baseline gap-2 sm:block sm:w-auto sm:shrink-0 sm:text-right">
            <div className="font-display text-4xl font-black leading-none tabular-nums sm:text-6xl" style={{ color: MEDAL_TEXT[0] }}>
              <CountUp end={latest.points} />
            </div>
            <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-light sm:mt-1">points</div>
          </div>
        </div>
      </Link>

      {/* the eras before — dealt in top to bottom */}
      <div className="cascade divide-y divide-border">
        {earlier.map((c, i) => (
          <Link
            key={c.seasonNumber}
            to={`/drivers/${c.driver.driverId}?season=${c.seasonNumber}`}
            style={{ "--i": Math.min(i, 16) }}
            className="group flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-4 transition hover:bg-surface2 sm:gap-x-5 sm:px-8"
          >
            <span className="w-9 shrink-0 font-display text-xl font-black uppercase leading-none tracking-tight text-faint sm:w-16 sm:text-2xl">
              S{c.seasonNumber}
            </span>
            <DriverAvatar name={c.driver.name} photoUrl={c.driver.photoUrl} color={c.driver.team?.color || MEDAL[0]} size={44} />
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <span className="truncate font-display text-xl font-extrabold uppercase tracking-tight text-dark transition group-hover:text-brand sm:text-2xl">
                {c.driver.name}
              </span>
              <Flag code={countryFor(c.driver.driverId, c.driver.country)} w={22} h={16} />
            </span>
            <span className="shrink-0 text-right">
              <span className="font-display text-xl font-black tabular-nums text-dark sm:text-2xl">
                <CountUp end={c.points} />
              </span>
              <span className="ml-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-light">pts</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function TeamChampions({ champions }) {
  const rows = champions.filter((c) => c.teams.length > 0);
  if (!rows.length)
    return <div className="card p-8 text-center text-medium">No team championships recorded yet.</div>;
  const [latest, ...earlier] = rows;
  return (
    <div className="card overflow-hidden">
      {/* reigning team champions */}
      <div className="relative overflow-hidden border-b border-border p-6 sm:p-8">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.1]"
          style={{ background: `radial-gradient(110% 150% at 90% 0%, ${MEDAL[0]}, transparent 55%)` }}
        />
        <div className="relative font-mono text-[10px] font-bold uppercase tracking-[0.14em] sm:text-[11px] sm:tracking-[0.25em]" style={{ color: MEDAL_TEXT[0] }}>
          Reigning team champions · {latest.seasonName || `Season ${latest.seasonNumber}`}
        </div>
        <div className="relative mt-4 grid gap-4 sm:grid-cols-2">
          {latest.teams.map((t) => (
            <Link
              key={t.tier}
              to={`/teams/${t.teamId}?season=${latest.seasonNumber}`}
              className="flex items-center gap-4 rounded-xl bg-surface2/60 p-4 transition hover:bg-surface2"
            >
              <TeamLogo id={t.teamId} name={t.name} color={t.color} logoUrl={t.logoUrl} size={52} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-2xl font-black uppercase tracking-tight text-dark">
                  {t.name}
                </span>
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">
                  Tier {t.tier} champions
                </span>
              </span>
              {t.points != null && (
                <span className="shrink-0 text-right">
                  <span className="font-display text-3xl font-black leading-none tabular-nums" style={{ color: MEDAL_TEXT[0] }}>
                    <CountUp end={t.points} />
                  </span>
                  <span className="block font-mono text-[9px] font-bold uppercase tracking-wider text-light">pts</span>
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>

      {/* earlier team titles — FIXED columns (Tier 1 left, Tier 2 right), so
          the tiers line up down the whole timeline. */}
      <div className="cascade divide-y divide-border">
        {earlier.map((c, i) => {
          const cell = (t) =>
            t ? (
              <Link key={t.tier} to={`/teams/${t.teamId}?season=${c.seasonNumber}`} className="group flex min-w-0 items-center gap-3">
                <TeamLogo id={t.teamId} name={t.name} color={t.color} logoUrl={t.logoUrl} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-lg font-extrabold uppercase tracking-tight text-dark transition group-hover:text-brand">
                    {t.name}
                  </span>
                  <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-light">Tier {t.tier}</span>
                </span>
                {t.points != null && (
                  <span className="shrink-0 font-display text-xl font-black tabular-nums text-dark">
                    <CountUp end={t.points} />
                    <span className="ml-1 font-mono text-[9px] font-bold uppercase tracking-wider text-light">pts</span>
                  </span>
                )}
              </Link>
            ) : (
              <span className="hidden sm:block" />
            );
          return (
            <div
              key={c.seasonNumber}
              style={{ "--i": Math.min(i, 16) }}
              className="grid items-center gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-[4rem_1fr_1fr] sm:px-8"
            >
              <span className="font-display text-2xl font-black uppercase leading-none tracking-tight text-faint">
                S{c.seasonNumber}
              </span>
              {cell(c.teams.find((t) => t.tier === 1))}
              {cell(c.teams.find((t) => t.tier === 2))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Records ----------------------------------------------------------------

function RecordCell({ rec }) {
  return (
    <Link
      to={`/drivers/${rec.holder.driverId}${rec.holder.seasonNumber != null ? `?season=${rec.holder.seasonNumber}` : ""}`}
      className="-ml-px -mt-px relative overflow-hidden border-l border-t border-border bg-card p-6 transition hover:bg-surface2"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{ background: `radial-gradient(130% 130% at 100% 0%, ${MEDAL[0]}, transparent 55%)` }}
      />
      <div className="relative font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">{rec.label}</div>
      <div className="relative mt-2 font-display text-7xl font-black leading-none tabular-nums" style={{ color: MEDAL_TEXT[0] }}>
        <CountUp end={rec.value} />
      </div>
      <div className="relative mt-5 flex items-center gap-3">
        <DriverAvatar name={rec.holder.name} photoUrl={rec.holder.photoUrl} color={rec.holder.team?.color || "#64748b"} size={44} />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-display text-xl font-extrabold uppercase tracking-tight text-dark">{rec.holder.name}</span>
            <Flag code={countryFor(rec.holder.driverId, rec.holder.country)} w={20} h={14} />
          </span>
          {rec.detail && <span className="block font-mono text-[10px] uppercase tracking-wider text-light">{rec.detail}</span>}
        </span>
      </div>
    </Link>
  );
}

// --- The ONE top list with its category switcher ------------------------------

function TopListPanel({ lists }) {
  const [key, setKey] = useState(lists[0]?.key);
  const list = lists.find((l) => l.key === key) || lists[0];
  const max = list.rows[0]?.value || 1;
  const [leader, ...chasers] = list.rows;

  return (
    <div className="card overflow-hidden">
      {/* the record holder of the picked category, celebrated big */}
      <Link
        to={`/drivers/${leader.driverId}${leader.seasonNumber != null ? `?season=${leader.seasonNumber}` : ""}`}
        className="relative flex flex-wrap items-center gap-4 overflow-hidden border-b border-border p-5 transition hover:bg-surface2 sm:gap-6 sm:p-8"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.1]"
          style={{ background: `radial-gradient(110% 160% at 0% 0%, ${leader.team?.color || "#888"}, transparent 60%)` }}
        />
        <DriverAvatar name={leader.name} photoUrl={leader.photoUrl} color={leader.team?.color || "#64748b"} size={76} className="text-2xl" />
        <span className="relative min-w-0 flex-1">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] sm:text-[11px] sm:tracking-[0.25em]" style={{ color: MEDAL_TEXT[0] }}>
            {list.label}
          </span>
          <span className="mt-1 flex items-center gap-3">
            <span className="truncate font-display text-2xl font-black uppercase tracking-tight text-dark sm:text-4xl">
              {leader.name}
            </span>
            <Flag code={countryFor(leader.driverId, leader.country)} w={26} h={19} />
          </span>
          {list.note && <span className="mt-1 block font-mono text-[10px] uppercase tracking-wider text-light">{list.note}</span>}
        </span>
        {/* Full-width row on phones — as a fixed right column it starved the name. */}
        <span className="relative flex w-full items-baseline gap-2 sm:block sm:w-auto sm:shrink-0 sm:text-right">
          <span className="font-display text-4xl font-black leading-none tabular-nums text-dark sm:text-6xl">
            <CountUp end={leader.value} />
          </span>
          {list.unit && <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light sm:block">{list.unit}</span>}
        </span>
      </Link>

      {/* the chasers — dealt in top to bottom, values counting up and the
          team-coloured bars sweeping in against the leader's total */}
      <div className="cascade divide-y divide-border">
        {chasers.map((r, i) => {
          const rank = i + 2;
          const pct = Math.max(3, Math.round((r.value / max) * 100));
          return (
            <Link
              key={r.driverId}
              to={`/drivers/${r.driverId}${r.seasonNumber != null ? `?season=${r.seasonNumber}` : ""}`}
              style={{ "--i": Math.min(i, 16) }}
              className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface2 sm:gap-4 sm:px-8"
            >
              <span className="w-7 shrink-0 text-center font-display text-lg font-black tabular-nums">
                <span style={rank <= 3 ? { color: MEDAL_TEXT[rank - 1] } : undefined} className={rank <= 3 ? "" : "text-light"}>
                  {rank}
                </span>
              </span>
              <DriverAvatar name={r.name} photoUrl={r.photoUrl} color={r.team?.color || "#64748b"} size={38} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2.5">
                  <span className="truncate font-display text-base font-extrabold uppercase tracking-tight text-dark sm:text-lg">
                    {r.name}
                  </span>
                  <Flag code={countryFor(r.driverId, r.country)} w={20} h={14} />
                </span>
                <span className="mt-1.5 block h-1.5 w-full max-w-64 overflow-hidden rounded-full bg-border">
                  <span
                    className="bar-fill block h-full rounded-full"
                    style={{ "--w": `${pct}%`, backgroundColor: r.team?.color || "#94a3b8" }}
                  />
                </span>
              </span>
              <span className="shrink-0 font-display text-xl font-black tabular-nums text-dark sm:text-2xl">
                <CountUp end={r.value} />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function HallOfFame() {
  const { data, loading, error } = useApi(useCallback(() => api.seriesRecords(), []));
  const [champMode, setChampMode] = useState("drivers");
  const [listKey, setListKey] = useState(null);

  if (loading)
    return (
      <div>
        <PageHeaderSkeleton />
        <div className="mb-8 grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
        <TableSkeleton rows={10} />
      </div>
    );
  if (error) return <ErrorBox message={error} />;
  if (!data || (!data.lists.length && !data.champions.length))
    return (
      <div>
        <PageHeader eyebrow="All-time" title="Hall of Fame" />
        <div className="card p-8 text-center text-medium">No completed seasons yet — the records start with the first finale.</div>
      </div>
    );

  const activeListKey = data.lists.some((l) => l.key === listKey) ? listKey : data.lists[0]?.key;
  const activeList = data.lists.find((l) => l.key === activeListKey);

  return (
    <div className="content-in space-y-9 sm:space-y-14">
      <PageHeader eyebrow="All-time" title="Hall of Fame" />

      {/* champions first — drivers ⇄ teams */}
      {data.champions.length > 0 && (
        <section className="reveal">
          <SectionHead
            eyebrow="The titles"
            title="Champions"
            right={
              <SlidingTabs
                items={[
                  { key: "drivers", label: "Drivers" },
                  { key: "teams", label: "Teams" },
                ]}
                value={champMode}
                onChange={setChampMode}
              />
            }
          />
          {champMode === "drivers" ? (
            <DriverChampions champions={data.champions} />
          ) : (
            <TeamChampions champions={data.champions} />
          )}
        </section>
      )}

      {/* single records — hairline band of golden numbers */}
      {data.records.length > 0 && (
        <section className="reveal">
          <SectionHead eyebrow="One-offs" title="Records" />
          <div className="cascade grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 lg:grid-cols-3">
            {data.records.map((rec, i) => (
              <div key={rec.key} className="grid" style={{ "--i": i }}>
                <RecordCell rec={rec} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ONE all-time top list, category picked via the button bar */}
      {activeList && (
        <section className="reveal">
          <SectionHead eyebrow="Careers" title="All-time Top 10" />
          <SlidingTabs
            className="mb-4"
            items={data.lists.map((l) => ({
              key: l.key,
              label: l.label.replace(/^Most /, "").replace(/^./, (c) => c.toUpperCase()),
            }))}
            value={activeListKey}
            onChange={setListKey}
          />
          <TopListPanel key={activeListKey} lists={[activeList]} />
        </section>
      )}
    </div>
  );
}
