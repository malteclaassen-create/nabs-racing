// One slide of the season story (review/Story.jsx), by its key. Every slide
// has the same three layers: the eyebrow at the top (the recap's mono label
// with the team-colour tab), the moment itself in the middle (a big number
// with what it is measured against, or a real thing: the circuit outlines of
// the season, the table line, the team-mate's score), and one plain line at
// the foot. The data and the words come from review/storySlides.mjs.
import { useState } from "react";
import { Link } from "react-router-dom";
import { DriverAvatar, MEDAL, readableInkOn } from "../../components/ui.jsx";
import Flag from "../../components/Flag.jsx";
import TeamLogo from "../../components/TeamLogo.jsx";
import CircuitMap from "../../components/CircuitMap.jsx";
import { circuitFor, flagFor } from "../../data/circuits.js";
import { roundTone } from "../../utils/roundTone.js";
import { Label, Bar } from "../recap/parts.jsx";
import GridToFlag from "../recap/GridToFlag.jsx";
import { saveSharePicture } from "./sharePicture.js";

// A part of a slide that comes in at its own beat.
const In = ({ d = 0, className = "", children, as: Tag = "div" }) => (
  <Tag className={`st-in ${className}`} style={{ "--d": `${d}ms` }}>
    {children}
  </Tag>
);

// A name as big as the frame allows: sized on the longest word so it never
// breaks inside one, and never bigger than the slide's headline size.
function nameSize(name, max = 4.25) {
  const longest = Math.max(4, ...String(name || "").split(/\s+/).map((w) => w.length));
  // Archivo Black in capitals runs about 0.8 em a letter; the slide keeps
  // 2rem each side.
  return { fontSize: `min(${max}rem, calc((100cqi - 4.5rem) / ${(longest * 0.82).toFixed(2)}))` };
}

// The big number of a slide, the recap's FinishCard figure: display face,
// tight, with a smaller lead-in letter where it is a place ("P4").
function Big({ value, tone = "var(--c-text)", d = 150 }) {
  const s = String(value ?? "");
  const lead = /^P\d/.test(s) ? "P" : /^\+\d/.test(s) ? "+" : null;
  return (
    <In d={d} className="flex items-start font-display font-black leading-none tracking-tighter" >
      {lead && <span className="mt-3 text-5xl text-light sm:mt-4">{lead}</span>}
      <span className="text-[7.5rem] sm:text-[8.5rem]" style={{ color: tone }}>
        {lead ? s.slice(1) : s}
      </span>
    </In>
  );
}

