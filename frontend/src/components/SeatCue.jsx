import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// "There is a seat free, and it is further down." A floating line above the
// bottom edge of the attendance page, for reserve drivers only.
//
// The market block is the last thing on that page, under the whole entry list,
// usually a screenful or more below the fold. The page's job is the question
// "are you racing on Friday", and somebody answers that at the top and leaves.
// A reserve then never sees the one part of the page they can act on.
//
// It goes away the moment the offers are actually on screen, which is also the
// moment it has done its job. `onSeen` is called then, and the caller writes
// that down so this does not greet them again tomorrow with the same news.
// `target` is the market block itself, not a ref to it. A ref object never
// changes identity, so an effect that finds it empty (the offers had not
// rendered yet when this mounted, which is the normal order when the two
// requests land the other way round) would never look again. An element in
// state re-runs the effect the moment it appears.
export default function SeatCue({ count, target, onSeen }) {
  const [arrived, setArrived] = useState(false);
  const seenRef = useRef(false);

  useEffect(() => {
    if (!target || arrived) return undefined;
    let last = 0;
    // Measured against the window rather than watched with an
    // IntersectionObserver. The observer is the tidier tool and was the first
    // version, but it only reports while the page is actually being painted,
    // which makes it untestable in a headless pane and quietly dead in a
    // background tab. This reads the same geometry on the events that can
    // change it, at most ten times a second.
    const check = () => {
      const b = target.getBoundingClientRect();
      const h = window.innerHeight || 0;
      // A quarter of the block is enough to count as "you are looking at it".
      // Waiting for all of it would never happen on a phone, where the offers
      // are taller than the screen.
      const shown = Math.min(b.bottom, h) - Math.max(b.top, 0);
      if (b.height <= 0 || shown < Math.min(b.height, h) * 0.25) return;
      setArrived(true);
      if (!seenRef.current) {
        seenRef.current = true;
        onSeen?.();
      }
    };
    // Throttled on the clock rather than on requestAnimationFrame: rAF is tied
    // to the page being painted, so it never runs in a background tab and the
    // cue would sit there through a whole scroll. One rect read per 100ms of
    // scrolling costs nothing.
    const schedule = () => {
      const now = performance.now();
      if (now - last < 100) return;
      last = now;
      check();
    };
    check(); // already scrolled there when the offers arrived
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [target, arrived, onSeen]);

  if (arrived || !count) return null;

  const label = count === 1 ? "A seat is free for this race" : `${count} seats are free for this race`;

  // Portalled to the body on purpose. Every route sits inside the `page-in`
  // wrapper, which holds a transform for its entrance, and a transformed
  // ancestor makes `position: fixed` resolve against IT instead of the window.
  // In place, this rendered a screenful below the bottom of the page, where it
  // is worth nothing at all.
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex justify-center px-4 sm:bottom-6">
      <button
        type="button"
        onClick={() =>
          target?.scrollIntoView({
            // The site switches its animations off for anyone who asked for
            // less motion; a page that slides 900 pixels under them would be
            // the loudest one left.
            behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "center",
          })
        }
        className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full border border-brand/50 bg-card/95 px-4 py-2 text-sm font-semibold text-dark shadow-lg backdrop-blur transition hover:border-brand"
      >
        <span className="truncate">{label}</span>
        {/* The bob is the existing scroll cue, which lite-graphics mode and
            reduced-motion already switch off. */}
        <svg
          viewBox="0 0 24 24"
          className="scroll-cue h-4 w-4 shrink-0 text-brand"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
      </button>
    </div>,
    document.body
  );
}
