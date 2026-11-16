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
import { Children, Fragment, cloneElement, isValidElement, createContext, useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MEDAL, readableInkOn } from "../../components/ui.jsx";
import CircuitMap from "../../components/CircuitMap.jsx";
import TeamLogo from "../../components/TeamLogo.jsx";
import { tyreCompound } from "../../data/liveTiming.js";
import { circuitFor } from "../../data/circuits.js";
import { nth } from "./copy.mjs";
import { seasonList } from "./storySlides.mjs";
import { saveSharePicture } from "./sharePicture.js";
import { motionOff } from "../../hooks/motion.js";
import Object3D, { has3D } from "./Object3D.jsx";

// How long a slide's opening line holds the frame before the slide itself
// comes in (review/story.css shifts every animation by it).
export const TEASE_MS = 2100;
const Offset = createContext(0);

const MEDAL_INK = MEDAL.map((m) => readableInkOn(m));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const fmt = (n) => Number(n || 0).toLocaleString("en-GB");

// "You" for the driver, the name for everyone else.
export function voiceOf(review) {
  const name = review.driver?.name || "This driver";
  return review.own ? { You: "You", you: "you", Your: "Your", your: "your", are: "are" } : { You: name, you: name, Your: `${name}'s`, your: `${name}'s`, are: "is" };
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
        <div className="st-col flex min-h-0 flex-col justify-center">{left}</div>
        {right.length > 0 && <div className="st-col st-aside flex min-h-0 flex-col justify-center">{right}</div>}
      </div>
    );
  }
  return <div className={`relative z-10 flex min-h-0 flex-1 flex-col px-6 pb-8 pt-[5.2rem] sm:px-7 ${className}`}>{children}</div>;
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
              className="st-in flex items-center gap-2.5 rounded-md px-2 py-1.5"
              style={{
                "--d": `${d + k * 110}ms`,
                ...(r.you ? { background: "var(--g-mark)", color: "var(--g-mark-fg)" } : null),
              }}
            >
              <span className="wr-big wr-num w-7 shrink-0 text-right text-[1.3rem] leading-none">{r.rank}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[14px] font-extrabold uppercase leading-tight">{r.you && review.own ? "You" : r.name}</span>
                  <span className="wr-num shrink-0 text-[14px] font-extrabold leading-tight">{fmt(r.value)}</span>
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

// A round sticker in the team colour, set at a slant over the slide.
const Stamp = ({ d = 0, className = "", children }) => (
  <div
    className={`st-land absolute flex h-[6.6rem] w-[6.6rem] items-center justify-center rounded-full text-center ${className}`}
    style={{
      "--d": `${d}ms`,
      background: "var(--g-mark)",
      color: "var(--g-mark-fg)",
    }}
  >
    <span className="wr-big block rotate-[-12deg] px-2 text-[0.95rem] uppercase leading-[1.02]">{children}</span>
  </div>
);

// --- the slides --------------------------------------------------------------------------

function Intro({ review }) {
  const v = voiceOf(review);
  const { season, driver } = review;
  const num = /\d+$/.exec(String(season.label))?.[0] || "";
  const head = num ? String(season.label).slice(0, -num.length).trim() : season.label;
  return (
    <Card>
      <Kicker d={100}>{review.own ? "This was your" : `This was ${v.your}`}</Kicker>
      <Fill text={head} d={250} />
      {num && <Echo value={num} d={500} size="min(92cqi, 52cqh)" />}
      <Aside>
      <div className="mt-auto">
        {driver.team && driver.team.tier !== 0 && (
          // The logo on its own light tile: a team logo in the team colour
          // would vanish on a slide painted in that same colour.
          <div className="st-land mb-4 inline-flex items-center justify-center rounded-2xl p-3" style={{ "--d": "1100ms", background: "#f6f5f1", boxShadow: "0 1px 0 rgba(0,0,0,0.08)" }}>
            <TeamLogo id={driver.team.id} name={driver.team.name} color={driver.team.color} logoUrl={driver.team.logoUrl} size={64} />
          </div>
        )}
        <Line d={1300}>
          <Mark>{driver.name}</Mark>
        </Line>
        <Kicker d={1500} className="mt-3 lv-mute">
          {season.roundsRun} rounds
          {driver.team?.name ? ` · ${driver.team.name}` : ""}
          {season.complete ? "" : " · so far"}
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
  const style = podium
    ? { background: "var(--g-mark)", color: "var(--g-mark-fg)" }
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
              Finished <Mark>every one</Mark>
            </>
          ) : (
            <>
              Saw the flag in <Mark>{plural(s.finishes, "race")}</Mark>
            </>
          )}
          {laps?.laps > 0 ? <>, {fmt(laps.laps)} laps in all.</> : "."}
        </Line>
        {laps?.rank && (
          <Kicker d={1500 + n * 70} className="mt-2 lv-mute normal-case tracking-normal">
            {topShare(laps.rank) <= 25 ? `That put ${v.you} in the top ${topShare(laps.rank)}% of the league for race laps.` : rankWords(laps.rank, "race laps")}
          </Kicker>
        )}
      </div>
      </Aside>
    </Card>
  );
}