// A circuit's outline drawn once from its start, in the team colour, from
// the site's own outlines (data/circuits.js). An uploaded outline the site
// only has as a picture is shown still.
function Outline({ track, className = "", d = 250, stroke = "var(--recap-team)", width = 2.6, draw = true }) {
  const c = circuitFor(track);
  if (!c) return <CircuitMap track={track} className={className} stroke={stroke} strokeWidth={width} />;
  return (
    <svg viewBox={c.box || "0 0 100 100"} className={className} fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path
        d={c.path}
        pathLength="1"
        className={draw ? "st-draw" : ""}
        style={{ "--d": `${d}ms` }}
        stroke={stroke}
        strokeWidth={width}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Frame({ slide, children, foot }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pb-7 pt-[5.25rem] sm:px-8">
      <In d={0}>
        <Label>{slide.eyebrow}</Label>
      </In>
      <div className="flex min-h-0 flex-1 flex-col justify-center py-4">{children}</div>
      {(foot ?? slide.line) && (
        <In d={900} className="border-t border-border pt-4 text-[15px] leading-relaxed text-medium">
          {foot ?? slide.line}
        </In>
      )}
    </div>
  );
}

// --- the slides ---------------------------------------------------------------------

function Intro({ slide, review }) {
  const { driver } = review;
  return (
    <Frame slide={slide} foot={slide.line}>
      <In d={150} className="flex items-center gap-3">
        <DriverAvatar name={driver.name} photoUrl={driver.photoUrl} color={driver.team?.color || "#232833"} size={56} />
        {driver.team && <TeamLogo id={driver.team.id} name={driver.team.name} color={driver.team.color} logoUrl={driver.team.logoUrl} size={18} showName nameClassName="text-sm text-light" />}
      </In>
      <In d={300} as="h2" className="mt-5 font-display font-black uppercase leading-[0.92] tracking-tight text-dark">
        <span style={nameSize(driver.name)}>{driver.name}</span>
      </In>
      <In d={450} className="mt-3 font-display text-xl font-extrabold uppercase tracking-tight text-light">
        {review.season.label}
      </In>
      {/* The season at a glance, a square per round in the career page's
          colours, laid down one after another. */}
      <div className="mt-8 flex w-full gap-[3px]">
        {review.rounds.map((r, k) => {
          const tone = roundTone({ status: r.status, position: r.position, points: r.points - (r.sprint?.points || 0) });
          return (
            <In key={r.round} d={650 + k * 60} className="min-w-0 max-w-[2.5rem] flex-1">
              <span className="block h-7 rounded-[3px]" style={tone ? { background: tone } : { boxShadow: "inset 0 0 0 1px var(--c-border)" }} />
              <span className="mt-1 block text-center font-mono text-[9px] font-bold tabular-nums text-faint">{r.round}</span>
            </In>
          );
        })}
      </div>
    </Frame>
  );
}

function Rounds({ slide, review }) {
  const rounds = review.rounds;
  const cols = rounds.length > 12 ? "grid-cols-5" : "grid-cols-4";
  return (
    <Frame slide={slide}>
      <div className="flex items-end gap-4">
        <Big value={slide.value} />
        <In d={300} className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.16em] text-light">
          {slide.unit}
        </In>
      </div>
      {/* Every circuit of the season, in calendar order: the ones raced in
          the team colour, a missed one faint. */}
      <div className={`mt-6 grid ${cols} gap-x-3 gap-y-4`}>
        {rounds.map((r, k) => {
          const raced = r.status !== "DNS";
          return (
            <In key={r.round} d={400 + k * 70} className="min-w-0">
              <Outline
                track={r.track}
                className="h-12 w-full"
                d={450 + k * 70}
                stroke={raced ? (r.status === "FINISHED" ? "var(--recap-team)" : "var(--c-text3)") : "var(--c-border)"}
                width={3.2}
              />
              <span className="mt-1 block truncate text-center font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-faint">
                R{r.round} {raced ? (r.status === "FINISHED" && r.position != null ? `P${r.position}` : r.status) : "–"}
              </span>
            </In>
          );
        })}
      </div>
    </Frame>
  );
}

function Best({ slide, review }) {
  const best = review.best;
  const flag = flagFor(best.track);
  const medal = best.position <= 3 ? `var(--medal-${best.position})` : "var(--c-text)";
  return (
    <Frame slide={slide}>
      {best.heroImageUrl ? (
        <In d={150} className="overflow-hidden rounded-xl border border-border">
          <img src={best.heroImageUrl} alt={`${best.track}, round ${best.round}`} className="block aspect-[16/10] w-full object-cover" />
        </In>
      ) : (
        <Outline track={best.track} className="mx-auto h-44 w-full sm:h-52" d={200} width={2.2} />
      )}
      <div className="mt-6 flex items-end gap-5">
        <Big value={slide.value} tone={medal} d={500} />
        <div className="mb-4 min-w-0">
          <In d={650} className="flex items-center gap-2.5">
            {flag && <Flag code={flag.country} w={26} h={19} className="rounded-sm" />}
            <span className="truncate font-display text-2xl font-black uppercase tracking-tight text-dark">{slide.title}</span>
          </In>
          <In d={750} className="mt-1 font-mono text-xs font-bold uppercase tracking-[0.16em] text-light">
            {slide.sub}
          </In>
        </div>
      </div>
    </Frame>
  );
}

function Climb({ slide, review }) {
  const c = review.climb;
  const field = c.starters || null;
  return (
    <Frame slide={slide}>
      <Big value={slide.value} tone="rgb(var(--c-ok))" />
      <In d={300} className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-light">
        places, {slide.title}
      </In>
      {field > 1 && c.grid <= field && c.position <= field && (
        <In d={450} className="mt-10">
          <GridToFlag grid={c.grid} finish={c.position} field={field} />
        </In>
      )}
    </Frame>
  );
}

