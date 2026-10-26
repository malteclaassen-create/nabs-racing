import { useEffect, useRef, useState } from "react";
import { prefersLessMotion } from "./ui.jsx";
import { useSite } from "../site.jsx";

// Page changes as a shower of the logo's streaks.
//
// Rounded bars at 45 degrees, in the league (or series) colour, white and
// black, rain in from the top right until they cover the screen; the new page
// is put in underneath; then they carry on out at the bottom left. The page
// shown is held back (`display`) until the screen is covered, so the old page
// never flickers into the new one half way.
//
// The first visit opens with the logo in the middle of the streaks, which
// then part to show the page. Moves inside one page (the admin's tabs, a
// changed ?season=) swap at once, and so does everything for anyone who
// asked their system for less motion.

const IN_MS = 580; // longest bar in, stagger included
const OUT_MS = 700; // longest bar out, stagger included
// Which colour each row gets: thin streaks in the accent (white, or the
// series colour) and in white, between wider black bars like the page.
// Few bars on purpose: each is a layer of its own, and phones redraw fewer
// layers more smoothly.
const TONES = ["bg", "accent", "bg", "ink", "bg", "accent", "bg", "bg", "ink", "bg", "accent", "bg", "ink", "bg", "accent", "bg"];
// Scatter in when each bar starts, so the front is ragged like rain.
const DELAYS = [40, 150, 10, 90, 160, 30, 120, 0, 70, 140, 20, 100, 60, 130, 5, 110];
// How long after the page swap its own entrance animations wait, so they play
// as the streaks clear instead of under them.
const ENTER_AFTER_INTRO = "720ms";
const ENTER_AFTER_SWAP = "160ms";

// One "page" for the transition: the admin's tabs count as one.
const pageKey = (loc) => (loc.pathname.startsWith("/admin") ? "/admin" : loc.pathname);

export function useRainTransition(location) {
  const [display, setDisplay] = useState(location);
  const [phase, setPhase] = useState(() => (prefersLessMotion() ? "idle" : "intro"));
  const [enter, setEnter] = useState(() => (prefersLessMotion() ? "0ms" : ENTER_AFTER_INTRO));
  const timers = useRef([]);
  const frame = useRef(0);
  const enterTimer = useRef(null);
  // the entrance delay goes back to nothing once the page is in, so things
  // shown later (a table after its data arrives) do not wait for no reason
  const delayEnter = (value, forMs) => {
    clearTimeout(enterTimer.current);
    setEnter(value);
    enterTimer.current = setTimeout(() => setEnter("0ms"), forMs);
  };

  // the opening: streaks part around the logo once
  useEffect(() => {
    if (phase !== "intro") return undefined;
    // (unless a page change has taken over the overlay meanwhile)
    const t = setTimeout(() => setPhase((p) => (p === "intro" ? "idle" : p)), 1400);
    delayEnter(ENTER_AFTER_INTRO, 2600);
    return () => clearTimeout(t);
  }, []); // the first render only

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    cancelAnimationFrame(frame.current);
    if (pageKey(location) === pageKey(display) || prefersLessMotion()) {
      setDisplay(location);
      if (pageKey(location) !== pageKey(display)) window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    setPhase("in");
    timers.current.push(
      setTimeout(() => {
        setDisplay(location);
        window.scrollTo({ top: 0, behavior: "instant" });
        delayEnter(ENTER_AFTER_SWAP, 2000);
        // the streaks clear once the new page is drawn underneath (two
        // frames: React's render, then the browser's paint), so building
        // the page does not stall the way out
        frame.current = requestAnimationFrame(() => {
          frame.current = requestAnimationFrame(() => {
            setPhase("out");
            timers.current.push(setTimeout(() => setPhase("idle"), OUT_MS));
          });
        });
      }, IN_MS + 40),
    );
  }, [location]); // when the address changes; `display` is read, not watched

  // While the streaks run, the page's own moving backgrounds pause (they
  // would be redrawn under the cover for nothing).
  useEffect(() => {
    document.documentElement.classList.toggle("wiping", phase !== "idle");
  }, [phase]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      clearTimeout(enterTimer.current);
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { display, phase, enter, displayKey: pageKey(display) };
}

export function RainOverlay({ phase }) {
  const { settings } = useSite();
  return (
    <div className="wipe" data-phase={phase} aria-hidden="true">
      <div className="wipe-rot">
        {TONES.map((tone, i) => (
          <div key={i} className={`wipe-bar wipe-${tone}`} style={{ "--d": `${DELAYS[i % DELAYS.length]}ms` }} />
        ))}
      </div>
      {phase === "intro" && (
        <img src={settings?.logoUrl || "/brand/logo.png"} alt="" className="wipe-logo" />
      )}
    </div>
  );
}
