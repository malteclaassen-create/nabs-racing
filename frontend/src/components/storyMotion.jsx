import { useEffect, useRef, useState } from "react";
import { motionOff } from "../hooks/motion.js";

// ---------------------------------------------------------------------------
// The motion of the pages told as cards: the race recap (pages/RaceRecapPage)
// and Season Wrapped (pages/SeasonWrapped). A card is a .recap-reveal (see
// index.css); it rises in once it is a good way into the screen, and what is
// inside it waits for it: numbers tick from what they were to what they are,
// bars fill, tags land last.
// ---------------------------------------------------------------------------

// Lets every .recap-reveal on the page in once it is a good way into the
// screen (its top past the lower fifth of the viewport); several arriving in
// one pass fan out top to bottom. A scroll check rather than an
// IntersectionObserver, like the site's own reveal: it never leaves a card
// stuck invisible, whatever the browser is doing with its frames. Re-armed
// whenever the page grows (the recap's lap chart card lands a beat later).
export function useStoryReveal(...deps) {
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
      due.forEach(({ el }, i) => {
        el.style.setProperty("--reveal-delay", `${Math.min(i, 6) * 110}ms`);
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

// Whether the card this element sits in has been let in yet. Numbers wait
// for that rather than for being on screen, or they would count up behind
// a card that is still invisible.
export function useRevealed() {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const host = ref.current?.closest(".recap-reveal");
    if (!host) {
      setOn(true);
      return;
    }
    if (host.classList.contains("is-visible")) {
      setOn(true);
      return;
    }
    const mo = new MutationObserver(() => {
      if (host.classList.contains("is-visible")) {
        setOn(true);
        mo.disconnect();
      }
    });
    mo.observe(host, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return [ref, on];
}

// A number that ticks from what it was to what it is, once its card is in.
export function Tween({ from = 0, to, decimals = 0, duration = 1400, delay = 350, prefix = "", suffix = "", className = "" }) {
  const [ref, on] = useRevealed();
  const start = from == null || !Number.isFinite(from) ? to : from;
  const [n, setN] = useState(start);
  useEffect(() => {
    if (!on || !Number.isFinite(to)) return;
    if (motionOff() || start === to) {
      setN(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (t) => {
      const p = Math.min(1, Math.max(0, (t - t0) / duration));
      const e = 1 - Math.pow(1 - p, 3);
      setN(start + (to - start) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, start, to, duration, delay]);
  const shown = decimals ? n.toFixed(decimals) : Math.round(n).toLocaleString("en-US");
  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {prefix}
      {shown}
      {suffix}
    </span>
  );
}
