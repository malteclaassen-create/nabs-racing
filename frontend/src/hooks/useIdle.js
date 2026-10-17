import { useEffect, useState } from "react";

// True once nobody has touched the page for `ms`: no pointer movement, tap,
// key, wheel or scroll. Any of those makes it false again at once and starts
// the wait over. A tab in the background is never idle (nothing is watching
// it), and coming back to it counts as activity.
//
// Built for the promo film in the Home/Welcome main card: it plays while the
// page is left alone and gets out of the way the moment somebody reaches for
// it. `enabled` false keeps it false and listens to nothing.
const ACTIVITY = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"];

export function useIdle(ms, enabled = true) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return undefined;
    }
    let timer;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), ms);
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        setIdle(false);
      } else {
        wake();
      }
    };
    for (const e of ACTIVITY) window.addEventListener(e, wake, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    wake();
    return () => {
      clearTimeout(timer);
      for (const e of ACTIVITY) window.removeEventListener(e, wake, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, enabled]);
  return idle;
}
