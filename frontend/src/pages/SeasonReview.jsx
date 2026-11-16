// ---------------------------------------------------------------------------
// /s/<series>/drivers/<row>/review: one driver's season, told in chapters.
//
// The race recap tells one round from a driver's seat; this tells the season
// the same way and in the same hand: the recap's cards, chapter headers,
// timing-screen rows, hairlines and motion (recap/parts.jsx, recap/reveal.js,
// the recap's own stylesheets), the team colour as the one accent. A member
// who has just read a race recap should not be able to tell the two apart.
//
// What it leaves out on purpose, because every earlier "Wrapped" was turned
// down for looking machine-made: a colour per section, slides, confetti, 3D,
// count-ups on every number, labels like "The Charger", praise. Every number
// stands next to what it is measured against ("4th of 19", "of 8 starts",
// the team-mate), and every sentence is filled from the same object the
// tables are drawn from (review/copy.mjs).
//
// The data comes from the backend (services/seasonReviewService.js): public
// figures only, so the page is the same whoever opens it. A chapter whose
// data the season does not have is simply not there, and the numbering
// stays continuous.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { DriverAvatar, TierBadge, ErrorBox, PageHeaderSkeleton, CardsSkeleton, MEDAL, readableInkOn } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import CircuitMap from "../components/CircuitMap.jsx";
import { flagFor } from "../data/circuits.js";
import { fmtLap } from "../utils/format.js";
import { roundTone } from "../utils/roundTone.js";
import { Card, Label, Row, Chapter, Bar } from "./recap/parts.jsx";
import { useNarrow } from "./recap/cards.jsx";
import GridToFlag from "./recap/GridToFlag.jsx";
import { useRecapReveal, useCardDepth } from "./recap/reveal.js";
import { sineInOutInverse } from "./recap/spring.js";
import {
  rankText,
  roundName,
  resultLine,
  resultHeadline,
  journeyLine,
  neighbourLine,
  roundsLine,
  bestLine,
  climbLine,
  contactLine,
  duelLines,
  sourceLine,
} from "./review/copy.mjs";
import "./recap/replay.css";
import "./recap/polish.css";
import "./recap/g3.css";
import "./recap/desktop.css";

const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);

export default function SeasonReview() {
  const { id } = useParams();
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let gone = false;
    setReview(null);
    setError(null);
    api
      .driverSeasonReview(id)
      .then((r) => !gone && setReview(r.review))
      .catch((e) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [id]);

  useRecapReveal(review);
  const rootRef = useCardDepth(review);
  const seasonLabel = review?.season?.label || "Season";
  useSpecificTitle(review?.driver ? `${review.driver.name} · ${seasonLabel} ${review.season.complete ? "in review" : "so far"}` : "Season review");

  if (error) return <ErrorBox message={error === "Not available" ? "The season review is not open yet." : error} />;
  if (!review) {
    return (
      <div className="space-y-5">
        <PageHeaderSkeleton />
        <CardsSkeleton count={2} cols="lg:grid-cols-[1.75fr,1fr]" />
        <CardsSkeleton count={1} cols="" />
      </div>
    );
  }
  if (review.tooEarly || review.empty) {
    return (
      <div className="card p-6">
        <Label>{review.season?.label}</Label>
        <p className="mt-2 text-medium">
          {review.tooEarly ? "Not enough rounds yet. The review opens once two rounds are run." : `${review.driver?.name || "This driver"} did not start a race this season.`}
        </p>
      </div>
    );
  }

  const team = review.driver.team;
  const teamColor = team?.color || null;
  let chapterNo = 0;
  const ch = () => String((chapterNo += 1)).padStart(2, "0");
  const c = review.championship;
  const hasJourney = c.journey?.length >= 2;
  const mates = (review.teammates || []).filter((m) => m.races > 0 || m.starts > 0);
  const numbers = numbersOf(review);

  return (
    <div
      ref={rootRef}
      className="rr space-y-4 sm:space-y-5"
      style={{ "--recap-team": teamColor || "var(--c-text)", "--recap-ink": teamColor ? readableInkOn(teamColor) : "var(--c-card)" }}
    >
      <Header review={review} />

      <section className="space-y-4 sm:space-y-5">
        <Chapter n={ch()} title="Result" sub={review.season.complete ? "Where the season ended" : "Where the season stands"} />
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1.75fr,1fr]">
          <PositionCard review={review} />
          <PointsCard review={review} />
        </div>
      </section>

      <section className="space-y-4 sm:space-y-5">
        <Chapter n={ch()} title="Round by round" sub={`Every round ${review.season.complete ? "of the season" : "so far"}`} />
        <RoundsCard review={review} />
      </section>

      {(hasJourney || c.table?.length > 0) && (
        <section className="space-y-4 sm:space-y-5">
          <Chapter n={ch()} title="Championship" sub="The place after every round" />
          <div className={`grid gap-4 sm:gap-5 ${hasJourney ? "lg:grid-cols-[1.45fr,1fr]" : ""}`}>
            {hasJourney && <PlaceLine review={review} />}
            <TableCard review={review} />
          </div>
        </section>
      )}

      {review.best && (
        <section className="space-y-4 sm:space-y-5">
          <Chapter n={ch()} title="Best round" sub={`${review.best.sprint ? "Sprint, " : ""}Round ${review.best.round}, ${review.best.track}`} />
          <BestRound review={review} />
        </section>
      )}

      {numbers.length >= 3 && (
        <section className="space-y-4 sm:space-y-5">
          <Chapter n={ch()} title="Against the field" sub={`The season in numbers, ${c.fieldSize} drivers`} />
          <NumbersCard numbers={numbers} />
        </section>
      )}

      {review.contact && (
        <section className="space-y-4 sm:space-y-5">
          <Chapter n={ch()} title="Contact" sub="Race by race" />
          <ContactCard review={review} />
        </section>
      )}

      {mates.length > 0 && (
        <section className="space-y-4 sm:space-y-5">
          <Chapter n={ch()} title="Team" sub={team?.name ? `Inside ${team.name}` : "The team-mate"} />
          <div className={`grid gap-4 sm:gap-5 ${mates.length > 1 ? "lg:grid-cols-2" : ""}`}>
            {mates.map((m) => (
              <DuelCard key={m.driverId} mate={m} you={review.driver} />
            ))}
          </div>
        </section>
      )}

      {(review.honours?.length > 0 || review.awards?.length > 0) && (
        <section className="space-y-4 sm:space-y-5">
          <Chapter n={ch()} title="Honours" sub="What the season gave" />
          <Honours review={review} />
        </section>
      )}

      <Footer review={review} />
    </div>
  );
}

