import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";

// ---------------------------------------------------------------------------
// Guided tours. Instead of a notification dropping you straight onto a page,
// a tour walks you there one step at a time: it spotlights the button you
// need to press next (dims the rest of the screen, pulses a ring around the
// target), shows a little coach-mark with a line of text, and advances the
// moment you click the highlighted control. Targets are matched by a
// `data-tour="..."` attribute, so a tour can hop across pages — after each
// click the engine just waits for the next step's target to appear.
//
// A tour is kicked off from anywhere via `useTour().startTour("<name>")`
// (the notification bell turns a `tour:<name>` link into exactly that call).
// ---------------------------------------------------------------------------

const TourCtx = createContext({ startTour: () => {}, active: false });
export const useTour = () => useContext(TourCtx);

// How long to keep looking for a step's target before giving up and showing a
// plain "carry on" card instead (e.g. the target lives in a menu we can't open
// for the user, as on a phone).
const FIND_TIMEOUT_MS = 5000;

// The tour catalogue. Each step: a `target` selector to spotlight, the text to
// show, and `to` — where clicking the target leads, which doubles as the
// "skip ahead" destination if we never find the target. `final` ends the tour.
function buildTour(name, { user }) {
  const driverId = user?.driverId;
  switch (name) {
    case "my-rating":
      return [
        {
          // Phone only: the profile chip lives inside the burger menu, so the
          // menu button comes first. On desktop the button doesn't exist and
          // the step skips itself (optional + skipMs).
          target: '[data-tour="nav-burger"]',
          title: "Open the menu",
          body: "Tap the menu button up top.",
          optional: true,
          skipMs: 700,
        },
        {
          target: '[data-tour="nav-profile"]',
          title: "Your profile",
          body: "Tap your name to open your driver profile.",
          to: driverId ? `/drivers/${driverId}` : "/profile",
        },
        {
          target: '[data-tour="personal-area"]',
          title: "Personal Area",
          body: "Open your Personal Area from here.",
          to: "/profile",
        },
        {
          target: '[data-tour="tab-rating"]',
          title: "The new tab",
          body: "Here it is: My Rating. Give it a tap.",
          to: "/profile?tab=rating",
        },
        {
          target: '[data-tour="my-rating-panel"]',
          title: "This is My Rating",
          body: "Yours only. It shows round by round where your rating comes from, where your strengths are and what's costing you points.",
          final: true,
        },
      ];
    default:
      return null;
  }
}

// First VISIBLE match for a selector: on a phone the same `data-tour` marker can
// sit on both the (hidden) desktop control and its mobile twin, so we skip
// anything with no box / display:none / visibility:hidden.
function findVisible(selector) {
  const els = document.querySelectorAll(selector);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none") return el;
  }
  return null;
}

