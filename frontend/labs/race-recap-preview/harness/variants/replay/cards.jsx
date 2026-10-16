// The broadcast graphics below the replay: the performance breakdown, the
// championship tower, the season curve, the tokens ledger, the team-mate
// split, the honours lower-thirds and the final classification.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, Timer, Flag as FlagIcon, TrendingUp, Star, Activity } from "lucide-react";
import { motionOff } from "@site/hooks/motion.js";
import { DriverAvatar } from "@site/components/ui.jsx";
import { buildRaceFacts } from "@site/components/RaceFacts.jsx";
import Flag from "@site/components/Flag.jsx";
import TeamLogo from "@site/components/TeamLogo.jsx";
import TokenIcon from "@site/components/TokenIcon.jsx";
import { countryFor } from "@site/data/driverCountries.js";
import { fmtLap, fmtLapDelta, NO_VALUE } from "@site/utils/format.js";
import { fmtDuration, fmtGap } from "@site/utils/raceDuration.js";
import { Card, Label, Delta, Tween, Ticker, Bar, useRevealed } from "./parts.jsx";
import { rgba } from "./RaceReplay.jsx";
import { useSpringRows, sineInOutInverse } from "./spring.js";
import { useCmp } from "./cmp.jsx";

const teamOf = (row) => row?.effectiveTeam || row?.team || null;

// --- performance breakdown --------------------------------------------------------

const RATING_PARTS = [
  { key: "exp", label: "Experience" },
  { key: "rac", label: "Racecraft" },
  { key: "aha", label: "Awareness" },
  { key: "pac", label: "Pace" },
];

