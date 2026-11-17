// One slide of the season story (review/Story.jsx), after Spotify Wrapped
// 2025: black and white with one colour, the team's (review/wrapPalette.js),
// and the type doing the work. Poster lines in capitals set edge to edge
// across the frame, a hero figure with outlined echoes stepped out behind
// it, a word picked out with a marker in the team colour, small labels set
// against huge words. The circuits stand in for album covers.
//
// The story always talks to "you", whoever opens it: it is told the way a
// Wrapped is, to the one whose season it is. Every figure is real (review/storySlides.mjs, review/copy.mjs).
import { Children, Fragment, cloneElement, isValidElement, createContext, useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MEDAL, readableInkOn } from "../../components/ui.jsx";
import CircuitMap from "../../components/CircuitMap.jsx";
import TeamLogo from "../../components/TeamLogo.jsx";
import { tyreCompound } from "../../data/liveTiming.js";
import { TyreBadge } from "../../components/TyreStrategy.jsx";
import { circuitFor } from "../../data/circuits.js";
import { nth } from "./copy.mjs";
import { seasonList } from "./storySlides.mjs";
import { saveSharePicture } from "./sharePicture.js";
import { motionOff } from "../../hooks/motion.js";
import Object3D, { has3D, holdBuildUntil } from "./Object3D.jsx";

// How long a slide's opening line holds the frame before the slide itself
// comes in (review/story.css shifts every animation by it).
export const TEASE_MS = 2100;
const Offset = createContext(0);

const MEDAL_INK = MEDAL.map((m) => readableInkOn(m));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const fmt = (n) => Number(n || 0).toLocaleString("en-GB");

// The story is always told to "you".
// eslint-disable-next-line no-unused-vars
export function voiceOf(review) {
  return { You: "You", you: "you", Your: "Your", your: "your", are: "are" };
}

// --- type ----------------------------------------------------------------------------