function Podiums({ slide }) {
  return (
    <Frame slide={slide}>
      <div className="flex items-end gap-4">
        <Big value={slide.value} tone="var(--medal-1)" />
        <In d={300} className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.16em] text-light">
          {slide.unit}
        </In>
      </div>
      <ol className="mt-6 space-y-2">
        {slide.podiums.slice(0, 8).map((p, k) => {
          const flag = flagFor(p.track);
          return (
            <In key={`${p.round}-${p.sprint}`} as="li" d={450 + k * 110} className="flex items-center gap-3">
              <span className="flex h-7 w-11 items-center justify-center rounded-[5px] font-mono text-xs font-black" style={{ background: MEDAL[p.position - 1], color: readableInkOn(MEDAL[p.position - 1]) }}>
                P{p.position}
              </span>
              {flag && <Flag code={flag.country} w={20} h={15} className="rounded-[2px]" />}
              <span className="min-w-0 truncate font-display text-base font-black uppercase tracking-tight text-dark">{p.track}</span>
              <span className="ml-auto font-mono text-[11px] font-bold text-light">
                R{p.round}
                {p.sprint ? " sprint" : ""}
              </span>
            </In>
          );
        })}
        {slide.podiums.length > 8 && <In d={1300} className="font-mono text-[11px] text-light">and {slide.podiums.length - 8} more</In>}
      </ol>
    </Frame>
  );
}

function Field({ slide }) {
  return (
    <Frame slide={slide}>
      <div className="divide-y divide-border">
        {slide.figures.map((f, k) => (
          <In key={f.k} d={200 + k * 220} className="flex items-end justify-between gap-4 py-4">
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">{f.label}</div>
              <div className="mt-1 font-display text-6xl font-black leading-none tabular-nums" style={{ color: f.k === "fastestLaps" ? "rgb(var(--c-fl))" : "var(--c-text)" }}>
                {f.value}
              </div>
            </div>
            <div className="pb-1 text-right font-mono text-sm font-bold text-medium">{f.rankText}</div>
          </In>
        ))}
      </div>
    </Frame>
  );
}

// The place in the table after every round, P1 at the top.
function Journey({ slide, review }) {
  const pts = review.championship.journey;
  const rounds = review.rounds.map((r) => r.round);
  const worst = Math.max(...pts.map((p) => p.position));
  const bottom = Math.max(5, Math.ceil(worst / 5) * 5);
  const W = 360;
  const H = 220;
  const PAD = { l: 30, r: 14, t: 18, b: 24 };
  const first = rounds[0] ?? 1;
  const lastR = rounds[rounds.length - 1] ?? first + 1;
  const x = (n) => PAD.l + ((n - first) / Math.max(1, lastR - first)) * (W - PAD.l - PAD.r);
  const y = (p) => PAD.t + ((p - 1) / Math.max(1, bottom - 1)) * (H - PAD.t - PAD.b);
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.round).toFixed(1)} ${y(p.position).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const peak = review.championship.peak;
  const marks = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70].filter((v) => v <= bottom && (v === 1 || bottom <= 20 || v % 10 === 0));
  return (
    <Frame slide={slide}>
      <div className="flex items-end gap-4">
        <Big value={slide.value} />
        <In d={300} className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.16em] text-light">
          {slide.unit}
        </In>
      </div>
      <In d={350} className="mt-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Place in the championship after each round">
          {marks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth="1" />
              <text x={PAD.l - 6} y={y(v) + 3.5} textAnchor="end" className="fill-faint font-mono text-[9px] font-bold">
                P{v}
              </text>
            </g>
          ))}
          <path d={line} pathLength="1" className="st-draw" style={{ "--d": "500ms" }} fill="none" stroke="var(--recap-team)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          {pts.map((p) => {
            const labelled = p === last || (peak && p.round === peak.round && peak.position < last.position);
            return labelled ? (
              <g key={p.round} className="st-in" style={{ "--d": "1700ms" }}>
                <circle cx={x(p.round)} cy={y(p.position)} r="5" fill="var(--recap-team)" stroke="var(--c-card)" strokeWidth="2" />
                <text x={x(p.round)} y={y(p.position) + (p.position <= 2 ? 18 : -10)} textAnchor="middle" className="rr-halo-text fill-dark font-display text-[13px] font-black">
                  P{p.position}
                </text>
              </g>
            ) : null;
          })}
          {rounds.map((n) => (
            <text key={n} x={x(n)} y={H - 6} textAnchor="middle" className="fill-faint font-mono text-[8px] font-bold">
              {n}
            </text>
          ))}
        </svg>
      </In>
    </Frame>
  );
}

