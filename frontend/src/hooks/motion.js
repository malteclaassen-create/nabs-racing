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

// Slide-open / slide-shut for `<details class="anim-details">`, which otherwise
// snap. One delegated listener for the whole site, installed once from App, so
// an accordion only has to carry the class: the markup stays a real
// <details>/<summary> (keyboard, screen readers, find-in-page), and where this
// does nothing (reduced motion, Lite mode, no Web Animations) the browser's own
// behaviour is left alone. A `<details>` whose click was already handled
// (`defaultPrevented`, e.g. the FAQ on the join page, which does its own) is
// skipped, and so is one without exactly one panel after the summary.
//
// Closing has to hold the element open until the animation ends, since
// `open=false` hides the panel at once. The `finished` promise rather than the
// event, for the same reason as the FAQ: it still resolves in a background tab.
export function useAnimatedDetails() {
  useEffect(() => {
    const running = new WeakMap();
    const onClick = (e) => {
      if (e.defaultPrevented) return;
      const summary = e.target.closest?.("summary");
      const details = summary?.parentElement;
      if (!details || details.tagName !== "DETAILS" || !details.classList.contains("anim-details")) return;
      // A link or button inside the summary keeps its own click.
      const inner = e.target.closest("a,button,input,select,textarea");
      if (inner && summary.contains(inner)) return;
      const panels = [...details.children].filter((c) => c !== summary);
      if (panels.length !== 1 || motionOff() || typeof panels[0].animate !== "function") return;
      const panel = panels[0];
      e.preventDefault();
      running.get(details)?.cancel();
      const opening = !details.open;
      if (opening) details.open = true; // has to be open to be measured
      const cs = getComputedStyle(panel);
      const rest = {
        height: `${panel.scrollHeight + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)}px`,
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom,
        borderTopWidth: cs.borderTopWidth,
        borderBottomWidth: cs.borderBottomWidth,
        opacity: "1",
      };
      const shut = { height: "0px", paddingTop: "0px", paddingBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px", opacity: "0" };
      panel.style.overflow = "hidden";
      const anim = panel.animate(opening ? [shut, rest] : [rest, shut], {
        duration: 220,
        easing: "cubic-bezier(0.4, 0.1, 0.2, 1)",
      });
      running.set(details, anim);
      anim.finished
        .then(() => {
          if (!opening) details.open = false;
          running.delete(details);
        })
        .catch(() => {}) // a newer click cancelled this one and now owns the state
        .finally(() => {
          if (running.get(details) === undefined) panel.style.overflow = "";
        });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}
