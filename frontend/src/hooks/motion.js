import { useEffect, useRef, useState } from "react";

// Shared "does the user want motion" check. All the effects below short-circuit
// to a static result when reduced motion is requested, matching the CSS.
const prefersReduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Lite graphics mode (Settings → Performance): pointer effects stand still too.
// Checked live inside the event handlers, so flipping the toggle takes effect
// without remounting anything.
const fxLite = () =>
  typeof document !== "undefined" && document.documentElement.classList.contains("fx-lite");

// Fires once when the element first scrolls into view. Returns [ref, inView].
// Used to kick off count-ups and other one-shot entrances exactly when seen.
export function useInView({ rootMargin = "0px 0px -10% 0px", once = true } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            if (once) io.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin, threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, once]);
  return [ref, inView];
}

// 3D pointer tilt: the element leans toward the cursor (sets --rx/--ry, read by
// the `.tilt` CSS class) and lifts a touch. `max` caps the lean in degrees.
export function useTilt({ max = 7, lift = 6 } = {}) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;
    let raf = 0;
    const onMove = (e) => {
      if (fxLite()) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // `important` so the tilt wins over a still-filling entrance animation
        // (cascade keyframes otherwise pin transform and the card can't lean).
        el.style.setProperty(
          "transform",
          `perspective(900px) rotateX(${-py * max}deg) rotateY(${px * max}deg) translateY(-${lift}px)`,
          "important"
        );
      });
    };
    const reset = () => {
      if (raf) cancelAnimationFrame(raf);
      el.style.removeProperty("transform");
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", reset);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", reset);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [max, lift]);
  return ref;
}

// Magnetic hover: the element drifts a few pixels toward the cursor, snapping
// back on leave. Great for primary call-to-action buttons.
export function useMagnetic({ strength = 0.35 } = {}) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;
    let raf = 0;
    const onMove = (e) => {
      if (fxLite()) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
      });
    };
    const reset = () => {
      if (raf) cancelAnimationFrame(raf);
      el.style.transform = "";
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", reset);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", reset);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [strength]);
  return ref;
}

// Scroll parallax: shifts the element vertically as the page scrolls, for a
// sense of depth (e.g. the hero photo drifting slower than the foreground).
export function useParallax(speed = 0.15) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (fxLite()) {
        el.style.transform = "";
        return;
      }
      const r = el.getBoundingClientRect();
      // Distance of the element's centre from the viewport centre.
      const offset = r.top + r.height / 2 - window.innerHeight / 2;
      el.style.transform = `translate3d(0, ${(-offset * speed).toFixed(1)}px, 0) scale(1.12)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed]);
  return ref;
}
