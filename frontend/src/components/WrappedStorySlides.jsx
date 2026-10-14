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
// Each slide is laid out for a tall frame: its words at the top and the
// bottom, and where it has a 3D scene (components/WrappedStage.jsx) the scene
// in the band between, under soft fades in the slide's colour so the words
// stay readable over it. Without 3D (no WebGL, Lite mode) the same band shows
// a flat picture of the same idea.
//
// Numbers count up on the story's clock, so a paused story holds them too.
// ---------------------------------------------------------------------------

// The story's clock: seconds into the current slide, ticking with the story.
export const StoryClock = createContext(null);

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

const Eyebrow = ({ children, d = 0 }) => (
  <St kind="fade" d={d} className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] opacity-90">
    {children}
  </St>
);

const Title = ({ children, d = 150, size = 9.5, max = 2.6 }) => (
  <St
    as="h2"
    d={d}
    className="font-display font-black uppercase leading-[0.95] tracking-tight [text-wrap:balance]"
    style={{ fontSize: `min(${size}cqw, ${max}rem)` }}
  >
    {children}
  </St>
);

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

// The big soft shapes drifting behind a slide's words.
function Shapes({ colors, variant = 0 }) {
  const ink = colors.ink;
  const accent = colors.accent;
  const sets = [
    [
      { cls: "rounded-full", style: { width: "70cqw", height: "70cqw", right: "-28cqw", top: "-14cqw", background: accent, opacity: 0.16, "--dx": "-18px", "--dy": "26px" } },
      { cls: "rounded-full", style: { width: "48cqw", height: "48cqw", left: "-20cqw", bottom: "8%", border: `10cqw solid ${ink}`, opacity: 0.07, "--rot": "-12deg" } },
    ],
    [
      { cls: "", style: { width: "150cqw", height: "22cqw", left: "-25cqw", top: "34%", background: ink, opacity: 0.06, transform: "rotate(-12deg)", "--rot": "-4deg", "--dy": "18px" } },
      { cls: "rounded-full", style: { width: "36cqw", height: "36cqw", right: "-8cqw", bottom: "16%", background: accent, opacity: 0.18, "--dx": "-30px" } },
    ],
    [
      { cls: "rounded-[30%]", style: { width: "58cqw", height: "58cqw", left: "-16cqw", top: "10%", border: `6cqw solid ${accent}`, opacity: 0.2, "--rot": "40deg" } },
      { cls: "rounded-full", style: { width: "84cqw", height: "84cqw", right: "-40cqw", bottom: "-20cqw", background: ink, opacity: 0.06, "--dx": "-20px", "--dy": "-20px" } },
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

// Fades in the slide's colour at the top and bottom, over a 3D scene.
function Scrims({ bg }) {
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
    <svg viewBox={c.box} className="h-full max-h-[38cqh] w-[70cqw]" aria-hidden="true" fill="none">
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
    <svg viewBox={`0 0 ${W} ${H}`} className="w-[78cqw]" aria-hidden="true" fill="none">
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
  let art = null;
  if (scene.kind === "intro") {
    art = (
      <div className="flex h-[52cqw] w-[52cqw] items-center justify-center rounded-full font-display font-black" style={{ border: `3cqw solid ${paint}`, fontSize: "22cqw" }}>
        {scene.number ?? "★"}
      </div>
    );
  } else if (scene.kind === "circuit") art = <CircuitArt track={scene.track} paint={paint} ink={ink} />;
  else if (scene.kind === "climb") art = <ArrowUp className="h-[40cqw] w-[40cqw]" style={{ color: paint }} strokeWidth={2.4} aria-hidden="true" />;
  else if (scene.kind === "trophies") {
    const tone = { gold: MEDAL_ON_DARK[0], silver: MEDAL_ON_DARK[1], bronze: MEDAL_ON_DARK[2] };
    art = (
      <div className="flex flex-wrap justify-center gap-3">
        {scene.tones.map((t, i) => (
          <St key={i} kind="pop" d={300 + i * 200}>
            <Trophy className="h-[17cqw] w-[17cqw]" style={{ color: tone[t] || paint }} aria-hidden="true" />
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
            className="flex w-[20cqw] items-start justify-center rounded-t-lg pt-2 font-display text-[7cqw] font-black"
            style={{ height: `${p === 1 ? 34 : p === 2 ? 25 : 18}cqw`, background: scene.kind === "podium" && p === scene.position ? paint : `${ink}22` }}
          >
            {p}
          </div>
        ))}
      </div>
    );
  }
  return <div className="flex h-full items-center justify-center">{art}</div>;
}

// --- the slides --------------------------------------------------------------------

// The frame every slide sits in: its colours, the shapes behind, the fades
// over the 3D, and the words in front.
function Frame({ slide, flat, variant = 0, children }) {
  const { colors } = slide;
  return (
    <div className="absolute inset-0" style={{ color: colors.ink }}>
      {!slide.scene && <Shapes colors={colors} variant={variant} />}
      {slide.scene && !flat && <Scrims bg={colors.bg} />}
      <div className="relative flex h-full flex-col px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-[5.75rem] sm:px-7 [@media(max-height:640px)]:pb-4 [@media(max-height:640px)]:pt-[5rem]">
        {children}
      </div>
    </div>
  );
}

// Top words, the scene's band, bottom words.
function SceneLayout({ slide, flat, top, bottom }) {
  return (
    <Frame slide={slide} flat={flat}>
      <div className="space-y-2.5">{top}</div>
      <div className="min-h-0 flex-1">{flat && <FlatArt scene={slide.scene} colors={slide.colors} />}</div>
      <div className="space-y-2">{bottom}</div>
    </Frame>
  );
}

function IntroSlide({ slide, data, flat }) {
  const d = data.driver;
  return (
    <SceneLayout
      slide={slide}
      flat={flat}
      top={
        <>
          <St kind="fade" className="flex items-center gap-2 font-display text-lg font-black tracking-tight">
            <span className="h-2 w-2 rounded-full" style={{ background: slide.colors.accent }} />
            NABS RACING
          </St>
          <Eyebrow d={150}>{slide.eyebrow}</Eyebrow>
        </>
      }
      bottom={
        <>
          <Title d={250} size={11} max={3.1}>
            {slide.title}
          </Title>
          <St d={700} className="text-[15px] font-semibold leading-snug opacity-90">
            {slide.sub}
          </St>
          <St d={1000} className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px] font-bold uppercase tracking-wider">
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
  return (
    <Frame slide={slide} variant={0}>
      <Eyebrow>{slide.eyebrow}</Eyebrow>
      <div className="flex flex-1 flex-col justify-center">
        <St d={150} className="font-display text-[min(7.6cqw,2rem)] font-extrabold leading-tight">
          {slide.lead}
        </St>
        <St kind="pop" d={450} className="font-display font-black leading-[0.85] tracking-tighter" style={{ fontSize: "min(42cqw, 11rem)" }}>
          <Count value={slide.count} delay={500} dur={1300} />
        </St>
        <St d={700} className="font-display text-[min(7.6cqw,2rem)] font-extrabold leading-tight">
          {slide.unit}
        </St>
        <St d={1900} className="mt-6 max-w-[22rem] text-[min(5cqw,1.25rem)] font-semibold leading-snug">
          {slide.then}
        </St>
        <St d={3000} className="mt-6 flex items-baseline gap-3">
          <span className="font-display font-black leading-none tracking-tight" style={{ fontSize: "min(17cqw, 4.5rem)" }}>
            <Count value={slide.points} delay={3100} dur={1200} />
          </span>
          <span className="font-display text-[min(6cqw,1.6rem)] font-extrabold">{slide.pointsLine.replace(/^\S+\s/, "")}</span>
        </St>
      </div>
    </Frame>
  );
}

function BigLine({ slide, text, medal, d = 500 }) {
  return (
    <St kind="pop" d={d} className="font-display font-black leading-[0.85] tracking-tighter" style={{ fontSize: fitSize(text, 8.5, 0.9), color: medalColor(medal) || undefined }}>
      {text}
    </St>
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
          <BigLine slide={slide} text={slide.big} medal={slide.medal} />
          <St d={800} className="font-display text-xl font-extrabold uppercase tracking-tight">
            {slide.place}
          </St>
          {slide.sub && (
            <St d={1000} className="font-mono text-xs font-bold uppercase tracking-wider opacity-90">
              {slide.sub}
            </St>
          )}
        </>
      }
    />
  );
}

function ClimbSlide({ slide, flat }) {
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
          <div className="flex items-end gap-3">
            <St kind="pop" d={5600} className="font-display font-black leading-[0.85] tracking-tighter" style={{ fontSize: "min(30cqw, 8rem)", color: slide.colors.accent }}>
              {slide.big}
            </St>
            <St d={5900} className="pb-2 font-display text-2xl font-black uppercase">
              {slide.unit}
            </St>
          </div>
          <St d={6100} className="font-display text-lg font-extrabold uppercase tracking-tight">
            {slide.place}
          </St>
        </>
      }
    />
  );
}

function WinsSlide({ slide, flat }) {
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
          <div className="flex items-end gap-3">
            <St kind="pop" d={400} className="font-display font-black leading-[0.85] tracking-tighter" style={{ fontSize: "min(32cqw, 8.5rem)" }}>
              {slide.big}
            </St>
            <St d={600} className="pb-2 font-display text-2xl font-black uppercase">
              {slide.unit}
            </St>
          </div>
          {slide.list.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {slide.list.slice(0, 6).map((w, i) => (
                <St key={i} d={900 + i * 160} className="rounded-lg px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wide" style={{ background: `${slide.colors.ink}14` }}>
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
          {slide.sub && (
            <St d={1500} className="font-mono text-xs font-bold uppercase tracking-wider">
              {slide.sub}
            </St>
          )}
        </>
      }
    />
  );
}

function TeammateSlide({ slide }) {
  const { colors } = slide;
  return (
    <Frame slide={slide} variant={1}>
      <Eyebrow>{slide.eyebrow}</Eyebrow>
      <div className="mt-2">
        <Title>{slide.title}</Title>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-7 [@media(max-height:640px)]:gap-3">
        <div className="flex items-center justify-between gap-3 [@media(max-height:640px)]:-my-2 [@media(max-height:640px)]:scale-[0.8]">
          <St kind="left" d={400} className="flex min-w-0 flex-col items-center gap-2 text-center">
            <DriverAvatar name={slide.me.name} photoUrl={slide.me.photoUrl} color={slide.paint} size={76} />
            <span className="max-w-[34cqw] truncate font-display text-lg font-black uppercase">{slide.me.name}</span>
          </St>
          <St kind="pop" d={700} className="font-display text-2xl font-black opacity-80">
            VS
          </St>
          <St kind="right" d={400} className="flex min-w-0 flex-col items-center gap-2 text-center">
            <DriverAvatar name={slide.other.name} photoUrl={slide.other.photoUrl} color="#6b7280" size={76} />
            <span className="max-w-[34cqw] truncate font-display text-lg font-black uppercase">{slide.other.name}</span>
          </St>
        </div>
        <div className="space-y-5 [@media(max-height:640px)]:space-y-2.5">
          {slide.rows.map((r, i) => {
            const total = r.a + r.b;
            const share = total ? r.a / total : 0.5;
            return (
              <St key={r.label} d={1100 + i * 450}>
                <div className="flex items-baseline justify-between font-display font-black">
                  <span className="text-4xl tabular-nums">
                    <Count value={r.a} delay={1200 + i * 450} dur={900} />
                  </span>
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] opacity-90">{r.label}</span>
                  <span className="text-4xl tabular-nums">
                    <Count value={r.b} delay={1200 + i * 450} dur={900} />
                  </span>
                </div>
                <div className="mt-2 flex h-3 gap-[3px] overflow-hidden rounded-full" style={{ background: `${colors.ink}26` }}>
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
  const nameRef = useRef(null);
  useFit(nameRef, 96, slide.name);
  return (
    <Frame slide={slide} variant={2}>
      <Eyebrow>{slide.eyebrow}</Eyebrow>
      <div className="mt-2">
        <Title>{slide.title}</Title>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-4">
        <St kind="pop" d={500}>
          <DriverAvatar name={slide.name} photoUrl={slide.photoUrl} color={slide.color || "#111"} size={96} />
        </St>
        <div ref={nameRef} className="w-full">
          <St kind="wipe" d={800} className="font-display font-black uppercase leading-[0.9] tracking-tight">
            <span data-fit className="inline-block whitespace-nowrap">
              {slide.name}
            </span>
          </St>
        </div>
        <St d={1400} className="font-display text-xl font-extrabold uppercase">
          {slide.detail}
        </St>
        {slide.h2h && (
          <St d={1900} className="max-w-[22rem] text-[15px] font-semibold leading-snug">
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
      bottom={
        <St d={7600} className="font-display text-xl font-extrabold uppercase leading-tight tracking-tight">
          {slide.sub}
        </St>
      }
    />
  );
}

function FinalSlide({ slide, flat }) {
  return (
    <SceneLayout
      slide={slide}
      flat={flat}
      top={
        <>
          <Eyebrow>{slide.eyebrow}</Eyebrow>
          <St kind="fade" d={250} className="font-display text-[min(7.6cqw,2rem)] font-extrabold leading-tight">
            {slide.lead}
          </St>
        </>
      }
      bottom={
        <>
          <BigLine slide={slide} text={slide.big} medal={slide.medal} d={slide.scene?.kind === "grid" ? 4700 : 1700} />
          {slide.title && (
            <St d={slide.scene?.kind === "grid" ? 5100 : 2100} className="font-display text-3xl font-black uppercase" style={{ color: medalColor(slide.medal) || undefined }}>
              {slide.title}
            </St>
          )}
          <St d={slide.scene?.kind === "grid" ? 5300 : 2400} className="font-mono text-xs font-bold uppercase tracking-wider opacity-90">
            {slide.sub}
          </St>
        </>
      }
    />
  );
}

const HONOUR_ICONS = { champion: Crown, vice: Medal, third: Medal, team: Trophy, newcomer: Rocket, "fastest-lap": Timer, overtakes: Rocket, "laps-led": FlagIcon, cleanest: ShieldCheck, dotd: Sparkles };

function HonoursSlide({ slide, flat }) {
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
        <ul className="space-y-2">
          {slide.items.slice(0, 5).map((h, i) => {
            const Icon = HONOUR_ICONS[h.key] || Trophy;
            const detail = h.ms ? `${fmtLap(h.ms)}${h.detail ? ` at ${prettyTrack(h.detail)}` : ""}` : h.detail;
            return (
              <St as="li" key={h.key} d={700 + i * 260} className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: slide.colors.accent }} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-display text-lg font-black uppercase leading-tight">{h.title}</span>
                  {detail && <span className="block text-[13px] font-semibold opacity-90">{detail}</span>}
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
  const words = slide.big.split(/\s+/);
  const wordsRef = useRef(null);
  useFit(wordsRef, 120, slide.big);
  return (
    <Frame slide={slide} variant={2}>
      <Eyebrow>{slide.eyebrow}</Eyebrow>
      <div className="flex flex-1 flex-col justify-center">
        <div ref={wordsRef} className="w-full">
          {words.map((w, i) => (
            <St key={i} kind="wipe" d={400 + i * 350} className="font-display font-black uppercase leading-[0.86] tracking-tighter">
              <span data-fit className="inline-block whitespace-nowrap">
                {w}
              </span>
            </St>
          ))}
        </div>
        <St d={400 + words.length * 350 + 400} className="mt-6 max-w-[22rem] text-[min(5cqw,1.25rem)] font-bold leading-snug">
          {slide.line}
        </St>
      </div>
    </Frame>
  );
}

function SummarySlide({ slide, data, actions }) {
  const d = data.driver;
  const medal = medalColor(slide.position);
  return (
    <Frame slide={slide} variant={0}>
      <Eyebrow>{slide.eyebrow}</Eyebrow>
      <St kind="pop" d={200} className="relative mt-3 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-4 [@media(max-height:640px)]:mt-2 [@media(max-height:640px)]:p-3">
        <div className="pointer-events-none absolute inset-0 opacity-30" style={{ background: `radial-gradient(120% 90% at 100% 0%, ${slide.paint}, transparent 60%)` }} />
        <div className="relative flex items-center gap-3">
          <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={slide.paint} size={52} />
          <div className="min-w-0">
            <div className="truncate font-display text-[min(7cqw,1.6rem)] font-black uppercase leading-none">{d.name}</div>
            {d.team?.name && <div className="mt-1 truncate text-xs font-semibold opacity-90">{d.team.name}</div>}
          </div>
          {slide.position != null && (
            <div className="ml-auto text-right">
              <div className="font-display text-[min(13cqw,3.2rem)] font-black leading-none" style={{ color: medal || undefined }}>
                P{slide.position}
              </div>
              {slide.fieldSize && <div className="font-mono text-[10px] font-bold uppercase tracking-wider opacity-90">of {slide.fieldSize}</div>}
            </div>
          )}
        </div>
        <div className="relative mt-4 grid grid-cols-3 gap-x-2 gap-y-3 [@media(max-height:640px)]:mt-3 [@media(max-height:640px)]:gap-y-2">
          {slide.stats.map((s) => (
            <div key={s.key}>
              <div className="font-display text-[min(8.5cqw,2.1rem)] font-black leading-none tabular-nums">
                {s.prefix}
                {Number(s.value).toLocaleString("en-US")}
              </div>
              <div className="mt-1 font-mono text-[9.5px] font-bold uppercase tracking-wider opacity-90">{s.label}</div>
            </div>
          ))}
        </div>
        {slide.type && (
          <div className="relative mt-4 inline-flex rounded-full px-3 py-1 font-display text-sm font-black uppercase [@media(max-height:640px)]:mt-2.5" style={{ background: "#C6F432", color: "#0B0F00" }}>
            {slide.type}
          </div>
        )}
      </St>
      <div className="mt-auto space-y-2.5 pt-4 [@media(max-height:640px)]:space-y-1 [@media(max-height:640px)]:pt-2" data-story-interactive>
        <St d={500} className="grid grid-cols-2 gap-2">
          <button type="button" onClick={actions.share} disabled={actions.busy} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-3 font-display text-base font-black uppercase text-[#0B0A12] transition hover:bg-white/90 disabled:opacity-60 [@media(max-height:640px)]:py-2.5 [@media(max-height:640px)]:text-sm">
            <Share2 className="h-5 w-5" aria-hidden="true" />
            {actions.busy ? "Making the picture…" : "Share your season"}
          </button>
          <button type="button" onClick={actions.save} disabled={actions.busy} className="inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-3 py-2.5 text-sm font-bold transition hover:bg-white/20 [@media(max-height:640px)]:py-1.5 [@media(max-height:640px)]:text-xs disabled:opacity-60">
            <Download className="h-4 w-4" aria-hidden="true" />
            Save picture
          </button>
          <button type="button" onClick={actions.copy} className="inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-3 py-2.5 text-sm font-bold transition hover:bg-white/20 [@media(max-height:640px)]:py-1.5 [@media(max-height:640px)]:text-xs">
            <LinkIcon className="h-4 w-4" aria-hidden="true" />
            Copy link
          </button>
          <button type="button" onClick={actions.replay} className="inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-3 py-2.5 text-sm font-bold transition hover:bg-white/20 [@media(max-height:640px)]:py-1.5 [@media(max-height:640px)]:text-xs">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Watch again
          </button>
          <button type="button" onClick={actions.close} className="inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-3 py-2.5 text-sm font-bold transition hover:bg-white/20 [@media(max-height:640px)]:py-1.5 [@media(max-height:640px)]:text-xs">
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            All the cards
          </button>
        </St>
        <p role="status" className="min-h-[1.25rem] text-center text-xs font-semibold opacity-90">
          {actions.msg}
        </p>
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
