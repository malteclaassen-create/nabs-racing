import { useEffect, useRef } from "react";

export default function useCardFoil(enabled) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    const reset = () => {
      cancelAnimationFrame(raf);
      ["--mx", "--my", "--rx", "--ry"].forEach((key) => el.style.removeProperty(key));
    };
    const move = (event) => {
      if (event.pointerType === "touch" || reduced.matches || document.documentElement.classList.contains("fx-lite")) return reset();
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--mx", x.toFixed(3));
        el.style.setProperty("--my", y.toFixed(3));
        el.style.setProperty("--rx", `${(0.5 - y) * 9}deg`);
        el.style.setProperty("--ry", `${(x - 0.5) * 12}deg`);
      });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", reset);
    el.addEventListener("pointercancel", reset);
    reduced.addEventListener("change", reset);
    const observer = new MutationObserver(reset);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    // A gallery can contain many animated surfaces. Only animate nearby cards.
    const visibility = new IntersectionObserver(([entry]) => {
      el.dataset.motionVisible = String(entry.isIntersecting);
      if (!entry.isIntersecting) reset();
    }, { rootMargin: "120px" });
    visibility.observe(el);
    return () => {
      reset();
      observer.disconnect();
      visibility.disconnect();
      delete el.dataset.motionVisible;
      reduced.removeEventListener("change", reset);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", reset);
      el.removeEventListener("pointercancel", reset);
    };
  }, [enabled]);
  return ref;
}
