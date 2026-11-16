// One slide of the season story (review/Story.jsx), by its key, in the
// story's own look (review/story.css, review/livery.js): the driver's livery
// colours, a tall condensed face, numbers so big they run off the frame,
// circuits drawn as thick lines. Each slide is one moment; its data and
// words come from review/storySlides.mjs and review/copy.mjs.
//
// Every colour here is the slide's ground (--g-bg, --g-fg, --g-mute,
// --g-accent), set by the player, so the same slide reads on the team colour,
// on black or on white. The medals keep their own colours.
import { useState } from "react";
import { Link } from "react-router-dom";
import { MEDAL, readableInkOn } from "../../components/ui.jsx";
import Flag from "../../components/Flag.jsx";
import TeamLogo from "../../components/TeamLogo.jsx";
import CircuitMap from "../../components/CircuitMap.jsx";
import { circuitFor, flagFor } from "../../data/circuits.js";
import { saveSharePicture } from "./sharePicture.js";

// --- pieces -------------------------------------------------------------------------

// A part of a slide that comes in at its own beat.
const In = ({ d = 0, className = "", children, as: Tag = "div", style }) => (
  <Tag className={`st-in ${className}`} style={{ "--d": `${d}ms`, ...style }}>
    {children}
  </Tag>
);

// The size of a big figure: as big as the frame takes for its number of
// characters (Big Shoulders runs about half an em a figure), up to `max`
// of the frame's width.
const bigSize = (text, max = 80) => {
  const n = Math.max(1, String(text ?? "").length);
  return `min(${max}cqi, ${(100 / (n * 0.56)).toFixed(1)}cqi, 46cqh)`;
};

// A figure that runs off the frame's edge, sliding in from that side.
function Giant({ value, side = "left", tone, d = 120, max = 80, className = "" }) {
  const s = String(value ?? "");
  return (
    <div
      className={`lv-display lv-num st-slide whitespace-nowrap ${className}`}
      style={{
        "--d": `${d}ms`,
        "--from": side === "left" ? "-18%" : "18%",
        fontSize: bigSize(s, max),
        color: tone || "var(--g-fg)",
        marginLeft: side === "left" ? "-0.055em" : undefined,
        marginRight: side === "right" ? "-0.055em" : undefined,
        textAlign: side === "right" ? "right" : "left",
      }}
    >
      {s}
    </div>
  );
}

// A word or name set as big as the width allows, never broken inside a word.
const fitWord = (word, max = 30) => {
  const n = Math.max(3, String(word || "").length);
  return { fontSize: `min(${max}cqh, calc((100cqi - 3.25rem) / ${(n * 0.5).toFixed(2)}))` };
};

// A name set into half the width, for two names side by side.
const halfWord = (name) => {
  const n = Math.max(4, ...String(name || "").split(/\s+/).map((w) => w.length));
  return { fontSize: `min(9cqh, calc((50cqi - 2.5rem) / ${(n * 0.5).toFixed(2)}))` };
};

