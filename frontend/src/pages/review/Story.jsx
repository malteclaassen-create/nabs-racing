// The season review as a story: full screen on a phone, a tall frame on a
// tablet, a wide frame on a laptop or desktop (words on the left, the
// picture on the right), one moment per slide, the way a Wrapped runs. Tap
// the right side (or the right arrow, or space) for the next slide, the left side for
// the one before; hold to stop the clock; Escape or the cross closes it and
// goes back to where it was opened from. Each slide runs for a few seconds and the
// last one stays until it is closed.
//
// It is drawn in the site's own look on purpose (review/story.css): every
// earlier "Wrapped" was turned down for its neon slides, 3D and confetti.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Pause, Play, ChevronLeft, ChevronRight } from "lucide-react";
import { useScrollLock, useFocusTrap } from "../../components/overlay.jsx";
import { motionOff } from "../../hooks/motion.js";
import StorySlide, { hasTease, TEASE_MS, Wide, useWideStory } from "./StorySlide.jsx";
import { slideColours, storyColour } from "./wrapPalette.js";
import "./story.css";

// How long a slide stays before the next one, in ms. Longer where there is
// more to read.
const DURATION = { quiz: 15000, intro: 5200, rounds: 7500, training: 8500, field: 8500, journey: 8000, team: 8000, honours: 7500, podiums: 7000, tyres: 7500, limits: 7500, passes: 7500, led: 7500, hits: 7500, tier: 8000, streak: 7000 };
const durationOf = (slide) => (DURATION[slide.key] || 6500) + (hasTease(slide.key) && !motionOff() ? TEASE_MS : 0);
const HOLD_MS = 200;

// How one slide hands over to the next. They take turns, so no two moves in
// a row look the same; going back always slides the earlier slide back in
// from the left. Each is a pair of classes in review/story.css: one for the
// slide coming in, one for the slide going out underneath it.
const TRANSITIONS = ["wipe", "circle", "push", "slash", "rise", "zoom"];
const TRANSITION_MS = 720;
const transitionInto = (n, back) => (back ? "back" : TRANSITIONS[(n - 1 + TRANSITIONS.length) % TRANSITIONS.length]);

