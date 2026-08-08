import { useEffect, useRef } from "react";

// The scrollbar, given back.
//
// The native one is hidden site-wide (see index.css — the rainbow line under
// the nav took over as the position indicator), which left nothing to grab.
// This is a plain track down the right edge, full height of the window, with a
// thumb on it: it travels as you scroll, and you can drag it yourself.
//
// It behaves like the real thing on purpose: the thumb's LENGTH says how much
// of the page you are looking at, dragging is 1:1 with the page, and a press on
// the empty track jumps there with the thumb centred on the point. Anything
// cleverer would be a novelty control that people have to learn.
//
// NOTE ON SMOOTHNESS — the reason there is not a single piece of React state in
// here. A scroll handler that calls setState runs a render of everything below
// it sixty times a second, which stutters this bar AND anything else animating
// off the same scroll (the rainbow progress line above the nav, in particular).
// So the component renders once and from then on writes to the DOM directly,
// inside requestAnimationFrame, which is what scroll-linked movement wants.

const MIN_THUMB = 36; // px — below this a thumb is too small to catch

export default function ScrollBar() {
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  // Live geometry, kept out of React on purpose (see the note above).
  const geom = useRef({ track: 0, thumb: 0, scrollable: 0, usable: false });
  const dragging = useRef(false);
  // Where inside the thumb the pointer grabbed it, so it doesn't jump to centre
  // itself under the cursor on the first move.
  const grabOffset = useRef(0);

  useEffect(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;

    const measure = () => {
      const doc = document.documentElement;
      const viewport = window.innerHeight;
      const trackH = track.clientHeight;
      const scrollable = doc.scrollHeight - viewport;
      // A page that barely scrolls doesn't need a bar, and a thumb filling the
      // whole track would say nothing anyway. Hidden by style rather than by
      // unmounting, so this stays a render-free component.
      const usable = scrollable >= 40 && trackH >= MIN_THUMB * 2;
      geom.current = {
        track: trackH,
        thumb: Math.max(MIN_THUMB, Math.round((viewport / doc.scrollHeight) * trackH)),
        scrollable,
        usable,
      };
      track.style.opacity = usable ? "1" : "0";
      track.style.pointerEvents = usable ? "auto" : "none";
      if (usable) thumb.style.height = `${geom.current.thumb}px`;
    };

    const paint = () => {
      const { track: trackH, thumb: thumbH, scrollable, usable } = geom.current;
      if (!usable) return;
      const progress = Math.min(1, Math.max(0, document.documentElement.scrollTop / scrollable));
      thumb.style.transform = `translateY(${progress * (trackH - thumbH)}px)`;
    };

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        paint();
      });
    };
    const onResize = () => {
      measure();
      paint();
    };

    onResize();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    // Pages here fill in after their data arrives, which changes the page
    // height without any scrolling at all.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    ro?.observe(document.body);

    // Dragging is handled on the window, not on the thumb: once you have
    // grabbed it the pointer may leave the 10px-wide bar, and the drag has to
    // keep going.
    const scrollToThumbTop = (top) => {
      const { track: trackH, thumb: thumbH, scrollable } = geom.current;
      const range = trackH - thumbH;
      if (range <= 0) return;
      const progress = Math.min(1, Math.max(0, top / range));
      window.scrollTo({ top: progress * scrollable, behavior: "auto" });
    };
    const onMove = (e) => {
      if (!dragging.current) return;
      const rect = track.getBoundingClientRect();
      scrollToThumbTop(e.clientY - rect.top - grabOffset.current);
    };
    const stopDrag = () => {
      if (!dragging.current) return;
      dragging.current = false;
      thumb.dataset.dragging = "false";
      document.body.style.userSelect = "";
    };
    const onThumbDown = (e) => {
      e.stopPropagation(); // not a track press — this is a grab
      dragging.current = true;
      thumb.dataset.dragging = "true";
      grabOffset.current = e.clientY - thumb.getBoundingClientRect().top;
      // While dragging, the page must not select text under the cursor.
      document.body.style.userSelect = "none";
    };
    const onTrackDown = (e) => {
      scrollToThumbTop(e.clientY - track.getBoundingClientRect().top - geom.current.thumb / 2);
    };

    thumb.addEventListener("pointerdown", onThumbDown);
    track.addEventListener("pointerdown", onTrackDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      thumb.removeEventListener("pointerdown", onThumbDown);
      track.removeEventListener("pointerdown", onTrackDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
      document.body.style.userSelect = "";
    };
  }, []);

  return (
    // Edge to edge: top of the window to the bottom, over the nav rather than
    // starting below it, so the thumb's position maps to the whole page.
    <div
      ref={trackRef}
      style={{ opacity: 0 }}
      className="group fixed inset-y-0 right-1.5 z-chrome hidden w-2.5 cursor-pointer touch-none transition-opacity sm:block"
      aria-hidden="true"
    >
      <div
        ref={thumbRef}
        // will-change keeps the thumb on its own layer, so moving it never asks
        // the page behind it to repaint.
        className="w-full rounded-full bg-border transition-colors will-change-transform group-hover:bg-light data-[dragging=true]:bg-medium"
        data-dragging="false"
      />
    </div>
  );
}