// "The most race laps of 64 drivers", "7th most of 64 (shared)".
function rankWords(rank, what) {
  if (!rank) return null;
  const joint = rank.shared ? "joint " : "";
  return rank.rank === 1 ? `The ${joint}most ${what} of ${rank.of} drivers.` : `The ${joint}${nth(rank.rank)} most ${what} of ${rank.of} drivers.`;
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
        Over <Mark>{plural(slide.weeks, "race week")}</Mark>.
      </Line>
      <Aside>
      <div className="relative mt-auto">
        {!first && topShare(slide.rank) <= 25 && (
          <Stamp d={1500} className="-top-24 right-0">
            Top {topShare(slide.rank)}% of the league
          </Stamp>
        )}
        {first && (
          <Stamp d={1500} className="-top-24 right-0">
            {slide.rank.shared ? "Joint most" : "Most"} in the league
          </Stamp>
        )}
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

// The tyres the race laps were done on: a ring a compound, as big as its share.
function Tyres({ slide, review }) {
  const v = voiceOf(review);
  const [top] = slide.tyres;
  const name = tyreCompound(top.tyre).name;
  const shown = slide.tyres.slice(0, 4);
  return (
    <Card>
      <Kicker d={100}>{v.You} spent most race laps on</Kicker>
      <Fill text={`${name}s`} d={250} />
      <Echo value={`${top.share}%`} d={500} />
      <Line d={900} size="min(5.4cqi, 3cqh)">
        of them, <Mark>{plural(top.laps, "lap")}</Mark>.
      </Line>
      <Aside>
      <div className="mt-auto flex items-end justify-between gap-2">
        {shown.map((t, k) => {
          const c = tyreCompound(t.tyre);
          const size = `${(3.4 + (t.share / 100) * 5.2).toFixed(2)}rem`;
          return (
            <div key={t.tyre} className="st-land flex min-w-0 flex-col items-center" style={{ "--d": `${1200 + k * 160}ms` }}>
              <svg viewBox="0 0 100 100" style={{ width: size, height: size }} aria-hidden="true">
                <circle cx="50" cy="50" r="44" fill="#16161a" />
                <circle cx="50" cy="50" r="33" fill="none" stroke={c.color} strokeWidth="9" />
                <text x="50" y="50" dy="0.35em" textAnchor="middle" fill="#f6f5f1" style={{ font: "900 28px Montserrat, sans-serif" }}>
                  {c.label}
                </text>
              </svg>
              <span className="mt-2 text-[13px] font-extrabold uppercase">{c.name}</span>
              <span className="wr-num text-[12px] font-bold opacity-70" style={{ fontFamily: "Inter, sans-serif" }}>
                {fmt(t.laps)} laps · {t.share}%
              </span>
            </div>
          );
        })}
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
      label: review.own ? "You" : review.driver.name,
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
              The game handed out <Mark>{plural(slide.penalties, "penalty", "penalties")}</Mark>.
            </>
          ) : (
            <>Not one penalty from the game.</>
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
              <span className="wr-cover shrink-0 rounded-lg" style={{ width: "min(14cqi, 7cqh)", ...(k === 0 ? { background: "var(--g-mark)", color: "var(--g-mark-fg)" } : null) }}>
                <Outline track={t.track} className="h-[72%] w-[72%]" d={650 + k * 150} width={7} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="wr-big block truncate uppercase leading-none" style={{ fontSize: "min(6.6cqi, 3.3cqh)" }}>
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

function Best({ review }) {
  const v = voiceOf(review);
  const b = review.best;
  const wide = useContext(Wide);
  const picture = b.heroImageUrl ? <img src={b.heroImageUrl} alt="" className="h-full w-full rounded-xl object-cover" /> : <Circuit3D track={b.track} d={250} className="h-full w-full" />;
  return (
    <Card>
      <Kicker d={100}>{v.Your} best race</Kicker>
      <Echo value={`P${b.position}`} d={600} size="min(48cqi, 24cqh)" />
      {wide ? (
        <Aside>
          <div className="st-fill st-3d relative min-h-0 flex-1">
            <div className="absolute inset-0">{picture}</div>
          </div>
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
            In one race, at <Mark>{c.track}</Mark>.
          </Line>
          <div className="mt-6">{fromTo}</div>
          <Aside>
            <div className="st-fill st-3d relative min-h-0 flex-1">
              <div className="absolute inset-0">
                <Circuit3D track={c.track} d={500} className="h-full w-full" />
              </div>
            </div>
          </Aside>
        </>
      ) : (
        <>
          <div className="relative -mx-2 mt-2 min-h-[7rem] flex-1">
            <div className="absolute inset-0">
              <Circuit3D track={c.track} d={500} className="h-full w-full" />
            </div>
          </div>
          {fromTo}
          <Line d={1400} className="mt-2" size="min(5.6cqi, 3cqh)">
            In one race, at <Mark>{c.track}</Mark>.
          </Line>
        </>
      )}
    </Card>
  );
}

// The podiums as medals: solid, metal, dropping in one after another and
// spinning to face out, four to a row with the circuit under each.
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
          {has3D()
            ? rows.map((row, r) => (
                <div key={r}>
                  <Thing
                    kind="medals"
                    data={{ places: row.map((p) => p.position), cols }}
                    d={1000 + r * cols * 180}
                    className="w-full"
                    style={{ aspectRatio: `${cols} / 1.05` }}
                    label={`Podium places: ${row.map((p) => `P${p.position}`).join(", ")}`}
                  />
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
              ))
            : flat}
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
        out of <Mark>{rank.of} drivers</Mark>.
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
      <Echo value={slide.value} d={300} />
      <Fill text="in the championship" d={750} outline />
      <Aside>
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
      </Aside>
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
      <Aside>
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
      </Aside>
    </Card>
  );
}

// The season's honours under a turning trophy: the trophy fills the frame,
// the titles are set big under it (on a wide screen, beside it).
function Honours({ slide, review }) {
  const v = voiceOf(review);
  const wide = useContext(Wide);
  const titles = (
    <div className="space-y-3">
      {slide.honours.map((h, k) => (
        <div key={h.key}>
          <Fill text={h.title} d={900 + k * 250} outline={k % 2 === 1} maxHeight={200} />
          {h.detail && (
            <Kicker d={1000 + k * 250} className="mt-1 lv-mute normal-case tracking-normal">
              {h.detail}
            </Kicker>
          )}
        </div>
      ))}
    </div>
  );
  const trophy = <Thing kind="trophy" d={150} className="st-3d h-full w-full" label="A trophy" fallback={null} />;
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
              <div className="mt-1 flex items-center gap-1.5 text-[13px] font-bold" style={{ fontFamily: "Inter, sans-serif" }}>
                {review.driver.team.tier !== 0 && <TeamLogo id={review.driver.team.id} name={review.driver.team.name} color={review.driver.team.color} logoUrl={review.driver.team.logoUrl} size={18} />}
                <span className="truncate opacity-60">{review.driver.team.name}</span>
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
            <div className="wr-big wr-num" style={{ fontSize: "min(15cqi, 7cqh)", color: "var(--g-mark)" }}>
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
          <Fill text={review.own ? "That was your" : `That was ${voiceOf(review).your}`} d={300} />
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
  const choose = (t) => {
    if (pick) return;
    setPick(t);
    timer.current = setTimeout(() => onNext?.(), 1900);
  };
  return (
    <Card>
      <Kicker d={100}>Quick question</Kicker>
      <Fill text={review.own ? "Guess your" : `Guess ${v.your}`} d={250} />
      <Fill text="best race" d={400} outline />
      <Aside>
      <div data-st-keep className="mt-auto space-y-2.5">
        {slide.options.map((t, k) => {
          const right = pick && t === answer;
          const wrong = pick === t && t !== answer;
          return (
            <div key={t} className="st-in" style={{ "--d": `${700 + k * 140}ms` }}>
              <button
                type="button"
                onClick={() => choose(t)}
                className="flex w-full items-center gap-3 rounded-2xl py-2 pl-2 pr-5 text-left transition-[background,color,opacity] duration-300"
                style={{
                  ...(right ? { background: "var(--g-mark)", color: "var(--g-mark-fg)" } : { boxShadow: "inset 0 0 0 2px var(--g-fg)" }),
                  ...(pick && !right ? { opacity: wrong ? 0.6 : 0.25 } : null),
                }}
              >
                <span className="wr-cover w-12 shrink-0 rounded-xl" style={right ? { background: "var(--g-mark-fg)", color: "var(--g-mark)" } : undefined}>
                  <Outline track={t} className="h-[74%] w-[74%]" draw={false} width={7} />
                </span>
                <span className={`wr-big min-w-0 flex-1 truncate text-[1.25rem] uppercase ${wrong ? "line-through decoration-[3px]" : ""}`}>{t}</span>
                {pick && (right || wrong) && <span className="wr-big shrink-0 text-[1.1rem]">{right ? "P" + slide.position : "X"}</span>}
              </button>
            </div>
          );
        })}
        <div className="h-8 pt-1">
          {pick && (
            <Line d={0} size="min(5.6cqi, 3cqh)">
              {pick === answer ? <Mark>Right.</Mark> : <>Not quite.</>}
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
      return `${v.You} did not only drive on race nights.`;
    case "field":
      return `So how did ${v.you} compare with everyone else?`;
    case "tyres":
      return `Which tyre did ${v.you} trust the most?`;
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