// The rating as a broadcast breakdown: the overall number ticks from last
// round's, and each part is a segmented bar holding last round's length in
// the brand colour with this round's change grown on in green (or given back
// in red), a cursor riding the new mark.
export function RatingBreakdown({ rating: r, card }) {
  const was = r.before?.overall;
  return (
    <Card>
      <div className="grid gap-6 lg:grid-cols-[minmax(15rem,auto),1fr] lg:items-center lg:gap-14">
        <div>
          <Label>Driver rating</Label>
          <div className="mt-2 flex items-end gap-4">
            <span className="font-display text-[4.5rem] font-black leading-none tracking-tighter text-dark sm:text-[6rem]">
              <Tween from={was} to={r.after.overall} />
            </span>
            {r.delta && (
              <div className="recap-tag mb-2 sm:mb-3">
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 ${r.delta.overall > 0.05 ? "border-ok/40 bg-ok/10" : r.delta.overall < -0.05 ? "border-bad/40 bg-bad/10" : "border-border"}`}>
                  <Delta value={r.delta.overall} className="text-sm" arrow />
                </span>
                {was != null && <div className="mt-1.5 font-mono text-[11px] text-light">was {Math.round(was)}</div>}
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-light">
            {r.rank != null && r.fieldSize != null && (
              <>
                <span className="rounded-md border border-border px-2 py-0.5 font-bold text-dark">#{r.rank}</span>
                <span>live form rank of {r.fieldSize}</span>
              </>
            )}
          </div>
          {card && <div className="mt-2 font-mono text-[11px] text-faint">Your card stays at {Math.round(card.rating.ratings.overall)} this season.</div>}
          {r.provisional && <div className="mt-1 font-mono text-[11px] text-faint">Still provisional: a few more starts and it settles.</div>}
        </div>
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
            <Label tone="text-light">Performance breakdown</Label>
            <span className="flex items-center gap-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-faint">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm bg-brand" />
                before
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm bg-ok" />
                this round
              </span>
            </span>
          </div>
          <div className="divide-y divide-border/60">
            {RATING_PARTS.map((p, i) => {
              const v = r.after[p.key];
              const b = r.before?.[p.key];
              const d = r.delta ? r.delta[p.key] : null;
              if (v == null) return null;
              const base = Math.max(0, Math.min(100, b ?? v));
              const lo = Math.min(base, v);
              const change = Math.abs(v - base);
              const gained = v >= base;
              return (
                <div key={p.key} className="grid grid-cols-[1fr,auto] items-center gap-x-3 gap-y-2 py-3 sm:grid-cols-[7rem,1fr,6.5rem] sm:gap-5">
                  <span className="font-display text-sm font-black uppercase tracking-tight text-medium">{p.label}</span>
                  <div className="relative order-last col-span-2 h-3 w-full rounded-[3px] bg-surface2 sm:order-none sm:col-span-1">
                    <div className="bar-fill absolute left-0 top-0 h-3 rounded-l-[3px] bg-brand" style={{ "--w": `${Math.max(2, lo)}%`, "--bar-delay": `${i * 110}ms` }} />
                    {change >= 0.05 && (
                      <div
                        className={`bar-fill absolute top-0 h-3 ${gained ? "" : "rr-from-right"}`}
                        style={{ ...(gained ? { left: `${base}%` } : { right: `${100 - base}%` }), "--w": `${Math.max(0.6, change)}%`, background: gained ? "rgb(var(--c-ok))" : "rgb(var(--c-bad))", "--bar-delay": `${900 + i * 110}ms` }}
                      />
                    )}
                    <div className="rr-segments pointer-events-none absolute inset-0" aria-hidden="true" />
                    <div className="rr-cursor pointer-events-none absolute inset-0" style={{ "--w": `${v}%`, "--bar-delay": `${i * 110}ms` }} aria-hidden="true">
                      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-dark" />
                    </div>
                  </div>
                  <span className="flex items-baseline justify-end gap-2">
                    {d != null && Math.abs(d) >= 0.05 && (
                      <span className="recap-tag" style={{ "--tag-delay": `${1300 + i * 120}ms` }}>
                        <Delta value={d} className="text-[11px]" />
                      </span>
                    )}
                    <span className="font-mono text-xl font-bold tabular-nums leading-none text-dark">
                      <Tween from={b} to={v} decimals={0} />
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

// --- the championship tower ------------------------------------------------------

// The table around you, as it stood before the round, reshuffling into how
// it stands now: the rows glide to their new places on springs, the totals
// count on by what the round paid, the gaps close or open.
export function StandingsTower({ standings: s, team, season, you }) {
  const [ref, on] = useRevealed();
  const [after, setAfter] = useState(() => motionOff());
  useEffect(() => {
    if (!on || after) return undefined;
    const id = setTimeout(() => setAfter(true), 1100);
    return () => clearTimeout(id);
  }, [on, after]);
  const rows = (s.window || []).slice().sort((a, b) => a.position - b.position);
  const beforeOrder = rows.slice().sort((a, b) => (a.prevPosition ?? a.position) - (b.prevPosition ?? b.position));
  const order = after ? rows : beforeOrder;
  const rh = 42;
  const moved = s.before ? s.before.position - s.after.position : null;
  const node = useSpringRows(
    rows.map((r) => [r.driverId, order.indexOf(r) * rh]),
    { omega: 8.5, zeta: 0.86 }
  );
  return (
    <Card bodyClassName="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <Label>In the championship</Label>
        <span className="font-mono text-[11px] text-light">of {s.fieldSize} drivers</span>
      </div>
      <div className="mt-2 flex items-end gap-4">
        <div className="flex items-start font-display font-black leading-none tracking-tighter text-dark">
          <span className="mt-2 text-2xl text-light">P</span>
          <span className="text-6xl">
            <Tween from={s.before?.position} to={s.after.position} delay={1150} duration={900} />
          </span>
        </div>
        {moved != null && (
          <div className="recap-tag mb-1.5" style={{ "--tag-delay": "1500ms" }}>
            {s.before && s.before.position !== s.after.position && <span className="mr-2 font-mono text-[11px] text-light line-through">P{s.before.position}</span>}
            <Delta value={moved} suffix={` place${Math.abs(moved) === 1 ? "" : "s"}`} className="text-xs" arrow />
          </div>
        )}
      </div>
      {rows.length > 1 && (
        <ol ref={ref} className="relative mt-4" style={{ height: rows.length * rh }} aria-label="The championship around you">
          {rows.map((r) => {
            const slot = order.indexOf(r);
            const me = r.driverId === you?.driverId;
            const color = r.team?.color || "#64748b";
            const pos = after ? r.position : r.prevPosition ?? r.position;
            const totalBefore = r.total - (r.roundPoints || 0);
            return (
              <li key={r.driverId} ref={node(r.driverId)} className="rr-trow-move absolute inset-x-0 top-0 bg-card" style={{ height: rh, zIndex: me ? 2 : 1, "--i": slot }}>
                <div
                  className={`flex h-[calc(100%-6px)] items-center gap-3 rounded-lg pr-3 ${me ? "" : "bg-surface2/60"}`}
                  style={me ? { background: rgba(color, 0.14), boxShadow: `inset 0 0 0 1px ${rgba(color, 0.55)}` } : undefined}
                >
                  <span className="flex h-full w-9 shrink-0 items-center justify-center rounded-l-lg font-mono text-sm font-black tabular-nums" style={me ? { background: color, color: "var(--recap-ink)" } : undefined}>
                    <span key={pos} className="rr-tick">{pos}</span>
                  </span>
                  <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
                  <span className={`min-w-0 flex-1 truncate font-display text-sm font-black uppercase tracking-tight ${me ? "text-dark" : "text-medium"}`}>{r.name}</span>
                  {r.roundPoints > 0 && (
                    <span className={`rr-chip-pop shrink-0 rounded px-1.5 font-mono text-[10px] font-bold tabular-nums ${after ? "is-on" : ""} ${me ? "bg-ok/15 text-ok" : "text-light"}`}>+{r.roundPoints}</span>
                  )}
                  <span className="w-10 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-dark">
                    <Tween from={totalBefore} to={r.total} delay={1150} duration={1300} lock={false} />
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-auto divide-y divide-border border-t border-border pt-1">
        {s.isLeader
          ? s.behind && (
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <Label tone="text-light">Lead over {s.behind.name}</Label>
                <span className="font-mono text-sm font-bold tabular-nums text-ok">
                  <Tween from={s.behindGapBefore} to={s.behind.gap} prefix="+" suffix=" pts" delay={1150} />
                </span>
              </div>
            )
          : s.ahead && (
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <Label tone="text-light">To {s.ahead.name} ahead</Label>
                <span className="font-mono text-sm font-bold tabular-nums text-dark">
                  <Tween from={s.aheadGapBefore} to={s.ahead.gap} prefix="−" suffix=" pts" delay={1150} />
                  {s.aheadGapBefore != null && s.aheadGapBefore !== s.ahead.gap && (
                    <span className="recap-tag ml-2 inline-block text-xs font-semibold text-light" style={{ "--tag-delay": "2000ms" }}>
                      was −{s.aheadGapBefore}
                    </span>
                  )}
                </span>
              </div>
            )}
        {s.leader && !s.isLeader && s.ahead?.name !== s.leader.name && (
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <Label tone="text-light">To {s.leader.name} (P1)</Label>
            <span className="font-mono text-sm font-bold tabular-nums text-dark">−{s.leader.total - s.after.total} pts</span>
          </div>
        )}
        {season?.bestFinish && (
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <Label tone="text-light">Best finish so far</Label>
            <span className="font-mono text-sm font-bold tabular-nums text-dark">
              P{season.bestFinish.position} · {season.bestFinish.track}
            </span>
          </div>
        )}
        {team?.after && (
          <div className="flex items-center justify-between gap-4 py-2.5">
            <span className="flex min-w-0 items-center gap-2">
              <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={14} />
              <Label tone="text-light">{team.name} · constructors</Label>
            </span>
            <span className="font-mono text-sm font-bold tabular-nums text-dark">
              P<Tween from={team.before?.position} to={team.after.position} delay={1300} duration={500} />
              {team.before && team.before.position !== team.after.position && (
                <span className="recap-tag ml-2 inline-block" style={{ "--tag-delay": "1800ms" }}>
                  <Delta value={team.before.position - team.after.position} className="text-xs" arrow />
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

// --- the season curve -------------------------------------------------------------

// Cumulative points, round by round, uncovered left to right by a curtain
// with a feathered edge that eases in and out; each round's mark settles in
// as the edge reaches it, with what that round paid above it.
function useNarrow() {
  const q = "(max-width: 639px)";
  const get = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(q).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(q);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, []);
  return narrow;
}

export function SeasonCurve({ season }) {
  const narrow = useNarrow();
  const rounds = season.rounds;
  const run = rounds.filter((r) => r.run);
  if (!run.length) return null;
  // A phone gets its own drawing size, so the labels stay readable.
  const W = narrow ? 360 : 720;
  const H = narrow ? 240 : 336;
  const PAD = narrow ? { l: 28, r: 14, t: 30, b: 28 } : { l: 36, r: 28, t: 34, b: 34 };
  let cum = 0;
  const pts = run.map((r) => ({ ...r, cum: (cum += r.points || 0) }));
  const maxY = Math.max(10, ...pts.map((p) => p.cum));
  const step = maxY <= 40 ? 10 : maxY <= 100 ? 25 : maxY <= 200 ? 50 : 100;
  const yMax = Math.ceil(maxY / step) * step;
  const x = (num) => PAD.l + ((num - 1) / Math.max(1, rounds.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.number).toFixed(1)} ${y(p.cum).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts[pts.length - 1].number).toFixed(1)} ${y(0).toFixed(1)} L${x(pts[0].number).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const last = pts[pts.length - 1];
  const gridY = Array.from({ length: yMax / step + 1 }, (_, i) => i * step).filter((v, i, a) => a.length <= 6 || i % 2 === 0);
  const kept = season.dropWorst > 0 ? `best ${rounds.length - season.dropWorst} of ${rounds.length} count` : null;
  const DRAW = 2000;
  // The curtain runs on an ease-in-out sine; each mark lands when the edge
  // actually reaches it.
  const at = (num) => Math.round(sineInOutInverse((x(num) - PAD.l) / (W - PAD.l)) * DRAW);
  return (
    <Card bodyClassName="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>Your championship points, round by round</Label>
        <span className="font-mono text-[11px] text-light">cumulative{kept ? ` · ${kept}` : ""}</span>
      </div>
      <div className="flex flex-1 flex-col justify-center">
      <div key={narrow ? "n" : "w"} className="relative mt-3 w-full overflow-hidden" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
          <path d={area} fill="var(--recap-team)" opacity="0.12" />
          <path d={line} fill="none" stroke="var(--recap-team)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <div className="rr-draw-curtain rr-feather absolute bottom-0 top-0 bg-card" style={{ left: `${(PAD.l / W) * 100}%`, width: `${((W - PAD.l) / W) * 100}%`, "--draw": `${DRAW}ms` }} aria-hidden="true" />
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Championship points round by round">
          {gridY.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth="1" strokeOpacity="0.7" />
              <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="fill-faint font-mono text-[10px] font-bold">
                {v}
              </text>
            </g>
          ))}
          {pts.map((p) => (
            <g key={p.number} className="rr-dot" style={{ "--d": `${at(p.number)}ms` }}>
              <circle cx={x(p.number)} cy={y(p.cum)} r={p.number === last.number ? 6 : 4} fill={p.status === "DNS" || p.dropped ? "var(--c-card)" : "var(--recap-team)"} stroke="var(--recap-team)" strokeWidth="2" />
              {p.number !== last.number && (
                <text x={x(p.number)} y={y(p.cum) - 10} textAnchor="middle" className="rr-halo-text fill-light font-mono text-[10px] font-bold">
                  {p.status === "DNS" ? "DNS" : p.dropped ? "dropped" : `+${p.points || 0}`}
                </text>
              )}
            </g>
          ))}
          <g className="rr-dot" style={{ "--d": `${at(last.number) + 120}ms` }}>
            <text x={x(last.number)} y={y(last.cum) - 14} textAnchor="middle" className="rr-halo-text fill-dark font-display text-[16px] font-black">
              {last.cum}
            </text>
          </g>
          {rounds.map((r) => (
            <text key={r.number} x={x(r.number)} y={H - 10} textAnchor="middle" className={`font-mono ${narrow ? "text-[9px]" : "text-[10px]"} font-bold ${r.run ? (r.number === last.number ? "fill-eyebrow" : "fill-light") : "fill-faint"}`}>
              R{r.number}
            </text>
          ))}
        </svg>
      </div>
      </div>
      <p className="mt-3 border-t border-border pt-3 font-mono text-[11px] leading-relaxed text-light">
        +{last.points || 0} this round · {last.cum} after {run.length} of {rounds.length} rounds. Hollow marks did not count.
      </p>
    </Card>
  );
}

// --- the tokens ---------------------------------------------------------------------

// What the round paid, counted into the balance: the earned number, the
// ledger (before, plus, balance) with the tokens gliding along the rail into
// it, then the road to the next card design, with what the stewards still owe
// drawn as a dashed piece on the end.
export function TokensCard({ points: p }) {
  const before = p.balance != null ? p.balance - (p.hypothetical ? 0 : p.earned) : null;
  const owed = Array.isArray(p.pending) ? p.pending : p.pending ? [p.pending] : [];
  const owedSum = owed.reduce((n, e) => n + (e.delta || 0), 0);
  const next = p.nextCard;
  const pct = next && p.balance != null ? Math.max(0, Math.min(100, (p.balance / next.cost) * 100)) : null;
  const owedPct = next && pct != null ? Math.max(0, Math.min(100 - pct, (owedSum / next.cost) * 100)) : 0;
  return (
    <Card>
      <div className="grid gap-6 lg:grid-cols-[1fr,1.25fr] lg:gap-14">
        <div>
          <Label>{p.hypothetical ? "NABS Tokens this round would pay" : "NABS Tokens earned"}</Label>
          <div className="mt-2 flex items-end gap-3">
            <TokenIcon className="champ-chip mb-2 h-11 w-11 sm:mb-3 sm:h-14 sm:w-14" />
            <span className="font-display text-[4.5rem] font-black leading-none tracking-tighter text-accent sm:text-[5.5rem]">
              <Tween to={p.earned} prefix="+" delay={500} />
            </span>
            <span className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light sm:mb-4">this round</span>
          </div>
          <div className="recap-cascade mt-3 flex flex-wrap gap-2">
            {p.entries.map((e, i) => (
              <span key={i} className="rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-medium" style={{ "--i": i + 6 }}>
                {e.title} <span className="font-bold text-dark">+{e.delta}</span>
                {e.race && <span className="text-light"> · {e.race.toLowerCase()}</span>}
              </span>
            ))}
            {owed.map((e, i) => (
              <span key={`p${i}`} className="rounded-md border border-dashed border-border px-2.5 py-1 font-mono text-[11px] text-light" style={{ "--i": p.entries.length + i + 6 }}>
                {e.title} <span className="font-bold">+{e.delta}</span>
                {e.race && <span> · {e.race.toLowerCase()}</span>} · after the stewards
              </span>
            ))}
          </div>
          {p.rate > 1 && !p.hypothetical && <p className="mt-3 font-mono text-[11px] text-light">Paid at ×{p.rate.toFixed(2)}: your Discord week counted.</p>}
          {p.hypothetical && <p className="mt-3 font-mono text-[11px] text-light">Preview: nothing has been paid for this round yet. This is what the rules pay a finish like this.</p>}
        </div>
        {p.balance != null && (
          <div className="flex flex-col justify-center">
            <div className="grid grid-cols-[1fr,auto,1fr] items-end gap-3 rounded-xl border border-border bg-surface2/50 p-3 sm:p-4">
              <div>
                <Label tone="text-light">Before</Label>
                <div className="mt-1 font-mono text-xl font-bold tabular-nums text-light sm:text-2xl">{before?.toLocaleString("en-US")}</div>
              </div>
              <div className="pb-1 text-center font-mono text-sm font-bold text-accent">+{p.hypothetical ? 0 : p.earned}</div>
              <div className="text-right">
                <Label tone="text-light">Season total</Label>
                <div className="mt-1 flex items-center justify-end gap-2 font-display text-2xl font-black tabular-nums text-dark sm:text-3xl">
                  <TokenIcon className="h-5 w-5" />
                  <Tween from={before} to={p.balance} delay={1500} duration={1600} />
                </div>
              </div>
              {/* the rail the tokens run along into the balance */}
              <div className="relative col-span-3 h-3" aria-hidden="true">
                <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rr-fly absolute inset-0" style={{ "--i": i }}>
                    <TokenIcon className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2" />
                  </div>
                ))}
              </div>
            </div>
            {next && (
              <div className="mt-5">
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <Label tone="text-light">Next card design</Label>
                    <div className="mt-1 truncate font-display text-lg font-black uppercase leading-tight tracking-tight text-dark">{next.name}</div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-sm font-bold tabular-nums text-dark">
                    {p.balance >= next.cost ? "Unlocked" : `${(next.cost - p.balance).toLocaleString("en-US")} to go`}
                    <span className="ml-1.5 font-normal text-light">of {next.cost.toLocaleString("en-US")}</span>
                  </div>
                </div>
                <Bar pct={pct} h="h-2.5" fill="bg-brand" delay={1500} cursor={false}>
                  {owedPct > 0 && (
                    <div
                      className="recap-tag absolute top-0 h-full rounded-r-full"
                      style={{ left: `${pct}%`, width: `${owedPct}%`, background: "rgb(var(--c-brand) / 0.3)", "--tag-delay": "2700ms" }}
                    />
                  )}
                </Bar>
                {owedSum > 0 && (
                  <div className="recap-tag mt-2 flex items-center gap-2 font-mono text-[11px] text-light" style={{ "--tag-delay": "2800ms" }}>
                    <span className="h-2 w-3 rounded-sm" style={{ background: "rgb(var(--c-brand) / 0.3)" }} aria-hidden="true" />
                    +{owedSum} more after the stewards
                  </div>
                )}
              </div>
            )}
            {(p.sample?.balance || p.sample?.nextCard) && (
              <p className="mt-4 font-mono text-[11px] text-faint">Sample values in this preview. Each member&rsquo;s real balance is private.</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// --- the team-mate split ---------------------------------------------------------------

// The two of you, in two parts. On the left this race: your numbers against
// theirs, with bars growing out from the middle where a number can be
// measured. On the right the season: the duel in races and on the grid, and
// where the two of you stand in the championship. On a phone the season part
// sits under the race.
export function TeammateSplit({ you, mates, standings, card, field }) {
  const m = mates[0];
  const color = you.team?.color || "#94a3b8";
  const posScore = (p) => (p == null || !field ? null : ((field - p + 1) / field) * 100);
  const better = (a, b, lowerWins = true) => (a == null || b == null || a === b ? 0 : (lowerWins ? a < b : a > b) ? 1 : -1);
  const myPts = standings?.after?.total ?? null;
  const myChamp = standings?.after?.position ?? null;
  const maxPts = Math.max(1, myPts || 0, m.seasonPoints || 0);
  const lapWin = better(you.bestLapMs, m.bestLapMs);
  const lapGap = lapWin !== 0 && you.bestLapMs && m.bestLapMs ? `${(Math.abs(you.bestLapMs - m.bestLapMs) / 1000).toFixed(3)} s faster` : null;
  const rows = [
    { label: "Race", a: you.finished ? `P${you.position}` : you.status, b: m.position != null ? `P${m.position}` : m.status, win: better(you.finished ? you.position : null, m.position), sa: posScore(you.finished ? you.position : null), sb: posScore(m.position) },
    { label: "Grid", a: you.grid != null ? `P${you.grid}` : NO_VALUE, b: m.grid != null ? `P${m.grid}` : NO_VALUE, win: better(you.grid, m.grid), sa: posScore(you.grid), sb: posScore(m.grid) },
    { label: "Best lap", a: fmtLap(you.bestLapMs) || NO_VALUE, b: fmtLap(m.bestLapMs) || NO_VALUE, win: lapWin, note: lapGap },
    { label: "Season points", a: myPts ?? NO_VALUE, b: m.seasonPoints ?? NO_VALUE, win: better(myPts, m.seasonPoints, false), sa: myPts != null ? (myPts / maxPts) * 100 : null, sb: m.seasonPoints != null ? (m.seasonPoints / maxPts) * 100 : null },
  ];
  const tone = (w) => (w > 0 ? "text-ok" : w < 0 ? "text-light" : "text-dark");
  const narrow = useNarrow();
  const av = narrow ? 32 : 48;
  const duel = m.duel && (m.duel.raceWins + m.duel.raceLosses > 0 || m.duel.qualiWins + m.duel.qualiLosses > 0) ? m.duel : null;
  const duels = duel
    ? [
        { k: "races", label: "Races", w: duel.raceWins, l: duel.raceLosses },
        { k: "grid", label: "Grid", w: duel.qualiWins, l: duel.qualiLosses },
      ].filter((d) => d.w + d.l > 0)
    : [];
  const table = [
    { label: "Championship", a: myChamp != null ? `P${myChamp}` : null, b: m.seasonPosition != null ? `P${m.seasonPosition}` : null, win: better(myChamp, m.seasonPosition) },
    { label: "Points", a: myPts, b: m.seasonPoints, win: better(myPts, m.seasonPoints, false) },
  ].filter((r) => r.a != null && r.b != null);
  const season = duels.length > 0 || table.length > 0;
  return (
    <Card className="!p-0">
      <div className={season ? "grid lg:grid-cols-[1.55fr,1fr]" : ""}>
        {/* This race */}
        <div className="min-w-0 px-4 pb-4 pt-5 sm:px-8 sm:pb-7 sm:pt-6">
          <div className="grid grid-cols-2 gap-3 pb-3 sm:gap-4">
            <div className="rr-split-l flex min-w-0 items-center gap-2 sm:gap-3">
              <DriverAvatar name={you.name} photoUrl={card?.driver?.photoUrl || null} color={color} size={av} />
              <div className="min-w-0">
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">You</div>
                <div className="truncate font-display text-[15px] font-black uppercase leading-tight tracking-tight text-dark min-[400px]:text-base sm:text-xl">{you.name}</div>
              </div>
            </div>
            <Link to={`/drivers/${m.driverId}`} className="rr-split-r flex min-w-0 flex-row-reverse items-center gap-2 text-right transition hover:text-brand sm:gap-3">
              <DriverAvatar name={m.name} photoUrl={m.photoUrl} color={color} size={av} />
              <div className="min-w-0">
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">Team-mate</div>
                <div className="truncate font-display text-[15px] font-black uppercase leading-tight tracking-tight text-dark min-[400px]:text-base sm:text-xl">{m.name}</div>
              </div>
            </Link>
          </div>
          {rows.map((r, i) => (
            <div key={r.label} className="grid grid-cols-[minmax(0,5.5rem),1fr,minmax(0,5.5rem)] items-center gap-3 border-t border-border py-3 sm:grid-cols-[minmax(0,7.5rem),1fr,minmax(0,7.5rem)] sm:gap-4">
              <span className={`truncate font-mono text-base font-bold tabular-nums sm:text-lg ${tone(r.win)}`}>{r.a}</span>
              <div className="grid min-w-0 gap-1.5">
                <Label tone="text-light" className="text-center">
                  {r.label}
                </Label>
                {r.sa != null || r.sb != null ? (
                  <div className="grid grid-cols-2 gap-1">
                    <div className="relative h-1.5 rounded-l-full bg-surface2">
                      {r.sa != null && <div className="bar-fill rr-from-right absolute right-0 top-0 h-full rounded-l-full" style={{ "--w": `${Math.max(3, r.sa)}%`, background: r.win >= 0 ? color : "var(--c-text3)", "--bar-delay": `${i * 120}ms` }} />}
                    </div>
                    <div className="relative h-1.5 rounded-r-full bg-surface2">
                      {r.sb != null && <div className="bar-fill absolute left-0 top-0 h-full rounded-r-full" style={{ "--w": `${Math.max(3, r.sb)}%`, background: r.win <= 0 ? rgba(color, 0.7) : "var(--c-text3)", "--bar-delay": `${i * 120}ms` }} />}
                    </div>
                  </div>
                ) : r.note ? (
                  <div className={`truncate font-mono text-[11px] font-bold text-ok ${r.win > 0 ? "text-left" : "text-right"}`}>
                    {r.note}
                  </div>
                ) : null}
              </div>
              <span className={`truncate text-right font-mono text-base font-bold tabular-nums sm:text-lg ${tone(-r.win)}`}>{r.b}</span>
            </div>
          ))}
        </div>

        {/* The season */}
        {season && (
          <div className="grid min-w-0 content-start gap-5 border-t border-border bg-surface2/50 px-4 pb-5 pt-5 sm:px-8 sm:pb-7 sm:pt-6 lg:border-l lg:border-t-0">
            <Label>Season duel{you.team?.name ? ` · ${you.team.name}` : ""}</Label>
            <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">
              <span className="truncate">{you.name}</span>
              <span className="truncate text-right">{m.name}</span>
            </div>
            {duels.map((d, j) => (
              <div key={d.k} className="grid grid-cols-[auto,1fr,auto] items-center gap-4">
                <Label tone="text-light" className="col-span-3">
                  {d.label}
                </Label>
                <span className={`font-display text-4xl font-black leading-none tabular-nums ${d.w > d.l ? "text-ok" : d.w < d.l ? "text-light" : "text-dark"}`}>{d.w}</span>
                <div className="flex items-center gap-1" aria-label={`${d.label}: ${d.w} to ${d.l}`}>
                  {Array.from({ length: d.w + d.l }, (_, i) => (
                    <span key={i} className="rr-pip h-2.5 flex-1 rounded-[2px]" style={{ background: i < d.w ? color : "var(--c-border)", "--i": i + j * 8 }} />
                  ))}
                </div>
                <span className={`text-right font-display text-4xl font-black leading-none tabular-nums ${d.l > d.w ? "text-ok" : d.l < d.w ? "text-light" : "text-dark"}`}>{d.l}</span>
              </div>
            ))}
            {table.length > 0 && (
              <div className="border-t border-border">
                {table.map((r) => (
                  <div key={r.label} className="grid grid-cols-[1fr,auto,auto] items-baseline gap-5 border-b border-border py-2.5">
                    <Label tone="text-light">{r.label}</Label>
                    <span className={`min-w-[4ch] text-right font-mono text-base font-bold tabular-nums ${tone(r.win)}`}>{r.a}</span>
                    <span className={`min-w-[4ch] text-right font-mono text-base font-bold tabular-nums ${tone(-r.win)}`}>{r.b}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {mates.length > 1 && <p className="border-t border-border px-4 py-3 font-mono text-[11px] text-light sm:px-8">Also in your colours: {mates.slice(1).map((x) => `${x.name} (${x.position != null ? `P${x.position}` : x.status})`).join(", ")}.</p>}
    </Card>
  );
}

// --- the honours ----------------------------------------------------------------------

const HONOUR_LOOK = {
  winner: { icon: Crown, bg: "var(--medal-1)", ink: "#111827" },
  fl: { icon: Timer, bg: "rgb(var(--c-fl))", ink: "#111827" },
  pole: { icon: FlagIcon, bg: "var(--c-text)", ink: "#111827" },
  climb: { icon: TrendingUp, bg: "rgb(var(--c-ok))", ink: "#111827" },
  dotd: { icon: Star, bg: "rgb(var(--c-brand))", ink: "var(--c-on-brand)" },
  steady: { icon: Activity, bg: "var(--c-text3)", ink: "#111827" },
};

// The night's honours as lower-thirds: a colour block with its mark, the
// name and flag, the number under it. Yours carry your colour on the edge.
// They rise in one after another; each block draws out and its mark rises.
export function HonoursBadges({ race, results, quali, sprint = false, youId }) {
  const { facts, dotd, dotdRow, hasDotd } = buildRaceFacts(race, results, quali);
  const winner = results.filter((r) => r.status === "FINISHED" && r.position != null).sort((a, b) => a.position - b.position)[0] || null;
  const by = (key) => facts.find((f) => f.key === key) || null;
  const cells = [
    winner ? { key: "winner", label: sprint ? "Sprint winner" : "Race winner", name: winner.name, driverId: winner.driverId, country: countryFor(winner.driverId, winner.country), value: [teamOf(winner)?.name, winner.totalTimeMs ? fmtDuration(winner.totalTimeMs + (winner.penaltySeconds || 0) * 1000) : null].filter(Boolean).join(" · ") } : null,
    by("fl") ? { ...by("fl"), label: "Fastest lap" } : null,
    by("pole") ? { ...by("pole"), label: "Pole position" } : null,
    by("climb") ? { ...by("climb"), label: "Biggest climber" } : null,
    hasDotd ? { key: "dotd", label: dotd.pickedBy ? `${dotd.pickedBy}’s Driver of the Day` : "Driver of the Day", name: dotd.name || dotdRow?.name, driverId: dotdRow?.driverId || null, country: dotdRow ? countryFor(dotdRow.driverId, dotdRow.country) : null, value: dotdRow ? `P${dotdRow.position} · ${teamOf(dotdRow)?.name || ""}` : null } : null,
    by("steady") ? { ...by("steady"), label: "Most consistent" } : null,
  ]
    .filter(Boolean)
    .slice(0, 4);
  if (!cells.length) return null;
  return (
    <div className="recap-reveal">
      <div className="recap-cascade grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        {cells.map((c, i) => {
          const look = HONOUR_LOOK[c.key] || HONOUR_LOOK.steady;
          const Icon = look.icon;
          const mine = c.driverId && c.driverId === youId;
          return (
            <div key={c.key} className="rr-honour card flex items-stretch overflow-hidden !p-0" style={{ "--i": i, ...(mine ? { boxShadow: "inset 3px 0 0 var(--recap-team), inset 0 1px 0 var(--p-edge, transparent), var(--p-drop, var(--c-shadow))" } : null) }}>
              <span className="rr-honour-block flex w-12 shrink-0 items-center justify-center" style={{ background: look.bg, color: look.ink }}>
                <Icon className="rr-honour-icon h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 px-3.5 py-3">
                <div className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">{c.label}</div>
                <div className="mt-0.5 flex items-center gap-2">
                  {c.driverId ? (
                    <Link to={`/drivers/${c.driverId}`} className="truncate font-display text-lg font-black uppercase leading-tight tracking-tight text-dark transition hover:text-brand">
                      {c.name}
                    </Link>
                  ) : (
                    <span className="truncate font-display text-lg font-black uppercase leading-tight tracking-tight text-dark">{c.name}</span>
                  )}
                  {c.country && <Flag code={c.country} w={16} h={12} />}
                  {mine && <span className="rounded px-1 font-mono text-[9px] font-black uppercase" style={{ background: "var(--recap-team)", color: "var(--recap-ink)" }}>you</span>}
                </div>
                {c.value && <div className={`mt-0.5 truncate font-mono text-[11px] ${c.key === "fl" ? "text-fl" : "text-light"}`}>{c.value}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- the final classification ----------------------------------------------------------

// The ending: the classification as the timing screen shows it after the flag
// (the top ten, and you pinned below when you are further back), and beside it
// the night in five numbers and the way out of the page.
export function Finale({ recap, shown, actions }) {
  const { results, you, race } = shown;
  const { rating, standings, points, weekend } = recap;
  const c = useCmp();
  const tiered = c.tier !== "all";
  // One tier picked: the classification of that tier's cars, numbered among
  // themselves, the time column the gap to the first of them.
  const classified = results.filter((r) => r.status !== "DNS" && (!tiered || c.keep(r))).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const placeOf = (r) => (tiered ? 1 + classified.filter((x) => x.status === "FINISHED" && x.position != null && x.position < r.position).length : r.position);
  const finishedN = classified.filter((r) => r.status === "FINISHED").length;
  const adj = (r) => (r?.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);
  const win = classified[0];
  const gap = (r) => {
    if (r.status && r.status !== "FINISHED") return r.status;
    if (r === win) return adj(r) ? fmtDuration(adj(r)) : "Winner";
    if (win?.laps != null && r.laps != null && r.laps < win.laps) return `+${win.laps - r.laps} lap${win.laps - r.laps > 1 ? "s" : ""}`;
    return adj(r) && adj(win) ? fmtGap(adj(r) - adj(win)) || NO_VALUE : NO_VALUE;
  };
  const top = classified.slice(0, 10);
  const mine = classified.find((r) => r.driverId === you?.driverId);
  const pinned = mine && !top.includes(mine) ? mine : null;
  const rowOf = (r, i) => {
    const me = r.driverId === you?.driverId;
    const color = teamOf(r)?.color || "#64748b";
    return (
      <li key={r.driverId} className="grid grid-cols-[2rem,1fr,auto,2.25rem] items-center gap-2 py-1.5 sm:grid-cols-[2.25rem,1fr,9rem,6.5rem,2.75rem] sm:gap-3 lg:grid-cols-[2.25rem,1fr,6.5rem,2.75rem] xl:grid-cols-[2.25rem,1fr,9rem,6.5rem,2.75rem]" style={{ "--i": Math.min(i, 12) }}>
        <span
          className={`flex h-7 items-center justify-center rounded-[5px] font-mono text-xs font-black tabular-nums ${me ? "" : r.position === 1 ? "bg-dark text-[var(--c-card)]" : "bg-surface2 text-medium"}`}
          style={me ? { background: color, color: "var(--recap-ink)" } : undefined}
        >
          {r.status === "FINISHED" ? placeOf(r) : NO_VALUE}
        </span>
        <span className={`flex h-7 min-w-0 items-center gap-2 rounded-[5px] pl-2 ${me ? "" : ""}`} style={me ? { background: rgba(color, 0.14), boxShadow: `inset 0 0 0 1px ${rgba(color, 0.5)}` } : undefined}>
          <span className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
          <span className={`truncate font-display text-[13px] font-black uppercase tracking-tight sm:text-sm ${me ? "text-dark" : "text-medium"}`}>{r.name}</span>
          {r.penaltySeconds > 0 && <span className="shrink-0 rounded bg-warn/15 px-1 font-mono text-[9px] font-bold text-warn">+{r.penaltySeconds}s</span>}
        </span>
        <span className="hidden truncate font-mono text-[11px] text-light sm:block lg:hidden xl:block">{teamOf(r)?.name}</span>
        <span className={`text-right font-mono text-[11px] font-bold tabular-nums ${r.status !== "FINISHED" ? "text-bad" : "text-medium"}`}>{gap(r)}</span>
        <span className={`text-right font-mono text-[11px] font-bold tabular-nums ${r.points > 0 ? "text-accent" : "text-faint"}`}>{r.points > 0 ? `+${r.points}` : "0"}</span>
      </li>
    );
  };
  const twoRaces = !!weekend?.isSprintWeekend;
  const stats = [
    you?.raced ? { k: "result", label: shown.half === "sprint" ? "Sprint" : twoRaces ? "Feature race" : "Result", value: you.finished ? `P${you.position}` : you.status, sub: you.finished && you.grid != null ? `from P${you.grid}` : null, tone: you.finished && you.position <= 3 ? "var(--medal-1)" : "var(--c-text)" } : null,
    you ? { k: "pts", label: twoRaces ? "Round total" : "Points", value: `+${twoRaces ? weekend.total : you.points || 0}`, sub: twoRaces ? `${weekend.sprint} + ${weekend.feature}` : "championship", tone: "rgb(var(--c-accent))" } : null,
    rating?.after ? { k: "rating", label: "Rating", value: String(Math.round(rating.after.overall)), sub: rating.delta ? `${rating.delta.overall >= 0 ? "▲ +" : "▼ −"}${Math.round(Math.abs(rating.delta.overall))}` : null, subTone: rating.delta?.overall >= 0 ? "text-ok" : "text-bad" } : null,
    standings?.after ? { k: "champ", label: "Championship", value: `P${standings.after.position}`, sub: standings.before && standings.before.position !== standings.after.position ? `was P${standings.before.position}` : `${standings.after.total} pts`, subTone: standings.before?.position > standings.after.position ? "text-ok" : "text-light" } : null,
    points && (points.entries.length || points.pending?.length) ? { k: "tok", label: "NABS Tokens", value: `+${points.earned}`, sub: points.balance != null ? (points.sample?.balance ? `${points.balance.toLocaleString("en-US")} total · sample` : `${points.balance.toLocaleString("en-US")} total`) : null, tone: "rgb(var(--c-accent))" } : null,
  ].filter(Boolean);
  return (
    <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1.35fr,1fr]">
      <Card className="!p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface2/70 px-4 py-2.5 sm:px-6">
          <span className="flex items-center gap-2">
            <span className="rr-chequer h-3 w-6 rounded-[2px]" aria-hidden="true" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">
              Final classification
              {tiered && (
                <span key={c.tier} className="rr-cmp-in ml-1.5 hidden text-light sm:inline-block">
                  · {c.label}
                </span>
              )}
            </span>
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">
            <span className="hidden sm:inline">{race.track} · </span>
            <span key={c.tier} className="rr-cmp-in inline-block whitespace-nowrap">
              {tiered ? (
                <>
                  {finishedN} <span className="sm:hidden">in {c.label}</span>
                  <span className="hidden sm:inline">classified</span>
                </>
              ) : (
                `${race.finishers ?? classified.length} classified`
              )}
            </span>
          </span>
        </div>
        <div className="px-4 py-3 sm:px-6 sm:py-4">
          <div className="grid grid-cols-[2rem,1fr,auto,2.25rem] gap-2 pb-1 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-faint sm:grid-cols-[2.25rem,1fr,9rem,6.5rem,2.75rem] sm:gap-3 lg:grid-cols-[2.25rem,1fr,6.5rem,2.75rem] xl:grid-cols-[2.25rem,1fr,9rem,6.5rem,2.75rem]">
            <span className="text-center">Pos</span>
            <span>Driver</span>
            <span className="hidden sm:block lg:hidden xl:block">Team</span>
            <span className="text-right">Time</span>
            <span className="text-right">Pts</span>
          </div>
          {/* Keyed on the field shown: a switch lets the new order rise in. */}
          <ol key={`top-${c.tier}`} className={`recap-cascade ${c.live ? "rr-cmp-roll" : ""}`}>{top.map(rowOf)}</ol>
          {pinned && (
            <>
              <div className="my-1 border-t border-dashed border-light/40" />
              <ol key={`pin-${c.tier}`} className={`recap-cascade ${c.live ? "rr-cmp-roll" : ""}`}>{rowOf(pinned, 11)}</ol>
            </>
          )}
          {tiered && (
            <p key={`n-${c.tier}`} className="rr-cmp-in mt-2.5 font-mono text-[10px] leading-snug text-faint">
              {c.youIn ? "" : "You're not in this tier. "}Places among the {c.label} cars only; the time is the gap to the first of them, the points are the race's.
            </p>
          )}
        </div>
      </Card>
      <Card bodyClassName="flex h-full flex-col">
        <Label>Your night in numbers</Label>
        <div className="rr-numbers mt-3 grid flex-1 grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
          {stats.map((s, i) => (
            <div key={s.k} className={`flex flex-col justify-center gap-2 bg-card p-3.5 sm:p-4 lg:px-6 ${stats.length % 2 === 1 && i === 0 ? "col-span-2" : ""}`}>
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-light">{s.label}</div>
              <div>
                <div className="font-display text-3xl font-black leading-none tabular-nums sm:text-4xl lg:text-[3.25rem]" style={{ color: s.tone || "var(--c-text)" }}>
                  <Ticker value={s.value} delay={250 + i * 140} />
                </div>
                {s.sub && <div className={`mt-1.5 font-mono text-[11px] font-bold ${s.subTone || "text-light"}`}>{s.sub}</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-auto pt-5">{actions}</div>
      </Card>
    </div>
  );
}

