// One slide of the season story (review/Story.jsx), set the way Spotify sets
// its Wrapped: one flat colour per slide (review/wrapPalette.js), a sentence
// in very big, very heavy type that speaks to the driver ("You started…"),
// one figure as the hero of the slide, a ranked top five with covers (here
// the real circuits), and a summary card at the end to save and share.
//
// When the person looking is not the driver, the same sentences carry the
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

// --- pieces ---------------------------------------------------------------------------

// A line of a statement, rising in at its beat.
const Say = ({ d = 0, className = "", style, children }) => (
  <div className={`wr-say st-in ${className}`} style={{ "--d": `${d}ms`, ...style }}>
    {children}
  </div>
);

// The hero figure of a slide: as big as the frame takes for its length.
function Hero({ value, d = 350, max = 62, className = "", style }) {
  const s = String(value ?? "");
  const n = Math.max(1, s.length);
  return (
    <div className={`wr-big wr-num st-land whitespace-nowrap ${className}`} style={{ "--d": `${d}ms`, fontSize: `min(${max}cqi, ${(88 / (n * 0.7)).toFixed(1)}cqi, 34cqh)`, ...style }}>
      {s}
    </div>
  );
}

// A small line under the statement.
const Small = ({ d = 0, className = "", children }) => (
  <div className={`wr-small lv-mute st-in ${className}`} style={{ "--d": `${d}ms` }}>
    {children}
  </div>
);

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

// A circuit as a cover: a square in the slide's strong colour, the track on it.
function Cover({ track, className = "", d = 250, width = 6, style }) {
  return (
    <div className={`wr-cover ${className}`} style={style}>
      <Outline track={track} className="h-[74%] w-[74%]" d={d} width={width} />
    </div>
  );
}

// The slide: the statement block, laid out from the top like a Wrapped card.
function Card({ children, className = "" }) {
  return <div className={`relative z-10 flex min-h-0 flex-1 flex-col px-6 pb-8 pt-[5.2rem] sm:px-7 ${className}`}>{children}</div>;
}

// The figure as a moving pattern behind a slide, faint.
function Pattern({ text, rows = 5, size = "34cqi" }) {
  const row = `${text} `.repeat(8);
  return (
    <div className="wr-pattern" aria-hidden="true" style={{ color: "var(--g-faint)" }}>
      {Array.from({ length: rows }, (_, k) => (
        <div key={k} className="wr-big" style={{ fontSize: size, lineHeight: 0.9 }}>
          {row}
          {row}
        </div>
      ))}
    </div>
  );
}

// --- the slides --------------------------------------------------------------------------

function Intro({ review }) {
  const v = voiceOf(review);
  const { season, driver } = review;
  const num = /\d+$/.exec(String(season.label))?.[0] || "";
  return (
    <>
      <Pattern text={num || season.label} rows={6} />
      <Card className="justify-center">
        <Say d={100}>{review.own ? "This was your" : `This was ${v.your}`}</Say>
        <Hero value={season.label} d={350} max={40} className="mt-2" />
        <Say d={900} className="mt-4" style={{ fontSize: "min(6.2cqi, 3.4cqh)" }}>
          {season.roundsRun} rounds{driver.team?.name ? ` with ${driver.team.name}` : ""}.
        </Say>
        <Small d={1300} className="mt-3">
          {season.complete ? "Tap through the season." : "The season so far. Tap through it."}
        </Small>
      </Card>
    </>
  );
}

function Rounds({ review }) {
  const v = voiceOf(review);
  const s = review.stats;
  const n = review.rounds.length;
  return (
    <Card>
      <Say d={100}>{v.You} started</Say>
      <Hero value={s.starts} d={350} />
      <Say d={850}>of the {plural(n, "round")}.</Say>
      <Say d={1500} className="mt-6">
        {s.finishes === s.starts ? (s.starts === 1 ? "And finished it." : "And finished every one.") : `Finished ${s.finishes} of them.`}
      </Say>
      {/* A dot per round: started ones full, missed ones open. */}
      <div className="mt-auto flex flex-wrap gap-2">
        {review.rounds.map((r, k) => (
          <span
            key={r.round}
            className="st-in block h-4 w-4 rounded-full"
            style={{ "--d": `${1800 + k * 50}ms`, background: r.status !== "DNS" ? "var(--g-fg)" : "transparent", boxShadow: "inset 0 0 0 2px var(--g-fg)" }}
          />
        ))}
      </div>
    </Card>
  );
}