// --- the header -------------------------------------------------------------------

function Header({ review }) {
  const { season, driver, series } = review;
  const team = driver.team;
  const meta = [
    season.from && season.to ? `${fmtDay(season.from)} to ${fmtDay(season.to)}` : null,
    season.complete ? `${season.roundsRun} rounds` : `${season.roundsRun} of ${season.totalRounds} rounds run`,
    series?.name || null,
  ].filter(Boolean);
  return (
    <div className="recap-reveal rr-head-block border-b border-border pb-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <div className="rr-mask rr-hl rr-hl-1">
            <div className="rr-mask-in">
              <Label>{["Season review", driver.division === 2 ? "Division 2" : null, season.complete ? null : "so far"].filter(Boolean).join(" · ")}</Label>
            </div>
          </div>
          <div className="rr-mask rr-hl rr-hl-2 mt-2">
            <h1 className="rr-mask-in font-display text-[clamp(2.25rem,9vw,3.75rem)] font-black uppercase leading-none tracking-tight text-dark">{season.label}</h1>
          </div>
          <div className="rr-mask rr-hl rr-hl-3 mt-3">
            <div className="rr-mask-in text-sm text-medium">{meta.join(" · ")}</div>
          </div>
        </div>
        <Link to={`/drivers/${driver.id}`} className="rr-chip flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition hover:border-light">
          <DriverAvatar name={driver.name} photoUrl={driver.photoUrl} color={team?.color || "#232833"} size={44} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-black uppercase tracking-tight text-dark">{driver.name}</span>
              {driver.tier != null && <TierBadge tier={driver.tier} />}
            </div>
            {team && <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={14} showName nameClassName="text-xs text-light" />}
          </div>
        </Link>
      </div>
      <FormStrip rounds={review.rounds} />
    </div>
  );
}

