// One slide of the season story (review/Story.jsx), after Spotify Wrapped
// 2025: black and white with one colour, the team's (review/wrapPalette.js),
// and the type doing the work. Poster lines in capitals set edge to edge
// across the frame, a hero figure with outlined echoes stepped out behind
// it, a word picked out with a marker in the team colour, small labels set
// against huge words. The circuits stand in for album covers.
//
// When the person looking is not the driver, the same lines carry the
// driver's name instead of "you" (review.own, from the backend). Every
// figure is real (review/storySlides.mjs, review/copy.mjs).
import { useState } from "react";
import { Link } from "react-router-dom";
import { MEDAL, readableInkOn } from "../../components/ui.jsx";
import CircuitMap from "../../components/CircuitMap.jsx";
import { circuitFor } from "../../data/circuits.js";
import { nth } from "./copy.mjs";
import { seasonList } from "./storySlides.mjs";
import { saveSharePicture } from "./sharePicture.js";

const MEDAL_INK = MEDAL.map((m) => readableInkOn(m));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

// "You" for the driver, the name for everyone else.
export function voiceOf(review) {
  const name = review.driver?.name || "This driver";
  return review.own
    ? { You: "You", you: "you", Your: "Your", your: "your", are: "are" }
    : { You: name, you: name, Your: `${name}'s`, your: `${name}'s`, are: "is" };
}

// --- type ----------------------------------------------------------------------------

