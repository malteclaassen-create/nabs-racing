import { useEffect, useRef, useState } from "react";

// Wraps a horizontally-scrollable strip and shows a soft fade on whichever
// edge has more content hidden beyond it — a clear "swipe for more" hint that
// auto-hides at the ends. `color` should match whatever sits behind the strip
// (page background, card, …) so the fade blends in.
export default function EdgeFade({
  children,
  className = "",
  innerClassName = "",
  color = "var(--c-card)",
  width = 40,
}) {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setEdge({
        start: el.scrollLeft > 2,
        end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <div ref={ref} className={`overflow-x-auto ${innerClassName}`}>
        {children}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 transition-opacity duration-200"
        style={{
          width,
          background: `linear-gradient(to right, ${color}, transparent)`,
          opacity: edge.start ? 1 : 0,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 transition-opacity duration-200"
        style={{
          width,
          background: `linear-gradient(to left, ${color}, transparent)`,
          opacity: edge.end ? 1 : 0,
        }}
      />
    </div>
  );
}