// A circuit's outline from the site's own data, drawn once from its start.
// An outline the site has only as an uploaded picture is shown still.
function Outline({ track, className = "", d = 250, stroke = "var(--g-fg)", width = 3, draw = true, opacity = 1 }) {
  const c = circuitFor(track);
  if (!c) return <CircuitMap track={track} className={className} stroke={stroke} strokeWidth={width} />;
  return (
    <svg viewBox={c.box || "0 0 100 100"} className={className} fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid meet" style={{ opacity }}>
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

// The frame of every slide: a label on a rule at the top, the moment, and a
// line at the foot.
function Shell({ label, right, foot, children, className = "" }) {
  return (
    <div className={`flex min-h-0 flex-1 flex-col px-6 pb-7 pt-[4.6rem] sm:px-7 ${className}`}>
      <In d={0}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="lv-label">{label}</span>
          {right && <span className="lv-label lv-mute">{right}</span>}
        </div>
        <div className="lv-rule st-wipe mt-2" style={{ "--d": "80ms" }} />
      </In>
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
      {foot && (
        <In d={1000}>
          <div className="lv-rule-thin mb-3" />
          <p className="lv-text">{foot}</p>
        </In>
      )}
    </div>
  );
}

const MEDAL_INK = MEDAL.map((m) => readableInkOn(m));

// --- the slides ---------------------------------------------------------------------

function Intro({ slide, review }) {
  const { driver, season, championship: c } = review;
  const words = String(driver.name || "").split(/\s+/).filter(Boolean);
  const rounds = review.rounds;
  const most = Math.max(1, ...rounds.map((r) => r.points || 0));
  return (
    <Shell label="Season review" right={`${season.label}${season.complete ? "" : " so far"}`} foot={`${season.roundsRun} rounds · ${c?.points ?? 0} points`}>
      <div className="flex flex-1 flex-col justify-center">
        <In d={150} className="flex items-center gap-3">
          {driver.number != null && <span className="lv-plate lv-display lv-num text-[2.4rem]">{driver.number}</span>}
          {driver.team && <TeamLogo id={driver.team.id} name={driver.team.name} color={driver.team.color} logoUrl={driver.team.logoUrl} size={20} showName nameClassName="lv-label" />}
        </In>
        <In d={200} className="lv-display lv-mute mt-5 text-[2.2rem] leading-none">
          {season.label}
        </In>
        <h2 className="mt-1">
          {words.map((w, k) => (
            <span key={k} className="lv-display st-slide block" style={{ ...fitWord(w), "--d": `${250 + k * 120}ms`, "--from": "-10%" }}>
              {w}
            </span>
          ))}
        </h2>
      </div>
      {/* The season in one strip: a bar per round as tall as what it paid,
          a podium in its medal, a retirement as an outline, a round not
          started as a short dash. */}
      <div className="mb-4">
        <div className="flex h-24 items-end gap-[3px]">
          {rounds.map((r, k) => {
            const finished = r.status === "FINISHED" && r.position != null;
            const medal = finished && r.position <= 3 ? MEDAL[r.position - 1] : null;
            const h = r.status === "DNS" ? 4 : Math.max(10, Math.round(((r.points || 0) / most) * 100));
            return (
              <div key={r.round} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <span
                  className="st-grow-y block rounded-[2px]"
                  style={{
                    "--d": `${600 + k * 55}ms`,
                    height: `${h}%`,
                    background: r.status === "DNS" ? "var(--g-mute)" : finished ? medal || "var(--g-fg)" : "transparent",
                    boxShadow: !finished && r.status !== "DNS" ? "inset 0 0 0 2px var(--g-fg)" : undefined,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-[3px]">
          {rounds.map((r) => (
            <span key={r.round} className="lv-label lv-mute min-w-0 flex-1 text-center text-[10px]">
              {r.round}
            </span>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function Rounds({ slide, review }) {
  const rounds = review.rounds;
  const cols = rounds.length > 12 ? "grid-cols-5" : "grid-cols-4";
  return (
    <Shell label="On the grid" right={slide.unit} foot={slide.line}>
      <div className="mt-2 flex items-end gap-4">
        <Giant value={slide.value} side="left" max={60} />
        <In d={400} className="mb-[0.6em] lv-display text-[2.6rem] leading-none">
          Starts
        </In>
      </div>
      <div className={`mt-auto grid ${cols} gap-x-3 gap-y-3 pb-4`}>
        {rounds.map((r, k) => {
          const raced = r.status !== "DNS";
          const finished = r.status === "FINISHED" && r.position != null;
          return (
            <In key={r.round} d={350 + k * 60} className="min-w-0">
              <Outline track={r.track} className="h-11 w-full" d={420 + k * 60} width={4} stroke={finished ? "var(--g-fg)" : raced ? "var(--g-accent)" : "var(--g-mute)"} opacity={raced ? 1 : 0.45} />
              <div className="lv-label mt-1 truncate text-center text-[11px]">
                <span className="lv-mute">R{r.round}</span> {finished ? `P${r.position}` : raced ? r.status : ""}
              </div>
            </In>
          );
        })}
      </div>
    </Shell>
  );
}

function Best({ slide, review }) {
  const best = review.best;
  const flag = flagFor(best.track);
  return (
    <Shell label={slide.eyebrow} right={`Round ${best.round}`}>
      {best.heroImageUrl ? (
        <In d={150} className="mt-4 overflow-hidden rounded-lg">
          <img src={best.heroImageUrl} alt={`${best.track}, round ${best.round}`} className="block aspect-[16/10] w-full object-cover" />
        </In>
      ) : (
        <div className="pointer-events-none absolute inset-x-0 top-6 bottom-36 flex items-center justify-center">
          <Outline track={best.track} className="h-full w-full" d={200} width={2.6} opacity={0.5} />
        </div>
      )}
      <div className="relative mt-auto">
        <Giant value={slide.value} side="left" max={64} d={700} tone={best.position <= 3 && !best.heroImageUrl ? undefined : undefined} />
        <In d={900} className="mt-1 flex items-center gap-3">
          {flag && <Flag code={flag.country} w={34} h={25} className="rounded-[3px]" />}
          <span className="lv-display truncate text-[3.1rem] leading-none">{slide.title}</span>
        </In>
        <In d={1050} className="lv-label lv-mute mt-2">
          {best.grid > 0 ? `From P${best.grid} on the grid · ` : ""}
          {best.points} points
        </In>
      </div>
    </Shell>
  );
}

// The climb as a straight: the back of the grid on the left, P1 on the
// right, the line drawn from where they started to where they finished.
function Climb({ slide, review }) {
  const c = review.climb;
  const field = Math.max(c.starters || 0, c.grid, c.position, 2);
  const at = (p) => 6 + ((field - p) / (field - 1)) * 88;
  return (
    <Shell label="Biggest climb" right={`Round ${c.round}, ${c.track}`} foot={slide.line}>
      <div className="mt-6">
        <Giant value={slide.value} side="right" tone="var(--g-accent)" max={70} />
        <In d={400} className="lv-display mt-1 text-right text-[2.4rem] leading-none">
          Places
        </In>
      </div>
      <In d={700} className="mt-auto pb-6">
        <svg viewBox="0 0 100 26" className="w-full" aria-hidden="true">
          <line x1="6" x2="94" y1="10" y2="10" stroke="var(--g-fg)" strokeOpacity="0.25" strokeWidth="1" />
          <line x1={at(c.grid)} x2={at(c.position)} y1="10" y2="10" pathLength="1" className="st-draw" style={{ "--d": "900ms" }} stroke="var(--g-accent)" strokeWidth="3" strokeLinecap="round" />
          <circle cx={at(c.grid)} cy="10" r="2.6" fill="var(--g-bg)" stroke="var(--g-fg)" strokeWidth="1.2" />
          <circle cx={at(c.position)} cy="10" r="3.2" fill="var(--g-accent)" />
        </svg>
        <div className="relative h-8">
          <span className="lv-label absolute -translate-x-1/2 text-[15px]" style={{ left: `${at(c.grid)}%` }}>
            P{c.grid}
          </span>
          <span className="lv-label absolute -translate-x-1/2 text-[15px] lv-accent" style={{ left: `${at(c.position)}%` }}>
            P{c.position}
          </span>
        </div>
        {c.starters ? <div className="lv-label lv-mute text-center text-[11px]">{c.starters} starters</div> : null}
      </In>
    </Shell>
  );
}

function Podiums({ slide }) {
  return (
    <Shell label="Podiums" right={slide.unit} foot={slide.line}>
      <Giant value={slide.value} side="left" tone={MEDAL[0]} max={58} />
      <ol className="mt-auto pb-4">
        {slide.podiums.slice(0, 7).map((p, k) => {
          const flag = flagFor(p.track);
          return (
            <In key={`${p.round}-${p.sprint}`} as="li" d={500 + k * 110} className="flex items-center gap-3 border-t border-[color:var(--g-mute)] py-2 first:border-t-0">
              <span className="lv-display lv-num flex h-9 w-12 items-center justify-center rounded-[4px] text-[1.6rem] leading-none" style={{ background: MEDAL[p.position - 1], color: MEDAL_INK[p.position - 1] }}>
                P{p.position}
              </span>
              {flag && <Flag code={flag.country} w={24} h={18} className="rounded-[2px]" />}
              <span className="lv-display min-w-0 truncate text-[1.9rem] leading-none">{p.track}</span>
              <span className="lv-label lv-mute ml-auto">
                R{p.round}
                {p.sprint ? " sprint" : ""}
              </span>
            </In>
          );
        })}
        {slide.podiums.length > 7 && (
          <In d={1400} className="lv-label lv-mute pt-2">
            and {slide.podiums.length - 7} more
          </In>
        )}
      </ol>
    </Shell>
  );
}

function Field({ slide }) {
  return (
    <Shell label="Against the field" foot={slide.line}>
      <div className="mt-auto pb-2">
        {slide.figures.map((f, k) => {
          const [rank, of] = String(f.rankText || "").split(" of ");
          return (
            <In key={f.k} d={200 + k * 260} className="flex items-end justify-between gap-4 border-t-[3px] border-[color:var(--g-fg)] pb-2 pt-2 first:border-t-0">
              <div className="min-w-0">
                <div className="lv-label">{f.label}</div>
                <div className="lv-display lv-num mt-1 leading-[0.8]" style={{ fontSize: "min(24cqh, 34cqi)", color: f.k === "fastestLaps" ? "var(--g-accent)" : undefined }}>
                  {f.value}
                </div>
              </div>
              <div className="pb-2 text-right">
                <div className="lv-display text-[2.6rem] leading-none">{rank}</div>
                {of && <div className="lv-label lv-mute">of {of}</div>}
              </div>
            </In>
          );
        })}
      </div>
    </Shell>
  );
}

// The place in the table after every round, P1 at the top, in the ground's
// ink: a thick line, a hairline every five places.
function Journey({ slide, review }) {
  const pts = review.championship.journey;
  const rounds = review.rounds.map((r) => r.round);
  const worst = Math.max(...pts.map((p) => p.position));
  const bottom = Math.max(5, Math.ceil(worst / 5) * 5);
  const W = 360;
  const H = 230;
  const PAD = { l: 34, r: 12, t: 14, b: 26 };
  const first = rounds[0] ?? 1;
  const lastR = rounds[rounds.length - 1] ?? first + 1;
  const x = (n) => PAD.l + ((n - first) / Math.max(1, lastR - first)) * (W - PAD.l - PAD.r);
  const y = (p) => PAD.t + ((p - 1) / Math.max(1, bottom - 1)) * (H - PAD.t - PAD.b);
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.round).toFixed(1)} ${y(p.position).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const peak = review.championship.peak;
  const marks = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70].filter((v) => v <= bottom && (v === 1 || bottom <= 20 || v % 10 === 0));
  return (
    <Shell label="Championship" right={slide.unit} foot={slide.line}>
      <Giant value={slide.value} side="right" max={62} />
      <In d={500} className="mt-auto pb-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Place in the championship after each round">
          {marks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--g-fg)" strokeOpacity="0.22" strokeWidth="1" />
              <text x={PAD.l - 7} y={y(v) + 4} textAnchor="end" fill="var(--g-mute)" style={{ font: "700 11px 'Saira Condensed', sans-serif" }}>
                P{v}
              </text>
            </g>
          ))}
          <path d={line} pathLength="1" className="st-draw" style={{ "--d": "650ms" }} fill="none" stroke="var(--g-fg)" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
          {pts.map((p) => {
            const labelled = p === last || (peak && p.round === peak.round && peak.position < last.position);
            return labelled ? (
              <g key={p.round} className="st-in" style={{ "--d": "1900ms" }}>
                <circle cx={x(p.round)} cy={y(p.position)} r="7" fill="var(--g-fg)" stroke="var(--g-bg)" strokeWidth="3" />
                <text x={x(p.round)} y={y(p.position) + (p.position <= 2 ? 26 : -14)} textAnchor="middle" fill="var(--g-fg)" style={{ font: "900 20px 'Big Shoulders Display', sans-serif" }}>
                  P{p.position}
                </text>
              </g>
            ) : null;
          })}
          {rounds.map((n) => (
            <text key={n} x={x(n)} y={H - 6} textAnchor="middle" fill="var(--g-mute)" style={{ font: "700 11px 'Saira Condensed', sans-serif" }}>
              {n}
            </text>
          ))}
        </svg>
      </In>
    </Shell>
  );
}

function Team({ slide, review }) {
  const { mate, lines } = slide;
  return (
    <Shell label="Team-mate" right={slide.title} foot={slide.line}>
      <In d={150} className="mt-6 grid grid-cols-[1fr,auto,1fr] items-end gap-3">
        <span className="lv-display min-w-0 break-words" style={halfWord(review.driver.name)}>
          {review.driver.name}
        </span>
        <span className="lv-label lv-mute pb-1">v</span>
        <span className="lv-display lv-mute min-w-0 break-words text-right" style={halfWord(mate.name)}>
          {mate.name}
        </span>
      </In>
      <div className="mt-auto space-y-6 pb-4">
        {lines.map((l, k) => {
          const total = l.me + l.them;
          const share = total > 0 ? (l.me / total) * 100 : 50;
          return (
            <In key={l.key} d={400 + k * 260}>
              <div className="grid grid-cols-[minmax(3rem,auto),1fr,minmax(3rem,auto)] items-end gap-3">
                <span className="lv-display lv-num text-[4rem] leading-[0.8]">{l.me}</span>
                <span className="lv-label pb-1 text-center">{l.label}</span>
                <span className="lv-display lv-num lv-mute text-right text-[4rem] leading-[0.8]">{l.them}</span>
              </div>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full" style={{ background: "var(--g-mute)", opacity: 1 }}>
                <span className="st-grow-x block h-full" style={{ width: `${share}%`, background: "var(--g-accent)", "--d": `${550 + k * 260}ms` }} />
              </div>
              {l.note && <div className="lv-label lv-mute mt-1.5 text-center text-[11px] normal-case tracking-normal">{l.note}</div>}
            </In>
          );
        })}
      </div>
    </Shell>
  );
}

function Contact({ slide, review }) {
  const rounds = review.rounds;
  return (
    <Shell label="Contact" right="Race by race" foot={slide.line}>
      <div className="mt-2 flex items-end gap-4">
        <Giant value={slide.value} side="left" tone="var(--g-accent)" max={56} />
        <In d={400} className="lv-display mb-[0.5em] text-[1.9rem] leading-[0.95]">
          Clean
          <br />
          rounds
        </In>
      </div>
      <In d={350} className="lv-label lv-mute -mt-1">
        {slide.unit}
      </In>
      {/* A column per round: a solid block for each contact with a car, an
          open one for the scenery, a bar along the foot for a clean round. */}
      <div className="mt-auto flex h-36 items-end gap-1.5 pb-1">
        {rounds.map((r, k) => {
          const known = r.contacts != null;
          const cars = r.contacts || 0;
          const walls = r.envContacts || 0;
          return (
            <div key={r.round} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              {!known ? (
                <span className="lv-label lv-mute text-[9px]">{r.status === "DNS" && !r.sprint ? "DNS" : "–"}</span>
              ) : cars + walls === 0 ? (
                <span className="st-grow-x block h-2 w-full rounded-[2px]" style={{ background: "var(--g-accent)", "--d": `${500 + k * 60}ms` }} />
              ) : (
                <span className="flex w-full flex-col-reverse gap-[2px]">
                  {Array.from({ length: Math.min(cars, 8) }, (_, n) => (
                    <span key={`c${n}`} className="st-in block h-3 rounded-[2px]" style={{ background: "var(--g-fg)", "--d": `${500 + k * 60 + n * 40}ms` }} />
                  ))}
                  {Array.from({ length: Math.min(walls, Math.max(0, 8 - cars)) }, (_, n) => (
                    <span key={`w${n}`} className="st-in block h-3 rounded-[2px]" style={{ boxShadow: "inset 0 0 0 2px var(--g-fg)", "--d": `${500 + k * 60 + (cars + n) * 40}ms` }} />
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mb-3 flex gap-1.5">
        {rounds.map((r) => (
          <span key={r.round} className="lv-label lv-mute min-w-0 flex-1 text-center text-[10px]">
            {r.round}
          </span>
        ))}
      </div>
    </Shell>
  );
}

const HONOUR_TONE = { champion: MEDAL[0], vice: MEDAL[1], third: MEDAL[2], "fastest-lap": "#c084fc" };

function Honours({ slide }) {
  return (
    <Shell label="Honours">
      <ol className="mt-auto pb-2">
        {slide.honours.map((h, k) => (
          <In key={h.key} as="li" d={250 + k * 220} className="flex items-stretch gap-4 border-t-[3px] border-[color:var(--g-fg)] py-3">
            <span className="w-2 shrink-0 rounded-[2px]" style={{ background: HONOUR_TONE[h.key] || "var(--g-accent)" }} />
            <span className="min-w-0">
              <span className="lv-display block text-[2.7rem] leading-[0.9]">{h.title}</span>
              {h.detail && <span className="lv-label lv-mute mt-1 block">{h.detail}</span>}
            </span>
          </In>
        ))}
      </ol>
    </Shell>
  );
}

// The last slide: the season on one poster (the picture is drawn from the
// same numbers), and the ways on.
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
  const words = String(review.driver.name || "").split(/\s+/).filter(Boolean);
  return (
    <div data-st-keep className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-[4.6rem] sm:px-7">
      <In d={0}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="lv-label">Season review</span>
          <span className="lv-label lv-mute">{slide.eyebrow}</span>
        </div>
        <div className="lv-rule mt-2" />
      </In>
      <h2 className="mt-4">
        {words.map((w, k) => (
          <span key={k} className="lv-display st-slide block" style={{ ...fitWord(w, 14), "--d": `${100 + k * 100}ms`, "--from": "-10%" }}>
            {w}
          </span>
        ))}
      </h2>
      {review.driver.team && (
        <In d={250} className="mt-2">
          <TeamLogo id={review.driver.team.id} name={review.driver.team.name} color={review.driver.team.color} logoUrl={review.driver.team.logoUrl} size={16} showName nameClassName="lv-label" />
        </In>
      )}
      <In d={350} className="mt-4 flex items-end justify-between gap-4 border-t-[3px] border-[color:var(--g-fg)] pt-3">
        {c.position ? (
          <span className="lv-display lv-num leading-[0.8]" style={{ fontSize: "min(17cqh, 36cqi)" }}>
            P{c.position}
          </span>
        ) : (
          <span />
        )}
        <div className="pb-1 text-right">
          <div className="lv-display lv-num text-[3.4rem] leading-[0.85]">{slide.points}</div>
          <div className="lv-label">points</div>
          {slide.unit && <div className="lv-label lv-mute mt-1 normal-case tracking-normal">{slide.unit}</div>}
        </div>
      </In>
      <In d={500} className="mt-4 grid grid-cols-3 border-t-[3px] border-[color:var(--g-fg)]">
        {slide.grid.map((g, k) => (
          <div key={g.k} className={`min-w-0 py-2.5 ${k % 3 ? "border-l-[1.5px] border-[color:var(--g-mute)] pl-3" : ""} ${k >= 3 ? "border-t-[1.5px] border-[color:var(--g-mute)]" : ""}`}>
            <div className="lv-label lv-mute text-[11px] leading-tight">{g.label}</div>
            <div className="lv-display lv-num mt-1 text-[2.3rem] leading-[0.85]">{g.value}</div>
            {g.sub && <div className="lv-label lv-mute mt-0.5 truncate text-[10px]">{g.sub}</div>}
          </div>
        ))}
      </In>
      <In d={700} className="mt-auto pt-5">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={state === "busy"} className="lv-btn lv-btn-solid">
            {state === "busy" ? "Drawing it" : "Save picture"}
          </button>
          <button type="button" onClick={onSheet} className="lv-btn lv-btn-line">
            Every round
          </button>
        </div>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <button type="button" onClick={copy} className="lv-link">
            {state === "copied" ? "Link copied" : "Copy link"}
          </button>
          <button type="button" onClick={onReplay} className="lv-link">
            Watch again
          </button>
          <Link to={`/drivers/${review.driver.id}?season=${review.season.number}`} className="lv-link">
            Driver page
          </Link>
        </div>
        {state === "failed" && <p className="lv-label mt-2 normal-case tracking-normal">The picture could not be made in this browser.</p>}
        {state === "saved" && <p className="lv-label lv-mute mt-2 normal-case tracking-normal">Saved to your downloads.</p>}
      </In>
    </div>
  );
}

const SLIDES = { intro: Intro, rounds: Rounds, best: Best, climb: Climb, podiums: Podiums, field: Field, journey: Journey, team: Team, contact: Contact, honours: Honours, final: Final };

export default function StorySlide({ slide, review, onReplay, onSheet }) {
  const Slide = SLIDES[slide.key];
  return Slide ? <Slide slide={slide} review={review} onReplay={onReplay} onSheet={onSheet} /> : null;
}
