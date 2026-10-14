import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Pause, Play, Smartphone, X } from "lucide-react";
import { buildStory } from "../utils/wrappedStory.mjs";
import { prettyTrack } from "../utils/pageTitle.js";
import { copyText } from "../utils/copyText.js";
import { motionOff } from "../hooks/motion.js";
import { useFocusTrap, useScrollLock } from "./overlay.jsx";
import WrappedStage from "./WrappedStage.jsx";
import StorySlide, { StoryClock, describe } from "./WrappedStorySlides.jsx";

// ---------------------------------------------------------------------------
// Season Wrapped as a story, the way Spotify tells a year: full screen, one
// slide at a time, a bar per slide along the top filling as it plays, and the
// story moving on by itself.
//
//   tap the right of the frame (or swipe left, or →)  next
//   tap the left third (or swipe right, or ←)         back
//   hold a finger down                                 pause while held
//   the pause button, or Space                         pause / play
//   swipe down, ×, or Escape                           close
//
// The last slide is the season on one card with the buttons to share it
// (a 9:16 picture made in the browser, utils/wrappedShareCard.js); it waits
// for the viewer instead of moving on.
//
// Behind the slides is one WebGL canvas (components/WrappedStage.jsx) showing
// the active slide's 3D scene. The story's clock drives it, the progress bar
// and every counting number, so everything stops and starts together. Lite
// mode gets the flat pictures instead of 3D; reduced motion gets each scene's
// finished frame, words that are simply there, and the same pace.
// ---------------------------------------------------------------------------

// A clock the slides and the stage listen to: seconds into the current slide.
function makeClock() {
  const subs = new Set();
  return {
    t: 0,
    set(t) {
      this.t = t;
      subs.forEach((fn) => fn(t));
    },
    subscribe(fn) {
      subs.add(fn);
      fn(this.t);
      return () => subs.delete(fn);
    },
  };
}

// Lite graphics (Settings -> Performance) means no 3D. Asked of the stored
// choice as well as the class on <html>: the class only goes on once the
// settings code has run, which after a fresh page load it may not have.
const liteMode = () => {
  if (typeof document === "undefined") return false;
  if (document.documentElement.classList.contains("fx-lite")) return true;
  try {
    return localStorage.getItem("nabs_fx") === "lite";
  } catch {
    return false;
  }
};

// A phone turned on its side: the story is made for a phone held upright and
// waits for that (the slides do not fit a frame 390 pixels tall).
const SIDEWAYS = "(orientation: landscape) and (max-height: 500px) and (pointer: coarse)";
function useSideways() {
  const [on, setOn] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(SIDEWAYS).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(SIDEWAYS);
    if (!mq) return undefined;
    const fn = () => setOn(mq.matches);
    fn();
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, []);
  return on;
}

