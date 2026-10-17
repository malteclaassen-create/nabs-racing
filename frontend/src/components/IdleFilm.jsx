import { useEffect, useRef, useState } from "react";

// The promo film inside a main card (see hooks/useIdleFilm.js). Not even
// mounted until the card first goes idle, so a visitor who never stops
// scrolling never downloads it. Muted and looped: it is a moving picture, not
// something to watch with sound (the promo page has the sound button). Fades
// in on its first real frame and out again the moment anybody moves, then
// pauses, so a card in the background costs nothing.
export default function IdleFilm({ film, className = "" }) {
  const ref = useRef(null);
  const [mounted, setMounted] = useState(false);
  const { active, setPlaying } = film;

  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    if (active) {
      v.muted = true; // the property, which is what autoplay rules look at
      v.play().catch(() => setPlaying(false));
      return undefined;
    }
    setPlaying(false);
    const t = setTimeout(() => v.pause(), 800);
    return () => clearTimeout(t);
  }, [active, mounted, setPlaying]);

  if (!mounted || !film.src) return null;
  return (
    <video
      ref={ref}
      src={film.src}
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
      onPlaying={() => setPlaying(true)}
      className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
        film.showing ? "opacity-100" : "opacity-0"
      } ${className}`}
    />
  );
}
