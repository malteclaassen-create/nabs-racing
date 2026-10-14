import { createContext, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { ArrowUp, Crown, Medal, Rocket, ShieldCheck, Sparkles, Timer, Trophy, Flag as FlagIcon, Share2, Download, Link as LinkIcon, RotateCcw, LayoutGrid } from "lucide-react";
import { DriverAvatar, readableInkOn } from "./ui.jsx";
import { circuitFor } from "../data/circuits.js";
import { prettyTrack } from "../utils/pageTitle.js";
import { fmtLap } from "../utils/format.js";
import { motionOff } from "../hooks/motion.js";

// ---------------------------------------------------------------------------
// The slides of the Season Wrapped story (components/WrappedStory.jsx plays
// them; utils/wrappedStory.mjs decides which there are and what they say).
//
// Two layouts. Tall, for a phone held upright (and the 9:16 card on a tablet):
// the words at the top and the bottom, and where a slide has a 3D scene
// (components/WrappedStage.jsx) the scene in the band between. Wide, for a
// computer: the whole screen is the scene, the words stand in a column on the
// left, larger, and the 3D fills the rest. Either way soft fades in the
// slide's colour keep the words readable over the scene, and without 3D (no
// WebGL, Lite mode) the scene's place holds a flat picture of the same idea.
//
// Headlines arrive word by word, numbers count up on the story's clock, and
// everything holds still while the story is paused.
// ---------------------------------------------------------------------------

// The story's clock: seconds into the current slide, ticking with the story.
export const StoryClock = createContext(null);
// The layout: { wide, scened, logo } — wide is the computer layout, scened
// that the slide has a 3D scene behind it right now, logo the league's mark in
// the colour that shows on this slide.
export const StoryLayout = createContext({ wide: false, scened: false, logo: null });
const useLayout = () => useContext(StoryLayout);

const MEDAL_ON_DARK = ["#F5C542", "#DFE3EA", "#E39A5F"];
const medalColor = (p) => (p >= 1 && p <= 3 ? MEDAL_ON_DARK[p - 1] : null);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);

// A number that counts up to `value` from `delay` ms into its slide.
export function Count({ value, delay = 300, dur = 1100, prefix = "", suffix = "" }) {
  const clock = useContext(StoryClock);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const show = (n) => {
      el.textContent = `${prefix}${Math.round(n).toLocaleString("en-US")}${suffix}`;
    };
    if (!clock || motionOff() || !Number.isFinite(value)) {
      show(value || 0);
      return undefined;
    }
    return clock.subscribe((t) => {
      const k = Math.min(1, Math.max(0, (t * 1000 - delay) / dur));
      show(value * easeOut(k));
    });
  }, [clock, value, delay, dur, prefix, suffix]);
  return (
    <>
      <span ref={ref} aria-hidden="true" className="tabular-nums">
        {prefix}0{suffix}
      </span>
      <span className="sr-only">
        {prefix}
        {Number(value || 0).toLocaleString("en-US")}
        {suffix}
      </span>
    </>
  );
}

// Animated entrance: `kind` is one of the .st-* entrances in index.css.
function St({ as: Tag = "div", kind = "rise", d = 0, className = "", style, children, ...rest }) {
  return (
    <Tag className={`st st-${kind} ${className}`} style={{ "--d": `${d}ms`, ...style }} {...rest}>
      {children}
    </Tag>
  );
}

const Eyebrow = ({ children, d = 0 }) => {
  const { wide } = useLayout();
  return (
    <St kind="fade" d={d} className={`font-mono font-bold uppercase tracking-[0.22em] opacity-90 ${wide ? "text-[13px]" : "text-[11px]"}`}>
      {children}
    </St>
  );
};

// A headline, each word rising out of its own line, one after the other.
function Title({ children, d = 150, tall = "min(9.5cqw, 2.6rem)", wide: wideSize = "min(4.6vw, 4.8rem)" }) {
  const { wide } = useLayout();
  const words = String(children).split(/\s+/).filter(Boolean);
  return (
    <h2 className="font-display font-black uppercase leading-[0.98] tracking-tight [text-wrap:balance]" style={{ fontSize: wide ? wideSize : tall }}>
      {words.map((w, i) => (
        <span key={i}>
          <span className="inline-block overflow-hidden pb-[0.06em] align-bottom">
            <span className="st st-up inline-block" style={{ "--d": `${d + i * 75}ms` }}>
              {w}
            </span>
          </span>{" "}
        </span>
      ))}
    </h2>
  );
}

// A big number or word that has to fit the frame's width.
const fitSize = (text, max = 9.5, share = 0.86) => `min(${max}rem, calc(${share * 100}cqw / ${Math.max(2.2, String(text).length * 0.6)}))`;

