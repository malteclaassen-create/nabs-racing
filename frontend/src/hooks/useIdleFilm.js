import { useCallback, useEffect, useState } from "react";
import { useIdle } from "./useIdle.js";

// How long the main card waits, untouched, before its promo film takes over.
export const IDLE_FILM_DELAY_MS = 8000;
// How long an intro may take to show its first frame before the card gives up
// on it and shows its HUD (a slow connection, or a phone in power-saving mode
// that refuses to autoplay at all).
const INTRO_START_TIMEOUT_MS = 4000;
const INTRO_SEEN_PREFIX = "nabs_intro_seen:";

// Whether this visitor gets moving pictures at all: not with reduced motion
// asked for, not in the site's low-effects mode, not on a connection that
// asked to save data (a film is several megabytes nobody requested).
function filmAllowed() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  if (document.documentElement.classList.contains("fx-lite")) return false;
  if (navigator.connection?.saveData) return false;
  return true;
}

// The intro plays once per browser session and film: hopping to the standings
// and back must not make anybody sit through it again, a new visit does.
function introSeen(src) {
  try {
    return sessionStorage.getItem(INTRO_SEEN_PREFIX + src) === "1";
  } catch {
    return false;
  }
}
function markIntroSeen(src) {
  try {
    sessionStorage.setItem(INTRO_SEEN_PREFIX + src, "1");
  } catch {
    /* private mode: it plays again next time, no harm */
  }
}

// Whether the promo page (components/EventPromo.jsx) is up. The intro waits
// for it to be closed: a film playing behind it would be over by then.
function promoOpen() {
  return typeof document !== "undefined" && document.documentElement.dataset.promo === "open";
}
function usePromoOpen() {
  const [open, setOpen] = useState(promoOpen);
  useEffect(() => {
    const sync = () => setOpen(promoOpen());
    sync();
    window.addEventListener("nabs-promo", sync);
    return () => window.removeEventListener("nabs-promo", sync);
  }, []);
  return open;
}

// Whether at least half of `el` is on screen.
function useInView(el, enabled) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!enabled || !el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [el, enabled]);
  return enabled && inView;
}

// The promo film of a main card (Home hero, Welcome car tile). `src` is the
// series' promoVideoUrl; put the returned `ref` on the card (a callback ref
// rather than a ref object, because the card mounts only once the page's data
// is in: an observer set up on the first render would watch nothing). Hand the
// whole object to <IdleFilm film={...} />, and hide the card's HUD while
// `hideHud` is true.
//
// Two ways the film plays:
//   - intro (opts.intro, a special event's page): once, right when the card
//     comes into view, with the HUD hidden from the start; the HUD fades in
//     when the film ends, or is skipped. Once per session (see introSeen).
//   - idle: muted and looped once the page has been left alone for
//     IDLE_FILM_DELAY_MS, the HUD fading out only once the film actually
//     plays (so a film still loading never leaves the card blank) and back in
//     on the first movement.
export function useIdleFilm(src, { intro = false } = {}) {
  const [el, ref] = useState(null);
  const allowed = !!src && filmAllowed();
  // "waiting" -> "playing" -> "done"; "done" from the start without an intro.
  const [phase, setPhase] = useState(() => (intro && allowed && !introSeen(src) ? "waiting" : "done"));
  const inView = useInView(el, allowed);
  const promoUp = usePromoOpen();
  const idle = useIdle(IDLE_FILM_DELAY_MS, inView && phase === "done");
  const [playing, setPlaying] = useState(false);

  // The film arrived after the first render (the series list loads in
  // parallel with the page): decide about the intro now.
  useEffect(() => {
    if (phase === "done" && intro && allowed && !introSeen(src) && !playing) setPhase("waiting");
    // Only when the inputs change, not when the phase moves on by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, intro, allowed]);

  useEffect(() => {
    if (phase === "waiting" && inView && !promoUp) {
      markIntroSeen(src);
      setPhase("playing");
    }
  }, [phase, inView, promoUp, src]);

  // An intro that has not shown a frame in time is given up on.
  useEffect(() => {
    if (phase !== "playing" || playing) return undefined;
    const t = setTimeout(() => setPhase("done"), INTRO_START_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [phase, playing]);

  const finish = useCallback(() => setPhase("done"), []);

  const mode = phase === "done" ? "idle" : "intro";
  const active = allowed && (mode === "intro" ? phase === "playing" : inView && idle);
  const showing = active && playing;
  return {
    ref,
    src,
    mode,
    active,
    showing,
    // The intro keeps the HUD away from the very start, so it never flashes
    // up for a moment before the film gets going.
    hideHud: mode === "intro" ? phase !== "done" : showing,
    setPlaying,
    onEnded: finish,
    skip: finish,
  };
}