export default function Story({ review, slides, onClose, onProgress }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  // The slide being left, kept on screen under the new one while the move
  // runs: { i, tr }.
  const [from, setFrom] = useState(null);
  const fromTimer = useRef(0);
  const origin = useRef({ x: "50%", y: "50%" });
  useEffect(() => () => clearTimeout(fromTimer.current), []);
  const frameRef = useRef(null);
  const barRef = useRef(null);
  const barsRef = useRef(null);
  const progress = useRef(0);
  const hold = useRef({ timer: 0, held: false, x: 0, t: 0 });
  const last = slides.length - 1;
  const slide = slides[i];
  const wide = useWideStory();
  useScrollLock(true);
  useFocusTrap(true, frameRef);
  // Every picture the story will show is fetched as it opens, so a photo
  // is already there when its slide comes in rather than loading late.
  useEffect(() => {
    const urls = new Set([review.driver?.photoUrl, review.best?.heroImageUrl, ...slides.map((sl) => sl.photo?.url)].filter(Boolean));
    const held = [...urls].map((u) => {
      const img = new Image();
      img.decoding = "async";
      img.src = u;
      return img;
    });
    return () => held.splice(0);
  }, [review, slides]);
  // The slide on show, for whoever keeps count (SeasonReview: how far a
  // member got through their own Wrapped).
  useEffect(() => {
    onProgress?.(i, slides.length);
  }, [i, slides.length, onProgress]);

  const go = useCallback(
    (to) => {
      const n = Math.max(0, Math.min(last, to));
      progress.current = 0;
      if (n !== i && !motionOff()) {
        setFrom({ i, tr: transitionInto(n, n < i) });
        clearTimeout(fromTimer.current);
        fromTimer.current = setTimeout(() => setFrom(null), TRANSITION_MS + 60);
      }
      setI(n);
    },
    [last, i]
  );
  const next = useCallback(() => (i < last ? go(i + 1) : null), [i, last, go]);
  const prev = useCallback(() => go(i - 1), [i, go]);

  // Every bar but the running one is set outright on each change of slide:
  // the ones behind full, the ones ahead empty, however the story got here
  // (an answer that moves on by itself, a jump back, a double tap).
  useLayoutEffect(() => {
    const bars = barsRef.current?.children || [];
    for (let k = 0; k < bars.length; k += 1) {
      const el = bars[k].firstElementChild;
      if (el && k !== i) el.style.setProperty("--p", k < i ? "1" : "0");
      if (el && k === i) el.style.setProperty("--p", "0");
    }
  }, [i, slides.length]);

  // The clock of the slide on show: fills its bar, then moves on. The bar is
  // set straight on the element, so the slide itself does not redraw sixty
  // times a second.
  useEffect(() => {
    const bar = barRef.current;
    if (i === last) {
      if (bar) bar.style.setProperty("--p", "1");
      return undefined;
    }
    if (paused) return undefined;
    const dur = durationOf(slide) * (motionOff() ? 1.3 : 1);
    const t0 = performance.now() - progress.current * dur;
    let raf = 0;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      progress.current = p;
      if (bar) bar.style.setProperty("--p", String(p));
      if (p >= 1) {
        next();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [i, paused, last, slide, next]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight" || (e.key === " " && !e.target.closest?.("button,a"))) {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  // Taps and holds on the frame. Buttons and links inside a slide keep their
  // own clicks.
  const down = (e) => {
    if (e.target.closest("button,a,[data-st-keep]")) return;
    const h = hold.current;
    h.x = e.clientX;
    h.t = performance.now();
    h.held = false;
    clearTimeout(h.timer);
    h.timer = setTimeout(() => {
      h.held = true;
      setPaused(true);
    }, HOLD_MS);
  };
  const up = (e) => {
    if (e.target.closest("button,a,[data-st-keep]")) return;
    const h = hold.current;
    clearTimeout(h.timer);
    if (h.held) {
      h.held = false;
      setPaused(false);
      return;
    }
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    // The circle opens where the frame was tapped.
    origin.current = { x: `${Math.round(e.clientX - box.left)}px`, y: `${Math.round(e.clientY - box.top)}px` };
    if (e.clientX - box.left < box.width / 3) prev();
    else next();
  };
  const cancel = () => {
    const h = hold.current;
    clearTimeout(h.timer);
    if (h.held) {
      h.held = false;
      setPaused(false);
    }
  };

  const colours = slideColours(slide.key, storyColour(review));
  // Every slide carries its own colours, so the one going out keeps its look
  // while the next one comes in over it.
  const layerStyle = (s) => slideColours(s.key, storyColour(review));
  // Portalled to <body>, like the site's Modal: a fixed overlay inside a
  // transformed ancestor (the page's own entrance) would land in the wrong
  // place, under the menu.
  return createPortal(
    <div
      className="st-overlay z-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${review.season.label} in review, ${review.driver.name}`}
    >
      <button type="button" className="st-side st-side-prev" onClick={prev} disabled={i === 0} aria-label="Previous slide">
        <ChevronLeft size={20} strokeWidth={2.25} />
      </button>
      <div
        ref={frameRef}
        className={`st-frame ${wide ? "st-frame-wide" : ""} ${paused ? "st-paused" : ""}`}
        style={colours}
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="absolute inset-x-0 top-0 z-10 px-3.5 pt-3">
          <div ref={barsRef} className="st-bars" aria-hidden="true">
            {slides.map((s, k) => (
              <span key={s.key} className="st-bar">
                <i ref={k === i ? barRef : undefined} />
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="lv-label truncate lv-mute">
              NABS Racing League · {review.season.label}
            </span>
            <span className="flex items-center gap-1">
              {i < last && (
                <button
                  type="button"
                  onClick={() => setPaused((p) => !p)}
                  className="flex h-9 w-9 items-center justify-center rounded-full opacity-75 transition hover:opacity-100"
                  aria-label={paused ? "Play" : "Pause"}
                >
                  {paused ? <Play size={17} strokeWidth={2.25} /> : <Pause size={17} strokeWidth={2.25} />}
                </button>
              )}
              <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full opacity-75 transition hover:opacity-100" aria-label="Close the story">
                <X size={19} strokeWidth={2.25} />
              </button>
            </span>
          </div>
        </div>
        <Wide.Provider value={wide}>
          {/* One keyed list, so the slide going out stays mounted as it is
              (its animations do not start over) while the new one joins. */}
          {[
            ...(from && slides[from.i] && from.i !== i ? [{ s: slides[from.i], cls: `st-out-${from.tr}`, out: true }] : []),
            { s: slide, cls: from ? `st-in-${from.tr}` : "", out: false },
          ].map(({ s, cls, out }) => (
            <div
              key={s.key}
              className={`st-layer ${cls}`}
              style={{ ...layerStyle(s), "--ox": origin.current.x, "--oy": origin.current.y }}
              aria-hidden={out || undefined}
            >
              <StorySlide slide={s} review={review} onReplay={() => go(0)} onNext={next} />
            </div>
          ))}
        </Wide.Provider>
      </div>
      <button type="button" className="st-side st-side-next" onClick={next} disabled={i === last} aria-label="Next slide">
        <ChevronRight size={20} strokeWidth={2.25} />
      </button>
    </div>,
    document.body
  );
}