// Words set as large as `max` pixels allows, shrunk together until the widest
// line fits the box: a long name or "The Podium Regular" in heavy capitals is
// far wider than its letter count suggests. Each line is a [data-fit] child.
function useFit(ref, max, key) {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    let width = -1;
    const fit = () => {
      box.style.fontSize = `${max}px`;
      const avail = box.clientWidth;
      let k = 1;
      for (const line of box.querySelectorAll("[data-fit]")) k = Math.min(k, avail / Math.max(1, line.scrollWidth));
      box.style.fontSize = `${Math.floor(max * Math.min(1, k * 0.98))}px`;
    };
    const onResize = () => {
      if (box.clientWidth !== width) {
        width = box.clientWidth;
        fit();
      }
    };
    onResize();
    let alive = true;
    document.fonts?.ready?.then(() => alive && fit());
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    ro?.observe(box);
    return () => {
      alive = false;
      ro?.disconnect();
    };
  }, [ref, max, key]);
}

// The big soft shapes drifting behind a slide's words. Sized against both
// sides of the frame, so a wide screen does not blow them up past it.
function Shapes({ colors, variant = 0 }) {
  const ink = colors.ink;
  const accent = colors.accent;
  const v = (n) => `min(${n}cqw, ${n}vh)`;
  const sets = [
    [
      { cls: "rounded-full", style: { width: v(70), height: v(70), right: `calc(${v(70)} * -0.4)`, top: `calc(${v(70)} * -0.2)`, background: accent, opacity: 0.16, "--dx": "-18px", "--dy": "26px" } },
      { cls: "rounded-full", style: { width: v(48), height: v(48), left: `calc(${v(48)} * -0.4)`, bottom: "8%", border: `${v(10)} solid ${ink}`, opacity: 0.07, "--rot": "-12deg" } },
      { cls: "story-spin rounded-full", style: { width: v(26), height: v(26), right: "12%", bottom: "14%", border: `${v(1.6)} dashed ${ink}`, opacity: 0.18 } },
    ],
    [
      { cls: "", style: { width: "150%", height: v(22), left: "-25%", top: "34%", background: ink, opacity: 0.06, transform: "rotate(-12deg)", "--rot": "-4deg", "--dy": "18px" } },
      { cls: "rounded-full", style: { width: v(36), height: v(36), right: `calc(${v(36)} * -0.2)`, bottom: "16%", background: accent, opacity: 0.18, "--dx": "-30px" } },
      { cls: "story-spin rounded-[28%]", style: { width: v(20), height: v(20), left: "8%", top: "16%", border: `${v(1.4)} solid ${accent}`, opacity: 0.3 } },
    ],
    [
      { cls: "rounded-[30%]", style: { width: v(58), height: v(58), left: `calc(${v(58)} * -0.28)`, top: "10%", border: `${v(6)} solid ${accent}`, opacity: 0.2, "--rot": "40deg" } },
      { cls: "rounded-full", style: { width: v(84), height: v(84), right: `calc(${v(84)} * -0.48)`, bottom: `calc(${v(84)} * -0.24)`, background: ink, opacity: 0.06, "--dx": "-20px", "--dy": "-20px" } },
    ],
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {sets[variant % sets.length].map((s, i) => (
        <div key={i} className={`story-shape ${s.cls}`} style={s.style} />
      ))}
    </div>
  );
}

// A word repeated in outline across the slide, sliding by: the kind of texture
// Spotify's Wrapped puts behind its big statements.
function Marquee({ text, colors, top = "58%", size = "min(26cqw, 24vh)" }) {
  const row = `${String(text).toUpperCase()} • `.repeat(6);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 overflow-hidden" style={{ top }}>
      <div
        className="story-marquee font-display font-black leading-none"
        style={{ fontSize: size, color: "transparent", WebkitTextStroke: `2px ${colors.ink}`, opacity: 0.1 }}
      >
        <span className="pr-[0.3em]">{row}</span>
        <span className="pr-[0.3em]">{row}</span>
      </div>
    </div>
  );
}