function Team({ slide, review }) {
  const { mate, lines } = slide;
  return (
    <Frame slide={slide}>
      <In d={150} className="grid grid-cols-[1fr,auto,1fr] items-baseline gap-3 font-display text-base font-black uppercase tracking-tight">
        <span className="truncate text-dark">{review.driver.name}</span>
        <span />
        <span className="truncate text-right text-medium">{mate.name}</span>
      </In>
      <div className="mt-5 space-y-6">
        {lines.map((l, k) => {
          const total = l.me + l.them;
          const share = total > 0 ? (l.me / total) * 100 : 50;
          return (
            <In key={l.key} d={350 + k * 250}>
              <div className="grid grid-cols-[minmax(3.5rem,auto),1fr,minmax(3.5rem,auto)] items-baseline gap-3">
                <span className="font-display text-[2.75rem] font-black leading-none tabular-nums text-dark">{l.me}</span>
                <span className="text-center font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-light">{l.label}</span>
                <span className="text-right font-display text-[2.75rem] font-black leading-none tabular-nums text-medium">{l.them}</span>
              </div>
              <div className="mt-2">
                <Bar pct={share} h="h-2" fillStyle={{ background: "var(--recap-team)" }} track="bg-surface2" cursor={false} delay={450 + k * 250} />
              </div>
              {l.note && <div className="mt-1 text-center font-mono text-[10px] text-faint">{l.note}</div>}
            </In>
          );
        })}
      </div>
    </Frame>
  );
}

function Contact({ slide, review }) {
  const rounds = review.rounds;
  return (
    <Frame slide={slide}>
      <div className="flex items-end gap-4">
        <Big value={slide.value} tone="rgb(var(--c-ok))" />
        <In d={300} className="mb-4 max-w-[12rem] font-mono text-xs font-bold uppercase leading-snug tracking-[0.12em] text-light">
          {slide.unit}
        </In>
      </div>
      {/* A column per round: a filled block for each contact with a car, an
          open one for the scenery, a dash where the file is missing. */}
      <div className="mt-8 flex h-40 items-end gap-1.5">
        {rounds.map((r, k) => {
          const known = r.contacts != null;
          const cars = r.contacts || 0;
          const walls = r.envContacts || 0;
          return (
            <In key={r.round} d={450 + k * 60} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              {!known ? (
                <span className="font-mono text-[8px] font-bold uppercase text-faint">{r.status === "DNS" && !r.sprint ? "DNS" : "–"}</span>
              ) : cars + walls === 0 ? (
                <span className="block h-1.5 w-full max-w-[1.5rem] rounded-full bg-ok/60" />
              ) : (
                <span className="flex w-full max-w-[1.5rem] flex-col-reverse gap-[2px]">
                  {Array.from({ length: Math.min(cars, 9) }, (_, n) => (
                    <span key={`c${n}`} className="block h-3 rounded-[2px]" style={{ background: "var(--c-text3)" }} />
                  ))}
                  {Array.from({ length: Math.min(walls, Math.max(0, 9 - cars)) }, (_, n) => (
                    <span key={`w${n}`} className="block h-3 rounded-[2px]" style={{ boxShadow: "inset 0 0 0 1.5px var(--c-text3)" }} />
                  ))}
                </span>
              )}
              <span className="font-mono text-[9px] font-bold tabular-nums text-faint">{r.round}</span>
            </In>
          );
        })}
      </div>
      <In d={1000} className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-light">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--c-text3)" }} />
          With a car
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ boxShadow: "inset 0 0 0 1.5px var(--c-text3)" }} />
          The scenery
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-3 rounded-full bg-ok/60" />
          None
        </span>
      </In>
    </Frame>
  );
}

const HONOUR_TONE = { champion: "var(--medal-1)", vice: "var(--medal-2)", third: "var(--medal-3)", "fastest-lap": "rgb(var(--c-fl))" };

