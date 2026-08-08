// ---------------------------------------------------------------------------
// The standings "shake-up" replay: rows first sit where the PREVIOUS round
// left them, hold a beat, then glide to their real slots — climbers flash
// green, fallers red. The same glide and the same flash classes the live
// page's projection table uses on race night, so both surfaces speak one
// motion language.
//
// Shared by the driver standings list and the round-matrix table (drivers "By
// round" and the constructors page) — one implementation, so the two can
// never drift apart in timing or feel.
//
// Works purely on the DOM: the caller renders its rows in the FINAL order
// (links, keys and tab order never change) with `data-replay-prev` carrying
// each row's previous rank, and hands the container to this function from a
// CALLBACK REF. Refs attach in React's commit phase, before the browser
// paints, so the rows are already offset to their old slots by first paint.
// A callback also needs no hooks — this tends to be called from below a
// component's early returns, where a hook would change the hook order
// between renders and crash the page (that is not hypothetical).
// ---------------------------------------------------------------------------
import { motionOff } from "../hooks/motion.js";

// Returns a cancel function when the replay was armed, or null when there was
// nothing to play. Cancel FULLY undoes an unplayed replay — listener off,
// timers cleared, row offsets removed — so the caller can treat a cancelled
// replay as if it never started and arm a fresh one. That exact property is
// what keeps this working under React's dev-mode double mount: the rehearsal
// mount plays, its teardown cancels cleanly, the real mount plays again. The
// first version's cancel left the offsets standing, and every dev page load
// froze the table in the previous round's order for good.
export function playStandingsReplay(container, { holdMs = 700 } = {}) {
  if (!container || motionOff()) return null;
  const els = [...container.children].filter((el) => el.dataset?.replayPrev);
  if (els.length < 2) return null;
  const order = els
    .map((el, i) => ({ el, i, prev: Number(el.dataset.replayPrev) || i + 1 }))
    .sort((a, b) => a.prev - b.prev);
  const tops = els.map((el) => el.getBoundingClientRect().top);
  const movers = [];
  order.forEach(({ el, i }, prevIdx) => {
    const dy = tops[prevIdx] - tops[i];
    if (!dy) return;
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
    el.style.zIndex = "1";
    el.style.position = "relative";
    movers.push({ el, up: dy > 0 }); // starts below its slot = climbing up
  });
  if (!movers.length) return null;
  void container.offsetHeight; // commit the start positions before releasing

  const release = () => {
    for (const { el, up } of movers) {
      el.style.transition = "transform var(--t-tell) var(--e-out)";
      el.style.transform = "";
      el.classList.add(up ? "proj-flash-up" : "proj-flash-down");
      el.addEventListener(
        "transitionend",
        () => {
          el.style.transition = "";
          el.style.zIndex = "";
          el.style.position = "";
        },
        { once: true }
      );
      el.addEventListener("animationend", () => el.classList.remove("proj-flash-up", "proj-flash-down"), {
        once: true,
      });
    }
  };

  // Play only once the table is actually IN VIEW, not once it exists: the
  // tier-2 constructors table sits below the fold, and a replay clocked from
  // page load had finished long before anyone scrolled to it — the one person
  // guaranteed to miss the show was the one who came to watch it. Same
  // trigger line the scroll reveals use (top edge crossing the bottom 10% of
  // the viewport), checked the same cheap way. Holding is safe meanwhile: the
  // rows sit in the PREVIOUS order, which is only ever on screen for the
  // holdMs beat after the table enters view.
  let timer = null;
  let done = false;
  const inView = () => {
    const r = container.getBoundingClientRect();
    return r.top < window.innerHeight * 0.9 && r.bottom > 0;
  };
  const arm = () => {
    if (done) return;
    done = true;
    window.removeEventListener("scroll", onScroll);
    timer = setTimeout(release, holdMs);
  };
  let ticking = false;
  const onScroll = () => {
    if (ticking || done) return;
    ticking = true;
    setTimeout(() => {
      ticking = false;
      if (inView()) arm();
    }, 50);
  };
  if (inView()) {
    arm();
  } else {
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  return () => {
    done = true;
    window.removeEventListener("scroll", onScroll);
    if (timer) clearTimeout(timer);
    for (const { el } of movers) {
      el.style.transition = "";
      el.style.transform = "";
      el.style.zIndex = "";
      el.style.position = "";
      el.classList.remove("proj-flash-up", "proj-flash-down");
    }
  };
}