// Fades in the slide's colour over a 3D scene: top and bottom in the tall
// layout, from the left in the wide one, where the words are.
function Scrims({ bg }) {
  const { wide } = useLayout();
  if (wide) {
    return (
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-y-0 left-0 w-[64%]" style={{ background: `linear-gradient(to right, ${bg} 0%, ${bg} 30%, ${bg}d9 46%, ${bg}00 100%)` }} />
        <div className="absolute inset-x-0 top-0 h-[22%]" style={{ background: `linear-gradient(to bottom, ${bg}cc 0%, ${bg}00 100%)` }} />
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-0 top-0 h-[40%]" style={{ background: `linear-gradient(to bottom, ${bg} 0%, ${bg}e6 32%, ${bg}00 100%)` }} />
      <div className="absolute inset-x-0 bottom-0 h-[42%]" style={{ background: `linear-gradient(to top, ${bg} 0%, ${bg}e6 36%, ${bg}00 100%)` }} />
    </div>
  );
}

// --- the flat pictures, where there is no 3D ---------------------------------------

function CircuitArt({ track, paint, ink }) {
  const c = circuitFor(track);
  if (!c) return <Trophy className="h-28 w-28" style={{ color: paint }} aria-hidden="true" />;
  return (
    <svg viewBox={c.box} className="h-full max-h-[56vh] w-full max-w-[70vh]" aria-hidden="true" fill="none">
      <path d={c.path} stroke={ink} strokeOpacity="0.25" strokeWidth="6" strokeLinejoin="round" />
      <path d={c.path} pathLength="1" className="story-trace" style={{ "--d": "400ms" }} stroke={paint} strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function JourneyArt({ journey, paint, ink }) {
  const n = journey.length;
  // From P1 down to just below the lowest place, like the 3D chart.
  const F = Math.max(6, Math.max(...journey.map((j) => j.position)) + 1);
  const W = 300;
  const H = 160;
  const x = (i) => 10 + (i / Math.max(1, n - 1)) * (W - 20);
  const y = (p) => 10 + ((p - 1) / (F - 1)) * (H - 20);
  const d = journey.map((j, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(j.position).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[80vh]" aria-hidden="true" fill="none">
      <line x1="10" x2={W - 10} y1={y(1)} y2={y(1)} stroke={ink} strokeOpacity="0.25" strokeDasharray="4 6" />
      <path d={d} pathLength="1" className="story-trace" stroke={paint} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      {journey.map((j, i) => (
        <circle key={j.round} cx={x(i)} cy={y(j.position)} r="4" fill={paint} />
      ))}
    </svg>
  );
}

function FlatArt({ scene, colors }) {
  if (!scene) return null;
  const { paint } = scene;
  const ink = colors.ink;
  const v = (n) => `min(${n}cqw, ${n * 0.8}vh)`;
  let art = null;
  if (scene.kind === "intro") {
    art = (
      <div className="flex items-center justify-center rounded-full font-display font-black" style={{ width: v(52), height: v(52), border: `${v(3)} solid ${paint}`, fontSize: v(22) }}>
        {scene.number ?? "★"}
      </div>
    );
  } else if (scene.kind === "circuit") art = <CircuitArt track={scene.track} paint={paint} ink={ink} />;
  else if (scene.kind === "climb") art = <ArrowUp style={{ color: paint, width: v(40), height: v(40) }} strokeWidth={2.4} aria-hidden="true" />;
  else if (scene.kind === "trophies") {
    const tone = { gold: MEDAL_ON_DARK[0], silver: MEDAL_ON_DARK[1], bronze: MEDAL_ON_DARK[2] };
    art = (
      <div className="flex flex-wrap justify-center gap-3">
        {scene.tones.map((t, i) => (
          <St key={i} kind="pop" d={300 + i * 200}>
            <Trophy style={{ color: tone[t] || paint, width: v(17), height: v(17) }} aria-hidden="true" />
          </St>
        ))}
      </div>
    );
  } else if (scene.kind === "journey") art = <JourneyArt journey={scene.journey} paint={paint} ink={ink} />;
  else if (scene.kind === "podium" || scene.kind === "grid") {
    art = (
      <div className="flex items-end gap-2" aria-hidden="true">
        {[2, 1, 3].map((p) => (
          <div
            key={p}
            className="flex items-start justify-center rounded-t-lg pt-2 font-display font-black"
            style={{ width: v(20), fontSize: v(7), height: v(p === 1 ? 34 : p === 2 ? 25 : 18), background: scene.kind === "podium" && p === scene.position ? paint : `${ink}22` }}
          >
            {p}
          </div>
        ))}
      </div>
    );
  }
  return <div className="flex h-full w-full items-center justify-center">{art}</div>;
}

// --- the slides --------------------------------------------------------------------

// The frame every slide sits in: its colours, the shapes behind (a slide
// without a scene) or the fades over the scene, and the words in front.
function Frame({ slide, variant = 0, marquee = null, children }) {
  const { colors } = slide;
  const { wide, scened } = useLayout();
  return (
    <div className="absolute inset-0" style={{ color: colors.ink }}>
      {!scened && <Shapes colors={colors} variant={variant} />}
      {!scened && marquee && <Marquee text={marquee} colors={colors} top={wide ? "62%" : "64%"} />}
      {scened && <Scrims bg={colors.bg} />}
      <div
        className={
          wide
            ? "relative flex h-full flex-col px-[6vw] pb-[5.5vh] pt-[9.5rem]"
            : "relative flex h-full flex-col px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-[5.75rem] sm:px-7 [@media(max-height:640px)]:pb-4 [@media(max-height:640px)]:pt-[5rem]"
        }
      >
        {children}
      </div>
    </div>
  );
}

// Top words, the scene's place, bottom words. Wide: the words as a column on
// the left and the scene (or its flat picture) to the right of them.
function SceneLayout({ slide, flat, top, bottom }) {
  const { wide } = useLayout();
  if (wide) {
    return (
      <Frame slide={slide}>
        <div className="flex h-full max-w-[min(42vw,42rem)] flex-col">
          <div className="space-y-4">{top}</div>
          <div className="flex-1" />
          <div className="space-y-3">{bottom}</div>
        </div>
        {flat && (
          <div className="absolute inset-y-[18%] right-[6vw] w-[46vw]">
            <FlatArt scene={slide.scene} colors={slide.colors} />
          </div>
        )}
      </Frame>
    );
  }
  return (
    <Frame slide={slide}>
      <div className="space-y-2.5">{top}</div>
      <div className="min-h-0 flex-1">{flat && <FlatArt scene={slide.scene} colors={slide.colors} />}</div>
      <div className="space-y-2">{bottom}</div>
    </Frame>
  );
}

// The headline number of a scene slide (P1, +30, 2).
// `share`: how much of a phone's width it may take (less where a word sits
// beside it).
function BigLine({ text, medal, color, d = 500, share = 0.9 }) {
  const { wide } = useLayout();
  return (
    <St
      kind="pop"
      d={d}
      className="font-display font-black leading-[0.85] tracking-tighter"
      style={{ fontSize: wide ? "min(24vh, 15rem)" : fitSize(text, 8.5, share), color: medalColor(medal) || color || undefined }}
    >
      {text}
    </St>
  );
}

// A line under the headline number (where, which round).
function Place({ children, d = 800 }) {
  const { wide } = useLayout();
  return (
    <St d={d} className={`font-display font-extrabold uppercase tracking-tight ${wide ? "text-3xl" : "text-xl"}`}>
      {children}
    </St>
  );
}

function Small({ children, d = 1000 }) {
  const { wide } = useLayout();
  return (
    <St d={d} className={`font-mono font-bold uppercase tracking-wider opacity-90 ${wide ? "text-sm" : "text-xs"}`}>
      {children}
    </St>
  );
}

function IntroSlide({ slide, data, flat }) {
  const d = data.driver;
  const { wide, logo } = useLayout();
  return (
    <SceneLayout
      slide={slide}
      flat={flat}
      top={
        <>
          <St kind="pop" className={`-ml-2 flex items-center gap-1.5 font-display font-black tracking-tight ${wide ? "text-3xl" : "text-xl"}`}>
            {logo && <img src={logo} alt="" width={64} height={64} className={wide ? "h-24 w-24" : "h-16 w-16"} />}
            NABS RACING
          </St>
          <Eyebrow d={150}>{slide.eyebrow}</Eyebrow>
        </>
      }
      bottom={
        <>
          <Title d={250} tall="min(11cqw, 3.1rem)" wide="min(6vw, 6.4rem)">
            {slide.title}
          </Title>
          <St d={900} className={`font-semibold leading-snug opacity-90 ${wide ? "text-xl" : "text-[15px]"}`}>
            {slide.sub}
          </St>
          <St d={1100} className={`flex flex-wrap items-center gap-2 pt-1 font-mono font-bold uppercase tracking-wider ${wide ? "text-sm" : "text-[11px]"}`}>
            {d.number != null && (
              <span className="rounded-md px-2 py-1" style={{ background: slide.scene.paint, color: readableInkOn(slide.scene.paint) }}>
                #{d.number}
              </span>
            )}
            {d.team?.name && <span className="rounded-md bg-white/10 px-2 py-1">{d.team.name}</span>}
          </St>
          <St kind="fade" d={2200} className="pt-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] opacity-80">
            <span className="story-hint-touch">Tap to go on, hold to pause</span>
            <span className="story-hint-mouse">Click or press → to go on, Space to pause</span>
          </St>
        </>
      }
    />
  );
}

function NumbersSlide({ slide }) {
  const { wide } = useLayout();
  const lead = (
    <St d={150} className="font-display font-extrabold leading-tight" style={{ fontSize: wide ? "min(3.4vw, 3.4rem)" : "min(7.6cqw,2rem)" }}>
      {slide.lead}
    </St>
  );
  const count = (
    <St kind="pop" d={450} className="font-display font-black leading-[0.82] tracking-tighter" style={{ fontSize: wide ? "min(52vh, 34vw)" : "min(42cqw, 11rem)" }}>
      <Count value={slide.count} delay={500} dur={1300} />
    </St>
  );
  const unit = (
    <St d={700} className="font-display font-extrabold leading-tight" style={{ fontSize: wide ? "min(3.4vw, 3.4rem)" : "min(7.6cqw,2rem)" }}>
      {slide.unit}
    </St>
  );
  const then = (
    <St d={1900} className={`font-semibold leading-snug ${wide ? "mt-8 max-w-[30rem] text-2xl" : "mt-6 max-w-[22rem] text-[min(5cqw,1.25rem)]"}`}>
      {slide.then}
    </St>
  );
  const points = (
    <St d={3000} className={`flex items-baseline gap-3 ${wide ? "mt-8" : "mt-6"}`}>
      <span className="font-display font-black leading-none tracking-tight" style={{ fontSize: wide ? "min(10vh, 6.5rem)" : "min(17cqw, 4.5rem)" }}>
        <Count value={slide.points} delay={3100} dur={1200} />
      </span>
      <span className="font-display font-extrabold" style={{ fontSize: wide ? "2rem" : "min(6cqw,1.6rem)" }}>
        {slide.pointsLine.replace(/^\S+\s/, "")}
      </span>
    </St>
  );
  return (
    <Frame slide={slide} variant={0}>
      <Eyebrow>{slide.eyebrow}</Eyebrow>
      {wide ? (
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-[4vw]">
          <div>
            {lead}
            {then}
            {points}
          </div>
          <div className="text-right">
            {count}
            {unit}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center">
          {lead}
          {count}
          {unit}
          {then}
          {points}
        </div>
      )}
    </Frame>
  );
}

function BestSlide({ slide, flat }) {
  return (
    <SceneLayout
      slide={slide}
      flat={flat}
      top={
        <>
          <Eyebrow>{slide.eyebrow}</Eyebrow>
          <Title>{slide.title}</Title>
        </>
      }
      bottom={
        <>
          <BigLine text={slide.big} medal={slide.medal} />
          <Place>{slide.place}</Place>
          {slide.sub && <Small>{slide.sub}</Small>}
        </>
      }
    />
  );
}

function ClimbSlide({ slide, flat }) {
  const { wide } = useLayout();
  return (
    <SceneLayout
      slide={slide}
      flat={flat}
      top={
        <>
          <Eyebrow>{slide.eyebrow}</Eyebrow>
          <Title>{slide.title}</Title>
        </>
      }
      bottom={
        <>
          <div className="flex flex-wrap items-end gap-x-3">
            <BigLine text={slide.big} color={slide.colors.accent} d={5600} share={0.6} />
            <St d={5900} className={`pb-2 font-display font-black uppercase ${wide ? "text-4xl" : "text-2xl"}`}>
              {slide.unit}
            </St>
          </div>
          <Place d={6100}>{slide.place}</Place>
        </>
      }
    />
  );
}

function WinsSlide({ slide, flat }) {
  const { wide } = useLayout();
  return (
    <SceneLayout
      slide={slide}
      flat={flat}
      top={
        <>
          <Eyebrow>{slide.eyebrow}</Eyebrow>
          <Title>{slide.title}</Title>
        </>
      }
      bottom={
        <>
          <div className="flex flex-wrap items-end gap-x-3">
            <BigLine text={slide.big} d={400} share={0.6} />
            <St d={600} className={`pb-2 font-display font-black uppercase ${wide ? "text-4xl" : "text-2xl"}`}>
              {slide.unit}
            </St>
          </div>
          {slide.list.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {slide.list.slice(0, 6).map((w, i) => (
                <St
                  key={i}
                  kind="pop"
                  d={900 + i * 160}
                  className={`rounded-lg px-2.5 py-1 font-mono font-bold uppercase tracking-wide ${wide ? "text-sm" : "text-[11px]"}`}
                  style={{ background: `${slide.colors.ink}14` }}
                >
                  {w}
                </St>
              ))}
              {slide.list.length > 6 && (
                <St d={900 + 6 * 160} className="rounded-lg px-2.5 py-1 font-mono text-[11px] font-bold uppercase" style={{ background: `${slide.colors.ink}14` }}>
                  +{slide.list.length - 6} more
                </St>
              )}
            </div>
          )}
          {slide.sub && <Small d={1500}>{slide.sub}</Small>}
        </>
      }
    />
  );
}

function TeammateSlide({ slide }) {
  const { colors } = slide;
  const { wide } = useLayout();
  const face = wide ? 132 : 76;
  return (
    <Frame slide={slide} variant={1}>
      <Eyebrow>{slide.eyebrow}</Eyebrow>
      <div className="mt-2">
        <Title>{slide.title}</Title>
      </div>
      <div className={`flex flex-1 flex-col justify-center gap-7 [@media(max-height:640px)]:gap-3 ${wide ? "mx-auto w-full max-w-5xl gap-12" : ""}`}>
        <div className="flex items-center justify-between gap-3 [@media(max-height:640px)]:-my-2 [@media(max-height:640px)]:scale-[0.8]">
          <St kind="left" d={400} className="flex min-w-0 flex-col items-center gap-2 text-center">
            <DriverAvatar name={slide.me.name} photoUrl={slide.me.photoUrl} color={slide.paint} size={face} />
            <span className={`truncate font-display font-black uppercase ${wide ? "max-w-[30vw] text-3xl" : "max-w-[34cqw] text-lg"}`}>{slide.me.name}</span>
          </St>
          <St kind="pop" d={700} className={`font-display font-black opacity-80 ${wide ? "text-6xl" : "text-2xl"}`}>
            VS
          </St>
          <St kind="right" d={400} className="flex min-w-0 flex-col items-center gap-2 text-center">
            <DriverAvatar name={slide.other.name} photoUrl={slide.other.photoUrl} color="#6b7280" size={face} />
            <span className={`truncate font-display font-black uppercase ${wide ? "max-w-[30vw] text-3xl" : "max-w-[34cqw] text-lg"}`}>{slide.other.name}</span>
          </St>
        </div>
        <div className={`space-y-5 [@media(max-height:640px)]:space-y-2.5 ${wide ? "space-y-8" : ""}`}>
          {slide.rows.map((r, i) => {
            const total = r.a + r.b;
            const share = total ? r.a / total : 0.5;
            return (
              <St key={r.label} d={1100 + i * 450}>
                <div className="flex items-baseline justify-between font-display font-black">
                  <span className={`tabular-nums ${wide ? "text-7xl" : "text-4xl"}`}>
                    <Count value={r.a} delay={1200 + i * 450} dur={900} />
                  </span>
                  <span className={`font-mono font-bold uppercase tracking-[0.18em] opacity-90 ${wide ? "text-sm" : "text-[11px]"}`}>{r.label}</span>
                  <span className={`tabular-nums ${wide ? "text-7xl" : "text-4xl"}`}>
                    <Count value={r.b} delay={1200 + i * 450} dur={900} />
                  </span>
                </div>
                <div className={`mt-2 flex gap-[3px] overflow-hidden rounded-full ${wide ? "h-4" : "h-3"}`} style={{ background: `${colors.ink}26` }}>
                  <div className="st st-grow h-full rounded-l-full" style={{ "--d": `${1300 + i * 450}ms`, width: `${share * 100}%`, background: slide.paint }} />
                </div>
              </St>
            );
          })}
        </div>
      </div>
    </Frame>
  );
}

function RivalSlide({ slide }) {
  const { wide } = useLayout();
  const nameRef = useRef(null);
  useFit(nameRef, wide ? 220 : 96, `${slide.name}:${wide}`);
  return (
    <Frame slide={slide} variant={2} marquee={slide.name}>
      <Eyebrow>{slide.eyebrow}</Eyebrow>
      <div className="mt-2">
        <Title>{slide.title}</Title>
      </div>
      <div className={`flex flex-1 flex-col justify-center gap-4 ${wide ? "max-w-[70vw]" : ""}`}>
        <St kind="pop" d={500}>
          <DriverAvatar name={slide.name} photoUrl={slide.photoUrl} color={slide.color || "#111"} size={wide ? 140 : 96} />
        </St>
        <div ref={nameRef} className="w-full">
          <St kind="wipe" d={800} className="font-display font-black uppercase leading-[0.9] tracking-tight">
            <span data-fit className="inline-block whitespace-nowrap">
              {slide.name}
            </span>
          </St>
        </div>
        <Place d={1400}>{slide.detail}</Place>
        {slide.h2h && (
          <St d={1900} className={`font-semibold leading-snug ${wide ? "max-w-[34rem] text-xl" : "max-w-[22rem] text-[15px]"}`}>
            {slide.h2h}
          </St>
        )}
      </div>
    </Frame>
  );
}

function JourneySlide({ slide, flat }) {
  return (
    <SceneLayout
      slide={slide}
      flat={flat}
      top={
        <>
          <Eyebrow>{slide.eyebrow}</Eyebrow>
          <Title>{slide.title}</Title>
        </>
      }
      bottom={<Place d={7600}>{slide.sub}</Place>}
    />
  );
}

function FinalSlide({ slide, flat }) {
  const { wide } = useLayout();
  const late = slide.scene?.kind === "grid";
  return (
    <SceneLayout
      slide={slide}
      flat={flat}
      top={
        <>
          <Eyebrow>{slide.eyebrow}</Eyebrow>
          <St kind="fade" d={250} className="font-display font-extrabold leading-tight" style={{ fontSize: wide ? "min(3.4vw, 3.4rem)" : "min(7.6cqw,2rem)" }}>
            {slide.lead}
          </St>
        </>
      }
      bottom={
        <>
          <BigLine text={slide.big} medal={slide.medal} d={late ? 4700 : 1700} />
          {slide.title && (
            <St kind="pop" d={late ? 5100 : 2100} className={`font-display font-black uppercase ${wide ? "text-6xl" : "text-3xl"}`} style={{ color: medalColor(slide.medal) || undefined }}>
              {slide.title}
            </St>
          )}
          <Small d={late ? 5300 : 2400}>{slide.sub}</Small>
        </>
      }
    />
  );
}

const HONOUR_ICONS = { champion: Crown, vice: Medal, third: Medal, team: Trophy, newcomer: Rocket, "fastest-lap": Timer, overtakes: Rocket, "laps-led": FlagIcon, cleanest: ShieldCheck, dotd: Sparkles };

function HonoursSlide({ slide, flat }) {
  const { wide } = useLayout();
  return (
    <SceneLayout
      slide={slide}
      flat={flat}
      top={
        <>
          <Eyebrow>{slide.eyebrow}</Eyebrow>
          <Title>{slide.title}</Title>
        </>
      }
      bottom={
        <ul className={wide ? "space-y-4" : "space-y-2"}>
          {slide.items.slice(0, 5).map((h, i) => {
            const Icon = HONOUR_ICONS[h.key] || Trophy;
            const detail = h.ms ? `${fmtLap(h.ms)}${h.detail ? ` at ${prettyTrack(h.detail)}` : ""}` : h.detail;
            return (
              <St as="li" kind="left" key={h.key} d={700 + i * 260} className="flex items-start gap-3">
                <Icon className={`mt-0.5 shrink-0 ${wide ? "h-8 w-8" : "h-5 w-5"}`} style={{ color: slide.colors.accent }} aria-hidden="true" />
                <span className="min-w-0">
                  <span className={`block font-display font-black uppercase leading-tight ${wide ? "text-3xl" : "text-lg"}`}>{h.title}</span>
                  {detail && <span className={`block font-semibold opacity-90 ${wide ? "text-base" : "text-[13px]"}`}>{detail}</span>}
                </span>
              </St>
            );
          })}
          {slide.items.length > 5 && (
            <St as="li" d={700 + 5 * 260} className="font-mono text-xs font-bold uppercase">
              and {slide.items.length - 5} more
            </St>
          )}
        </ul>
      }
    />
  );
}

function TypeSlide({ slide }) {
  const { wide } = useLayout();
  const words = slide.big.split(/\s+/);
  const wordsRef = useRef(null);
  useFit(wordsRef, wide ? 260 : 120, `${slide.big}:${wide}`);
  return (
    <Frame slide={slide} variant={2} marquee={slide.big}>
      <Eyebrow>{slide.eyebrow}</Eyebrow>
      <div className="flex flex-1 flex-col justify-center">
        <div ref={wordsRef} className={wide ? "w-full max-w-[74vw]" : "w-full"}>
          {words.map((w, i) => (
            <St key={i} kind="wipe" d={400 + i * 350} className="font-display font-black uppercase leading-[0.86] tracking-tighter">
              <span data-fit className="inline-block whitespace-nowrap">
                {w}
              </span>
            </St>
          ))}
        </div>
        <St d={400 + words.length * 350 + 400} className={`mt-6 font-bold leading-snug ${wide ? "max-w-[36rem] text-2xl" : "max-w-[22rem] text-[min(5cqw,1.25rem)]"}`}>
          {slide.line}
        </St>
      </div>
    </Frame>
  );
}

function SummarySlide({ slide, data, actions }) {
  const d = data.driver;
  const medal = medalColor(slide.position);
  const { wide } = useLayout();
  const small = "[@media(max-height:640px)]:py-1.5 [@media(max-height:640px)]:text-xs";
  const secondary = `inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-3 py-2.5 text-sm font-bold transition hover:bg-white/20 disabled:opacity-60 ${small}`;
  return (
    <Frame slide={slide} variant={0} marquee={wide ? null : d.name}>
      <div className={wide ? "flex h-full w-full max-w-[30rem] flex-col justify-center" : "contents"}>
        <Eyebrow>{slide.eyebrow}</Eyebrow>
        <St kind="pop" d={200} className="relative mt-3 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm [@media(max-height:640px)]:mt-2 [@media(max-height:640px)]:p-3">
          <div className="pointer-events-none absolute inset-0 opacity-30" style={{ background: `radial-gradient(120% 90% at 100% 0%, ${slide.paint}, transparent 60%)` }} />
          <div className="relative flex items-center gap-3">
            <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={slide.paint} size={52} />
            <div className="min-w-0">
              <div className="truncate font-display font-black uppercase leading-none" style={{ fontSize: wide ? "1.75rem" : "min(7cqw,1.6rem)" }}>
                {d.name}
              </div>
              {d.team?.name && <div className="mt-1 truncate text-xs font-semibold opacity-90">{d.team.name}</div>}
            </div>
            {slide.position != null && (
              <div className="ml-auto text-right">
                <div className="font-display font-black leading-none" style={{ color: medal || undefined, fontSize: wide ? "3.4rem" : "min(13cqw,3.2rem)" }}>
                  P{slide.position}
                </div>
                {slide.fieldSize && <div className="font-mono text-[10px] font-bold uppercase tracking-wider opacity-90">of {slide.fieldSize}</div>}
              </div>
            )}
          </div>
          <div className="relative mt-4 grid grid-cols-3 gap-x-2 gap-y-3 [@media(max-height:640px)]:mt-3 [@media(max-height:640px)]:gap-y-2">
            {slide.stats.map((s, i) => (
              <St key={s.key} kind="rise" d={500 + i * 90}>
                <div className="font-display font-black leading-none tabular-nums" style={{ fontSize: wide ? "2.2rem" : "min(8.5cqw,2.1rem)" }}>
                  {s.prefix}
                  {Number(s.value).toLocaleString("en-US")}
                </div>
                <div className="mt-1 font-mono text-[9.5px] font-bold uppercase tracking-wider opacity-90">{s.label}</div>
              </St>
            ))}
          </div>
          {slide.type && (
            <div className="relative mt-4 inline-flex rounded-full px-3 py-1 font-display text-sm font-black uppercase [@media(max-height:640px)]:mt-2.5" style={{ background: "#C6F432", color: "#0B0F00" }}>
              {slide.type}
            </div>
          )}
        </St>
        <div className={`space-y-2.5 pt-4 [@media(max-height:640px)]:space-y-1 [@media(max-height:640px)]:pt-2 ${wide ? "mt-2" : "mt-auto"}`} data-story-interactive>
          <St d={700} className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={actions.share}
              disabled={actions.busy}
              className="col-span-2 inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-3 font-display text-base font-black uppercase text-[#0B0A12] transition hover:scale-[1.02] hover:bg-white/90 disabled:opacity-60 [@media(max-height:640px)]:py-2.5 [@media(max-height:640px)]:text-sm"
            >
              <Share2 className="h-5 w-5" aria-hidden="true" />
              {actions.busy ? "Making the picture…" : "Share your season"}
            </button>
            <button type="button" onClick={actions.save} disabled={actions.busy} className={secondary}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Save picture
            </button>
            <button type="button" onClick={actions.copy} className={secondary}>
              <LinkIcon className="h-4 w-4" aria-hidden="true" />
              Copy link
            </button>
            <button type="button" onClick={actions.replay} className={secondary}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Watch again
            </button>
            <button type="button" onClick={actions.close} className={secondary}>
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              All the cards
            </button>
          </St>
          <p role="status" className="min-h-[1.25rem] text-center text-xs font-semibold opacity-90">
            {actions.msg}
          </p>
        </div>
      </div>
    </Frame>
  );
}

const SLIDES = {
  intro: IntroSlide,
  numbers: NumbersSlide,
  best: BestSlide,
  climb: ClimbSlide,
  wins: WinsSlide,
  teammate: TeammateSlide,
  rival: RivalSlide,
  journey: JourneySlide,
  final: FinalSlide,
  honours: HonoursSlide,
  type: TypeSlide,
  summary: SummarySlide,
};

export default function StorySlide({ slide, data, flat, actions }) {
  const Slide = SLIDES[slide.kind];
  return Slide ? <Slide slide={slide} data={data} flat={flat} actions={actions} /> : null;
}

// One sentence per slide for screen readers, read once when the slide comes
// up (the slide's own text counts up and would be read half-way).
export function describe(slide) {
  return sentence(describeParts(slide));
}

const sentence = (parts) =>
  parts
    .filter((x) => x != null && String(x).trim())
    .map((x) => String(x).trim().replace(/[.…]?$/, (m) => m || "."))
    .join(" ");

function describeParts(slide) {
  switch (slide.kind) {
    case "intro":
      return [slide.title, slide.sub];
    case "numbers":
      return [`${slide.lead} ${slide.count} ${slide.unit}`, slide.then, slide.pointsLine];
    case "best":
      return [`${slide.eyebrow}: ${slide.big}, ${slide.place}`, slide.sub];
    case "climb":
      return [`${slide.eyebrow}: ${slide.big} ${slide.unit}`, slide.title, slide.place];
    case "wins":
      return [`${slide.big} ${slide.unit}`, slide.list.join(", "), slide.sub];
    case "teammate":
      return [`${slide.eyebrow}, ${slide.me.name} against ${slide.other.name}`, slide.title, ...slide.rows.map((r) => `${r.label}: ${r.a} to ${r.b}`)];
    case "rival":
      return [`${slide.eyebrow}: ${slide.name}, ${slide.detail}`, slide.h2h];
    case "journey":
      return [slide.eyebrow, slide.title, slide.sub];
    case "final":
      return [`${slide.eyebrow}: ${slide.big}`, slide.title, slide.sub];
    case "honours":
      return [slide.title, slide.items.map((h) => h.title).join(", ")];
    case "type":
      return [`${slide.eyebrow}: ${slide.big}`, slide.line];
    case "summary":
      return ["Summary", slide.position != null ? `P${slide.position}` : null, slide.stats.map((x) => `${x.label}: ${x.prefix || ""}${x.value}`).join(", ")];
    default:
      return [];
  }
}
