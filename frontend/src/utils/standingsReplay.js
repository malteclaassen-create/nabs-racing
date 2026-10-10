// ---------------------------------------------------------------------------
// The standings "shake-up" replay: rows first sit where the PREVIOUS round
// left them, hold a beat, then glide to their real slots — climbers flash
// green, fallers red. The same glide and the same flash classes the live
// page's projection table uses on race night, so both surfaces speak one
// motion language.
//
// Shared by the driver standings board (list and "By round") and the
// constructors table — one implementation, so the two can never drift apart
// in timing or feel.
//
// Works purely on the DOM: the caller renders its rows in the FINAL order
// (links, keys and tab order never change) with `data-replay-prev` carrying
// each row's previous rank, and hands the container to this function from a
// CALLBACK REF. Refs attach in React's commit phase, before the browser
// paints, so the rows are already offset to their old slots by first paint.
// A callback also needs no hooks — this tends to be called from below a
// component's early returns, where a hook would change the hook order
// between renders and crash the page (that is not hypothetical).
//
// The offsets ride on the `translate` property, not on `transform`. The
// cascade entrance animates `transform` and keeps its end value afterwards
// (fill-mode both), which used to beat any inline transform, so the two could
// not share a row and the entrance had to be switched off whenever the replay
// ran. The browser applies `translate` and `transform` one after the other,
// so now a row can rise into its old slot with the cascade and then glide.
// ---------------------------------------------------------------------------
import { motionOff } from "../hooks/motion.js";

// Returns a cancel function when the replay was armed, or null when there was
// nothing to play. Cancel FULLY undoes an unplayed replay — listeners off,
// timers cleared, row offsets and stagger indexes put back — so the caller can
// treat a cancelled replay as if it never started and arm a fresh one. That
// exact property is what keeps this working under React's dev-mode double
// mount: the rehearsal mount plays, its teardown cancels cleanly, the real
// mount plays again. The first version's cancel left the offsets standing,
// and every dev page load froze the table in the previous round's order for
// good.
//
// `afterEntrance`: the container is a `.cascade` whose rows deal themselves
// in. The rows then deal in at their OLD slots, top to bottom as the eye sees
// them (each mover's `--i` stagger index is set to the slot it starts in), and
// the hold only starts once every row has finished arriving, so the glide
// never runs over a row that is still rising. `holdMs` is then the pause
// between the last row landing and the glide.
export function playStandingsReplay(container, { holdMs = 700, afterEntrance = false } = {}) {
  if (!container || motionOff()) return null;
  const els = [...container.children].filter((el) => el.dataset?.replayPrev);
  if (els.length < 2) return null;
  const order = els
    .map((el, i) => ({ el, i, prev: Number(el.dataset.replayPrev) || i + 1 }))
    .sort((a, b) => a.prev - b.prev);
  // Layout positions, not getBoundingClientRect: a row still rising from an
  // entrance animation (the dev double mount re-arms mid-entrance) would be
  // measured a few pixels off its slot and glide home with a jolt.
  const tops = els.map((el) => el.offsetTop);
  const movers = [];
  order.forEach(({ el, i }, prevIdx) => {
    const dy = tops[prevIdx] - tops[i];
    if (!dy) return;
    const mover = { el, up: dy > 0, stagger: el.style.getPropertyValue("--i") }; // starts below its slot = climbing up
    el.style.transition = "none";
    el.style.translate = `0 ${dy}px`;
    el.style.zIndex = "1";
    el.style.position = "relative";
    if (afterEntrance) el.style.setProperty("--i", String(Math.min(prevIdx, 16)));
    movers.push(mover);
  });
  if (!movers.length) return null;
  void container.offsetHeight; // commit the start positions before releasing

  const release = () => {
    for (const { el, up } of movers) {
      el.style.transition = "translate var(--t-tell) var(--e-out)";
      el.style.translate = "";
      el.classList.add(up ? "proj-flash-up" : "proj-flash-down");
      // Only this row's own glide: a hover fade on the row, or the flash on a
      // cell inside it, ends first and would otherwise clear the transition
      // halfway and snap the row home.
      const onGlideEnd = (e) => {
        if (e.target !== el || e.propertyName !== "translate") return;
        el.removeEventListener("transitionend", onGlideEnd);
        el.style.transition = "";
        el.style.zIndex = "";
        el.style.position = "";
      };
      el.addEventListener("transitionend", onGlideEnd);
      const onFlashEnd = (e) => {
        if (e.target !== el || !e.animationName.startsWith("proj-flash")) return;
        el.removeEventListener("animationend", onFlashEnd);
        el.classList.remove("proj-flash-up", "proj-flash-down");
      };
      el.addEventListener("animationend", onFlashEnd);
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
  let cancelled = false;
  let watcher = null;
  const inView = () => {
    const r = container.getBoundingClientRect();
    return r.top < window.innerHeight * 0.9 && r.bottom > 0;
  };
  const hold = () => {
    if (!cancelled) timer = setTimeout(release, holdMs);
  };
  // Waits for the rows' entrance to finish. The scroll-reveal pass marks the
  // cascade .is-visible a frame or so after this runs, so first wait for that
  // class; then every animation running on a row (the fade and the rise) has
  // a `finished` promise to wait on. A row with no animation, because motion
  // is reduced or the panel was swapped in without its cascade, resolves at
  // once. The fallback timer only matters if the class never arrives.
  const afterDealt = () => {
    const wait = () => {
      watcher?.disconnect();
      watcher = null;
      clearTimeout(timer);
      if (cancelled) return;
      const anims = els.flatMap((el) => (el.getAnimations ? el.getAnimations() : []));
      Promise.allSettled(anims.map((a) => a.finished)).then(hold);
    };
    if (!container.classList.contains("cascade") || container.classList.contains("is-visible")) return wait();
    watcher = new MutationObserver(() => {
      if (container.classList.contains("is-visible")) wait();
    });
    watcher.observe(container, { attributes: true, attributeFilter: ["class"] });
    timer = setTimeout(wait, 2500);
  };
  const arm = () => {
    if (done) return;
    done = true;
    window.removeEventListener("scroll", onScroll);
    if (afterEntrance) afterDealt();
    else hold();
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
    cancelled = true;
    window.removeEventListener("scroll", onScroll);
    watcher?.disconnect();
    watcher = null;
    if (timer) clearTimeout(timer);
    for (const { el, stagger } of movers) {
      el.style.transition = "";
      el.style.translate = "";
      el.style.zIndex = "";
      el.style.position = "";
      if (afterEntrance) {
        if (stagger) el.style.setProperty("--i", stagger);
        else el.style.removeProperty("--i");
      }
      el.classList.remove("proj-flash-up", "proj-flash-down");
    }
  };
}
