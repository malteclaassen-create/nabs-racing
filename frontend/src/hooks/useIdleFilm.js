import { useEffect, useState } from "react";
import { useIdle } from "./useIdle.js";

// How long the main card waits, untouched, before its promo film takes over.
export const IDLE_FILM_DELAY_MS = 8000;

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
// series' promoVideoUrl; put the returned `ref` on the card. A callback ref
// rather than a ref object, because the card mounts only once the page's data
// is in: an observer set up on the first render would watch nothing. The film is `active` once the card is
// on screen and the page has been left alone for IDLE_FILM_DELAY_MS; `showing`
// once it is actually playing, which is when the card fades its overlay (the
// HUD) out, so a film still loading never leaves the card blank. Hand the
// whole object to <IdleFilm film={...} />.
export function useIdleFilm(src) {
  const [el, ref] = useState(null);
  const allowed = !!src && filmAllowed();
  const inView = useInView(el, allowed);
  const idle = useIdle(IDLE_FILM_DELAY_MS, inView);
  const active = allowed && inView && idle;
  const [playing, setPlaying] = useState(false);
  return { ref, src, active, showing: active && playing, setPlaying };
}
