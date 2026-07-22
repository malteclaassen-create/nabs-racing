import { useLayoutEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Segmented control with a SLIDING active pill. Instead of each button painting
// its own active background (which makes the highlight jump from button to
// button), ONE absolutely-positioned pill glides to wherever the active button
// sits — including across wrapped rows, since top/height are measured too.
// Used by every view switcher / tab bar on the site; the NavBar has its own
// variant (useSlidingHighlight) because its items are NavLinks, not buttons.
// ---------------------------------------------------------------------------

export default function SlidingTabs({
  items, // [{ key, label (ReactNode), title? }]
  value,
  onChange,
  className = "", // extra classes on the wrapper
  wrapClassName = "inline-flex flex-wrap rounded-xl border border-border bg-card p-1",
  btnClassName = "px-3.5 py-2 text-sm", // sizing of each button
  pillClassName = "rounded-lg bg-brand shadow", // the sliding pill's look
  activeClassName = "text-ink", // active button (text only — the pill is the bg)
  idleClassName = "text-light hover:text-dark",
}) {
  const wrapRef = useRef(null);
  const btnRefs = useRef({});
  const [pill, setPill] = useState(null); // { left, top, width, height }

  useLayoutEffect(() => {
    const el = btnRefs.current[value];
    const wrap = wrapRef.current;
    if (!el || !wrap) {
      setPill(null);
      return;
    }
    const measure = () => {
      setPill({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
      // Bars that scroll sideways instead of wrapping (long, data-driven lists
      // on phones) keep the active button in view — otherwise picking the last
      // category and coming back leaves the highlight parked off-screen. No-op
      // for every bar that fits, which is all of them on desktop.
      if (wrap.scrollWidth > wrap.clientWidth + 1) {
        const centred = el.offsetLeft - (wrap.clientWidth - el.offsetWidth) / 2;
        wrap.scrollLeft = Math.max(0, Math.min(centred, wrap.scrollWidth - wrap.clientWidth));
      }
    };
    measure();
    // Re-measure when the bar reflows (resize, fonts, wrapping) so the pill
    // stays glued to its button.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(wrap);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [value, items.length]);

  return (
    <div ref={wrapRef} className={`relative ${wrapClassName} ${className}`}>
      {pill && (
        <span
          aria-hidden
          className={`absolute left-0 top-0 will-change-transform ${pillClassName} transition-[transform,width,height] duration-300 ease-out`}
          style={{ transform: `translate(${pill.left}px, ${pill.top}px)`, width: pill.width, height: pill.height }}
        />
      )}
      {items.map((it) => (
        <button
          key={it.key}
          ref={(n) => (btnRefs.current[it.key] = n)}
          type="button"
          title={it.title}
          data-tour={it.dataTour}
          onClick={() => onChange(it.key)}
          aria-pressed={value === it.key}
          className={`relative z-10 rounded-lg font-bold transition-colors ${btnClassName} ${
            value === it.key ? activeClassName : idleClassName
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// NavBar variant: measures the element marked `.is-active` inside `ref` and
// returns the pill box, re-measured on `deps` change and on resize. The caller
// renders the pill itself (its look differs from the segmented controls).
export function useSlidingHighlight(ref, deps) {
  const [pill, setPill] = useState(null);
  useLayoutEffect(() => {
    const wrap = ref.current;
    if (!wrap) return;
    const measure = () => {
      const el = wrap.querySelector(".is-active");
      if (!el) {
        setPill(null);
        return;
      }
      // Rect-based (not offsetLeft): an item may sit inside its own relative
      // wrapper (the Standings flyout does), which would skew offset* values.
      const wr = wrap.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      setPill({ left: er.left - wr.left, top: er.top - wr.top, width: er.width, height: er.height });
    };
    measure();
    // Late re-measures: fonts settling and neighbours animating in (the docked
    // season pill fades in over ~300ms) shift the row WITHOUT resizing it, so
    // a ResizeObserver on the row alone wouldn't notice.
    const ts = [120, 400, 800].map((ms) => setTimeout(measure, ms));
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(wrap);
    ro?.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      ts.forEach(clearTimeout);
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return pill;
}