function Honours({ slide }) {
  return (
    <Frame slide={slide} foot={null}>
      <ol className="space-y-3">
        {slide.honours.map((h, k) => (
          <In key={h.key} as="li" d={200 + k * 200} className="flex items-stretch overflow-hidden rounded-lg border border-border">
            <span className="w-1.5 shrink-0" style={{ background: HONOUR_TONE[h.key] || "var(--recap-team)" }} />
            <span className="min-w-0 px-4 py-3">
              <span className="block font-display text-xl font-black uppercase leading-tight tracking-tight text-dark">{h.title}</span>
              {h.detail && <span className="mt-0.5 block font-mono text-[11px] text-light">{h.detail}</span>}
            </span>
          </In>
        ))}
      </ol>
    </Frame>
  );
}

// The last slide: the season on one card (the same card the picture is drawn
// from), and the ways on.
function Final({ slide, review, onReplay, onSheet }) {
  const [state, setState] = useState(null);
  const save = async () => {
    setState("busy");
    try {
      const how = await saveSharePicture(review, slide);
      setState(how === "shared" ? "shared" : "saved");
    } catch {
      setState("failed");
    }
  };
  const copy = () => {
    try {
      navigator.clipboard?.writeText(window.location.href.split("?")[0]).then(() => setState("copied"));
    } catch {
      /* no clipboard */
    }
  };
  const c = review.championship;
  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-[5.25rem] sm:px-8">
      <div data-st-keep className="flex min-h-0 flex-1 flex-col">
        <In d={0}>
          <Label>{slide.eyebrow}</Label>
        </In>
        <In d={100} as="h2" className="mt-3 font-display font-black uppercase leading-[0.95] tracking-tight text-dark">
          <span style={nameSize(slide.title, 3)}>{slide.title}</span>
        </In>
        {review.driver.team && (
          <In d={150} className="mt-2">
            <TeamLogo id={review.driver.team.id} name={review.driver.team.name} color={review.driver.team.color} logoUrl={review.driver.team.logoUrl} size={16} showName nameClassName="text-sm text-light" />
          </In>
        )}
        <In d={250} className="mt-5 flex items-end justify-between gap-4 border-t border-border pt-4">
          {slide.value && (
            <div className="flex items-start font-display font-black leading-none tracking-tighter text-dark">
              <span className="mt-2 text-3xl text-light">P</span>
              <span className="text-[5.5rem]">{c.position}</span>
            </div>
          )}
          <div className="pb-2 text-right">
            <div className="font-mono text-[11px] font-bold text-light">{slide.unit}</div>
            <div className="mt-1 font-display text-4xl font-black tabular-nums text-accent">
              {slide.points}
              <span className="ml-1 font-mono text-xs font-bold text-light">pts</span>
            </div>
          </div>
        </In>
        <In d={400} className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border">
          {slide.grid.map((g) => (
            <div key={g.k} className="bg-card p-3">
              <div className="font-mono text-[9px] font-bold uppercase leading-tight tracking-[0.08em] text-light">{g.label}</div>
              <div className="mt-1 font-display text-2xl font-black leading-none tabular-nums text-dark">{g.value}</div>
              {g.sub && <div className="mt-1 truncate font-mono text-[10px] text-faint">{g.sub}</div>}
            </div>
          ))}
        </In>
        <In d={600} className="mt-auto pt-5">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={state === "busy"} className="btn-primary">
              {state === "busy" ? "Drawing the picture" : "Save picture"}
            </button>
            <button type="button" onClick={onSheet} className="btn-secondary">
              Every round
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-sm">
            <button type="button" onClick={copy} className="font-semibold text-light transition hover:text-dark">
              {state === "copied" ? "Link copied" : "Copy link"}
            </button>
            <button type="button" onClick={onReplay} className="font-semibold text-light transition hover:text-dark">
              Watch again
            </button>
            <Link to={`/drivers/${review.driver.id}`} className="font-semibold text-light transition hover:text-dark">
              Driver page
            </Link>
          </div>
          {state === "failed" && <p className="mt-2 text-xs text-bad">The picture could not be made in this browser.</p>}
          {state === "saved" && <p className="mt-2 text-xs text-light">Saved to your downloads.</p>}
        </In>
      </div>
    </div>
  );
}

const SLIDES = { intro: Intro, rounds: Rounds, best: Best, climb: Climb, podiums: Podiums, field: Field, journey: Journey, team: Team, contact: Contact, honours: Honours, final: Final };

export default function StorySlide({ slide, review, onReplay, onSheet }) {
  const Slide = SLIDES[slide.key];
  return Slide ? <Slide slide={slide} review={review} onReplay={onReplay} onSheet={onSheet} /> : null;
}
