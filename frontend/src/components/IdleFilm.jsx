import { useEffect, useRef, useState } from "react";

// The promo film inside a main card (see hooks/useIdleFilm.js). Not even
// mounted until it is first asked to play, so a visitor who never stops
// scrolling never downloads it. Always muted: it is a moving picture, not
// something to watch with sound (the promo page has the sound button).
//   - intro: played once from the start, with a "Skip intro" button; when it
//     ends the card's HUD comes in over its last frame fading away.
//   - idle: looped; fades in on its first real frame and out again the moment
//     anybody moves, then pauses, so a card in the background costs nothing.
export default function IdleFilm({ film, className = "" }) {
  const ref = useRef(null);
  const [mounted, setMounted] = useState(false);
  const { active, mode, setPlaying } = film;

  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    if (active) {
      v.muted = true; // the property, which is what autoplay rules look at
      if (mode === "intro") v.currentTime = 0;
      v.play().catch(() => setPlaying(false));
      return undefined;
    }
    setPlaying(false);
    const t = setTimeout(() => v.pause(), 800);
    return () => clearTimeout(t);
  }, [active, mode, mounted, setPlaying]);

  if (!mounted || !film.src) return null;
  return (
    <>
      <video
        ref={ref}
        src={film.src}
        muted
        loop={mode === "idle"}
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        onPlaying={() => setPlaying(true)}
        onEnded={film.onEnded}
        className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
          film.showing ? "opacity-100" : "opacity-0"
        } ${className}`}
      />
      {mode === "intro" && film.showing && (
        <button
          type="button"
          onClick={film.skip}
          className="absolute bottom-4 right-4 z-30 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-widest text-white backdrop-blur transition hover:bg-black/65"
        >
          Skip intro
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
            <path d="M5 5l9 7-9 7zM15 5h3v14h-3z" />
          </svg>
        </button>
      )}
    </>
  );
}
