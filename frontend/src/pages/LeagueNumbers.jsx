// ---------------------------------------------------------------------------
// /s/<series>/numbers: the league in numbers (backend
// services/leagueNumbersService.js), one season or every season at once.
//
// The Hall of Fame answers "who has the most"; this page answers "how much
// happened": races, starts, laps, passes, how many different winners, and the
// nights that stood out. Sums that some races never recorded (laps, passes and
// contacts are missing from the oldest result files) say how many races they
// were taken from, right under the number.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useSeriesPath } from "../context/SeriesContext.jsx";
import { useSpecificTitle, prettyTrack } from "../utils/pageTitle.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, CardsSkeleton, DriverAvatar, MEDAL_TEXT } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import { countryFor } from "../data/driverCountries.js";
import { useBoxWidth } from "../hooks/useBoxWidth.js";

const grouped = (n) => Number(n).toLocaleString("en-GB");

// "0.412 s" under a minute, "1:02.4" beyond it.
function fmtGap(ms) {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(3)} s`;
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(1).padStart(4, "0")}`;
}

export default function LeagueNumbers() {
  const [params, setParams] = useSearchParams();
  const want = params.get("season");
  const { seriesPath } = useSeriesPath();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let gone = false;
    setLoading(true);
    setError(null);
    api
      .leagueNumbers(want)
      .then((d) => !gone && setData(d))
      .catch((e) => !gone && setError(e.message))
      .finally(() => !gone && setLoading(false));
    return () => {
      gone = true;
    };
  }, [want]);

  const all = data?.scope === "all";
  const label = all ? "All time" : data?.season ? (data.season.name && !/^\d+$/.test(data.season.name) ? data.season.name : `Season ${data.season.number}`) : null;
  useSpecificTitle(data ? (all ? "The league in numbers, all time" : `${label} in numbers`) : "The league in numbers");

  if (error) return <ErrorBox message={error} />;
  if (!data) {
    return (
      <div className="space-y-5">
        <PageHeaderSkeleton />
        <CardsSkeleton count={6} />
      </div>
    );
  }

  const choose = (v) => {
    const next = new URLSearchParams(params);
    if (v) next.set("season", v);
    else next.delete("season");
    setParams(next);
  };
  const t = data.totals;
  const picker = (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Showing</span>
      <select
        className="input py-1.5 text-sm"
        aria-label="Season"
        value={all ? "all" : String(data.season?.number ?? "")}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="all">All time</option>
        {data.seasons.map((s) => (
          <option key={s.number} value={s.number}>
            {s.name && !/^\d+$/.test(s.name) ? s.name : `Season ${s.number}`}
            {s.isActive ? " (now)" : ""}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    // Held at reduced opacity while another season loads, rather than blanked:
    // the frame stays, the numbers change.
    <div className={`space-y-8 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <PageHeader
        eyebrow={all ? `${data.series.name} · every season` : `${data.series.name} · ${label}`}
        title="In numbers"
        subtitle={
          all
            ? "Every season of the league added up: how much racing, how many winners, and the nights that stood out."
            : `${label} added up: how much racing, how many winners, and the nights that stood out.`
        }
        right={picker}
        keepTitle
      />

      {t.races === 0 ? (
        <div className="card p-6 text-sm text-light">No race has been run {all ? "yet" : "this season yet"}.</div>
      ) : (
        <>
          <Kpis data={data} />
          <Superlatives data={data} all={all} />
          <div className="grid gap-6 lg:grid-cols-2">
            <WinnersCard winners={data.winners} seriesPath={seriesPath} />
            {!all && data.winsByTeam.length > 0 ? (
              <TeamWinsCard teams={data.winsByTeam} />
            ) : (
              <FieldCard data={data} />
            )}
          </div>
          {!all && data.perRound.length > 1 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <RoundColumns
                title="Cars on the grid"
                sub="starters per round"
                rows={data.perRound.map((r) => ({ round: r.round, track: r.track, value: r.starters }))}
                unit="cars"
              />
              {data.perRound.some((r) => r.overtakes != null) ? (
                <RoundColumns
                  title="Overtakes"
                  sub="passes per round, both races of a sprint weekend"
                  rows={data.perRound.filter((r) => r.overtakes != null).map((r) => ({ round: r.round, track: r.track, value: r.overtakes }))}
                  unit="passes"
                />
              ) : (
                <RoundColumns
                  title="Retirements"
                  sub="DNFs per round"
                  rows={data.perRound.map((r) => ({ round: r.round, track: r.track, value: r.dnfs }))}
                  unit="DNFs"
                />
              )}
            </div>
          )}
          <p className="text-xs leading-relaxed text-light">
            Counted from the classified results, time penalties applied, both races of a sprint weekend included (a sprint
            start is a start and a sprint win a win). Poles are one per round. Laps, overtakes and contacts only exist in
            the result files that recorded them, so those totals name the races they come from.{" "}
            <Link to={seriesPath("/records")} className="font-semibold text-brand hover:underline">
              The all-time records are in the Hall of Fame.
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

// --- the headline numbers ----------------------------------------------------------

function Covered({ sum, races }) {
  if (sum.value == null) return null;
  if (sum.races >= races) return null;
  return <span className="mt-0.5 block text-[11px] text-light">from {grouped(sum.races)} of {grouped(races)} races</span>;
}

function Kpis({ data }) {
  const t = data.totals;
  const tiles = [
    t.seasons > 1 && { label: t.seasons === 1 ? "Season" : "Seasons", value: t.seasons },
    { label: t.rounds === 1 ? "Round" : "Rounds", value: t.rounds, sub: t.sprints ? `${t.races} races, ${t.sprints} of them sprints` : null },
    { label: "Starts", value: t.starts },
    { label: t.drivers === 1 ? "Driver" : "Drivers", value: t.drivers },
    { label: data.winners.count === 1 ? "Winner" : "Different winners", value: data.winners.count },
    t.laps.value != null && { label: "Laps raced", value: t.laps.value, cover: t.laps },
    t.overtakes.value != null && { label: "Overtakes", value: t.overtakes.value, cover: t.overtakes },
  ].filter(Boolean);
  return (
    // As many to a row as fit, so four tiles fill it as well as seven do.
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
      {tiles.map((k) => (
        <div key={k.label} className="card px-4 py-4">
          <div className="font-display text-3xl font-black leading-none tracking-tight text-dark sm:text-4xl">{grouped(k.value)}</div>
          <div className="mt-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-light">{k.label}</div>
          {k.sub && <div className="mt-0.5 text-[11px] text-light">{k.sub}</div>}
          {k.cover && <Covered sum={k.cover} races={t.races} />}
        </div>
      ))}
    </div>
  );
}

// --- the nights that stood out ----------------------------------------------------------

function Where({ race, all }) {
  return (
    <div className="mt-1 text-xs text-light">
      {prettyTrack(race.track)} · {all ? `Season ${race.season}, ` : ""}Round {race.round}
      {race.sprint ? " · sprint" : ""}
    </div>
  );
}

function Person({ who, small = false }) {
  const code = countryFor(who.driverId, who.country);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <DriverAvatar name={who.name} photoUrl={who.photoUrl} size={small ? 22 : 28} />
      <span className="truncate font-semibold text-dark">{who.name}</span>
      {code && <Flag code={code} w={18} h={13} />}
    </span>
  );
}

function Fact({ label, value, children }) {
  return (
    <div className="card flex flex-col p-5">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">{label}</div>
      <div className="mt-2 font-display text-3xl font-black leading-none tracking-tight text-dark">{value}</div>
      <div className="mt-2 min-w-0 text-sm">{children}</div>
    </div>
  );
}

function Superlatives({ data, all }) {
  const facts = [];
  if (data.closestFinish) {
    const c = data.closestFinish;
    facts.push(
      <Fact key="closest" label="Closest finish" value={fmtGap(c.gapMs)}>
        <Person who={c.winner} /> <span className="text-light">beat</span> <Person who={c.second} small />
        <Where race={c.race} all={all} />
      </Fact>
    );
  }
  if (data.biggestMargin && data.biggestMargin.race.raceId !== data.closestFinish?.race.raceId) {
    const c = data.biggestMargin;
    facts.push(
      <Fact key="margin" label="Biggest winning margin" value={fmtGap(c.gapMs)}>
        <Person who={c.winner} />
        <Where race={c.race} all={all} />
      </Fact>
    );
  }
  if (data.biggestComeback) {
    const c = data.biggestComeback;
    facts.push(
      <Fact key="climb" label="Biggest climb" value={`+${c.gained}`}>
        <Person who={c.driver} />
        <div className="mt-1 text-xs text-light">
          P{c.grid} to P{c.position} · {prettyTrack(c.race.track)} · {all ? `Season ${c.race.season}, ` : ""}Round {c.race.round}
        </div>
      </Fact>
    );
  }
  if (data.busiestRace) {
    const c = data.busiestRace;
    facts.push(
      <Fact key="busy" label="Busiest race" value={`${grouped(c.overtakes)} passes`}>
        <Where race={c.race} all={all} />
      </Fact>
    );
  }
  if (data.field.biggest) {
    facts.push(
      <Fact key="field" label="Biggest grid" value={`${data.field.biggest.value} cars`}>
        <Where race={data.field.biggest.race} all={all} />
        {data.field.average != null && <div className="mt-1 text-xs text-light">{data.field.average} on average</div>}
      </Fact>
    );
  }
  const t = data.totals;
  if (t.finishRate != null) {
    facts.push(
      <Fact key="finish" label="Saw the flag" value={`${t.finishRate}%`}>
        <div className="text-xs text-light">
          {grouped(t.finishes)} finishes from {grouped(t.starts)} starts · {grouped(t.dnfs)} DNF{t.dnfs === 1 ? "" : "s"}
          {t.dsqs ? ` · ${grouped(t.dsqs)} DSQ` : ""}
        </div>
      </Fact>
    );
  }
  if (data.polesitters.rounds > 0) {
    facts.push(
      <Fact key="poles" label="Different polesitters" value={data.polesitters.count}>
        <div className="text-xs text-light">
          over {data.polesitters.rounds} round{data.polesitters.rounds === 1 ? "" : "s"} · {data.podiumFinishers} different podium finishers
        </div>
      </Fact>
    );
  }
  if (all && data.tracks.mostRaced) {
    facts.push(
      <Fact key="track" label="Most raced circuit" value={prettyTrack(data.tracks.mostRaced.track)}>
        <div className="text-xs text-light">
          {data.tracks.mostRaced.rounds} rounds · {data.tracks.count} circuits in all
        </div>
      </Fact>
    );
  }
  if (!facts.length) return null;
  return <div className="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">{facts}</div>;
}

// --- who won ------------------------------------------------------------------------------

// One bar per name, the count at its tip, all in one colour: it is one measure
// of one thing, and who is who is carried by the name and the face beside it.
function Bars({ rows, render }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,11rem),1fr] items-center gap-3">
          <span className="min-w-0">{render(r)}</span>
          <span className="flex items-center gap-2">
            <span className="h-3 rounded-r-[4px] bg-brand" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
            <span className="font-mono text-xs font-bold tabular-nums text-dark">{r.value}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function WinnersCard({ winners, seriesPath }) {
  const [more, setMore] = useState(false);
  const list = more ? winners.list : winners.list.slice(0, 10);
  return (
    <div className="card p-5 sm:p-6">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">Who won</div>
      <h2 className="mt-1 font-display text-xl font-extrabold uppercase tracking-tight text-dark">
        {winners.count} {winners.count === 1 ? "winner" : "different winners"}
      </h2>
      <div className="mt-4">
        <Bars
          rows={list.map((w, i) => ({ key: w.key, value: w.wins, w, i }))}
          render={({ w, i }) => (
            <Link to={seriesPath(`/drivers/${encodeURIComponent(w.driverId)}`)} className="flex min-w-0 items-center gap-2 hover:underline">
              <span className="w-5 shrink-0 text-right font-mono text-[11px] text-light" style={i < 3 ? { color: MEDAL_TEXT[i] } : undefined}>
                {i + 1}
              </span>
              <Person who={w} small />
            </Link>
          )}
        />
      </div>
      {winners.list.length > 10 && (
        <button type="button" onClick={() => setMore((m) => !m)} className="mt-4 text-sm font-semibold text-brand hover:underline">
          {more ? "Show the top ten" : `Show all ${winners.list.length}`}
        </button>
      )}
    </div>
  );
}

function TeamWinsCard({ teams }) {
  return (
    <div className="card p-5 sm:p-6">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">Wins by team</div>
      <h2 className="mt-1 font-display text-xl font-extrabold uppercase tracking-tight text-dark">
        {teams.length} {teams.length === 1 ? "team" : "teams"} on the top step
      </h2>
      <div className="mt-4">
        <Bars
          rows={teams.map((t) => ({ key: t.teamId, value: t.wins, t }))}
          render={({ t }) => (
            <TeamLogo id={t.teamId} name={t.name} color={t.color} logoUrl={t.logoUrl} size={18} showName nameClassName="truncate text-sm font-semibold text-dark" />
          )}
        />
      </div>
    </div>
  );
}

function FieldCard({ data }) {
  const t = data.totals;
  return (
    <div className="card p-5 sm:p-6">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">The field</div>
      <h2 className="mt-1 font-display text-xl font-extrabold uppercase tracking-tight text-dark">
        {grouped(t.drivers)} drivers, {grouped(t.starts)} starts
      </h2>
      <dl className="mt-4 divide-y divide-border text-sm">
        {data.field.average != null && <Row label="Average grid" value={`${data.field.average} cars`} />}
        {data.field.smallest && <Row label="Smallest grid" value={`${data.field.smallest.value} cars`} />}
        {t.contacts.value != null && <Row label="Contacts" value={grouped(t.contacts.value)} />}
        {t.gamePenalties.value != null && <Row label="In-game penalties" value={grouped(t.gamePenalties.value)} />}
        {t.penaltySeconds > 0 && <Row label="Stewards' time penalties" value={`${grouped(t.penaltySeconds)} s`} />}
        <Row label="Circuits" value={grouped(data.tracks.count)} />
      </dl>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{label}</dt>
      <dd className="font-mono text-sm font-bold tabular-nums text-dark">{value}</dd>
    </div>
  );
}

// --- round by round ---------------------------------------------------------------------------

// A column per round, one colour, the highest one labelled on its cap. Hover
// or focus a column for its round and value; the table under it has them all.
function RoundColumns({ title, sub, rows, unit }) {
  const [active, setActive] = useState(null);
  // Drawn at the card's own width, so the axis type stays its real size.
  const [boxRef, W] = useBoxWidth(560);
  const H = 200;
  const PAD = { l: 40, r: 12, t: 22, b: 28 };
  const max = Math.max(1, ...rows.map((r) => r.value));
  const stepFor = (m) => (m <= 5 ? 1 : m <= 10 ? 2 : m <= 25 ? 5 : m <= 50 ? 10 : m <= 100 ? 20 : m <= 250 ? 50 : 100);
  const step = stepFor(max);
  const top = Math.ceil(max / step) * step;
  const plotW = W - PAD.l - PAD.r;
  const band = plotW / rows.length;
  const barW = Math.min(24, Math.max(4, band - 6));
  const y = (v) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const base = y(0);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step).filter((v, i, a) => a.length <= 5 || i % 2 === 0 || i === a.length - 1);
  const peak = rows.reduce((b, r, i) => (b == null || r.value > rows[b].value ? i : b), null);
  // Every round's label while they fit, every other one when they would touch.
  const every = band < 26 ? 2 : 1;
  // Square at the baseline, 4px round at the data end.
  const column = (x, v) => {
    const cap = y(v);
    const r = Math.min(4, (base - cap) / 2, barW / 2);
    if (base - cap < 0.5) return "";
    return `M${x} ${base} V${cap + r} Q${x} ${cap} ${x + r} ${cap} H${x + barW - r} Q${x + barW} ${cap} ${x + barW} ${cap + r} V${base} Z`;
  };
  const a = active != null ? rows[active] : null;
  const ax = a ? PAD.l + band * active + band / 2 : 0;

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">{title}</div>
        <span className="font-mono text-[11px] text-light">{sub}</span>
      </div>
      <div ref={boxRef} className="relative mt-3" onPointerLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={`${title}, ${sub}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth="1" />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="fill-faint font-mono text-[10px] font-bold">
                {t}
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const x = PAD.l + band * i + (band - barW) / 2;
            return (
              <g key={r.round}>
                <path d={column(x, r.value)} className={`text-brand transition-opacity ${active != null && active !== i ? "opacity-60" : ""}`} fill="currentColor" />
                {i % every === 0 && (
                  <text x={x + barW / 2} y={H - 9} textAnchor="middle" className="fill-light font-mono text-[10px] font-bold">
                    R{r.round}
                  </text>
                )}
                {i === peak && (
                  <text x={x + barW / 2} y={y(r.value) - 7} textAnchor="middle" className="fill-dark font-mono text-[11px] font-bold">
                    {r.value}
                  </text>
                )}
                <rect
                  x={PAD.l + band * i}
                  y={PAD.t - 10}
                  width={band}
                  height={H - PAD.t - PAD.b + 10}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={`Round ${r.round}, ${prettyTrack(r.track)}: ${r.value} ${unit}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="outline-none"
                />
              </g>
            );
          })}
        </svg>
        {a && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-card px-3 py-2 shadow-lg"
            style={{ left: `${(ax / W) * 100}%`, top: `calc(${(y(a.value) / H) * 100}% - 8px)` }}
          >
            <div className="font-mono text-sm font-bold tabular-nums text-dark">
              {a.value} <span className="font-normal text-light">{unit}</span>
            </div>
            <div className="text-[11px] text-light">
              R{a.round} · {prettyTrack(a.track)}
            </div>
          </div>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-semibold text-light transition hover:text-dark">As a table</summary>
        <table className="mt-2 w-full text-left text-sm">
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.round}>
                <td className="py-1.5 pr-3 font-mono tabular-nums text-medium">R{r.round}</td>
                <td className="py-1.5 pr-3 text-dark">{prettyTrack(r.track)}</td>
                <td className="py-1.5 text-right font-mono font-bold tabular-nums text-dark">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