// A poster line: capitals set edge to edge across the frame. The SVG's text
// is given the full width to fill; a line too short to fill it without
// looking stretched (a single figure) keeps its own width instead.
function Fill({ text, d = 0, outline = false, className = "", maxHeight = 270, align = "left", style }) {
  const t = String(text ?? "").toUpperCase();
  // A wide column is wider than it is tall next to the rest of the slide, so
  // a short word may not grow as tall as it would in a phone frame.
  if (useContext(Wide)) maxHeight = Math.min(maxHeight, 230);
  const n = Math.max(
    1,
    [...t].reduce((w, ch) => w + (ch === " " ? 0.32 : /[I1.,:']/.test(ch) ? 0.42 : 0.78), 0),
  );
  const size = Math.min(1000 / n, maxHeight);
  const natural = size * n;
  const stretch = natural >= 820;
  const h = Math.round(size * 0.74);
  const x = align === "right" && !stretch ? 1000 - natural : 0;
  return (
    <div className={`wr-line st-in ${className}`} style={{ "--d": `${d}ms`, ...style }}>
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
  const ems = [...v].reduce((w, ch) => w + (/[,.]/.test(ch) ? 0.3 : ch === "%" ? 1.05 : /[A-Z]/.test(ch) ? 0.8 : 0.74), 0);
  if (!size) size = `min(56cqi, ${(80 / Math.max(0.74, ems)).toFixed(1)}cqi, 30cqh)`;
  const shown = useCountUp(v, d + useContext(Offset));
  return (
    <div
      className={`wr-echo wr-big wr-num st-land whitespace-nowrap ${className}`}
      style={{
        "--d": `${d}ms`,
        fontSize: size,
        lineHeight: 0.82,
        marginBottom: "0.1em",
      }}
    >
      <span className="wr-ghost" style={{ "--sx": "0.09em", "--sy": "0.07em", "--d": `${d + 350}ms` }} aria-hidden="true">
        {shown}
      </span>
      <span className="wr-ghost" style={{ "--sx": "0.045em", "--sy": "0.035em", "--d": `${d + 250}ms` }} aria-hidden="true">
        {shown}
      </span>
      <span className="relative" aria-label={v}>
        {shown}
      </span>
    </div>
  );
}

// A figure counts up to its value as it lands, the way Wrapped runs up a
// total. Only a single number of two digits or more ("1,092", "+33", "58%");
// "5-3" or "1st" are shown as they are.
function useCountUp(v, delay) {
  const m = /^([^\d]*)([\d,]+)([^\d]*)$/.exec(v);
  const target = m ? Number(m[2].replace(/,/g, "")) : null;
  const counts = target != null && target >= 10 && !motionOff();
  const [n, setN] = useState(counts ? 0 : target);
  useEffect(() => {
    if (!counts) return undefined;
    let raf = 0;
    const t0 = performance.now() + delay;
    const dur = Math.min(1500, 650 + target * 4);
    holdBuildUntil(t0 + dur);
    const tick = (t) => {
      const p = Math.max(0, Math.min(1, (t - t0) / dur));
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [counts, target, delay]);
  if (!m || !counts) return v;
  const body = m[2].includes(",") ? n.toLocaleString("en-GB") : String(n);
  return `${m[1]}${body}${m[3]}`;
}

// "Top 2%", as Wrapped puts a listener among all the others.
export const topShare = (rank) => (rank ? Math.max(1, Math.ceil((rank.rank / rank.of) * 100)) : null);

// A small label, the quiet voice set against the loud one.
const Kicker = ({ d = 0, className = "", children }) => (
  <div className={`st-kick st-in text-[13px] font-bold uppercase tracking-[0.14em] ${className}`} style={{ "--d": `${d}ms`, fontFamily: "Inter, sans-serif" }}>
    {children}
  </div>
);

// A plain sentence with a word or two picked out by the marker.
const Line = ({ d = 0, className = "", children, size = "min(6.6cqi, 3.6cqh)" }) => (
  <div className={`st-say st-in font-extrabold leading-[1.25] ${className}`} style={{ "--d": `${d}ms`, fontSize: size }}>
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

// On a laptop or desktop screen the story is a wide frame instead of a tall
// one (review/story.css). A slide then sets its words in the left column and
// its picture, list or chart in the right one; on a phone the same two parts
// simply follow each other down the frame, as they always did.
export const WIDE_QUERY = "(min-width: 1024px) and (min-height: 600px)";
export const Wide = createContext(false);
export function useWideStory() {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(WIDE_QUERY).matches;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    const m = window.matchMedia?.(WIDE_QUERY);
    if (!m) return undefined;
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

// The part of a slide that goes to the right column on a wide screen. On a
// phone it stays exactly where it is written.
const Aside = ({ children }) => children;

function Card({ children, className = "" }) {
  const wide = useContext(Wide);
  if (wide) {
    // Fragments are opened up, so an <Aside> inside one still finds its column.
    const flat = (list) => Children.toArray(list).flatMap((k) => (k?.type === Fragment ? flat(k.props.children) : [k]));
    const kids = flat(children).map((k, i) => (isValidElement(k) ? cloneElement(k, { key: `c${i}` }) : k));
    const right = kids.filter((k) => k?.type === Aside);
    const left = kids.filter((k) => k?.type !== Aside);
    return (
      <div className={`st-wide relative z-10 grid min-h-0 flex-1 ${right.length ? "" : "st-wide-one"} ${className}`}>
        <div className="st-col flex min-h-0 flex-col justify-center">
          {left}
        </div>
        {right.length > 0 && <div className="st-col st-aside flex min-h-0 flex-col justify-center">{right}</div>}
      </div>
    );
  }
  return (
    <div className={`relative z-10 flex min-h-0 flex-1 flex-col px-6 pb-8 pt-[5.2rem] sm:px-7 ${className}`}>
      {children}
    </div>
  );
}

// A leaderboard the way Wrapped lists a top five: the place, the name, a bar
// for the figure, the driver's own row in the team colour. When the driver
// is further back, their row follows after a gap.
function Board({ board, review, d = 0 }) {
  const max = Math.max(1, ...board.rows.map((r) => r.value));
  return (
    <ol className="space-y-1">
      {board.rows.map((r, k) => {
        const gap = k > 0 && r.rank > board.rows[k - 1].rank + 1 && r.you;
        return (
          <li key={`${r.name}-${k}`}>
            {gap && (
              <div className="st-in py-0.5 pl-9 text-[13px] font-extrabold leading-none opacity-50" style={{ "--d": `${d + k * 110}ms` }}>
                ...
              </div>
            )}
            <div
              className="st-in flex items-center gap-2.5 rounded-md px-2 py-2"
              style={{
                "--d": `${d + k * 110}ms`,
                ...(r.you ? { background: "var(--g-mark)", color: "var(--g-mark-fg)" } : null),
              }}
            >
              <span className="wr-big wr-num w-7 shrink-0 text-right text-[1.3rem] leading-none">{r.rank}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[15px] font-extrabold uppercase leading-tight">{r.you ? "You" : r.name}</span>
                  <span className="wr-num shrink-0 text-[15px] font-extrabold leading-tight">{fmt(r.value)}</span>
                </span>
                <span
                  className="mt-1 block h-[5px] overflow-hidden rounded-full"
                  style={{
                    background: "color-mix(in srgb, currentColor 16%, transparent)",
                  }}
                >
                  <span
                    className="st-grow-x block h-full rounded-full"
                    style={{
                      "--d": `${d + 200 + k * 110}ms`,
                      width: `${Math.max(3, (r.value / max) * 100)}%`,
                      background: "currentColor",
                    }}
                  />
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// --- the slides --------------------------------------------------------------------------

function Intro({ review }) {
  const v = voiceOf(review);
  const { season, driver } = review;
  const num = /\d+$/.exec(String(season.label))?.[0] || "";
  const head = num ? String(season.label).slice(0, -num.length).trim() : season.label;
  const wide = useContext(Wide);
  const logo = driver.team && driver.team.tier !== 0 && (
    // The logo on its own light tile: a team logo in the team colour would
    // vanish on a slide painted in that same colour.
    <div className="st-land inline-flex shrink-0 items-center justify-center rounded-2xl p-3" style={{ "--d": "1100ms", background: "#f6f5f1", boxShadow: "0 1px 0 rgba(0,0,0,0.08)" }}>
      <TeamLogo id={driver.team.id} name={driver.team.name} color={driver.team.color} logoUrl={driver.team.logoUrl} size={wide ? 96 : 64} />
    </div>
  );
  const facts = (
    <>
      {season.roundsRun} rounds
      {driver.team?.name ? ` · ${driver.team.name}` : ""}
      {season.complete ? "" : " · so far"}
    </>
  );
  // On a wide screen the season runs right across the window, the figure
  // as tall as it gets, and the driver sits under it as one line.
  if (wide) {
    return (
      <Card>
        <Kicker d={100}>This was your</Kicker>
        <div className="flex items-end" style={{ gap: "3cqi" }}>
          <div className="min-w-0 flex-1 pb-[1.2cqh]">
            <Fill text={head} d={250} />
          </div>
          {num && <Echo value={num} d={500} size="min(46cqh, 30cqi)" className="shrink-0" />}
        </div>
        <div className="mt-[5cqh] flex items-center gap-6">
          {logo}
          <div className="min-w-0">
            <div className="st-in wr-big truncate uppercase leading-none" style={{ "--d": "1300ms", fontSize: "min(5.6cqi, 9cqh)" }}>
              {driver.name}
            </div>
            <Kicker d={1500} className="mt-3 lv-mute">
              {facts}
            </Kicker>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <Kicker d={100}>This was your</Kicker>
      <Fill text={head} d={250} />
      {num && <Echo value={num} d={500} size="min(92cqi, 52cqh)" />}
      <Aside>
      <div className="mt-auto">
        {logo && <div className="mb-4">{logo}</div>}
        <Line d={1300}>
          <Mark>{driver.name}</Mark>
        </Line>
        <Kicker d={1500} className="mt-3 lv-mute">
          {facts}
        </Kicker>
      </div>
      </Aside>
    </Card>
  );
}

// One tile a round: the place at the flag, or why there is none.
function RoundTile({ r, d }) {
  const fin = r.status === "FINISHED" && r.position != null;
  const podium = fin && r.position <= 3;
  // A podium in its medal: gold, silver, bronze.
  const style = podium
    ? { background: MEDAL[r.position - 1], color: MEDAL_INK[r.position - 1] }
    : fin
      ? { background: "var(--g-fg)", color: "var(--g-bg)" }
      : r.status === "DNS"
        ? {
            boxShadow: "inset 0 0 0 1.5px var(--g-mute)",
            color: "var(--g-mute)",
          }
        : { boxShadow: "inset 0 0 0 2px var(--g-fg)" };
  return (
    <div className="st-land relative flex aspect-square flex-col justify-between rounded-md p-1.5" style={{ "--d": `${d}ms`, ...style }}>
      <span className="text-[10px] font-bold leading-none opacity-70" style={{ fontFamily: "Inter, sans-serif" }}>
        R{r.round}
      </span>
      <span className="wr-big wr-num text-right leading-none" style={{ fontSize: fin ? "1.35rem" : "0.9rem" }}>
        {fin ? `P${r.position}` : r.status === "DNS" ? "DNS" : r.status === "DSQ" ? "DSQ" : "DNF"}
      </span>
    </div>
  );
}

function Rounds({ review }) {
  const v = voiceOf(review);
  const s = review.stats;
  const n = review.rounds.length;
  const laps = review.racing;
  // A Tier 2 driver's race laps are ranked among Tier 2.
  const lapRank = review.tier?.ranks?.lapsRaced || laps?.rank || null;
  const lapScope = review.tier?.ranks?.lapsRaced ? `Tier ${review.tier.tier}` : null;
  return (
    <Card>
      <Fill text={`${v.You} started`} d={100} />
      <Echo value={s.starts} d={350} />
      <Fill text={`of ${n} rounds`} d={800} outline />
      <Aside>
      <div className="mt-auto">
        <div className="grid grid-cols-6 gap-1.5">
          {review.rounds.map((r, k) => (
            <RoundTile key={r.round} r={r} d={1100 + k * 70} />
          ))}
        </div>
        <Line d={1300 + n * 70} className="mt-4" size="min(5.6cqi, 3cqh)">
          {s.finishes === s.starts ? (
            <>
              You saw the flag <Mark>every time</Mark>
            </>
          ) : !s.finishes ? (
            <>
              The flag <Mark>will have to wait</Mark>
            </>
          ) : (
            <>
              You saw the flag <Mark>{times(s.finishes)}</Mark>
            </>
          )}
          {laps?.laps > 0 ? <>. {fmt(laps.laps)} race laps.</> : "."}
        </Line>
        {lapRank && (
          <Kicker d={1500 + n * 70} className="mt-2 lv-mute normal-case tracking-normal">
            {topShare(lapRank) <= 25 ? `More race laps than ${100 - topShare(lapRank)}% of ${lapScope || "the league"}.` : rankWords(lapRank, "race laps", lapScope)}
          </Kicker>
        )}
      </div>
      </Aside>
    </Card>
  );
}

// "The most race laps of 64 drivers", "7th most of 64 (shared)".
function rankWords(rank, what, scope = null) {
  if (!rank) return null;
  const joint = rank.shared ? "joint " : "";
  if (scope) return rank.rank === 1 ? `${joint ? "Joint most" : "Most"} ${what} in ${scope}.` : `${joint ? "Joint " : ""}${nth(rank.rank)} for ${what}, out of ${rank.of} in ${scope}.`;
  return rank.rank === 1 ? `${joint ? "Joint most" : "Most"} ${what} of all ${rank.of} drivers.` : `${joint ? "Joint " : ""}${nth(rank.rank)} for ${what}, out of ${rank.of} drivers.`;
}

// Training laps on the league's practice servers between the rounds.
function Training({ slide, review }) {
  const v = voiceOf(review);
  const first = slide.rank?.rank === 1;
  return (
    <Card>
      <Kicker d={100}>Between the races, {v.you} put in</Kicker>
      <Echo value={fmt(slide.value)} d={300} />
      <Fill text="training laps" d={750} outline />
      <Line d={1000} size="min(5.4cqi, 3cqh)">
        Spread over <Mark>{plural(slide.weeks, "race week")}</Mark>.
      </Line>
      {(first || topShare(slide.rank) <= 25) && <RankLine rank={slide.rank} what="training laps" d={1200} />}
      <Aside>
      <div className="relative mt-auto">
        {slide.board?.rows?.length > 1 ? (
          <>
            <Kicker d={1200} className="mb-2 lv-mute">
              Most training laps
            </Kicker>
            <Board board={slide.board} review={review} d={1300} />
          </>
        ) : (
          slide.rank && <Line d={1200}>{rankWords(slide.rank, "training laps")}</Line>
        )}
      </div>
      </Aside>
    </Card>
  );
}

// The tyres the race laps were done on: one bar of every race lap split by
// compound in the compound colours (the way the race pages draw a tyre
// strategy), then a row a compound with the site's tyre badge.
function Tyres({ slide }) {
  const [top] = slide.tyres;
  const name = tyreCompound(top.tyre).name;
  const shown = slide.tyres.slice(0, 4);
  const wide = useContext(Wide);
  return (
    <Card>
      <Kicker d={100}>Your go-to tyre</Kicker>
      <Fill text={`${name}s`} d={250} />
      <Echo value={`${top.share}%`} d={500} />
      <Line d={900} size="min(5.4cqi, 3cqh)">
        of your race laps. <Mark>{plural(top.laps, "lap")}</Mark> on them.
      </Line>
      <Aside>
        <div className={wide ? "" : "mt-auto pt-6"}>
          <Kicker d={1100} className="lv-mute">
            Every race lap, by tyre
          </Kicker>
          <div className="mt-3 flex h-4 w-full gap-[3px] overflow-hidden rounded-full">
            {shown.map((t, k) => (
              <span
                key={t.tyre}
                className="st-grow-x block h-full first:rounded-l-full last:rounded-r-full"
                style={{ "--d": `${1200 + k * 160}ms`, width: `${t.share}%`, background: tyreCompound(t.tyre).color }}
              />
            ))}
          </div>
          <ul className={`mt-5 ${wide ? "space-y-4" : "space-y-3"}`}>
            {shown.map((t, k) => {
              const c = tyreCompound(t.tyre);
              return (
                <li key={t.tyre} className="st-in flex items-center gap-3.5" style={{ "--d": `${1350 + k * 160}ms` }}>
                  <TyreBadge t={c} size={wide ? 42 : 34} />
                  <span className="wr-big min-w-0 flex-1 truncate uppercase leading-none" style={{ fontSize: wide ? "1.6rem" : "1.2rem" }}>
                    {c.name}
                  </span>
                  <span className="shrink-0 text-[14px] font-bold lv-mute" style={{ fontFamily: "Inter, sans-serif" }}>
                    {plural(t.laps, "lap")}
                  </span>
                  <span className="wr-big wr-num w-[3.2em] shrink-0 text-right leading-none" style={{ fontSize: wide ? "1.6rem" : "1.2rem" }}>
                    {t.share}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </Aside>
    </Card>
  );
}


// Track limits: every cut as a square, then the rate against the field's.
function Limits({ slide, review }) {
  const v = voiceOf(review);
  const mine = slide.cuts / Math.max(1, slide.races);
  const field = slide.fieldPerRace;
  const max = Math.max(mine, field || 0, 0.1);
  const one = (n) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
  const rows = [
    {
      k: "me",
      label: "You",
      value: mine,
      you: true,
    },
    field != null ? { k: "field", label: "The field", value: field } : null,
  ].filter(Boolean);
  return (
    <Card>
      <Fill text={`${v.You} cut the track`} d={100} />
      <Echo value={slide.cuts} d={350} size="min(44cqi, 22cqh)" />
      <Fill text={slide.cuts === 1 ? "time" : "times"} d={750} outline maxHeight={170} />
      <div className="mt-4 flex flex-wrap gap-1.5">
        {Array.from({ length: Math.min(slide.cuts, 60) }, (_, k) => (
          <span key={k} className="st-land block h-5 w-5 rounded-[4px]" style={{ "--d": `${1000 + k * 35}ms`, background: "var(--g-mark)" }} />
        ))}
      </div>
      <Aside>
      <div className="mt-auto space-y-3">
        <Kicker d={1500} className="lv-mute">
          Cuts a race
        </Kicker>
        {rows.map((r, k) => (
          <div key={r.k} className="st-in" style={{ "--d": `${1600 + k * 200}ms` }}>
            <div className="flex items-baseline justify-between text-[14px] font-extrabold uppercase">
              <span className="truncate">{r.label}</span>
              <span className="wr-num">{one(r.value)}</span>
            </div>
            <div className="mt-1 h-3 overflow-hidden rounded-full" style={{ background: "var(--g-faint)" }}>
              <span
                className="st-grow-x block h-full rounded-full"
                style={{
                  "--d": `${1700 + k * 200}ms`,
                  width: `${Math.max(3, (r.value / max) * 100)}%`,
                  background: r.you ? "var(--g-mark)" : "var(--g-fg)",
                }}
              />
            </div>
          </div>
        ))}
        <Line d={2100} className="pt-1" size="min(5cqi, 2.8cqh)">
          {slide.penalties > 0 ? (
            <>
              Cost you <Mark>{plural(slide.penalties, "penalty", "penalties")}</Mark> from the game.
            </>
          ) : (
            <>And not a single penalty for it.</>
          )}
        </Line>
      </div>
      </Aside>
    </Card>
  );
}

function Top({ slide, review }) {
  const v = voiceOf(review);
  const wide = useContext(Wide);
  return (
    <Card>
      <Fill text={`${v.Your} top`} d={100} />
      <Fill text="results" d={250} outline />
      <Aside>
        <ol className={`flex min-h-0 flex-col ${wide ? "" : "mt-6 flex-1 justify-end"}`}>
          {slide.list.map((t, k) => (
            <li
              key={`${t.round}-${t.sprint}`}
              className="st-in flex min-h-0 flex-1 items-center gap-4 border-t py-3"
              style={{ "--d": `${550 + k * 150}ms`, maxHeight: "6.5rem", borderColor: "var(--g-faint)" }}
            >
              <span className="wr-big wr-num w-9 shrink-0 text-center leading-none" style={{ fontSize: "min(11cqi, 5.4cqh)", ...(k === 0 ? { color: "var(--g-mark)" } : null) }}>
                {k + 1}
              </span>
              <span className="wr-cover shrink-0 rounded-lg" style={{ width: "min(15cqi, 7.6cqh)", ...(k === 0 ? { background: "var(--g-mark)", color: "var(--g-mark-fg)" } : null) }}>
                <Outline track={t.track} className="h-[84%] w-[84%]" d={650 + k * 150} width={3.6} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="wr-big block truncate uppercase leading-none" style={{ fontSize: "min(5.2cqi, 2.9cqh)" }}>
                  {t.track}
                </span>
                <span className="mt-1.5 block truncate text-[13px] font-bold lv-mute" style={{ fontFamily: "Inter, sans-serif" }}>
                  {t.sprint ? "Sprint · " : `Round ${t.round} · `}
                  {plural(t.points, "point")}
                </span>
              </span>
              <span className="wr-big wr-num shrink-0 leading-none" style={{ fontSize: "min(8.4cqi, 4.2cqh)" }}>
                P{t.position}
              </span>
            </li>
          ))}
        </ol>
      </Aside>
    </Card>
  );
}

// A race photo on a slide: framed, drifting slowly closer, with the round
// it is from in the corner.
function Photo({ photo, d = 300, className = "", style }) {
  return (
    <figure className={`st-land st-photo relative overflow-hidden rounded-2xl ${className}`} style={{ "--d": `${d}ms`, ...style }}>
      <img src={photo.url} alt="" className="h-full w-full object-cover" draggable="false" />
      <figcaption className="absolute bottom-2.5 left-2.5 rounded-md px-2 py-1 text-[11px] font-bold leading-none text-white" style={{ background: "rgba(0,0,0,0.62)", fontFamily: "Inter, sans-serif" }}>
        Round {photo.round}
        {photo.track ? ` · ${photo.track}` : ""}
      </figcaption>
    </figure>
  );
}

// A 3D object on a slide (review/Object3D.jsx), started with the slide's
// own timing, opening line included.
function Thing({ d = 0, ...rest }) {
  return <Object3D delay={d + useContext(Offset)} {...rest} />;
}

// The circuit as a slowly turning band in space, or its flat outline
// where the browser draws no 3D.
function Circuit3D({ track, d = 200, className = "" }) {
  return (
    <Thing
      kind="track"
      data={{ track }}
      d={d}
      className={`st-3d ${className}`}
      label={`${track} circuit`}
      fallback={<Outline track={track} className={`h-full w-full ${className}`} d={d + 100} width={3} stroke="var(--g-pop)" />}
    />
  );
}

function Best({ slide, review }) {
  const v = voiceOf(review);
  const b = review.best;
  const wide = useContext(Wide);
  const picture = slide.photo ? (
    <Photo photo={slide.photo} d={250} className="h-full w-full" />
  ) : b.heroImageUrl ? (
    <img src={b.heroImageUrl} alt="" className="h-full w-full rounded-xl object-cover" />
  ) : (
    <Circuit3D track={b.track} d={250} className="h-full w-full" />
  );
  return (
    <Card>
      <Kicker d={100}>{v.Your} best race</Kicker>
      <Echo value={`P${b.position}`} d={600} size="min(48cqi, 24cqh)" />
      {wide ? (
        <Aside>
          {slide.photo ? (
            <Photo photo={slide.photo} d={250} className="aspect-video w-full" />
          ) : (
            <div className="st-fill st-3d relative min-h-0 flex-1">
              <div className="absolute inset-0">{picture}</div>
            </div>
          )}
        </Aside>
      ) : (
        <div className="relative -mx-2 min-h-[8rem] flex-1">
          <div className="absolute inset-0">{picture}</div>
        </div>
      )}
      <Fill text={b.track} d={1300} />
      <Line d={1550} size="min(5.6cqi, 3cqh)">
        {b.grid > 0 ? (
          <>
            Started <Mark>P{b.grid}</Mark>, round {b.round}.
          </>
        ) : (
          <>Round {b.round}.</>
        )}
      </Line>
    </Card>
  );
}

function Climb({ slide, review }) {
  const v = voiceOf(review);
  const c = review.climb;
  const wide = useContext(Wide);
  const fromTo = (
    <div className="st-in flex items-baseline gap-3 wr-big wr-num" style={{ "--d": "1100ms", fontSize: "min(12cqi, 6cqh)" }}>
      <span className="lv-mute">P{c.grid}</span>
      <span className="text-[0.55em]">to</span>
      <span style={{ color: "var(--g-mark)" }}>P{c.position}</span>
    </div>
  );
  return (
    <Card>
      <Fill text={`${v.You} made up`} d={100} />
      <Echo value={`+${c.gained}`} d={350} />
      <Fill text="places" d={800} outline />
      {wide ? (
        <>
          <Line d={1400}>
            All in one race, at <Mark>{c.track}</Mark>.
          </Line>
          <div className="mt-6">{fromTo}</div>
          <Aside>
            {slide.photo ? (
              <Photo photo={slide.photo} d={500} className="aspect-video w-full" />
            ) : (
              <div className="st-fill st-3d relative min-h-0 flex-1">
                <div className="absolute inset-0">
                  <Circuit3D track={c.track} d={500} className="h-full w-full" />
                </div>
              </div>
            )}
          </Aside>
        </>
      ) : (
        <>
          <div className="relative -mx-2 mt-2 min-h-[7rem] flex-1">
            <div className="absolute inset-0">
              {slide.photo ? <Photo photo={slide.photo} d={500} className="h-full w-full" /> : <Circuit3D track={c.track} d={500} className="h-full w-full" />}
            </div>
          </div>
          {fromTo}
          <Line d={1400} className="mt-2" size="min(5.6cqi, 3cqh)">
            All in one race, at <Mark>{c.track}</Mark>.
          </Line>
        </>
      )}
    </Card>
  );
}

// The podiums as medals: solid, metal, dropping in one after another and
// spinning to face out, four to a row with the circuit under each.
// The room between rows of medals, in pixels.
const MEDAL_GAP = 12;

function Podiums({ slide, review }) {
  const v = voiceOf(review);
  const n = slide.podiums.length;
  const wide = useContext(Wide);
  const shown = slide.podiums.slice(0, 8);
  // Up to four medals sit two by two, so each is big enough to read.
  const cols = shown.length > 4 ? Math.min(4, shown.length) : Math.min(2, shown.length);
  const rows = [];
  for (let k = 0; k < shown.length; k += cols) rows.push(shown.slice(k, k + cols));
  const flat = (
    <div className="flex flex-wrap gap-x-3 gap-y-3">
      {shown.map((p, k) => (
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
  );
  return (
    <Card>
      <Fill text={`${v.You} stood on`} d={100} />
      <Fill text="the podium" d={250} outline />
      <div className="mt-4 flex items-end gap-4">
        <Echo value={n} d={500} size="min(50cqi, 24cqh)" />
        <Line d={900} className="mb-4">
          {n === 1 ? "time." : "times."}
        </Line>
      </div>
      <Aside>
        <div className={`st-3d space-y-3 ${wide ? "" : "flex flex-1 flex-col justify-center pt-4"}`}>
          {has3D() ? (
            // One scene for every medal: each row of its own made the
            // browser set up 3D several times at once, and the slide stuttered.
            // The canvas lies behind the rows; the rows keep the room the
            // medals need and carry the labels under them.
            // The medals are set on the rows' own boxes (data-medal-row), so
            // labels that grow with the screen never end up under a coin; the
            // block is kept narrow enough for every row and label to fit.
            <div className="relative mx-auto w-full" style={{ maxWidth: `calc((${wide ? 72 : 48}cqh - ${rows.length} * ${wide ? 64 : 46}px) * ${cols / (rows.length * 1.05)})` }}>
              <Thing
                kind="medals"
                data={{ places: shown.map((p) => p.position), cols, rows: true }}
                d={1000}
                style={{ position: "absolute", inset: 0 }}
                label={`Podium places: ${shown.map((p) => `P${p.position}`).join(", ")}`}
              />
              <div className="relative flex flex-col" style={{ gap: MEDAL_GAP }}>
                {rows.map((row, r) => (
                  <div key={r}>
                    <div data-medal-row="" style={{ aspectRatio: `${cols} / 1.05` }} />
                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                      {row.map((p, k) => (
                        <div key={`${p.round}-${p.sprint}`} className="st-in min-w-0 text-center" style={{ "--d": `${1300 + (r * cols + k) * 180}ms` }}>
                          <div className="truncate text-[12px] font-extrabold uppercase">{p.track}</div>
                          <div className="text-[11px] font-bold opacity-70" style={{ fontFamily: "Inter, sans-serif" }}>
                            {p.sprint ? "Sprint" : `Round ${p.round}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            flat
          )}
        </div>
      </Aside>
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
      {rank.shared && <Fill text="joint" d={600} outline maxHeight={150} />}
      <Echo value={nth(rank.rank)} d={750} size={slide.board ? "min(40cqi, 18cqh)" : "min(54cqi, 28cqh)"} />
      <Line d={1150}>
        out of <Mark>{rank.of} {slide.scope ? `in ${slide.scope}` : "drivers"}</Mark>.
      </Line>
      <Aside>
      {slide.board?.rows?.length > 1 ? (
        <div className="mt-auto">
          <Board board={slide.board} review={review} d={1500} />
          {rest.length > 0 && (
            <Kicker d={2300} className="mt-3 lv-mute normal-case tracking-normal">
              {rest.map((f) => `${f.label}: ${f.value}, ${f.rankText}`).join(" · ")}
            </Kicker>
          )}
        </div>
      ) : (
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
      )}
      </Aside>
    </Card>
  );
}

// The place in the table after every round, as one bold line in the accent,
// with the places marked down the side, the best place picked out and the
// last one named at the end of the line.
function Journey({ slide, review }) {
  const v = voiceOf(review);
  const pts = review.championship.journey;
  const rounds = review.rounds.map((r) => r.round);
  const worst = Math.max(...pts.map((p) => p.position));
  const bottom = Math.max(5, Math.ceil(worst / 5) * 5);
  const wide = useContext(Wide);
  const W = 360;
  // Taller on a phone, where the chart has the lower half of the frame.
  const H = wide ? 210 : 280;
  const PAD = { l: 30, r: 34, t: 16, b: 34 };
  const first = rounds[0] ?? 1;
  const lastR = rounds[rounds.length - 1] ?? first + 1;
  const x = (n) => PAD.l + ((n - first) / Math.max(1, lastR - first)) * (W - PAD.l - PAD.r);
  const y = (p) => PAD.t + ((p - 1) / Math.max(1, bottom - 1)) * (H - PAD.t - PAD.b);
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.round).toFixed(1)} ${y(p.position).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const done = review.season.complete;
  const peak = pts.reduce((b, p) => (!b || p.position < b.position ? p : b), null);
  const showPeak = peak && peak.position < last.position;
  const marks = [1, ...Array.from({ length: Math.floor(bottom / 5) }, (_, k) => (k + 1) * 5)].filter((p) => p <= bottom);
  const label = { font: "700 10px Inter, sans-serif" };
  return (
    <Card>
      <Kicker d={100}>{done ? `${v.You} finished the season` : `After round ${last.round}, ${v.you} ${v.are}`}</Kicker>
      <Echo value={slide.value} d={300} />
      <Fill text="in the championship" d={750} outline />
      <Aside>
        <div className="st-in mt-auto" style={{ "--d": "1100ms" }}>
          <Kicker d={1100} className="mb-2 lv-mute">
            Your place after every round
          </Kicker>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label="Place in the championship after each round">
            {marks.map((p) => (
              <g key={p}>
                <line x1={PAD.l} x2={W - PAD.r + 6} y1={y(p)} y2={y(p)} stroke="var(--g-faint)" strokeWidth="1" strokeDasharray={p === 1 ? undefined : "3 4"} />
                <text x={PAD.l - 8} y={y(p)} dy="0.35em" textAnchor="end" fill="var(--g-mute)" style={label}>
                  P{p}
                </text>
              </g>
            ))}
            <path d={line} pathLength="1" className="st-draw" style={{ "--d": "1200ms" }} fill="none" stroke="var(--g-mark)" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
            {showPeak && (
              <g className="st-in" style={{ "--d": "2300ms" }}>
                <circle cx={x(peak.round)} cy={y(peak.position)} r="5" fill="var(--g-bg)" stroke="var(--g-fg)" strokeWidth="2.5" />
                <text x={x(peak.round)} y={y(peak.position) - 11} textAnchor="middle" fill="var(--g-fg)" style={{ font: "800 11px Montserrat, sans-serif" }}>
                  Best P{peak.position}
                </text>
              </g>
            )}
            <circle cx={x(last.round)} cy={y(last.position)} r="8" fill="var(--g-fg)" />
            <text x={x(last.round) + 13} y={y(last.position)} dy="0.35em" fill="var(--g-fg)" style={{ font: "900 13px Montserrat, sans-serif" }}>
              P{last.position}
            </text>
            {rounds.map((n) => (
              <text key={n} x={x(n)} y={H - 16} textAnchor="middle" fill="var(--g-mute)" style={label}>
                {n}
              </text>
            ))}
            <text x={PAD.l} y={H - 1} fill="var(--g-mute)" style={{ font: "700 9px Inter, sans-serif", letterSpacing: "0.12em" }}>
              ROUND
            </text>
          </svg>
        </div>
      </Aside>
    </Card>
  );
}


function Team({ slide, review }) {
  const v = voiceOf(review);
  const { mate, lines } = slide;
  const [head, ...rest] = lines;
  const wide = useContext(Wide);
  return (
    <Card>
      <Fill text="You" d={100} />
      <Kicker d={250} className="lv-mute">
        against
      </Kicker>
      <Fill text={mate.name} d={350} outline />
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
      {slide.photo && (
        <Aside>
          <div className={wide ? "mb-6" : "relative my-4 min-h-[8rem] flex-1"}>
            {wide ? <Photo photo={slide.photo} d={1100} className="aspect-video w-full" /> : <div className="absolute inset-0"><Photo photo={slide.photo} d={1100} className="h-full w-full" /></div>}
          </div>
        </Aside>
      )}
      <Aside>
      <div className={`space-y-2.5 ${slide.photo && !wide ? "" : "mt-auto"}`}>
        {rest.map((l, k) => (
          <div key={l.key} className="st-in flex items-baseline justify-between gap-3 border-t border-[color:var(--g-faint)] pt-2" style={{ "--d": `${1300 + k * 220}ms` }}>
            <span className={`${wide ? "text-[19px]" : "text-[15px]"} font-extrabold`}>{l.label}</span>
            <span className={`wr-big wr-num ${wide ? "text-[2.6rem]" : "text-[1.8rem]"}`}>
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
      </Aside>
    </Card>
  );
}

function Contact({ review }) {
  const v = voiceOf(review);
  const k = review.contact;
  const wide = useContext(Wide);
  return (
    <Card>
      <Fill text={`${v.You} kept it`} d={100} />
      <Fill text="clean in" d={250} outline />
      <Echo value={k.clean} d={500} />
      <Line d={900}>
        <Mark>{k.clean === 1 ? "round" : "rounds"}</Mark> without touching another car.
      </Line>
      <Aside>
      <div className="mt-auto">
        <div className={`flex ${wide ? "h-40" : "h-20"} items-end gap-1.5`}>
          {review.rounds.map((r, n) => {
            const known = r.contacts != null;
            const cars = r.contacts || 0;
            return (
              <div key={r.round} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                {known ? (
                  <span
                    className="st-grow-y block w-full rounded-t-[3px]"
                    style={{
                      "--d": `${1300 + n * 60}ms`,
                      height: cars ? `${Math.min(100, 18 + cars * 16)}%` : "5px",
                      background: cars ? "var(--g-fg)" : "var(--g-mark)",
                    }}
                  />
                ) : (
                  <span className="st-grow-y block h-[5px] w-full rounded-full" style={{ "--d": `${1300 + n * 60}ms`, boxShadow: "inset 0 0 0 1.5px var(--g-mute)" }} />
                )}
              </div>
            );
          })}
        </div>
        <Kicker d={1700} className="mt-3 lv-mute normal-case tracking-normal">
          Cars touched, round by round. {k.cars} in total.
        </Kicker>
      </div>
      </Aside>
    </Card>
  );
}

// The season's honours under a turning trophy: the trophy fills the frame,
// the titles are set big under it (on a wide screen, beside it).
// The trophy on the honours slide: a plain cup in the slide's own colours,
// shaded in hard bands like a printed picture rather than polished gold.
const TrophyArt = () => <Thing kind="trophy" d={150} className="st-3d h-full w-full" label="A trophy" fallback={null} />;

function Honours({ slide, review }) {
  const v = voiceOf(review);
  const wide = useContext(Wide);
  // One or two titles are set as poster lines. More than that and every
  // title gets the same size, so a long one is not tiny next to a short one.
  const many = slide.honours.length > 2;
  const titles = (
    <div className={many ? "space-y-2.5" : "space-y-3"}>
      {slide.honours.map((h, k) => (
        <div key={h.key}>
          {many ? (
            <div
              className="st-in wr-big uppercase leading-[0.95]"
              style={{ "--d": `${900 + k * 180}ms`, fontSize: "min(6.6cqi, 3.9cqh)", ...(k % 2 === 1 ? { color: "var(--g-pop)" } : null) }}
            >
              {h.title}
            </div>
          ) : (
            <Fill text={h.title} d={900 + k * 250} outline={k % 2 === 1} maxHeight={200} />
          )}
          {h.detail && (
            <Kicker d={1000 + k * (many ? 180 : 250)} className="mt-1 lv-mute normal-case tracking-normal">
              {h.detail}
            </Kicker>
          )}
        </div>
      ))}
    </div>
  );
  const trophy = <TrophyArt />;
  return (
    <Card>
      {wide ? (
        <>
          <Fill text={`And ${v.you}`} d={100} />
          <Fill text="took home" d={200} outline />
          <div className="mt-8">{titles}</div>
          <Aside>
            <div className="st-fill st-3d relative min-h-0 flex-1">
              <div className="absolute inset-0">{trophy}</div>
            </div>
          </Aside>
        </>
      ) : (
        <>
          <Kicker d={100}>And {v.you} took home</Kicker>
          <div className="relative -mx-4 min-h-[9rem] flex-1">
            <div className="absolute inset-0">{trophy}</div>
          </div>
          {titles}
        </>
      )}
    </Card>
  );
}

// A name set as big as the card's text column takes, never broken inside a
// word (Montserrat Black runs about 0.68 em a letter).
const nameFit = (name) => {
  const n = Math.max(
    4,
    ...String(name || "")
      .split(/\s+/)
      .map((w) => w.length),
  );
  return {
    fontSize: `min(9cqi, 4.6cqh, calc(46cqi / ${(n * 0.68).toFixed(2)}))`,
  };
};

// The cover of the summary card, as a Wrapped card shows the face of the
// year: the driver's own picture with the season number pinned to it, or,
// without a picture, the season number itself in the team colour.
function SeasonCover({ review }) {
  const [broken, setBroken] = useState(false);
  const num = /\d+$/.exec(String(review.season?.label || ""))?.[0] || "";
  const photo = review.driver?.photoUrl && !broken ? review.driver.photoUrl : null;
  return (
    <div className="wr-cover relative w-[40%] shrink-0" style={{ background: "var(--g-mark)", color: "var(--g-mark-fg)" }}>
      {photo ? (
        <>
          <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setBroken(true)} draggable="false" />
          {num && (
            <span className="wr-big wr-num absolute bottom-1.5 right-1.5 rounded-md px-1.5 py-0.5 leading-none" style={{ background: "var(--g-mark)", color: "var(--g-mark-fg)", fontSize: "min(7cqi, 3.2cqh)" }}>
              S{num}
            </span>
          )}
        </>
      ) : (
        <span className="wr-big wr-num leading-none" style={{ fontSize: "min(26cqi, 13cqh)" }}>
          {num || "S"}
        </span>
      )}
    </div>
  );
}

// The last slide: the summary card, the way Wrapped ends. A cover on top,
// two lists side by side, the two big numbers at the foot. The picture that
// "Save picture" makes is this card.
function Final({ slide, review, onReplay }) {
  const wide = useContext(Wide);
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
  const card = (
      <div
        className="st-land flex shrink-0 flex-col rounded-xl p-5"
        style={{
          "--d": "100ms",
          background: "var(--g-fg)",
          color: "var(--g-bg)",
        }}
      >
        <div className="flex items-center gap-3">
          <SeasonCover review={review} />
          <div className="min-w-0">
            <div className="text-[12px] font-bold uppercase tracking-[0.12em] opacity-60" style={{ fontFamily: "Inter, sans-serif" }}>
              {slide.eyebrow}
            </div>
            <div className="wr-big uppercase" style={nameFit(review.driver.name)}>
              {review.driver.name}
            </div>
            {review.driver.team?.name && (
              <div className="mt-1.5 flex items-center gap-2 font-bold" style={{ fontFamily: "Inter, sans-serif", fontSize: "min(4.4cqi, 2.1cqh)" }}>
                {review.driver.team.tier !== 0 && <TeamLogo id={review.driver.team.id} name={review.driver.team.name} color={review.driver.team.color} logoUrl={review.driver.team.logoUrl} size={26} />}
                <span className="truncate opacity-75">{review.driver.team.name}</span>
              </div>
            )}
          </div>
        </div>
        <div className={`mt-6 grid gap-4 ${top.length ? "grid-cols-[1.3fr_1fr]" : "grid-cols-1"}`}>
          {top.length > 0 && (
          <div className="min-w-0">
            <div className="text-[12px] font-bold uppercase tracking-[0.12em] opacity-60" style={{ fontFamily: "Inter, sans-serif" }}>
              Top results
            </div>
            <ol className="mt-2 space-y-1">
              {top.map((t, k) => (
                <li key={`${t.round}-${t.sprint}`} className="truncate font-extrabold leading-snug" style={{ fontSize: "min(4.2cqi, 2.2cqh)" }}>
                  {k + 1} {t.track} <span className="opacity-50">P{t.position}</span>
                </li>
              ))}
            </ol>
          </div>
          )}
          <div className="min-w-0">
            <div className="text-[12px] font-bold uppercase tracking-[0.12em] opacity-60" style={{ fontFamily: "Inter, sans-serif" }}>
              The season
            </div>
            <ol className="mt-2 space-y-1">
              {seasonList(slide, review).map((g) => (
                <li key={g.k} className="truncate font-extrabold leading-snug" style={{ fontSize: "min(4.2cqi, 2.2cqh)" }}>
                  {g.value} <span className="opacity-50">{g.label}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 border-t pt-4" style={{ borderColor: "color-mix(in srgb, currentColor 14%, transparent)" }}>
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
            <div className="wr-big wr-num" style={{ fontSize: "min(15cqi, 7cqh)", color: "var(--g-mark-paper, var(--g-mark))" }}>
              {c.position ? `P${c.position}` : "–"}
            </div>
          </div>
        </div>
        <div className="mt-3 text-[12px] font-bold opacity-50" style={{ fontFamily: "Inter, sans-serif" }}>
          NABS Racing League · {review.season.label}
        </div>
      </div>
  );
  const actions = (
      <div className="st-in pt-4" style={{ "--d": "700ms" }}>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={state === "busy"} className="lv-btn lv-btn-solid">
            {state === "busy" ? "Drawing it" : "Save picture"}
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
  );
  if (wide) {
    return (
      <div data-st-keep className="st-wide st-wide-final relative z-10 grid min-h-0 flex-1">
        <div className="st-col flex min-h-0 flex-col justify-center">{card}</div>
        <div className="st-col flex min-h-0 flex-col justify-center">
          <Fill text="That was your" d={300} />
          <Fill text={review.season.label} d={450} outline />
          <div className="mt-6">{actions}</div>
        </div>
      </div>
    );
  }
  return (
    <div data-st-keep className="relative z-10 flex min-h-0 flex-1 flex-col justify-center px-5 pb-6 pt-[4.4rem] sm:px-6">
      {card}
      {actions}
    </div>
  );
}

// "Guess your best race": four circuits, one of them right. Tapping one shows
// the answer and moves on to the slide that tells it; left alone, the clock
// runs out and the story moves on all the same.
function Quiz({ slide, review, onNext }) {
  const v = voiceOf(review);
  const [pick, setPick] = useState(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const answer = slide.answer;
  const wide = useContext(Wide);
  const choose = (t) => {
    if (pick) return;
    setPick(t);
    timer.current = setTimeout(() => onNext?.(), 1900);
  };
  return (
    <Card>
      <Kicker d={100}>Quick question</Kicker>
      <Fill text="Guess your" d={250} />
      <Fill text="best race" d={400} outline />
      <Aside>
      <div data-st-keep className={wide ? "space-y-3" : "mt-6 flex flex-1 flex-col justify-center gap-3"}>
        {slide.options.map((t, k) => {
          const right = pick && t === answer;
          const wrong = pick === t && t !== answer;
          return (
            <div key={t} className="st-in" style={{ "--d": `${700 + k * 140}ms` }}>
              <button
                type="button"
                onClick={() => choose(t)}
                className="flex w-full items-center gap-4 rounded-2xl py-2 pl-2 pr-5 text-left transition-[background,color,opacity] duration-300"
                style={{
                  ...(right ? { background: "var(--g-mark)", color: "var(--g-mark-fg)" } : { boxShadow: "inset 0 0 0 2px var(--g-fg)" }),
                  ...(pick && !right ? { opacity: wrong ? 0.6 : 0.25 } : null),
                }}
              >
                <span className="wr-cover w-16 shrink-0 rounded-xl" style={right ? { background: "var(--g-mark-fg)", color: "var(--g-mark)" } : undefined}>
                  <Outline track={t} className="h-[84%] w-[84%]" draw={false} width={3.8} />
                </span>
                <span className={`wr-big min-w-0 flex-1 truncate text-[1.45rem] uppercase ${wrong ? "line-through decoration-[3px]" : ""}`}>{t}</span>
                {pick && (right || wrong) && <span className="wr-big shrink-0 text-[1.1rem]">{right ? "P" + slide.position : "X"}</span>}
              </button>
            </div>
          );
        })}
        <div className="h-8 pt-1">
          {pick && (
            <Line d={0} size="min(5.6cqi, 3cqh)">
              {pick === answer ? <Mark>Got it.</Mark> : <>Nope.</>}
            </Line>
          )}
        </div>
      </div>
      </Aside>
    </Card>
  );
}

// The line a slide opens on, alone on the frame, before the figure comes:
// Wrapped's "but who did you play the most?" beat.
function teaseOf(key, review) {
  const v = voiceOf(review);
  switch (key) {
    case "training":
      return `${v.You} didn't just show up on race night.`;
    case "field":
      return `So how do ${v.you} stack up against everyone?`;
    case "tyres":
      return `Which tyre did ${v.you} live on?`;
    case "journey":
      return "And the championship?";
    default:
      return null;
  }
}

function Tease({ text }) {
  const wide = useContext(Wide);
  return (
    <div className={`st-tease pointer-events-none absolute inset-0 z-20 flex items-center ${wide ? "px-[6cqi]" : "px-6 sm:px-7"}`} aria-hidden="true">
      <p className="wr-big" style={wide ? { fontSize: "min(6.4cqi, 11cqh)", lineHeight: 1, maxWidth: "15em" } : { fontSize: "min(11cqi, 6cqh)", lineHeight: 1 }}>
        {text}
      </p>
    </div>
  );
}

// "That put you in the top 8% of the league", or where the rank put you.
function RankLine({ rank, what, d, scope = null }) {
  if (!rank) return null;
  const share = topShare(rank);
  return (
    <Line d={d} size="min(5.4cqi, 3cqh)">
      {rank.rank === 1 ? (
        <>
          <Mark>{rank.shared ? "Joint most" : "Most"}</Mark> {scope ? `in ${scope}` : "in the whole league"}.
        </>
      ) : share <= 25 ? (
        <>
          Only <Mark>{share}%</Mark> of {scope || "the league"} did more.
        </>
      ) : (
        rankWords(rank, what, scope)
      )}
    </Line>
  );
}

// Passes made on track, with a bar a round; the round with the most stands
// out in the team colour.
function Passes({ slide }) {
  const wide = useContext(Wide);
  const per = slide.perRound.filter((p) => p.n != null);
  const max = Math.max(1, ...per.map((p) => p.n));
  const top = per.reduce((a, b) => (b.n > (a?.n ?? -1) ? b : a), null);
  return (
    <Card>
      <Fill text="You passed" d={100} />
      <Echo value={fmt(slide.value)} d={350} />
      <Fill text="cars" d={800} outline />
      <RankLine rank={slide.rank} what="overtakes" d={1100} scope={slide.scope} />
      <Aside>
        <div className="mt-auto">
          <div className={`flex items-end gap-1.5 ${wide ? "h-64" : "h-28"}`}>
            {slide.perRound.map((p, k) => (
              <div key={p.round} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                {p.n != null ? (
                  <span
                    className="st-grow-y block w-full rounded-t-[3px]"
                    style={{ "--d": `${1300 + k * 60}ms`, height: `${Math.max(4, (p.n / max) * 100)}%`, background: p === top ? "var(--g-mark)" : "var(--g-fg)" }}
                  />
                ) : (
                  <span className="st-grow-y block h-[5px] w-full rounded-full" style={{ "--d": `${1300 + k * 60}ms`, boxShadow: "inset 0 0 0 1.5px var(--g-mute)" }} />
                )}
              </div>
            ))}
          </div>
          {top && (
            <Kicker d={1900} className="mt-3 lv-mute normal-case tracking-normal">
              {top.n} of them in one race, at {top.track}.
            </Kicker>
          )}
        </div>
      </Aside>
    </Card>
  );
}

// Laps in the lead, under a chequered flag.
function Led({ slide }) {
  const wide = useContext(Wide);
  const flag = <Thing kind="flag" d={200} className="st-3d h-full w-full" label="A chequered flag" fallback={null} />;
  const where = slide.where.slice(0, 3);
  return (
    <Card>
      <Kicker d={100}>Out in front</Kicker>
      <Fill text="You led" d={200} />
      <Echo value={fmt(slide.value)} d={450} />
      <Fill text={slide.value === 1 ? "lap" : "laps"} d={850} outline maxHeight={170} />
      {wide ? (
        <Aside>
          <div className="st-fill st-3d relative min-h-0 flex-1">
            <div className="absolute inset-0">{flag}</div>
          </div>
        </Aside>
      ) : (
        // On a phone the flag is a finish line: a wide band edge to edge
        // between the figure and the words, no pole to stand about on.
        <div className="relative -mx-6 my-3 min-h-[7rem] flex-1 sm:-mx-7">
          <div className="absolute inset-0">
            <Thing kind="flag" data={{ banner: true }} d={200} className="st-3d h-full w-full" label="A chequered flag" fallback={null} />
          </div>
        </div>
      )}
      {where.length > 0 && (
        <Line d={1200} size="min(5cqi, 2.8cqh)">
          {where.map((w, k) => (
            <span key={w.round}>
              {k > 0 ? ", " : ""}
              {k === 0 ? <Mark>{w.track}</Mark> : w.track} {w.laps}
            </span>
          ))}
          .
        </Line>
      )}
      <RankLine rank={slide.rank} what="laps led" d={1400} scope={slide.scope} />
    </Card>
  );
}

// Contact with other cars and with the scenery, against the field.
function Hits({ slide, review }) {
  const wide = useContext(Wide);
  const one = (n) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
  const rows = [
    { k: "me", label: "You", value: slide.perRace, you: true },
    slide.fieldPerRace != null ? { k: "field", label: "The field", value: slide.fieldPerRace } : null,
  ].filter((r) => r && r.value != null);
  const max = Math.max(0.1, ...rows.map((r) => r.value));
  const cleaner = slide.fieldPerRace != null && slide.perRace != null && slide.perRace < slide.fieldPerRace;
  return (
    <Card>
      <Fill text="You touched" d={100} />
      <Echo value={fmt(slide.cars)} d={350} />
      <Fill text={slide.cars === 1 ? "other car" : "other cars"} d={800} outline />
      {slide.scenery > 0 && (
        <Line d={1100} size="min(5.4cqi, 3cqh)">
          Plus the wall <Mark>{times(slide.scenery)}</Mark>.
        </Line>
      )}
      {slide.photo && (
        <Aside>
          <div className={wide ? "mb-6" : "relative my-4 min-h-[8rem] flex-1"}>
            {wide ? <Photo photo={slide.photo} d={1200} className="aspect-video w-full" /> : <div className="absolute inset-0"><Photo photo={slide.photo} d={1200} className="h-full w-full" /></div>}
          </div>
        </Aside>
      )}
      <Aside>
        <div className={`space-y-3 ${slide.photo && !wide ? "" : "mt-auto"}`}>
          <Kicker d={1400} className="lv-mute">
            Car contact a race
          </Kicker>
          {rows.map((r, k) => (
            <div key={r.k} className="st-in" style={{ "--d": `${1500 + k * 200}ms` }}>
              <div className="flex items-baseline justify-between text-[14px] font-extrabold uppercase">
                <span className="truncate">{r.label}</span>
                <span className="wr-num">{one(r.value)}</span>
              </div>
              <div className="mt-1 h-3 overflow-hidden rounded-full" style={{ background: "var(--g-faint)" }}>
                <span className="st-grow-x block h-full rounded-full" style={{ "--d": `${1600 + k * 200}ms`, width: `${Math.max(3, (r.value / max) * 100)}%`, background: r.you ? "var(--g-pop)" : "var(--g-fg)" }} />
              </div>
            </div>
          ))}
          {rows.length > 1 && (
            <Line d={2000} className="pt-1" size="min(5cqi, 2.8cqh)">
              {cleaner ? <>Less than the average driver.</> : <>More than the average driver.</>}
            </Line>
          )}
          {review.contact?.races ? (
            <Kicker d={2200} className="lv-mute normal-case tracking-normal">
              From the {plural(review.contact.races, "race")} the server logged.
            </Kicker>
          ) : null}
        </div>
      </Aside>
    </Card>
  );
}

// A round tile for a rank among Tier 2: the medal colours for the top three
// Tier 2 cars of the round, plain ink for the rest.
function TierTile({ p, d }) {
  const medal = p.rank <= 3;
  return (
    <div
      className="st-land flex aspect-square flex-col justify-between rounded-md p-1.5"
      style={{ "--d": `${d}ms`, ...(medal ? { background: MEDAL[p.rank - 1], color: MEDAL_INK[p.rank - 1] } : { background: "var(--g-fg)", color: "var(--g-bg)" }) }}
    >
      <span className="text-[10px] font-bold leading-none opacity-70" style={{ fontFamily: "Inter, sans-serif" }}>
        R{p.round}
      </span>
      <span className="wr-big wr-num text-right leading-none" style={{ fontSize: "1.35rem" }}>
        {p.rank}
      </span>
    </div>
  );
}

// The season inside Tier 2: the place among Tier 2, how often the driver was
// the best Tier 2 car of a round, and every round as a Tier 2 rank.
function Tier({ slide }) {
  const label = `Tier ${slide.tier}`;
  return (
    <Card>
      <Kicker d={100}>Just counting {label}</Kicker>
      <Fill text="You finished" d={200} />
      <Echo value={`P${slide.position}`} d={450} />
      <Fill text={`in ${label}`} d={850} outline />
      <Line d={1100} size="min(5.4cqi, 3cqh)">
        {slide.wins > 0 ? (
          <>
            Best {label} car <Mark>{times(slide.wins)}</Mark>
            {slide.podiums > slide.wins ? <>, top three {times(slide.podiums)}.</> : "."}
          </>
        ) : slide.podiums > 0 ? (
          <>
            Top three in {label} <Mark>{times(slide.podiums)}</Mark>.
          </>
        ) : (
          <>
            Out of <Mark>{slide.field} drivers</Mark> in {label}.
          </>
        )}
      </Line>
      <Aside>
        <div className="mt-auto">
          <Kicker d={1300} className="mb-2 lv-mute">
            Your place among {label}, round by round
          </Kicker>
          <div className="grid grid-cols-6 gap-1.5">
            {slide.perRound.map((p, k) => (
              <TierTile key={p.round} p={p} d={1400 + k * 70} />
            ))}
          </div>
        </div>
      </Aside>
    </Card>
  );
}

// The best run of the season: rounds in a row with points, or with the flag.
function Streak({ slide, review }) {
  const wide = useContext(Wide);
  const inRun = new Set(slide.rounds);
  const points = slide.kind === "points";
  return (
    <Card>
      <Kicker d={100}>Your best run</Kicker>
      <Echo value={slide.n} d={300} />
      <Fill text="rounds in a row" d={750} outline />
      <Line d={1050} size="min(5.4cqi, 3cqh)">
        {points ? "In the points" : "Saw the flag"} from <Mark>{slide.from.track}</Mark> to <Mark>{slide.to.track}</Mark>.
      </Line>
      <Aside>
        <div className="mt-auto">
          <div className={`grid grid-cols-6 ${wide ? "gap-2" : "gap-1.5"}`}>
            {review.rounds.map((r, k) => (
              <div key={r.round} style={inRun.has(r.round) ? null : { opacity: 0.28 }}>
                <RoundTile r={r} d={1300 + k * 70} />
              </div>
            ))}
          </div>
          <Kicker d={2100} className="mt-3 lv-mute normal-case tracking-normal">
            Rounds {slide.from.round} to {slide.to.round}, without a break.
          </Kicker>
        </div>
      </Aside>
    </Card>
  );
}

const SLIDES = {
  quiz: Quiz,
  intro: Intro,
  rounds: Rounds,
  training: Training,
  tyres: Tyres,
  limits: Limits,
  top: Top,
  best: Best,
  climb: Climb,
  podiums: Podiums,
  field: Field,
  journey: Journey,
  team: Team,
  contact: Contact,
  passes: Passes,
  led: Led,
  hits: Hits,
  tier: Tier,
  streak: Streak,
  honours: Honours,
  final: Final,
};

export default function StorySlide({ slide, review, onReplay, onNext }) {
  const Comp = SLIDES[slide.key];
  if (!Comp) return null;
  const tease = teaseOf(slide.key, review);
  const body = <Comp slide={slide} review={review} onReplay={onReplay} onNext={onNext} />;
  if (!tease) return body;
  return (
    <Offset.Provider value={TEASE_MS}>
      <Tease text={tease} />
      <div className="relative flex min-h-0 flex-1 flex-col" style={{ "--d0": `${TEASE_MS}ms` }}>
        {body}
      </div>
    </Offset.Provider>
  );
}

export const hasTease = (key) => ["training", "field", "tyres", "journey"].includes(key);