function Top({ slide, review }) {
  const v = voiceOf(review);
  return (
    <Card>
      <Say d={100}>{v.Your} top results</Say>
      <ol className="mt-auto space-y-3.5 pb-2">
        {slide.list.map((t, k) => (
          <li key={`${t.round}-${t.sprint}`} className="st-in flex items-center gap-3.5" style={{ "--d": `${450 + k * 170}ms` }}>
            <span className="wr-big wr-num w-7 shrink-0 text-[2.2rem]">{k + 1}</span>
            <Cover track={t.track} className="w-[3.6rem] shrink-0" d={550 + k * 170} width={7} />
            <span className="min-w-0">
              <span className="block truncate text-[1.25rem] font-extrabold leading-tight">{t.track}</span>
              <span className="wr-small lv-mute block">
                P{t.position}
                {t.sprint ? " in the sprint" : ""} · {plural(t.points, "point")} · R{t.round}
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
      <Say d={100}>{v.Your} best race</Say>
      <div className="st-land mx-auto mt-6 w-[72%]" style={{ "--d": "350ms" }}>
        {b.heroImageUrl ? (
          <img src={b.heroImageUrl} alt="" className="aspect-square w-full rounded-md object-cover" />
        ) : (
          <div className="wr-cover w-full" style={{ background: "var(--g-pop)", color: "var(--g-pop-fg)" }}>
            <Outline track={b.track} className="h-[76%] w-[76%]" d={650} width={3.4} />
          </div>
        )}
      </div>
      <div className="mt-auto">
        <div className="wr-big st-in text-center" style={{ "--d": "1100ms", fontSize: "min(14cqi, 7cqh)" }}>
          {b.track}
        </div>
        <Say d={1350} className="mt-2 text-center" style={{ fontSize: "min(6cqi, 3.2cqh)" }}>
          P{b.position}
          {b.grid > 0 ? ` from P${b.grid}` : ""}
          {b.sprint ? " in the sprint" : ""}.
        </Say>
        <Small d={1600} className="mt-1 text-center">
          Round {b.round} · {plural(b.points, "point")}
        </Small>
      </div>
    </Card>
  );
}

function Climb({ review }) {
  const v = voiceOf(review);
  const c = review.climb;
  return (
    <Card>
      <Say d={100}>{v.You} made up</Say>
      <Hero value={c.gained} d={350} />
      <Say d={850}>places in one race.</Say>
      <div className="mt-auto">
        <Say d={1400} style={{ fontSize: "min(6.4cqi, 3.4cqh)" }}>
          {c.track}, round {c.round}.
        </Say>
        <Small d={1600} className="mt-1">
          From P{c.grid} on the grid to P{c.position}
          {c.starters ? `, ${c.starters} starters` : ""}.
        </Small>
      </div>
    </Card>
  );
}

function Podiums({ slide, review }) {
  const v = voiceOf(review);
  const n = slide.podiums.length;
  return (
    <Card>
      <Say d={100}>{v.You} stood on the podium</Say>
      <Hero value={n} d={350} />
      <Say d={850}>{n === 1 ? "time." : "times."}</Say>
      <div className="mt-auto flex flex-wrap gap-x-3 gap-y-4">
        {slide.podiums.slice(0, 8).map((p, k) => (
          <div key={`${p.round}-${p.sprint}`} className="st-land flex w-[4.4rem] flex-col items-center text-center" style={{ "--d": `${1200 + k * 140}ms` }}>
            <span className="wr-big flex h-14 w-14 items-center justify-center rounded-full text-[1.4rem]" style={{ background: MEDAL[p.position - 1], color: MEDAL_INK[p.position - 1] }}>
              P{p.position}
            </span>
            <span className="wr-small mt-1 w-full truncate text-[12px]">{p.track}</span>
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
      <Say d={100}>{figureLine(first, v)}</Say>
      <Say d={500} className="mt-6" style={{ fontSize: "min(6cqi, 3.2cqh)" }}>
        That made {v.you}
        {rank.shared ? " joint" : ""}
      </Say>
      <Hero value={nth(rank.rank)} d={750} max={52} />
      <Say d={1200} style={{ fontSize: "min(6cqi, 3.2cqh)" }}>
        of {rank.of} drivers.
      </Say>
      <div className="mt-auto space-y-3">
        {rest.map((f, k) => (
          <div key={f.k} className="st-in flex items-baseline justify-between gap-3 border-t-2 border-[color:var(--g-fg)] pt-2" style={{ "--d": `${1700 + k * 250}ms` }}>
            <span className="text-[1.05rem] font-extrabold leading-snug">{figureLine(f, v)}</span>
            <span className="wr-small shrink-0">{f.rankText}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// The place in the table after every round, as one bold line.
function Journey({ slide, review }) {
  const v = voiceOf(review);
  const pts = review.championship.journey;
  const rounds = review.rounds.map((r) => r.round);
  const worst = Math.max(...pts.map((p) => p.position));
  const bottom = Math.max(5, Math.ceil(worst / 5) * 5);
  const W = 360;
  const H = 200;
  const PAD = { l: 8, r: 14, t: 16, b: 22 };
  const first = rounds[0] ?? 1;
  const lastR = rounds[rounds.length - 1] ?? first + 1;
  const x = (n) => PAD.l + ((n - first) / Math.max(1, lastR - first)) * (W - PAD.l - PAD.r);
  const y = (p) => PAD.t + ((p - 1) / Math.max(1, bottom - 1)) * (H - PAD.t - PAD.b);
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.round).toFixed(1)} ${y(p.position).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const done = review.season.complete;
  return (
    <Card>
      <Say d={100}>{done ? `${v.You} finished the season` : `After round ${last.round}, ${v.you} ${v.are}`}</Say>
      <Hero value={slide.value} d={350} />
      <Say d={850}>in the championship.</Say>
      <div className="st-in mt-auto" style={{ "--d": "1200ms" }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label="Place in the championship after each round">
          <path d={line} pathLength="1" className="st-draw" style={{ "--d": "1300ms" }} fill="none" stroke="var(--g-fg)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(last.round)} cy={y(last.position)} r="9" fill="var(--g-fg)" />
          {rounds.map((n) => (
            <text key={n} x={x(n)} y={H - 2} textAnchor="middle" fill="var(--g-mute)" style={{ font: "700 11px Inter, sans-serif" }}>
              {n}
            </text>
          ))}
        </svg>
        <Small d={1700} className="mt-2">
          {slide.line}
        </Small>
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
      <Say d={100}>
        {v.You} against {mate.name}
      </Say>
      {head && (
        <>
          <Hero value={`${head.me}–${head.them}`} d={350} max={54} className="mt-3" />
          <Say d={850} style={{ fontSize: "min(6cqi, 3.2cqh)" }}>
            {head.key === "races" ? "ahead at the flag." : head.label.toLowerCase() + "."}
          </Say>
        </>
      )}
      <div className="mt-auto space-y-3">
        {rest.map((l, k) => (
          <div key={l.key} className="st-in flex items-baseline justify-between gap-3 border-t-2 border-[color:var(--g-fg)] pt-2" style={{ "--d": `${1300 + k * 250}ms` }}>
            <span className="text-[1.05rem] font-extrabold">{l.label}</span>
            <span className="wr-big wr-num text-[1.9rem]">
              {l.me}–{l.them}
            </span>
          </div>
        ))}
        {slide.line && <Small d={1900}>{slide.line}</Small>}
      </div>
    </Card>
  );
}

function Contact({ review }) {
  const v = voiceOf(review);
  const k = review.contact;
  return (
    <Card>
      <Say d={100}>{v.You} got through</Say>
      <Hero value={k.clean} d={350} />
      <Say d={850}>{k.clean === 1 ? "round" : "rounds"} without touching another car.</Say>
      <div className="mt-auto">
        <div className="flex h-24 items-end gap-1.5">
          {review.rounds.map((r, n) => {
            const known = r.contacts != null;
            const cars = r.contacts || 0;
            return (
              <div key={r.round} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                {known ? (
                  <span
                    className="st-grow-y block w-full rounded-t-[4px]"
                    style={{ "--d": `${1200 + n * 60}ms`, height: cars ? `${Math.min(100, 18 + cars * 16)}%` : "6px", background: cars ? "var(--g-fg)" : "var(--g-mute)" }}
                  />
                ) : (
                  <span className="block h-[6px] w-full rounded-full" style={{ boxShadow: "inset 0 0 0 1.5px var(--g-mute)" }} />
                )}
              </div>
            );
          })}
        </div>
        <Small d={1700} className="mt-3">
          Contact with other cars, round by round. {k.cars} in all, {k.scenery} with the scenery.
        </Small>
      </div>
    </Card>
  );
}

function Honours({ slide, review }) {
  const v = voiceOf(review);
  return (
    <Card>
      <Say d={100}>And {v.you} took home</Say>
      <ol className="mt-auto space-y-4">
        {slide.honours.map((h, k) => (
          <li key={h.key} className="st-in border-t-2 border-[color:var(--g-fg)] pt-2" style={{ "--d": `${450 + k * 220}ms` }}>
            <span className="wr-big block" style={{ fontSize: "min(10cqi, 5.5cqh)" }}>
              {h.title}
            </span>
            {h.detail && <span className="wr-small lv-mute block">{h.detail}</span>}
          </li>
        ))}
      </ol>
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
          <div className="wr-cover w-[40%] shrink-0" style={{ background: "var(--g-bg)", color: "var(--g-fg)" }}>
            {review.best ? <Outline track={review.best.track} className="h-[74%] w-[74%]" d={400} width={6} /> : null}
          </div>
          <div className="min-w-0">
            <div className="wr-small opacity-70">{slide.eyebrow}</div>
            <div className="wr-big" style={nameFit(review.driver.name)}>
              {review.driver.name}
            </div>
            {review.driver.team?.name && <div className="wr-small mt-0.5 opacity-70">{review.driver.team.name}</div>}
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <div className="wr-small opacity-70">Top results</div>
            <ol className="mt-1 space-y-0.5">
              {top.map((t, k) => (
                <li key={`${t.round}-${t.sprint}`} className="truncate text-[15px] font-extrabold leading-snug">
                  {k + 1} {t.track} <span className="opacity-60">P{t.position}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="min-w-0">
            <div className="wr-small opacity-70">The season</div>
            <ol className="mt-1 space-y-0.5">
              {seasonList(slide, review).map((g) => (
                <li key={g.k} className="truncate text-[15px] font-extrabold leading-snug">
                  {g.value} <span className="opacity-60">{g.label}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="mt-auto grid grid-cols-2 gap-4 pt-4">
          <div>
            <div className="wr-small opacity-70">Points</div>
            <div className="wr-big wr-num" style={{ fontSize: "min(15cqi, 7cqh)" }}>
              {slide.points}
            </div>
          </div>
          <div>
            <div className="wr-small opacity-70">Championship</div>
            <div className="wr-big wr-num" style={{ fontSize: "min(15cqi, 7cqh)" }}>
              {c.position ? `P${c.position}` : "–"}
            </div>
          </div>
        </div>
        <div className="wr-small mt-3 opacity-60">NABS Racing League · {review.season.label}</div>
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