export function TourProvider({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  // { name, steps, index } | null
  const [tour, setTour] = useState(null);

  const startTour = useCallback(
    (name) => {
      const steps = buildTour(name, { user });
      if (!steps || !steps.length) return; // unknown tour name: do nothing
      setTour({ name, steps, index: 0 });
    },
    [user]
  );

  // Deep-link / self-test hook: a `?tour=<name>` in the URL starts that tour on
  // load, then the param is stripped so a refresh doesn't restart it. Lets a
  // tour be linked to directly, and makes it easy to preview one on demand.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = params.get("tour");
    if (!name) return;
    params.delete("tour");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
    );
    startTour(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const end = useCallback(() => setTour(null), []);
  const next = useCallback(() => {
    setTour((t) => {
      if (!t) return null;
      return t.index + 1 < t.steps.length ? { ...t, index: t.index + 1 } : null;
    });
  }, []);

  // Advance by the coach-mark button: take the same route the target would have,
  // then step on. Used both as the phone fallback and as a "can't click it?" out.
  const skipAhead = useCallback(
    (step) => {
      if (step?.to) navigate(step.to);
      next();
    },
    [navigate, next]
  );

  return (
    <TourCtx.Provider value={{ startTour, active: !!tour }}>
      {children}
      {tour && (
        <TourOverlay
          key={`${tour.name}:${tour.index}`}
          step={tour.steps[tour.index]}
          index={tour.index}
          total={tour.steps.length}
          onNext={next}
          onSkipAhead={skipAhead}
          onEnd={end}
        />
      )}
    </TourCtx.Provider>
  );
}

// One step's spotlight + coach-mark. Runs a rAF loop that keeps the ring glued
// to the (moving, scrolling) target and re-attaches the advance-on-click
// listener whenever the matched element changes across a navigation.
function TourOverlay({ step, index, total, onNext, onSkipAhead, onEnd }) {
  const spotRef = useRef(null);
  const cardRef = useRef(null);
  // The element currently spotlighted — the Next button clicks it for you, so
  // "Next" always does exactly what tapping the control would (e.g. it really
  // opens the burger menu instead of just moving the tour along).
  const targetRef = useRef(null);
  const [mode, setMode] = useState("searching"); // searching | found | notfound

  // Latest handlers in refs so the long-lived rAF loop never goes stale.
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  const isFinal = !!step.final;

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    let boundEl = null;
    let scrolled = false;
    const startAt = performance.now();
    let modeNow = "searching";
    setMode("searching");

    const onTargetClick = () => {
      // The target handles its own navigation (it's a real link/button); we
      // just move the tour forward.
      onNextRef.current?.();
    };

    const place = (rect) => {
      const spot = spotRef.current;
      const card = cardRef.current;
      const pad = 6;
      if (spot) {
        spot.style.opacity = rect ? "1" : "0";
        if (rect) {
          spot.style.left = `${rect.left - pad}px`;
          spot.style.top = `${rect.top - pad}px`;
          spot.style.width = `${rect.width + pad * 2}px`;
          spot.style.height = `${rect.height + pad * 2}px`;
        }
      }
      if (card) {
        const cw = card.offsetWidth || 300;
        const ch = card.offsetHeight || 150;
        const margin = 14;
        let top;
        let left;
        if (rect) {
          const below = rect.bottom + margin;
          top = below + ch <= window.innerHeight - 8 ? below : Math.max(8, rect.top - ch - margin);
          left = Math.min(Math.max(rect.left, 12), window.innerWidth - cw - 12);
        } else {
          top = Math.max(12, window.innerHeight / 2 - ch / 2);
          left = Math.max(12, window.innerWidth / 2 - cw / 2);
        }
        card.style.top = `${top}px`;
        card.style.left = `${left}px`;
      }
    };

    const loop = () => {
      if (cancelled) return;
      const el = isFinal || step.target ? findVisible(step.target) : null;
      if (el) {
        if (el !== boundEl) {
          if (boundEl) boundEl.removeEventListener("click", onTargetClick, true);
          boundEl = el;
          targetRef.current = el;
          if (!isFinal) boundEl.addEventListener("click", onTargetClick, true);
          if (!scrolled) {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
            scrolled = true;
          }
        }
        if (modeNow !== "found") {
          modeNow = "found";
          setMode("found");
        }
        place(el.getBoundingClientRect());
      } else {
        if (boundEl) {
          boundEl.removeEventListener("click", onTargetClick, true);
          boundEl = null;
          targetRef.current = null;
        }
        // An optional step (e.g. the burger-menu step, which only exists on
        // phones) quietly skips itself when its target isn't around.
        if (step.optional && performance.now() - startAt > (step.skipMs || 700)) {
          cancelled = true;
          onNextRef.current?.();
          return;
        }
        if (modeNow !== "notfound" && performance.now() - startAt > FIND_TIMEOUT_MS) {
          modeNow = "notfound";
          setMode("notfound");
        }
        place(null);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (boundEl) boundEl.removeEventListener("click", onTargetClick, true);
    };
  }, [step, isFinal]);

  // Escape ends the tour (a gentle way out).
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onEnd();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnd]);

  const showRing = mode === "found";

  // An optional step stays invisible while it's still deciding whether its
  // target exists at all — otherwise the card would flash for a beat on
  // desktop before the step skips itself.
  if (step.optional && mode === "searching") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70]">
      {/* Spotlight: dims the whole screen except a pulsing cut-out over the
          target, and lets clicks pass straight through to it. */}
      <div
        ref={spotRef}
        className={`tour-spot fixed ${showRing ? "" : "tour-spot-idle"}`}
        style={{ opacity: 0 }}
        aria-hidden
      />
      {/* When we can't spotlight anything (searching, or the target never
          showed) a plain scrim keeps focus on the coach-mark. */}
      {!showRing && <div className="fixed inset-0 bg-ink/55" aria-hidden />}

      <div
        ref={cardRef}
        role="dialog"
        aria-live="polite"
        className="tour-card pointer-events-auto fixed w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-card p-4 shadow-2xl shadow-ink/40"
      >
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-eyebrow">
            Step {index + 1} of {total}
          </span>
          <button
            type="button"
            onClick={onEnd}
            className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-light transition hover:bg-surface2 hover:text-dark"
          >
            End tour
          </button>
        </div>
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">{step.title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-medium">{step.body}</p>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-5 bg-brand" : "w-1.5 bg-border"
                }`}
              />
            ))}
          </div>
          {isFinal ? (
            <button type="button" onClick={onEnd} className="btn-primary px-4 py-1.5 text-sm">
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                // With a spotlighted control, Next presses it for you (the
                // click listener on it advances the tour); without one it
                // falls back to jumping straight to the step's destination.
                if (mode === "found" && targetRef.current) targetRef.current.click();
                else onSkipAhead(step);
              }}
              className="btn-secondary inline-flex items-center gap-1 px-3.5 py-1.5 text-sm"
            >
              {mode === "found" ? "Next" : "Take me there"}
              <span aria-hidden>→</span>
            </button>
          )}
        </div>
        {mode === "found" && !isFinal && (
          <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-wider text-light">
            or click the highlighted button
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