// The season at a glance under the header: one square per round in the
// career page's colours (a medal for the podium, the accent for points, pale
// for a finish without, grey for a retirement, an empty slot for a round not
// started), its number under it.
function FormStrip({ rounds }) {
  if (!rounds?.length) return null;
  return (
    <div className="mt-5">
      <ol className="recap-cascade flex w-full gap-[3px]">
        {rounds.map((r, i) => {
          const tone = roundTone({ status: r.status, position: r.position, points: r.points - (r.sprint?.points || 0) });
          return (
            <li key={r.round} className="min-w-0 max-w-[3.25rem] flex-1" style={{ "--i": Math.min(i, 14) }}>
              <span
                className="block h-6 rounded-[3px] sm:h-7"
                title={`${roundName(r)} · ${r.status === "FINISHED" && r.position != null ? `P${r.position}` : r.status}${r.points > 0 ? ` · ${r.points} pts` : ""}`}
                style={tone ? { background: tone } : { background: "transparent", boxShadow: "inset 0 0 0 1px var(--c-border)" }}
              />
              <span className="mt-1 block text-center font-mono text-[10px] font-bold tabular-nums text-faint">{r.round}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// --- 01 result -----------------------------------------------------------------------

function PositionCard({ review }) {
  const c = review.championship;
  const complete = review.season.complete;
  // A medal only once the title is decided.
  const medal = complete && c.position >= 1 && c.position <= 3 ? `var(--medal-${c.position})` : null;
  return (
    <Card bodyClassName="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Label>Championship position</Label>
        {c.position && <Label tone="text-light">of {c.fieldSize} who raced</Label>}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="recap-pop flex items-start font-display font-black leading-none tracking-tighter" style={{ color: medal || "var(--c-text)" }}>
          <span className="mt-3 text-4xl text-light sm:mt-5 sm:text-5xl">P</span>
          <span className="text-[6.5rem] sm:text-[8.5rem]">{c.position ?? "–"}</span>
        </div>
        <div className="mb-3 min-w-0 flex-1">
          <div className="font-display text-[1.3rem] font-black uppercase leading-[1.12] tracking-tight text-dark sm:text-3xl sm:leading-tight">{resultHeadline(review)}</div>
          {c.peak && hasJourneyOf(c) && c.peak.position < c.position && (
            <div className="recap-tag mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-light">best</span>
              <span className="rounded-md border px-2 py-0.5 font-mono text-xs font-bold text-dark" style={{ borderColor: "var(--recap-team)" }}>
                P{c.peak.position}
              </span>
              <span className="font-mono text-xs text-light">after {roundName(c.peak)}</span>
            </div>
          )}
        </div>
      </div>
      {resultLine(review) && (
        <div className="recap-tag mt-auto border-t border-border pt-4" style={{ "--tag-delay": "1100ms" }}>
          <p className="text-sm leading-relaxed text-medium">{resultLine(review)}</p>
        </div>
      )}
    </Card>
  );
}

const hasJourneyOf = (c) => (c.journey?.length || 0) >= 2;

function PointsCard({ review }) {
  const c = review.championship;
  const s = review.stats;
  const dropped = (review.rounds || []).filter((r) => r.dropped);
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <Label>Championship points</Label>
        <span className="font-display text-5xl font-black leading-none tabular-nums text-accent">
          {c.points}
          <span className="ml-1 font-mono text-xs font-bold text-light">pts</span>
        </span>
      </div>
      <div className="mt-4 divide-y divide-border border-t border-border">
        {c.ahead && <Row label={`To P${c.ahead.position}, ${c.ahead.name}`} value={`−${c.ahead.gap}`} />}
        {c.behind && <Row label={`Over P${c.behind.position}, ${c.behind.name}`} value={`+${c.behind.gap}`} />}
        <Row label="Points finishes" value={`${s.pointsFinishes} of ${s.starts} starts`} />
        {c.dropWorst > 0 && dropped.length > 0 && <Row label={`Dropped (worst ${c.dropWorst})`} value={dropped.map((r) => `R${r.round}`).join(", ")} tone="text-light" />}
        {c.official && <Row label="Total" value="the league's official sheet" tone="text-light" />}
      </div>
    </Card>
  );
}

// --- 02 round by round -----------------------------------------------------------------

// A finishing place as the timing screen shows it: a chip, a medal fill for
// the podium, the status where there is no place.
function PlaceChip({ status, position, small = false }) {
  const finished = status === "FINISHED" && position != null;
  const medal = finished && position <= 3 ? MEDAL[position - 1] : null;
  return (
    <span
      className={`inline-flex ${small ? "h-5 min-w-[2rem] text-[10px]" : "h-7 min-w-[2.6rem] text-xs"} items-center justify-center rounded-[5px] px-1.5 font-mono font-black tabular-nums ${
        medal ? "" : finished ? "bg-surface2 text-dark" : status === "DNS" ? "text-faint" : "bg-bad/15 text-bad"
      }`}
      style={medal ? { background: medal, color: readableInkOn(medal) } : status === "DNS" ? { boxShadow: "inset 0 0 0 1px var(--c-border)" } : undefined}
    >
      {finished ? `P${position}` : status || "–"}
    </span>
  );
}

function Mark({ children, tone = "text-light", title }) {
  return (
    <span className={`rounded-[4px] border border-border px-1 py-px font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${tone}`} title={title}>
      {children}
    </span>
  );
}

function RoundsCard({ review }) {
  const official = review.championship.official;
  const showTable = review.rounds.some((r) => r.after != null);
  const cols = showTable
    ? "grid-cols-[1.75rem,1fr,2.6rem,2.25rem] sm:grid-cols-[2rem,1fr,3rem,3rem,3.25rem,3.25rem]"
    : "grid-cols-[1.75rem,1fr,2.6rem,2.25rem] sm:grid-cols-[2rem,1fr,3rem,3rem,3.25rem]";
  return (
    <Card className="!p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface2/70 px-4 py-2.5 sm:px-6">
        <span className="flex items-center gap-2">
          <span className="rr-chequer h-3 w-6 rounded-[2px]" aria-hidden="true" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">Results sheet</span>
        </span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">{review.rounds.length} rounds</span>
      </div>
      <div className="px-4 py-3 sm:px-6 sm:py-4">
        <div className={`grid ${cols} gap-2 pb-1 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-faint sm:gap-3`}>
          <span>R</span>
          <span>Circuit</span>
          <span className="hidden text-center sm:block">Grid</span>
          <span className="text-center">Finish</span>
          <span className="text-right">{official ? "" : "Pts"}</span>
          {showTable && <span className="hidden text-right sm:block">Table</span>}
        </div>
        <ol className="recap-cascade">
          {review.rounds.map((r, i) => {
            const flag = flagFor(r.track);
            const marks = [r.pole && "Pole", r.fastestLap && "FL", r.dotd && "DOTD"].filter(Boolean);
            const prevAfter = i > 0 ? review.rounds[i - 1].after : null;
            const move = r.after != null && prevAfter != null ? prevAfter - r.after : null;
            return (
              <li
                key={r.round}
                className={`grid ${cols} items-center gap-2 border-t border-border py-2 first:border-t-0 sm:gap-3`}
                style={{ "--i": Math.min(i, 14), ...(r.best ? { boxShadow: "inset 3px 0 0 var(--recap-team)", paddingLeft: "6px", marginLeft: "-6px" } : null) }}
              >
                <span className="font-mono text-xs font-bold tabular-nums text-light">{r.round}</span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    {flag && <Flag code={flag.country} w={18} h={13} className="shrink-0 rounded-[2px]" />}
                    <span className="truncate font-display text-[13px] font-black uppercase tracking-tight text-dark sm:text-sm">{r.track}</span>
                    {r.best && <span className="hidden font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-eyebrow sm:inline">best</span>}
                  </span>
                  {(marks.length > 0 || r.sprint) && (
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {r.sprint && (
                        <span className="font-mono text-[10px] text-light">
                          Sprint {r.sprint.status === "FINISHED" && r.sprint.position != null ? `P${r.sprint.position}` : r.sprint.status}
                          {r.sprint.points > 0 ? `, ${r.sprint.points} pts` : ""}
                        </span>
                      )}
                      {marks.map((m) => (
                        <Mark key={m} tone={m === "FL" ? "text-fl" : m === "DOTD" ? "text-eyebrow" : "text-light"}>
                          {m}
                        </Mark>
                      ))}
                    </span>
                  )}
                </span>
                <span className="hidden text-center font-mono text-xs font-bold tabular-nums text-light sm:block">{r.grid > 0 ? `P${r.grid}` : "–"}</span>
                <span className="text-center">
                  <PlaceChip status={r.status} position={r.position} />
                </span>
                <span className={`text-right font-mono text-xs font-bold tabular-nums ${official ? "text-faint" : r.dropped ? "text-faint line-through" : r.points > 0 ? "text-accent" : "text-faint"}`}>
                  {official ? "" : r.points}
                </span>
                {showTable && (
                  <span className="hidden text-right font-mono text-xs font-bold tabular-nums text-medium sm:block">
                    {r.after != null ? `P${r.after}` : "–"}
                    {move ? <span className={`ml-1 text-[10px] ${move > 0 ? "text-ok" : "text-bad"}`}>{move > 0 ? `▲${move}` : `▼${-move}`}</span> : null}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {roundsLine(review) && <p className="recap-tag mt-3 border-t border-border pt-3 text-xs leading-relaxed text-light">{roundsLine(review)}</p>}
        {official && (
          <p className="mt-1.5 text-xs leading-relaxed text-light">
            This season's points were kept on the league's own sheet, so there are no points per round. The total above is the official one.
          </p>
        )}
      </div>
    </Card>
  );
}

// --- 03 championship -----------------------------------------------------------------

// The place in the table after every round: P1 at the top, one line in the
// team colour drawn from the first round to the last, a hairline every five
// places, and two labels only: the best place and the last.
function PlaceLine({ review }) {
  const narrow = useNarrow();
  const c = review.championship;
  const rounds = review.rounds.map((r) => ({ round: r.round, track: r.track }));
  const pts = c.journey;
  const worst = Math.max(...pts.map((p) => p.position));
  const bottom = Math.max(5, Math.ceil(worst / 5) * 5);
  const W = narrow ? 360 : 720;
  const H = narrow ? 240 : 320;
  const PAD = narrow ? { l: 30, r: 16, t: 24, b: 28 } : { l: 38, r: 30, t: 28, b: 34 };
  const first = rounds[0]?.round ?? 1;
  const lastR = rounds[rounds.length - 1]?.round ?? first + 1;
  const x = (n) => PAD.l + ((n - first) / Math.max(1, lastR - first)) * (W - PAD.l - PAD.r);
  const y = (p) => PAD.t + ((p - 1) / Math.max(1, bottom - 1)) * (H - PAD.t - PAD.b);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.round).toFixed(1)} ${y(p.position).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const peak = c.peak;
  const gridY = [1, ...Array.from({ length: Math.floor(bottom / 5) }, (_, i) => (i + 1) * 5)].filter((v, i, a) => a.indexOf(v) === i && v <= bottom);
  const DRAW = 1800;
  const at = (n) => Math.round(sineInOutInverse((x(n) - PAD.l) / (W - PAD.l)) * DRAW);
  return (
    <Card bodyClassName="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>Place in the table, round by round</Label>
        <span className="font-mono text-[11px] text-light">of {c.fieldSize}</span>
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <div key={narrow ? "n" : "w"} className="relative mt-3 w-full overflow-hidden" style={{ aspectRatio: `${W} / ${H}` }}>
          <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
            <path d={line} fill="none" stroke="var(--recap-team)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <div className="rr-draw-curtain rr-feather absolute bottom-0 top-0 bg-card" style={{ left: `${(PAD.l / W) * 100}%`, width: `${((W - PAD.l) / W) * 100}%`, "--draw": `${DRAW}ms` }} aria-hidden="true" />
          <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Place in the championship after each round">
            {gridY.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth="1" strokeOpacity="0.7" />
                <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="fill-faint font-mono text-[10px] font-bold">
                  P{v}
                </text>
              </g>
            ))}
            {pts.map((p) => {
              const labelled = p === last || (peak && p.round === peak.round && peak.position < last.position);
              return (
                <g key={p.round} className="rr-dot" style={{ "--d": `${at(p.round)}ms` }}>
                  <circle cx={x(p.round)} cy={y(p.position)} r={labelled ? 6 : 4} fill={labelled ? "var(--recap-team)" : "var(--c-card)"} stroke="var(--recap-team)" strokeWidth="2" />
                  {labelled && (
                    <text x={x(p.round)} y={y(p.position) + (p.position <= 2 ? 22 : -12)} textAnchor="middle" className="rr-halo-text fill-dark font-display text-[15px] font-black">
                      P{p.position}
                    </text>
                  )}
                </g>
              );
            })}
            {rounds.map((r) => (
              <text key={r.round} x={x(r.round)} y={H - 10} textAnchor="middle" className={`font-mono ${narrow ? "text-[9px]" : "text-[10px]"} font-bold ${r.round === last.round ? "fill-eyebrow" : "fill-light"}`}>
                R{r.round}
              </text>
            ))}
          </svg>
        </div>
      </div>
      {journeyLine(review) && <p className="mt-3 border-t border-border pt-3 font-mono text-[11px] leading-relaxed text-light">{journeyLine(review)}</p>}
    </Card>
  );
}

// The final table around the driver, as timing-screen rows, and the driver
// either side of them.
function TableCard({ review }) {
  const c = review.championship;
  return (
    <Card bodyClassName="flex h-full flex-col">
      <Label>{review.season.complete ? "Final table" : `Table after round ${review.season.roundsRun}`}</Label>
      <ol className="recap-cascade mt-3 space-y-1">
        {c.table.map((r, i) => {
          const color = r.team?.color || "#64748b";
          return (
            <li key={r.driverId} className="grid grid-cols-[2.25rem,1fr,3.25rem] items-center gap-2" style={{ "--i": i }}>
              <span
                className={`flex h-7 items-center justify-center rounded-[5px] font-mono text-xs font-black tabular-nums ${r.you ? "" : r.position === 1 ? "bg-dark text-[var(--c-card)]" : "bg-surface2 text-medium"}`}
                style={r.you ? { background: "var(--recap-team)", color: "var(--recap-ink)" } : undefined}
              >
                {r.position}
              </span>
              <span
                className="flex h-7 min-w-0 items-center gap-2 rounded-[5px] pl-2"
                style={r.you ? { background: "color-mix(in srgb, var(--recap-team) 14%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--recap-team) 50%, transparent)" } : undefined}
              >
                <span className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
                {r.you ? (
                  <span className="truncate font-display text-[13px] font-black uppercase tracking-tight text-dark sm:text-sm">{r.name}</span>
                ) : (
                  <Link to={`/drivers/${r.driverId}`} className="truncate font-display text-[13px] font-black uppercase tracking-tight text-medium transition hover:text-dark sm:text-sm">
                    {r.name}
                  </Link>
                )}
              </span>
              <span className={`text-right font-mono text-xs font-bold tabular-nums ${r.you ? "text-accent" : "text-medium"}`}>{r.points}</span>
            </li>
          );
        })}
      </ol>
      {(c.ahead || c.behind) && (
        <div className="recap-tag mt-auto space-y-1.5 border-t border-border pt-3 text-xs leading-relaxed text-light" style={{ "--tag-delay": "900ms" }}>
          {c.ahead && <p>{neighbourLine(c.ahead)}</p>}
          {c.behind && <p>{neighbourLine(c.behind, { ahead: false })}</p>}
        </div>
      )}
    </Card>
  );
}

// --- 04 best round -------------------------------------------------------------------

function BestRound({ review }) {
  const { best, climb } = review;
  const flag = flagFor(best.track);
  const field = best.starters || null;
  const showClimb = climb && (climb.raceId !== best.raceId || climb.sprint !== best.sprint);
  const photo = best.heroImageUrl;
  return (
    <div className={`grid gap-4 sm:gap-5 ${photo || showClimb ? "lg:grid-cols-[1.75fr,1fr]" : ""}`}>
      <Card bodyClassName="flex h-full flex-col">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Label>{best.sprint ? "Best result, sprint" : "Best result"}</Label>
          <Label tone="text-light">{best.points} pts</Label>
        </div>
        <div className="mt-3 flex items-center gap-5">
          <CircuitMap track={best.track} className="h-24 w-32 shrink-0 sm:h-28 sm:w-40" stroke="var(--recap-team)" strokeWidth={3} />
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              {flag && <Flag code={flag.country} w={28} h={21} className="rounded-sm" />}
              <span className="truncate font-display text-2xl font-black uppercase tracking-tight text-dark sm:text-3xl">{best.track}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {best.grid > 0 && (
                <>
                  <span className="rounded-md border border-border px-2 py-0.5 font-mono text-xs font-bold text-light">P{best.grid}</span>
                  <span className="text-light">→</span>
                </>
              )}
              <span className="rounded-md border px-2 py-0.5 font-mono text-xs font-bold text-dark" style={{ borderColor: "var(--recap-team)" }}>
                P{best.position}
              </span>
              <span className="ml-1 font-mono text-xs text-light">Round {best.round}</span>
            </div>
          </div>
        </div>
        {best.grid > 0 && field > 1 && best.grid <= field && best.position <= field && (
          <div className="mt-4">
            <GridToFlag grid={best.grid} finish={best.position} field={field} />
          </div>
        )}
        <div className="recap-tag mt-auto border-t border-border pt-4" style={{ "--tag-delay": "1200ms" }}>
          <p className="text-sm leading-relaxed text-medium">{bestLine(best)}</p>
        </div>
      </Card>
      {photo ? (
        <Card className="!p-0 overflow-hidden">
          <img src={photo} alt={`${best.track}, round ${best.round}`} className="block h-full max-h-[22rem] w-full object-cover" loading="lazy" />
        </Card>
      ) : showClimb ? (
        <Card bodyClassName="flex h-full flex-col">
          <Label>Biggest climb</Label>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-display text-5xl font-black leading-none tabular-nums text-ok">+{climb.gained}</span>
            <span className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-light">places</span>
          </div>
          <p className="mt-auto border-t border-border pt-4 text-sm leading-relaxed text-medium">{climbLine(climb)}</p>
        </Card>
      ) : null}
    </div>
  );
}

// --- 05 against the field -------------------------------------------------------------

// The figures worth setting against the field, in a fixed order; a figure
// the season does not have (no telemetry, no grid) is left out, never zeroed.
function numbersOf(review) {
  const s = review.stats;
  const r = review.ranks || {};
  // Wins and podiums are always told, a zero included; the rarer figures only
  // when there is one, since "Poles 0" with nothing to set it against is filler.
  const some = (v) => (v > 0 ? v : null);
  const out = [
    { k: "wins", label: "Wins", value: s.wins, sub: rankText(r.wins) },
    { k: "podiums", label: "Podiums", value: s.podiums, sub: rankText(r.podiums) },
    { k: "poles", label: "Poles", value: some(s.poles), sub: rankText(r.poles) },
    { k: "fl", label: "Fastest laps", value: some(s.fastestLaps), sub: rankText(r.fastestLaps), tone: "rgb(var(--c-fl))" },
    { k: "ot", label: "Overtakes", value: some(s.overtakes), sub: rankText(r.overtakes) },
    { k: "led", label: "Laps led", value: some(s.lapsLed), sub: rankText(r.lapsLed) },
    { k: "avg", label: "Average finish", value: s.avgFinish != null ? `P${String(s.avgFinish).replace(/\.0$/, "")}` : null, sub: s.bestFinish ? `best P${s.bestFinish}` : null },
    { k: "fin", label: "Finishes", value: s.finishes, sub: `of ${s.starts} starts${s.dnf ? `, ${s.dnf} DNF` : ""}` },
  ];
  return out.filter((n) => n && n.value != null);
}

// Columns for the number grid: no empty cell is left at the end of a row
// (the hairline grid would show it as a grey block), so the last figure takes
// up what is left of its row, and on a phone an odd first figure the full one.
const GRID_COLS = { 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" };
const SPAN = { 2: "sm:col-span-2", 3: "sm:col-span-3" };
function NumbersCard({ numbers }) {
  const n = numbers.length;
  const cols = n % 4 === 0 || n > 6 ? 4 : 3;
  const rest = n % cols;
  return (
    <Card>
      <div className={`rr-numbers grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border ${GRID_COLS[cols]}`}>
        {numbers.map((n, i) => (
          <div
            key={n.k}
            className={`flex flex-col justify-center gap-2 bg-card p-3.5 sm:p-4 lg:px-6 ${numbers.length % 2 === 1 && i === 0 ? "col-span-2 sm:col-span-1" : ""} ${
              rest && i === numbers.length - 1 ? SPAN[cols - rest + 1] || "" : ""
            }`}
          >
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-light">{n.label}</div>
            <div>
              <div className="font-display text-3xl font-black leading-none tabular-nums sm:text-4xl" style={{ color: n.tone || "var(--c-text)" }}>
                {n.value}
              </div>
              <div className="mt-1.5 min-h-[1rem] font-mono text-[11px] font-bold text-light">{n.sub || ""}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-light">Ranks are among the drivers who raced in this table. A shared rank is level with somebody else.</p>
    </Card>
  );
}

// --- 06 contact ------------------------------------------------------------------------

// Contact race by race: a column per round, cars in the speed colours of the
// recap's contact list (a bar per contact), the scenery as hollow marks, and
// a clean round marked as such. Rounds without the server's file stay empty.
function ContactCard({ review }) {
  const rounds = review.rounds;
  const contact = review.contact;
  const max = Math.max(3, ...rounds.map((r) => (r.contacts || 0) + (r.envContacts || 0)));
  return (
    <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1.6fr,1fr]">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label>Contact per round</Label>
          <span className="font-mono text-[11px] text-light">{contact.races} races on file</span>
        </div>
        <ol className="recap-cascade mt-4 flex items-end gap-1.5 sm:gap-2" style={{ height: `${Math.min(10, max) * 14 + 34}px` }}>
          {rounds.map((r, i) => {
            const known = r.contacts != null;
            const cars = r.contacts || 0;
            const walls = r.envContacts || 0;
            return (
              <li key={r.round} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" style={{ "--i": Math.min(i, 14) }} title={known ? `${roundName(r)}: ${cars} with cars, ${walls} with the scenery` : `${roundName(r)}: not on file`}>
                {!known ? (
                  <span className="font-mono text-[9px] text-faint">–</span>
                ) : cars + walls === 0 ? (
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ok">0</span>
                ) : (
                  <span className="flex w-full max-w-[1.75rem] flex-col-reverse gap-[2px]">
                    {Array.from({ length: Math.min(cars, 10) }, (_, k) => (
                      <span key={`c${k}`} className="block h-3 rounded-[2px]" style={{ background: "var(--recap-team)" }} />
                    ))}
                    {Array.from({ length: Math.min(walls, Math.max(0, 10 - cars)) }, (_, k) => (
                      <span key={`w${k}`} className="block h-3 rounded-[2px]" style={{ boxShadow: "inset 0 0 0 1.5px var(--recap-team)" }} />
                    ))}
                  </span>
                )}
                <span className="font-mono text-[10px] font-bold tabular-nums text-faint">{r.round}</span>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-light">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--recap-team)" }} />
            With a car
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ boxShadow: "inset 0 0 0 1.5px var(--recap-team)" }} />
            With the scenery
          </span>
        </div>
      </Card>
      <Card bodyClassName="flex h-full flex-col">
        <Label>The season's contact</Label>
        <div className="mt-4 divide-y divide-border border-t border-border">
          <Row label="With other cars" value={contact.cars} />
          <Row label="With the scenery" value={contact.scenery} />
          <Row label="Races without touching a car" value={`${contact.clean} of ${contact.races}`} tone={contact.clean > 0 ? "text-ok" : "text-dark"} />
          {contact.rank && <Row label="Fewest per race" value={rankText(contact.rank)} />}
        </div>
        <p className="recap-tag mt-auto border-t border-border pt-3 text-xs leading-relaxed text-light" style={{ "--tag-delay": "900ms" }}>
          {contactLine(contact)}
        </p>
      </Card>
    </div>
  );
}

// --- 07 team ------------------------------------------------------------------------------

// The team-mate as score lines: the driver's side in the team colour, the
// team-mate's in plain text, a bar split by the two shares.
function DuelCard({ mate, you }) {
  const lines = duelLines(mate);
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>Against {mate.name}</Label>
        <Link to={`/drivers/${mate.driverId}`} className="font-mono text-[11px] text-light transition hover:text-dark">
          Driver page
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-[1fr,auto,1fr] items-baseline gap-3 font-display text-sm font-black uppercase tracking-tight">
        <span className="truncate text-dark">{you.name}</span>
        <span />
        <span className="truncate text-right text-medium">{mate.name}</span>
      </div>
      <div className="mt-2 space-y-3.5">
        {lines.map((l, i) => {
          const total = l.me + l.them;
          const share = total > 0 ? (l.me / total) * 100 : 50;
          return (
            <div key={l.key}>
              <div className="grid grid-cols-[3rem,1fr,3rem] items-baseline gap-3">
                <span className="font-display text-2xl font-black tabular-nums text-dark">{l.me}</span>
                <span className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">{l.label}</span>
                <span className="text-right font-display text-2xl font-black tabular-nums text-medium">{l.them}</span>
              </div>
              <div className="mt-1.5">
                <Bar pct={share} h="h-1.5" fillStyle={{ background: "var(--recap-team)" }} track="bg-surface2" cursor={false} delay={200 + i * 120} />
              </div>
              {l.note && <div className="mt-1 text-center font-mono text-[10px] text-faint">{l.note}</div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// --- 08 honours -------------------------------------------------------------------------

const HONOUR_TONE = {
  champion: "var(--medal-1)",
  vice: "var(--medal-2)",
  third: "var(--medal-3)",
  "fastest-lap": "rgb(var(--c-fl))",
};

function Honours({ review }) {
  const items = [
    ...review.honours.map((h) => ({ key: h.key, title: h.title, detail: h.key === "fastest-lap" && h.ms ? `${fmtLap(h.ms)}${h.detail ? `, ${h.detail}` : ""}` : h.detail })),
    ...review.awards.map((a, i) => ({ key: `award-${i}`, title: a.title, detail: a.note || "Voted by the league" })),
  ];
  if (review.stats.dotd > 0) items.push({ key: "dotd", title: "Driver of the Day", detail: `${review.stats.dotd} time${review.stats.dotd === 1 ? "" : "s"}` });
  return (
    <ol className="recap-cascade grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((h, i) => (
        <li key={h.key} className="card flex items-stretch overflow-hidden" style={{ "--i": i }}>
          <span className="w-1.5 shrink-0" style={{ background: HONOUR_TONE[h.key] || "var(--recap-team)" }} />
          <span className="min-w-0 px-4 py-3">
            <span className="block font-display text-base font-black uppercase leading-tight tracking-tight text-dark">{h.title}</span>
            {h.detail && <span className="mt-0.5 block truncate font-mono text-[11px] text-light">{h.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

// --- the foot ----------------------------------------------------------------------------

function Footer({ review }) {
  const [copied, setCopied] = useState(false);
  const share = useMemo(() => (typeof window !== "undefined" ? window.location.href : ""), []);
  const copy = () => {
    try {
      navigator.clipboard?.writeText(share).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      });
    } catch {
      /* no clipboard: nothing to do */
    }
  };
  return (
    <div className="recap-reveal space-y-4 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Link to={`/drivers/${review.driver.id}`} className="btn-primary">
            Driver page
          </Link>
          <Link to="/drivers" className="btn-secondary">
            Standings
          </Link>
        </div>
        <button type="button" onClick={copy} className="text-sm font-semibold text-light transition hover:text-dark">
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
      <p className="font-mono text-[11px] leading-relaxed text-faint">{sourceLine(review)}</p>
    </div>
  );
}

