import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { useSeriesPath } from "../context/SeriesContext.jsx";

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
// (the notification bell turns a `tour:<name>` link into exactly that call),
// or by a `?tour=<name>` in the address, which is also how a tour is previewed
// without waiting for the notification that normally offers it. The parameter
// is stripped once read, so a refresh doesn't restart it.
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
//
// `go` is the other kind of step: instead of waiting for the reader to click a
// link, the tour drives there itself and then points at something on the page
// it arrived at. Which kind to use is not a style choice. A tour that teaches
// somebody HOW to reach a page has to make them walk it (that is the whole
// lesson — see "my-rating"). A tour that shows somebody AROUND should not make
// them hunt for the next nav item, and on a phone it could not anyway: the nav
// lives inside the burger menu, so every hop would need the menu opened first.
//
// The step list is built per device rather than marking desktop-only steps
// optional, so "step 3 of 7" counts the steps this reader will actually see.
function buildTour(name, { user, p, desktop }) {
  const driverId = user?.driverId;
  switch (name) {
    // The "show me around" tour, offered on the landing page. Written for
    // somebody who has never seen the site and may not have an account: every
    // stop is public, and it ends where a newcomer actually has to go next.
    // The two shapes are not a compromise, they are what each device can do.
    //
    // On a DESKTOP the nav bar is on screen the whole time, so the tour points
    // at the item you would press and lets you press it. That is the part worth
    // teaching — where things live — and it also sets the pace: nothing moves
    // until the reader moves it, so the page changes when they expect it to.
    //
    // On a PHONE all six of those items are inside the burger menu, and the
    // menu closes itself on every navigation. Walking the nav there would mean
    // open menu, press, arrive, open menu again, six times over. So it points
    // at the menu once, says that everything is in there, and then drives
    // itself, showing the thing on each page rather than the way to it.
    //
    // The order is a season, in the order it happens: where everyone stands,
    // the rounds behind us, saying you're in for the next one, and then the
    // night it is run. It used to put race night before signing up for it.
    case "newcomer":
      return desktop
        ? [
            {
              target: '[data-tour="nav-search"]',
              title: "Search everything",
              body: "Any driver, team, race or season. It reaches across all seasons, so a result from years ago is one word away.",
            },
            {
              target: '[data-tour="nav-standings"]',
              title: "Standings live under here",
              body: "Two tables: the drivers' championship and the constructors'. Open it.",
            },
            {
              // The flyout the step above just opened, spotlighted whole so all
              // three choices are lit rather than one of them. Nothing to press
              // on the box itself, hence nextGoes.
              target: '[data-tour="nav-standings-menu"]',
              title: "Three tables",
              body: "The drivers' championship, the constructors', and the all-time records across every season. Pick one, or press Next for the drivers'.",
              to: p("/drivers"),
              nextGoes: true,
            },
            {
              target: '[data-tour="nav-races"]',
              title: "Every round",
              body: "The season's calendar, and every round that has been run: full result, fastest lap, who stood in for whom.",
              to: p("/races"),
            },
            {
              // Sign-up runs one round at a time, so between rounds this item
              // is not in the nav at all and the step takes itself out.
              target: '[data-tour="nav-attendance"]',
              title: "Saying you're in",
              body: "Before each round everyone answers here, and a driver who can't make it can hand their seat to a reserve.",
              to: p("/attendance"),
              optional: true,
              skipMs: 1200,
            },
            {
              target: '[data-tour="nav-live"]',
              title: "Race night",
              body: "While a race is on this page is live timing: positions, gaps, tyres and the pit lane, straight off the server.",
              to: p("/live"),
            },
            {
              target: '[data-tour="feedback-fab"]',
              title: "Something broken?",
              body: "This corner button goes straight to the league admins. Anyone can write, account or not.",
            },
            {
              go: "/",
              to: "/",
              target: '[data-tour="welcome-cta"]',
              title: "That's the tour",
              body: user
                ? "Have a look around. The rest of the site is yours to poke at."
                : "The league runs on Discord: that's where the sign-ups, the results and the arguing happen. Come and say hello.",
              final: true,
              // Finish at the top of the page, not halfway down it.
              top: true,
            },
          ]
        : [
            {
              target: '[data-tour="nav-burger"]',
              title: "Everything is in here",
              body: "Standings, the calendar, live timing, sign-ups. Have a look, then come back with Next and I'll show you the important ones.",
            },
            {
              go: p("/drivers"),
              to: p("/drivers"),
              target: '[data-tour="standings-views"]',
              title: "The championship",
              body: "Points as they stand. This switch turns the table into a round-by-round grid, or into the drivers' rating cards.",
            },
            {
              go: p("/races"),
              to: p("/races"),
              target: '[data-tour="race-rounds"]',
              title: "Every round",
              body: "Pick a round here and it opens below: full result, fastest lap, who stood in for whom.",
            },
            {
              go: p("/attendance"),
              to: p("/attendance"),
              target: '[data-tour="signup-card"]',
              title: "Saying you're in",
              body: "Before each round everyone answers here, and a driver who can't make it can hand their seat to a reserve.",
              // Often simply shut between rounds. Long enough that the page has
              // had a chance to load before the step decides it isn't there.
              optional: true,
              skipMs: 3000,
            },
            {
              go: p("/live"),
              to: p("/live"),
              target: '[data-tour="live-header"]',
              title: "Race night",
              body: "While a race is on this page is live timing: positions, gaps, tyres and the pit lane, straight off the server.",
            },
            {
              go: "/",
              to: "/",
              target: '[data-tour="welcome-cta"]',
              title: "That's the tour",
              body: user
                ? "Have a look around. The rest of the site is yours to poke at."
                : "The league runs on Discord: that's where the sign-ups, the results and the arguing happen. Come and say hello.",
              final: true,
              // Finish at the top of the page, not halfway down it.
              top: true,
            },
          ];
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
  const { seriesPath } = useSeriesPath();
  // { name, steps, index } | null
  const [tour, setTour] = useState(null);

  const startTour = useCallback(
    (name) => {
      // Read once, at the start: a tour that swapped its own steps halfway
      // through a rotation would renumber itself under the reader.
      const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
      const steps = buildTour(name, { user, p: seriesPath, desktop });
      if (!steps || !steps.length) return; // unknown tour name: do nothing
      setTour({ name, steps, index: 0 });
    },
    [user, seriesPath]
  );

  // A `go` step takes itself there. Keyed on the step INDEX, so it fires once
  // per step and a reader who wanders off mid-tour isn't dragged back.
  const goneFor = useRef(null);
  useEffect(() => {
    const step = tour?.steps[tour.index];
    const key = tour && `${tour.name}:${tour.index}`;
    if (!step?.go || goneFor.current === key) return;
    goneFor.current = key;
    if (window.location.pathname !== step.go) navigate(step.go);
  }, [tour, navigate]);

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
        } else if (modeNow === "notfound" || !card.style.top) {
          top = Math.max(12, window.innerHeight / 2 - ch / 2);
          left = Math.max(12, window.innerWidth / 2 - cw / 2);
        } else {
          // Between two steps the next target does not exist yet — a page is
          // still arriving, a menu still opening. Leaving the card where it was
          // is what stops the flicker: it used to jump to the middle of the
          // screen for those few frames and then jump again to the new target,
          // so every step change read as two moves and a stutter. It only
          // centres itself once the search has actually given up, which is the
          // one case where the card has nothing to sit beside.
          return;
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
            // `top` is for a step whose target sits at the top of its page
            // anyway: centring it would push the page DOWN a few hundred pixels
            // and leave the reader stranded there when the tour ends. The last
            // step of the newcomer tour lands back on the front page, and
            // landing on a page means seeing the top of it.
            if (step.top) window.scrollTo({ top: 0, behavior: "auto" });
            else el.scrollIntoView({ block: "center", behavior: "smooth" });
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
    <div className="pointer-events-none fixed inset-0 z-tour">
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
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">
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
                //
                // `nextGoes` is for a step that spotlights something you are
                // meant to READ rather than press — a menu holding three links,
                // say. Pressing the box itself would do nothing at all, so Next
                // takes the step's own destination instead. Clicking one of the
                // links inside still works: the click reaches the box on its
                // way up and moves the tour along.
                if (step.nextGoes || mode !== "found" || !targetRef.current) onSkipAhead(step);
                else targetRef.current.click();
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
