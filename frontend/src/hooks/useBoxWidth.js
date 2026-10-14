import { useEffect, useRef, useState } from "react";

// The width an element actually has on screen, kept current as it changes.
//
// For SVG charts that draw at their real size: a chart whose viewBox is as wide
// as its card keeps its axis type at the size it was written in, where a fixed
// 720-unit drawing scaled down onto a phone shrinks it to a few pixels (the
// same reason components/PointsChart.jsx measures its box). `fallback` is the
// width to draw at before the first measurement.
export function useBoxWidth(fallback = 720) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = (w) => w > 0 && setWidth(Math.round(w));
    read(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => read(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
