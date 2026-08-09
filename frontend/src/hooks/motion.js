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

// "Should this animate at all?" for animations driven by JavaScript rather than
// a CSS class. The CSS ones get the same two answers from the `.fx-lite …
// { animation: none }` rules and the reduced-motion media query in index.css;
// anything scripted has to ask here, or it would keep moving after the visitor
// has asked the site to stop.
export const motionOff = () => prefersReduced() || fxLite();

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

// Scroll parallax for a COVER IMAGE: drifts the picture inside its frame as the
// page scrolls, for a sense of depth (the hero photo moving slower than the
// foreground).
//
// It moves the crop, not the element. The old version scaled the image to 112%
// and slid it with a transform, which meant the picture stuck out 6% past its
// card on every side and relied on the card's `overflow: hidden` to hide the
// rest. That overhang was drawn anyway: a scroll gives the transformed image a
// compositing layer of its own, and a layer of its own does not reliably honour
// an ancestor's ROUNDED overflow clip. What you saw was a bright 43px band of
// the photo along the bottom of the hero, unscrimmed, with a hard edge above
// it, and it appeared as soon as the page had been scrolled once.
//
// object-position has no overhang to lose control of: the image is exactly the
// size of its frame and the crop slides within it, so there is nothing outside
// the box for any layer to draw. The drift survives; the whole class of bug
// does not. It needs the image to be `object-cover` and to have room to move,
// which a landscape photo in a wide card has plenty of; where it hasn't (a
// portrait card on a phone, where the crop is already pinned) the picture
// simply sits still, which is the right answer there anyway.
export function useParallax(speed = 0.15) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (fxLite()) {
        el.style.objectPosition = "";
        return;
      }
      const r = el.getBoundingClientRect();
      // Where the frame sits relative to the middle of the screen, as -1..1.
      const offset = r.top + r.height / 2 - window.innerHeight / 2;
      const t = Math.max(-1, Math.min(1, offset / Math.max(1, window.innerHeight)));
      // 50% is centred; the swing is what `speed` buys. Kept well inside 0..100
      // so the crop never runs out of picture at either end.
      el.style.objectPosition = `center ${(50 + t * speed * 100).toFixed(1)}%`;
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