// A poster line: capitals set edge to edge across the frame. The SVG's text
// is given the full width to fill; a line too short to fill it without
// looking stretched (a single figure) keeps its own width instead.
function Fill({ text, d = 0, outline = false, className = "", maxHeight = 520, align = "left", style }) {
  const t = String(text ?? "").toUpperCase();
  const n = Math.max(1, [...t].reduce((w, ch) => w + (ch === " " ? 0.32 : /[I1.,:']/.test(ch) ? 0.42 : 0.78), 0));
  const size = Math.min(1000 / n, maxHeight);
  const natural = size * n;
  const stretch = natural >= 820;
  const h = Math.round(size * 0.74);
  const x = align === "right" && !stretch ? 1000 - natural : 0;
  return (
    <div className={`st-in ${className}`} style={{ "--d": `${d}ms`, ...style }}>
      <svg viewBox={`0 0 1000 ${h}`} className={`wr-fill ${outline ? "is-outline" : ""}`} role="img" aria-label={text}>
        <text x={x} y={h} fontSize={size} {...(stretch ? { textLength: 1000, lengthAdjust: "spacingAndGlyphs" } : {})}>
          {t}
        </text>
      </svg>
    </div>
  );
}

// The hero figure with two outlined echoes stepped out behind it.
function Echo({ value, d = 300, size, className = "" }) {
  const v = String(value ?? "");
  // As big as the frame takes for the figure's length (Montserrat Black
  // figures run about 0.72 em), leaving room for the echoes.
  if (!size) size = `min(56cqi, ${(84 / (Math.max(1, v.length) * 0.74)).toFixed(1)}cqi, 30cqh)`;
  return (
    <div className={`wr-echo wr-big wr-num st-land whitespace-nowrap ${className}`} style={{ "--d": `${d}ms`, fontSize: size, lineHeight: 0.82 }}>
      <span className="wr-ghost" style={{ "--sx": "0.09em", "--sy": "0.07em", "--d": `${d + 350}ms` }} aria-hidden="true">
        {v}
      </span>
      <span className="wr-ghost" style={{ "--sx": "0.045em", "--sy": "0.035em", "--d": `${d + 250}ms` }} aria-hidden="true">
        {v}
      </span>
      <span className="relative">{v}</span>
    </div>
  );
}

// A small label, the quiet voice set against the loud one.
const Kicker = ({ d = 0, className = "", children }) => (
  <div className={`st-in text-[13px] font-bold uppercase tracking-[0.14em] ${className}`} style={{ "--d": `${d}ms`, fontFamily: "Inter, sans-serif" }}>
    {children}
  </div>
);

// A plain sentence with a word or two picked out by the marker.
const Line = ({ d = 0, className = "", children, size = "min(6.6cqi, 3.6cqh)" }) => (
  <div className={`st-in font-extrabold leading-[1.25] ${className}`} style={{ "--d": `${d}ms`, fontSize: size }}>
    {children}
  </div>
);
const Mark = ({ children }) => <span className="wr-mark">{children}</span>;

// A circuit's outline from the site's own data, drawn once from its start.
function Outline({ track, className = "", d = 250, stroke = "currentColor", width = 4, draw = true }) {
  const c = circuitFor(track);
  if (!c) return <CircuitMap track={track} className={className} stroke={stroke} strokeWidth={width} />;
  return (
    <svg viewBox={c.box || "0 0 100 100"} className={className} fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path d={c.path} pathLength="1" className={draw ? "st-draw" : ""} style={{ "--d": `${d}ms` }} stroke={stroke} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Card({ children, className = "" }) {
  return <div className={`relative z-10 flex min-h-0 flex-1 flex-col px-6 pb-8 pt-[5.2rem] sm:px-7 ${className}`}>{children}</div>;
}

// --- the slides --------------------------------------------------------------------------

function Intro({ review }) {
  const v = voiceOf(review);
  const { season, driver } = review;
  const num = /\d+$/.exec(String(season.label))?.[0] || "";
  const head = num ? String(season.label).slice(0, -num.length).trim() : season.label;
  return (
    <Card>
      <Kicker d={100}>{review.own ? "This was your" : `This was ${v.your}`}</Kicker>
      <Fill text={head} d={250} className="mt-3" />
      {num && <Echo value={num} d={500} size="min(92cqi, 52cqh)" className="-mt-2" />}
      <div className="mt-auto">
        <Line d={1300}>
          <Mark>{driver.name}</Mark>
        </Line>
        <Kicker d={1500} className="mt-3 lv-mute">
          {season.roundsRun} rounds{driver.team?.name ? ` · ${driver.team.name}` : ""}
          {season.complete ? "" : " · so far"}
        </Kicker>
      </div>
    </Card>
  );
}

function Rounds({ review }) {
  const v = voiceOf(review);
  const s = review.stats;
  const n = review.rounds.length;
  return (
    <Card>
      <Fill text={`${v.You} started`} d={100} />
      <Echo value={s.starts} d={350} className="mt-4" />
      <Fill text={`of ${n} rounds`} d={800} className="mt-4" outline />
      <div className="mt-auto">
        <Line d={1400}>{s.finishes === s.starts ? <>And finished <Mark>every single one</Mark>.</> : <>And saw the flag in <Mark>{plural(s.finishes, "race")}</Mark>.</>}</Line>
      </div>
    </Card>
  );
}

function Top({ slide, review }) {
  const v = voiceOf(review);
  return (
    <Card>
      <Fill text={`${v.Your} top`} d={100} />
      <Fill text="results" d={250} outline />
      <ol className="mt-auto space-y-4 pb-1">
        {slide.list.map((t, k) => (
          <li key={`${t.round}-${t.sprint}`} className="st-in flex items-center gap-4" style={{ "--d": `${550 + k * 170}ms` }}>
            <span className="wr-big wr-num w-8 shrink-0 text-[2.6rem] leading-none" style={k === 0 ? { color: "var(--g-mark)" } : { color: "transparent", WebkitTextStroke: "1.5px var(--g-fg)" }}>
              {k + 1}
            </span>
            <span className="wr-cover w-[3.4rem] shrink-0" style={k === 0 ? { background: "var(--g-mark)", color: "var(--g-mark-fg)" } : undefined}>
              <Outline track={t.track} className="h-[74%] w-[74%]" d={650 + k * 170} width={7} />
            </span>
            <span className="min-w-0">
              <span className="wr-big block truncate text-[1.45rem] uppercase leading-none">{t.track}</span>
              <span className="mt-1 block text-[13px] font-bold opacity-70" style={{ fontFamily: "Inter, sans-serif" }}>
                P{t.position}
                {t.sprint ? " in the sprint" : ""} · {plural(t.points, "point")}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Best({ review }) {
  const v = voiceOf(review);
  const b = review.best;
  return (
    <Card>
      <Kicker d={100}>{v.Your} best race</Kicker>
      <div className="relative mt-4 flex-1">
        <div className="absolute inset-0 flex items-center justify-center opacity-90">
          {b.heroImageUrl ? <img src={b.heroImageUrl} alt="" className="h-full w-full rounded-md object-cover" /> : <Outline track={b.track} className="h-full w-full opacity-40" d={300} width={2.4} />}
        </div>
        <div className="absolute bottom-0 left-0">
          <Echo value={`P${b.position}`} d={900} size="min(48cqi, 26cqh)" />
        </div>
      </div>
      <Fill text={b.track} d={1300} className="mt-3" />
      <Line d={1550} className="mt-3" size="min(5.6cqi, 3cqh)">
        {b.grid > 0 ? (
          <>
            From <Mark>P{b.grid} on the grid</Mark>, round {b.round}.
          </>
        ) : (
          <>Round {b.round}.</>
        )}
      </Line>
    </Card>
  );
}

function Climb({ review }) {
  const v = voiceOf(review);
  const c = review.climb;
  return (
    <Card>
      <Fill text={`${v.You} made up`} d={100} />
      <Echo value={`+${c.gained}`} d={350} className="mt-4" />
      <Fill text="places" d={800} className="mt-4" outline />
      <div className="mt-auto">
        <Line d={1400}>
          In one race: <Mark>{c.track}</Mark>, from P{c.grid} to P{c.position}.
        </Line>
      </div>
    </Card>
  );
}

function Podiums({ slide, review }) {
  const v = voiceOf(review);
  const n = slide.podiums.length;
  return (
    <Card>
      <Fill text={`${v.You} stood on`} d={100} />
      <Fill text="the podium" d={250} outline />
      <div className="mt-4 flex items-end gap-4">
        <Echo value={n} d={500} size="min(50cqi, 26cqh)" />
        <Line d={900} className="mb-4">
          {n === 1 ? "time." : "times."}
        </Line>
      </div>
      <div className="mt-auto flex flex-wrap gap-x-3 gap-y-3">
        {slide.podiums.slice(0, 8).map((p, k) => (
          <div key={`${p.round}-${p.sprint}`} className="st-land flex w-[4.2rem] flex-col items-center text-center" style={{ "--d": `${1200 + k * 120}ms` }}>
            <span className="wr-big flex h-12 w-12 items-center justify-center rounded-full text-[1.25rem]" style={{ background: MEDAL[p.position - 1], color: MEDAL_INK[p.position - 1] }}>
              P{p.position}
            </span>
            <span className="mt-1 w-full truncate text-[11px] font-bold uppercase" style={{ fontFamily: "Inter, sans-serif" }}>
              {p.track}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// "You set the fastest lap twice." and where that put them in the field.
function figureLine(f, v) {
  const n = f.value;
  switch (f.k) {
    case "fastestLaps":
      return `${v.You} set the fastest lap ${times(n)}.`;
    case "overtakes":
      return `${v.You} made ${plural(n, "overtake")}.`;
    case "lapsLed":
      return `${v.You} led ${plural(n, "lap")}.`;
    case "poles":
      return `${v.You} took ${plural(n, "pole")}.`;
    case "wins":
      return `${v.You} won ${plural(n, "race")}.`;
    default:
      return `${f.label}: ${n}.`;
  }
}

function Field({ slide, review }) {
  const v = voiceOf(review);
  const [first, ...rest] = slide.figures;
  const rank = first.rank;
  return (
    <Card>
      <Line d={100}>{figureLine(first, v)}</Line>
      <Kicker d={450} className="mt-6 lv-mute">
        That made {v.you}
      </Kicker>
      {rank.shared && <Fill text="joint" d={600} className="mt-2" outline />}
      <Echo value={nth(rank.rank)} d={750} size="min(54cqi, 28cqh)" className="mt-1" />
      <Line d={1150} className="mt-3">
        out of <Mark>{rank.of} drivers</Mark>.
      </Line>
      <div className="mt-auto space-y-2.5">
        {rest.map((f, k) => (
          <div key={f.k} className="st-in flex items-baseline justify-between gap-3 border-t border-[color:var(--g-faint)] pt-2" style={{ "--d": `${1600 + k * 220}ms` }}>
            <span className="text-[15px] font-extrabold">{figureLine(f, v)}</span>
            <span className="shrink-0 text-[13px] font-bold opacity-70" style={{ fontFamily: "Inter, sans-serif" }}>
              {f.rankText}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// The place in the table after every round, as one bold line in the accent.
function Journey({ slide, review }) {
  const v = voiceOf(review);
  const pts = review.championship.journey;
  const rounds = review.rounds.map((r) => r.round);
  const worst = Math.max(...pts.map((p) => p.position));
  const bottom = Math.max(5, Math.ceil(worst / 5) * 5);
  const W = 360;
  const H = 190;
  const PAD = { l: 8, r: 14, t: 14, b: 22 };
  const first = rounds[0] ?? 1;
  const lastR = rounds[rounds.length - 1] ?? first + 1;
  const x = (n) => PAD.l + ((n - first) / Math.max(1, lastR - first)) * (W - PAD.l - PAD.r);
  const y = (p) => PAD.t + ((p - 1) / Math.max(1, bottom - 1)) * (H - PAD.t - PAD.b);
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.round).toFixed(1)} ${y(p.position).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const done = review.season.complete;
  return (
    <Card>
      <Kicker d={100}>{done ? `${v.You} finished the season` : `After round ${last.round}, ${v.you} ${v.are}`}</Kicker>
      <Echo value={slide.value} d={300} className="mt-3" />
      <Fill text="in the championship" d={750} className="mt-4" outline />
      <div className="st-in mt-auto" style={{ "--d": "1100ms" }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label="Place in the championship after each round">
          <path d={line} pathLength="1" className="st-draw" style={{ "--d": "1200ms" }} fill="none" stroke="var(--g-mark)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(last.round)} cy={y(last.position)} r="9" fill="var(--g-fg)" />
          {rounds.map((n) => (
            <text key={n} x={x(n)} y={H - 2} textAnchor="middle" fill="var(--g-mute)" style={{ font: "700 11px Inter, sans-serif" }}>
              {n}
            </text>
          ))}
        </svg>
      </div>
    </Card>
  );
}

function Team({ slide, review }) {
  const v = voiceOf(review);
  const { mate, lines } = slide;
  const [head, ...rest] = lines;
  return (
    <Card>
      <Fill text={review.own ? "You" : review.driver.name} d={100} />
      <Kicker d={250} className="mt-2 lv-mute">
        against
      </Kicker>
      <Fill text={mate.name} d={350} className="mt-2" outline />
      {head && (
        <div className="mt-5 flex items-end gap-4">
          <Echo value={`${head.me}-${head.them}`} d={600} size="min(40cqi, 22cqh)" />
          <Line d={1000} className="mb-3" size="min(5.4cqi, 3cqh)">
            {head.key === "races" ? (
              <>
                <Mark>ahead</Mark> at the flag
              </>
            ) : (
              head.label.toLowerCase()
            )}
          </Line>
        </div>
      )}
      <div className="mt-auto space-y-2.5">
        {rest.map((l, k) => (
          <div key={l.key} className="st-in flex items-baseline justify-between gap-3 border-t border-[color:var(--g-faint)] pt-2" style={{ "--d": `${1300 + k * 220}ms` }}>
            <span className="text-[15px] font-extrabold">{l.label}</span>
            <span className="wr-big wr-num text-[1.8rem]">
              {l.me}-{l.them}
            </span>
          </div>
        ))}
        {slide.line && (
          <Kicker d={1800} className="pt-1 lv-mute">
            {slide.line}
          </Kicker>
        )}
      </div>
    </Card>
  );
}

function Contact({ review }) {
  const v = voiceOf(review);
  const k = review.contact;
  return (
    <Card>
      <Fill text={`${v.You} kept it`} d={100} />
      <Fill text="clean in" d={250} outline />
      <Echo value={k.clean} d={500} className="mt-4" />
      <Line d={900} className="mt-3">
        <Mark>{k.clean === 1 ? "round" : "rounds"}</Mark> without touching another car.
      </Line>
      <div className="mt-auto">
        <div className="flex h-20 items-end gap-1.5">
          {review.rounds.map((r, n) => {
            const known = r.contacts != null;
            const cars = r.contacts || 0;
            return (
              <div key={r.round} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                {known ? (
                  <span
                    className="st-grow-y block w-full rounded-t-[3px]"
                    style={{ "--d": `${1300 + n * 60}ms`, height: cars ? `${Math.min(100, 18 + cars * 16)}%` : "5px", background: cars ? "var(--g-fg)" : "var(--g-mark)" }}
                  />
                ) : (
                  <span className="block h-[5px] w-full rounded-full" style={{ boxShadow: "inset 0 0 0 1.5px var(--g-mute)" }} />
                )}
              </div>
            );
          })}
        </div>
        <Kicker d={1700} className="mt-3 lv-mute normal-case tracking-normal">
          Contact with other cars, round by round: {k.cars} in all.
        </Kicker>
      </div>
    </Card>
  );
}

function Honours({ slide, review }) {
  const v = voiceOf(review);
  return (
    <Card>
      <Kicker d={100}>And {v.you} took home</Kicker>
      <div className="mt-auto space-y-3">
        {slide.honours.map((h, k) => (
          <div key={h.key}>
            <Fill text={h.title} d={350 + k * 250} outline={k % 2 === 1} maxHeight={260} />
            {h.detail && (
              <Kicker d={450 + k * 250} className="mt-1 lv-mute normal-case tracking-normal">
                {h.detail}
              </Kicker>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// A name set as big as the card's text column takes, never broken inside a
// word (Montserrat Black runs about 0.68 em a letter).
const nameFit = (name) => {
  const n = Math.max(4, ...String(name || "").split(/\s+/).map((w) => w.length));
  return { fontSize: `min(9cqi, 4.6cqh, calc(46cqi / ${(n * 0.68).toFixed(2)}))` };
};

// The last slide: the summary card, the way Wrapped ends. A cover on top,
// two lists side by side, the two big numbers at the foot. The picture that
// "Save picture" makes is this card.
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
  const top = slide.top || [];
  return (
    <div data-st-keep className="relative z-10 flex min-h-0 flex-1 flex-col px-5 pb-5 pt-[4.4rem] sm:px-6">
      <div className="st-land flex min-h-0 flex-1 flex-col rounded-xl p-4" style={{ "--d": "100ms", background: "var(--g-fg)", color: "var(--g-bg)" }}>
        <div className="flex items-center gap-3">
          <div className="wr-cover w-[40%] shrink-0" style={{ background: "var(--g-mark)", color: "var(--g-mark-fg)" }}>
            {review.best ? <Outline track={review.best.track} className="h-[74%] w-[74%]" d={400} width={6} /> : null}
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-bold uppercase tracking-[0.12em] opacity-60" style={{ fontFamily: "Inter, sans-serif" }}>
              {slide.eyebrow}
            </div>
            <div className="wr-big uppercase" style={nameFit(review.driver.name)}>
              {review.driver.name}
            </div>
            {review.driver.team?.name && (
              <div className="mt-0.5 text-[13px] font-bold opacity-60" style={{ fontFamily: "Inter, sans-serif" }}>
                {review.driver.team.name}
              </div>
            )}
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-60" style={{ fontFamily: "Inter, sans-serif" }}>
              Top results
            </div>
            <ol className="mt-1.5 space-y-0.5">
              {top.map((t, k) => (
                <li key={`${t.round}-${t.sprint}`} className="truncate text-[15px] font-extrabold leading-snug">
                  {k + 1} {t.track} <span className="opacity-50">P{t.position}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-60" style={{ fontFamily: "Inter, sans-serif" }}>
              The season
            </div>
            <ol className="mt-1.5 space-y-0.5">
              {seasonList(slide, review).map((g) => (
                <li key={g.k} className="truncate text-[15px] font-extrabold leading-snug">
                  {g.value} <span className="opacity-50">{g.label}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="mt-auto grid grid-cols-2 gap-4 pt-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-60" style={{ fontFamily: "Inter, sans-serif" }}>
              Points
            </div>
            <div className="wr-big wr-num" style={{ fontSize: "min(15cqi, 7cqh)" }}>
              {slide.points}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-60" style={{ fontFamily: "Inter, sans-serif" }}>
              Championship
            </div>
            <div className="wr-big wr-num" style={{ fontSize: "min(15cqi, 7cqh)", color: "var(--g-mark)" }}>
              {c.position ? `P${c.position}` : "–"}
            </div>
          </div>
        </div>
        <div className="mt-3 text-[12px] font-bold opacity-50" style={{ fontFamily: "Inter, sans-serif" }}>
          NABS Racing League · {review.season.label}
        </div>
      </div>
      <div className="st-in pt-4" style={{ "--d": "700ms" }}>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={state === "busy"} className="lv-btn lv-btn-solid">
            {state === "busy" ? "Drawing it" : "Save picture"}
          </button>
          <button type="button" onClick={onSheet} className="lv-btn lv-btn-line">
            Every round
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
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
        {state === "failed" && <p className="wr-small mt-2">The picture could not be made in this browser.</p>}
        {state === "saved" && <p className="wr-small lv-mute mt-2">Saved to your downloads.</p>}
      </div>
    </div>
  );
}

const SLIDES = { intro: Intro, rounds: Rounds, top: Top, best: Best, climb: Climb, podiums: Podiums, field: Field, journey: Journey, team: Team, contact: Contact, honours: Honours, final: Final };

export default function StorySlide({ slide, review, onReplay, onSheet }) {
  const Comp = SLIDES[slide.key];
  return Comp ? <Comp slide={slide} review={review} onReplay={onReplay} onSheet={onSheet} /> : null;
}
