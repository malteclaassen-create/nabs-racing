import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useSwapClass } from "../hooks/motion.js";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, TableSkeleton, Skeleton, DriverAvatar, MEDAL, MEDAL_TEXT, CountUp, readableInkOn } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import { countryFor } from "../data/driverCountries.js";
import SlidingTabs from "../components/SlidingTabs.jsx";

// ---------------------------------------------------------------------------
// /records — the Hall of Fame: the champions gallery (drivers ⇄ teams), the
// single records, and ONE big all-time top list with a category picker.
// Categories come data-driven from the backend's lists array, so new ones
// (poles once quali data lands, new telemetry) appear in the picker by themselves.
// ---------------------------------------------------------------------------

function SectionHead({ eyebrow, title, right }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow sm:text-[11px] sm:tracking-[0.2em]">{eyebrow}</div>
        <h2 className="mt-1 font-display text-2xl font-extrabold uppercase tracking-tight text-dark sm:text-3xl">{title}</h2>
      </div>
      {right}
    </div>
  );
}

// --- Page head ---------------------------------------------------------------

// Title, a line of intro and the series in four numbers. The numbers come from
// the server (recordsService totals), counted in people rather than handles.
// A server that predates the totals simply shows the seasons alone.
function HallHeader({ data }) {
  const t = data.totals;
  const stats = [
    { label: data.seasons === 1 ? "Season" : "Seasons", value: data.seasons },
    ...(t
      ? [
          { label: "Races run", value: t.races },
          { label: "Drivers", value: t.drivers },
          { label: t.champions === 1 ? "Champion" : "Champions", value: t.champions },
        ]
      : []),
  ];
  return (
    <div className="border-b border-border pb-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow sm:text-[13px] sm:tracking-[0.2em]">
            All-time{data.seriesName ? ` · ${data.seriesName}` : ""}
          </div>
          <h1 className="mt-1 font-display text-4xl font-black uppercase leading-none tracking-tight text-dark sm:text-6xl">
            Hall of Fame
          </h1>
          <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-light">
            Every season so far, boiled down to the names that stuck. Champions, one-off records and the career
            leaderboards.
          </p>
        </div>
        {/* Two by two on a phone, one row from sm. Hairlines per cell rather
            than divide-*, which would draw a second line along the outer edge
            of the 2x2 block. */}
        <div
          className={`grid shrink-0 overflow-hidden rounded-2xl border border-border bg-card shadow-card ${
            stats.length > 1 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1"
          }`}
        >
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={`border-border px-4 py-3 sm:px-6 ${
                ["", "border-l", "border-t sm:border-l sm:border-t-0", "border-l border-t sm:border-t-0"][i]
              }`}
            >
              <div className="font-display text-2xl font-black tabular-nums text-dark sm:text-3xl">
                <CountUp end={s.value} />
              </div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
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
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest sm:text-[11px] sm:tracking-[0.2em]" style={{ color: MEDAL_TEXT[0] }}>
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
        <div className="relative font-mono text-[10px] font-bold uppercase tracking-widest sm:text-[11px] sm:tracking-[0.2em]" style={{ color: MEDAL_TEXT[0] }}>
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
                  <span className="block font-mono text-[10px] font-bold uppercase tracking-wider text-light">pts</span>
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
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">Tier {t.tier}</span>
                </span>
                {t.points != null && (
                  <span className="shrink-0 font-display text-xl font-black tabular-nums text-dark">
                    <CountUp end={t.points} />
                    <span className="ml-1 font-mono text-[10px] font-bold uppercase tracking-wider text-light">pts</span>
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

// --- The ONE top list, as a bar chart with a category picker -----------------

// The category name as the picker and the heading show it: "Most career
// points" reads "Career points".
const listName = (l) => l.label.replace(/^Most /, "").replace(/^./, (c) => c.toUpperCase());

// The category picker. A list of our own rather than a native <select>: the
// browser's open list could not be styled, came out narrower or wider than the
// button and in the system's colours. This one opens exactly as wide as the
// button, in the panel's dark style, and keeps the keyboard handling a select
// has (arrows, Home/End, Enter, Escape).
function RankingPicker({ lists, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef(null);
  const button = useRef(null);
  const listId = useId();
  const current = Math.max(0, lists.findIndex((l) => l.key === value));

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const show = () => { setActive(current); setOpen(true); };
  const pick = (i) => {
    onChange(lists[i].key);
    setOpen(false);
    button.current?.focus();
  };
  const onKey = (e) => {
    const last = lists.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") { setOpen(false); return; }
    e.preventDefault();
    if (e.key === "ArrowDown") setActive((i) => Math.min(last, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "Enter" || e.key === " ") pick(active);
  };

  return (
    <div ref={wrap} className="relative max-sm:w-full sm:min-w-[15rem]">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        className={`flex w-full items-center gap-3 rounded-xl bg-white/10 py-2.5 pl-4 pr-3 text-base font-semibold ring-1 transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:text-sm ${open ? "ring-white/30" : "ring-white/15"}`}
      >
        <span className="text-white/50">Ranking</span>
        <span className="min-w-0 flex-1 truncate text-left text-white">{listName(lists[current])}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Ranking"
          className="absolute inset-x-0 top-full z-dropdown mt-1.5 max-h-80 overflow-y-auto rounded-xl bg-ink p-1.5 shadow-lift ring-1 ring-white/15"
        >
          {lists.map((l, i) => (
            <li
              key={l.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${i === active ? "bg-white/10 text-white" : "text-white/75"}`}
            >
              {listName(l)}
              {i === current && <Check className="h-4 w-4 shrink-0 text-eyebrow" strokeWidth={2} aria-hidden />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Dark in both themes, like the other heroes (bg-ink). Each bar is measured
// against the leader and painted in the driver's latest team colour, so the
// gaps between the names read at a glance. Nine-plus categories (and more as
// the data grows) sit behind one dropdown instead of a wall of buttons. The
// `dark` class hands the inside the dark-theme tokens (eyebrow tone, the
// dropdown's open list) on a light page too.
function TopListPanel({ lists, activeKey, onChange, seasons }) {
  const list = lists.find((l) => l.key === activeKey) || lists[0];
  const max = list.rows[0]?.value || 1;
  // The rows fade over when the category changes; the panel itself (and the
  // dropdown with the focus in it) stays put.
  const swap = useSwapClass(list.key);

  return (
    <section className="dark reveal rounded-3xl bg-ink p-5 text-white shadow-lift sm:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-eyebrow">
            Careers · all-time top 10
          </div>
          <h2 className="mt-1 font-display text-3xl font-black uppercase tracking-tight sm:text-4xl">{listName(list)}</h2>
          {list.note && <p className="mt-1 font-mono text-[11px] text-white/50">{list.note}</p>}
        </div>
        <RankingPicker lists={lists} value={list.key} onChange={onChange} />
      </div>

      <div key={list.key} className={swap}>
        <div className="cascade space-y-2.5">
          {list.rows.map((r, i) => {
            const rank = i + 1;
            const pct = Math.max(3, Math.round((r.value / max) * 100));
            const color = r.team?.color || "#94a3b8";
            return (
              <Link
                key={r.driverId}
                to={`/drivers/${r.driverId}${r.seasonNumber != null ? `?season=${r.seasonNumber}` : ""}`}
                style={{ "--i": Math.min(i, 16) }}
                className="group grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 rounded-lg sm:grid-cols-[2rem_9rem_minmax(0,1fr)]"
              >
                <span
                  className={`font-display text-base font-black tabular-nums ${rank === 1 ? "" : "text-white/50"}`}
                  style={rank === 1 ? { color: MEDAL[0] } : undefined}
                >
                  {rank}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-display text-sm font-black uppercase tracking-tight text-white transition group-hover:text-eyebrow">
                    {r.name}
                  </span>
                  <Flag code={countryFor(r.driverId, r.country)} w={16} h={11} />
                </span>
                {/* The bar keeps room for the logo and the number even when the
                    value is tiny next to the leader's. */}
                <span className="relative col-span-2 block h-8 overflow-hidden rounded-md bg-white/5 sm:col-span-1">
                  <span
                    className="bar-fill absolute inset-y-0 left-0 flex min-w-[5.5rem] items-center justify-end rounded-md pr-3"
                    style={{ "--w": `${pct}%`, background: `linear-gradient(90deg, ${color}55, ${color})` }}
                  >
                    <span
                      className={`font-mono text-sm font-bold tabular-nums ${readableInkOn(color) === "#fff" ? "drop-shadow" : ""}`}
                      style={{ color: readableInkOn(color) }}
                    >
                      <CountUp end={r.value} />
                    </span>
                  </span>
                  {r.team && (
                    <span className="absolute inset-y-0 left-2 flex items-center">
                      <TeamLogo id={r.team.id} name={r.team.name} color={r.team.color} logoUrl={r.team.logoUrl} size={16} />
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-4 font-mono text-[10px] uppercase tracking-wider text-white/50">
        <span>Bar colour = latest team</span>
        {seasons > 0 && <span>{seasons === 1 ? "1 season" : `${seasons} seasons`} counted</span>}
      </div>
    </section>
  );
}

export default function HallOfFame() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.seriesRecords(), []));
  const wall = useApi(useCallback(() => api.tokenWall(), []));
  const [champMode, setChampMode] = useState("drivers");
  const [listKey, setListKey] = useState(null);
  // The switch below fades its panel over instead of rebuilding it from blank;
  // the page's first arrival keeps its own entrance. The top list does the
  // same for its own rows.
  const champSwap = useSwapClass(champMode);

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
  // Keep the page's own header above the error, the way the empty state below
  // already does: a failed read should still look like the page you asked for,
  // not like the site lost its way.
  if (error)
    return (
      <div>
        <PageHeader eyebrow="All-time" title="Hall of Fame" />
        <ErrorBox message={error} onRetry={reload} />
      </div>
    );
  if (!data || (!data.lists.length && !data.champions.length))
    return (
      <div>
        <PageHeader eyebrow="All-time" title="Hall of Fame" />
        <div className="card p-8 text-center text-medium">No completed seasons yet. The records start with the first finale.</div>
      </div>
    );

  const activeListKey = data.lists.some((l) => l.key === listKey) ? listKey : data.lists[0]?.key;

  return (
    <div className="content-in space-y-6 sm:space-y-14">
      <HallHeader data={data} />

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
          <div key={champMode} className={champSwap}>
            {champMode === "drivers" ? (
              <DriverChampions champions={data.champions} />
            ) : (
              <TeamChampions champions={data.champions} />
            )}
          </div>
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

      {/* ONE all-time top list, the category picked in its own dropdown */}
      {data.lists.length > 0 && (
        <TopListPanel lists={data.lists} activeKey={activeListKey} onChange={setListKey} seasons={data.seasons} />
      )}

      {/* the wall: names bought with server tokens, oldest first */}
      {wall.data?.wall?.length > 0 && (
        <section className="reveal">
          <SectionHead eyebrow="NABS Tokens" title="The wall" />
          <p className="mb-4 text-sm text-light">The people who put their name up here. Earned on the server, not on the track.</p>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {wall.data.wall.map((w, i) => (
              <li key={`${w.name}-${i}`} className="flex items-baseline justify-between gap-4 px-4 py-3">
                <span className="font-display text-base font-extrabold uppercase tracking-tight text-dark">{w.name}</span>
                <span className="font-mono text-xs text-light">
                  {new Date(w.since).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