export default function WrappedStory({ data, mine, url, onClose }) {
  const slides = useMemo(() => buildStory(data, { mine, fmtTrack: prettyTrack }), [data, mine]);
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0); // bumps on "watch again", replaying every entrance
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const [hidden, setHidden] = useState(typeof document !== "undefined" && document.hidden);
  const [flat, setFlat] = useState(liteMode);
  const [share, setShare] = useState({ busy: false, msg: "" });
  const sideways = useSideways();
  const clock = useMemo(makeClock, []);
  const elapsed = useRef(0);
  const barRef = useRef(null);
  const panelRef = useRef(null);
  const frameRef = useRef(null);
  const stageRef = useRef(null);
  const press = useRef(null);
  const still = useMemo(() => motionOff(), []);
  const slide = slides[index];
  const last = slides.length - 1;

  useScrollLock(true);
  useFocusTrap(true, panelRef, { initialFocus: panelRef });

  const go = useCallback(
    (to) => {
      const next = Math.max(0, Math.min(last, to));
      elapsed.current = 0;
      clock.set(0);
      barRef.current?.style.setProperty("--p", "0");
      setIndex(next);
      // Moving on plays again: a paused story would otherwise hold the next
      // slide's words before their entrance, which is to say invisible.
      setPaused(false);
    },
    [clock, last]
  );
  const next = useCallback(() => {
    if (index < last) go(index + 1);
  }, [go, index, last]);
  const prev = useCallback(() => {
    if (index > 0) go(index - 1);
    else {
      // The first slide: start it again.
      go(0);
      setRound((r) => r + 1);
    }
  }, [go, index]);

  // The story stops when the page is not being looked at.
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // The clock: one animation frame at a time while playing.
  const running = !paused && !holding && !hidden && !sideways && !!slide;
  useEffect(() => {
    if (!running) return undefined;
    let raf = 0;
    let before = performance.now();
    const dur = slide.duration;
    const tick = (now) => {
      elapsed.current += Math.min(100, now - before);
      before = now;
      if (dur && elapsed.current >= dur) {
        if (index < last) {
          go(index + 1);
          return;
        }
        elapsed.current = dur;
      }
      clock.set(elapsed.current / 1000);
      barRef.current?.style.setProperty("--p", dur ? String(Math.min(1, elapsed.current / dur)) : "1");
      // A slide that waits (the summary) has nothing left to move after a while.
      if (!dur && elapsed.current > 6000) return;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, index, round, slide, clock, go, last]);

  // Keys: arrows to move, Space to pause, Escape to close. On the document,
  // not the dialog: a button that had focus can go with its slide (Watch
  // again, say), and the keys must keep working all the same.
  const keys = useRef(null);
  keys.current = (e) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === " " && !e.target.closest?.("button, a")) setPaused((p) => !p);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  useEffect(() => {
    const onKey = (e) => keys.current?.(e);
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  // Focus that went with a slide comes back to the story.
  useEffect(() => {
    const panel = panelRef.current;
    const active = document.activeElement;
    if (panel && (!active || active === document.body || !active.isConnected)) panel.focus({ preventScroll: true });
  }, [index, round]);

  // Taps, holds and swipes on the frame.
  const holdTimer = useRef(0);
  const onPointerDown = (e) => {
    if (e.button > 0 || e.target.closest?.("button, a, [data-story-interactive]")) return;
    press.current = { x: e.clientX, y: e.clientY, held: false };
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      if (press.current) {
        press.current.held = true;
        setHolding(true);
      }
    }, 220);
  };
  // A finger on the move is a swipe, not a hold.
  const onPointerMove = (e) => {
    const p = press.current;
    if (p && !p.held && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) clearTimeout(holdTimer.current);
  };
  const onPointerUp = (e) => {
    clearTimeout(holdTimer.current);
    const p = press.current;
    press.current = null;
    if (!p) return undefined;
    if (p.held) setHolding(false);
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    // Swipes count however long they took.
    if (dy > 90 && Math.abs(dx) < 80) return onClose();
    if (Math.abs(dx) > 60 && Math.abs(dy) < 80) return dx < 0 ? next() : prev();
    // A hold let go of just plays on; a tap moves.
    if (p.held || Math.hypot(dx, dy) > 20) return undefined;
    const r = frameRef.current.getBoundingClientRect();
    return e.clientX - r.left < r.width * 0.3 ? prev() : next();
  };
  const onPointerCancel = () => {
    clearTimeout(holdTimer.current);
    press.current = null;
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(holdTimer.current), []);

  // The scene for the stage, with the slide's colours for its fog and grid.
  const spec = useMemo(
    () => (slide?.scene ? { ...slide.scene, bg: slide.colors.bg, accent: slide.colors.accent, round } : null),
    [slide, round]
  );

  // The summary card's buttons.
  const summary = slides[last];
  const fileName = `${data.driver.name}-${data.season.label}-wrapped.jpg`.replace(/[^\w.-]+/g, "-");
  const makePicture = useCallback(async () => {
    const { drawShareCard } = await import("../utils/wrappedShareCard.js");
    const intro = slides[0]?.scene;
    let car = null;
    try {
      car = intro && stageRef.current ? stageRef.current.still({ ...intro, bg: "#0B0A12" }, 3.4, 1080, 820) : null;
    } catch {
      car = null;
    }
    const address = url ? url.replace(/^https?:\/\//, "") : "";
    return drawShareCard({ card: summary, data, car, address });
  }, [slides, summary, data, url]);
  const download = (blob) => {
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 4000);
  };
  const actions = {
    busy: share.busy,
    msg: share.msg,
    async share() {
      setShare({ busy: true, msg: "" });
      try {
        const blob = await makePicture();
        const file = new File([blob], fileName, { type: "image/jpeg" });
        const title = `${data.driver.name}'s ${data.season.label} Wrapped`;
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title, text: url ? `${title} ${url}` : title });
            setShare({ busy: false, msg: "" });
          } catch (e) {
            setShare({ busy: false, msg: e?.name === "AbortError" ? "" : "Sharing didn't work here; the picture is saved instead." });
            if (e?.name !== "AbortError") download(blob);
          }
          return;
        }
        download(blob);
        setShare({ busy: false, msg: "Picture saved. Post it wherever you like." });
      } catch {
        setShare({ busy: false, msg: "The picture couldn't be made on this device." });
      }
    },
    async save() {
      setShare({ busy: true, msg: "" });
      try {
        download(await makePicture());
        setShare({ busy: false, msg: "Picture saved." });
      } catch {
        setShare({ busy: false, msg: "The picture couldn't be made on this device." });
      }
    },
    async copy() {
      const ok = await copyText(url);
      setShare((s) => ({ ...s, msg: ok ? "Link copied." : url }));
    },
    replay() {
      setShare({ busy: false, msg: "" });
      setRound((r) => r + 1);
      go(0);
      setPaused(false);
    },
    close: onClose,
  };

  if (!slide) return null;
  const ink = slide.colors.ink;
  const label = `${data.driver.name}'s ${data.season.label} Wrapped`;

  // On <body>, out of the page's own stacking (its entrance animation makes a
  // layer the site's bars would otherwise sit on top of).
  return createPortal(
    <div className="fixed inset-0 z-overlay flex items-center justify-center bg-black/90 sm:backdrop-blur-sm" role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${label}, a story in ${slides.length} slides`}
        tabIndex={-1}
        className="flex items-center gap-5 outline-none"
      >
        <button
          type="button"
          onClick={prev}
          aria-label="Previous slide"
          className="hidden h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:inline-flex"
        >
          <ChevronLeft className="h-6 w-6" aria-hidden="true" />
        </button>

        <div
          ref={frameRef}
          className={`story-frame ${running ? "" : "is-paused"}`}
          style={{ backgroundColor: slide.colors.bg }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={(e) => press.current && onPointerUp(e)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {!flat && (
            <WrappedStage spec={spec} clock={clock} still={still} stageRef={stageRef} onUnavailable={() => setFlat(true)} />
          )}

          <StoryClock.Provider value={clock}>
            <div key={`${index}:${round}`} className="story-slide-in absolute inset-0">
              <StorySlide slide={slide} data={data} flat={flat} actions={actions} />
            </div>
          </StoryClock.Provider>

          {/* The bars, one per slide, and the two buttons. */}
          <div className="absolute inset-x-0 top-0 z-10 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]" style={{ color: ink }}>
            <div className="flex gap-1" aria-hidden="true">
              {slides.map((s, i) => (
                <div key={s.key} className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: `${ink}40` }}>
                  {i < index && <div className="h-full w-full rounded-full" style={{ background: ink }} />}
                  {i === index && <div ref={barRef} className="story-bar h-full w-full rounded-full" style={{ background: ink }} />}
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.2em] opacity-90">
                {index + 1} / {slides.length}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPaused((p) => !p)}
                  aria-label={paused ? "Play" : "Pause"}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-black/10"
                >
                  {paused ? <Play className="h-5 w-5" aria-hidden="true" /> : <Pause className="h-5 w-5" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close the story"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-black/10"
                >
                  <X className="h-6 w-6" aria-hidden="true" />
                </button>
              </span>
            </div>
          </div>

          {sideways && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#0B0A12] px-8 text-center text-white" data-story-interactive>
              <Smartphone className="h-10 w-10" aria-hidden="true" />
              <div className="font-display text-2xl font-black uppercase">Turn your phone upright</div>
              <p className="max-w-sm text-sm opacity-90">Season Wrapped is made for a phone held the tall way. It waits for you.</p>
              <button type="button" onClick={onClose} className="mt-1 rounded-full bg-white/10 px-4 py-2 text-sm font-bold transition hover:bg-white/20">
                Show the cards instead
              </button>
            </div>
          )}

          <p className="sr-only" aria-live="polite">
            {`Slide ${index + 1} of ${slides.length}. ${describe(slide)}`}
          </p>
        </div>

        <button
          type="button"
          onClick={next}
          disabled={index === last}
          aria-label="Next slide"
          className="hidden h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30 sm:inline-flex"
        >
          <ChevronRight className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body
  );
}
