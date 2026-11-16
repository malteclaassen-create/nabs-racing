// The recap's motion, shared by every page told in its chapters (the race
// recap, the season review): cards let in as they come up the screen, and
// a little scroll-linked depth while they travel to the reading line.
import { useEffect, useRef } from "react";
import { motionOff } from "../../hooks/motion.js";

// Lets every .recap-reveal on the page in once it is a good way into the
// screen (its top past the lower fifth of the viewport); several arriving in
// one pass fan out top to bottom. A scroll check rather than an
// IntersectionObserver, like the site's own reveal: it never leaves a card
// stuck invisible, whatever the browser is doing with its frames. Re-armed
// whenever the page grows (the lap chart card lands a beat later).
export function useRecapReveal(...deps) {
  useEffect(() => {
    const pending = () => [...document.querySelectorAll(".recap-reveal:not(.is-visible)")];
    if (!pending().length) return;
    if (motionOff()) {
      pending().forEach((el) => el.classList.add("is-visible"));
      return;
    }
    // A short timer rather than an animation frame: frames stop when the tab
    // is not painting, timers do not, and the site's own reveal learned the
    // same lesson (hooks/useScrollReveal.js).
    let timer = 0;
    const check = () => {
      timer = 0;
      const line = window.innerHeight * 0.82;
      const due = pending()
        .map((el) => ({ el, top: el.getBoundingClientRect().top }))
        .filter((x) => x.top < line)
        .sort((a, b) => a.top - b.top);
      // Calm steps: cards arriving together follow one another 140 ms apart.
      due.forEach(({ el }, i) => {
        el.style.setProperty("--reveal-delay", `${Math.min(i, 6) * 140}ms`);
        el.classList.add("is-visible");
      });
    };
    const onScroll = () => {
      if (!timer) timer = setTimeout(check, 40);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// Scroll-linked depth: a card still low on the screen sits a little further
// down, and glides up into its place as it is scrolled towards the reading
// line (35% down the screen), where it comes to rest. Chapter headers sit on
// a nearer layer and travel a touch more. It writes the `translate` property
// only, which composes with the entrance's `transform` and never touches
// layout; positions are read from the layout (offsetTop), never from the
// moved boxes, so it cannot feed back on itself. Off with reduced motion.
export function useCardDepth(...deps) {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || motionOff()) return undefined;
    let items = [];
    let raf = 0;
    const docTop = (el) => {
      let y = 0;
      for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
      return y;
    };
    const measure = () => {
      items = [...root.querySelectorAll(".recap-reveal")].slice(1).map((el) => ({
        el,
        top: docTop(el),
        k: el.classList.contains("rr-chapter") ? 0.075 : 0.06,
        max: el.classList.contains("rr-chapter") ? 44 : 36,
        last: null,
      }));
    };
    const update = () => {
      raf = 0;
      if (motionOff()) {
        items.forEach((it) => it.el.style.removeProperty("translate"));
        return;
      }
      const vh = window.innerHeight;
      const line = vh * 0.35;
      const sy = window.scrollY;
      for (const it of items) {
        const top = it.top - sy;
        if (top > vh * 1.4 || top < -vh) continue;
        const off = Math.max(0, Math.min(it.max, (top - line) * it.k));
        const r = Math.round(off * 10) / 10;
        if (r !== it.last) {
          it.last = r;
          it.el.style.translate = r ? `0 ${r}px` : "";
        }
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const remeasure = () => {
      measure();
      onScroll();
    };
    measure();
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(remeasure) : null;
    ro?.observe(root);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", remeasure);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", remeasure);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

const teamOf = (row) => row?.effectiveTeam || row?.team || null;
