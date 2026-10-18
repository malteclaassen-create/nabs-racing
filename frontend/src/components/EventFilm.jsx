import { useEffect, useRef, useState } from "react";
import { filmAllowed } from "../hooks/useIdleFilm.js";
import { usePromoOpen } from "../utils/promoOpen.js";

// The main card of a special event's home page: a film IS the card.
//
// With a `loop` (Series.promoLoopUrl) the card simply plays that, muted and
// over and over; the page around it carries the facts. Without one it falls
// back to the promo film, whose last frame carries the event's facts (when,
// where, which car), so that one plays through once and then rests on the
// frame, which stays as the card's picture:
//
//   - Once per browser session and film it plays from the start, as soon as
//     the promo page (if up) is closed. Hopping to the entry list and back
//     shows the resting frame straight away instead of the whole film again.
//   - "Skip" jumps to the resting frame, "Replay" plays it again.
//   - Reduced motion, low-effects mode or Save-Data: no autoplay, the card
//     opens on the resting frame (the facts are what matter).
//   - No film, or one that will not load: `fallback`, a still picture, with
//     whatever the page passes as `children` over it.
//   - `still`: only the resting frame, no playing and no button (the backdrop
//     of the winner's card when the race has no photo of its own).
const SEEN_PREFIX = "nabs_event_film_seen:";
const REST_OFFSET_S = 0.05; // the resting frame, just before the very end

function seenFilm(src) {
  try {
    return sessionStorage.getItem(SEEN_PREFIX + src) === "1";
  } catch {
    return false;
  }
}
function markFilmSeen(src) {
  try {
    sessionStorage.setItem(SEEN_PREFIX + src, "1");
  } catch {
    /* private mode: it simply plays again next time */
  }
}

export default function EventFilm(props) {
  return props.loop && !props.still ? <LoopFilm {...props} /> : <OnceFilm {...props} />;
}

// The loop: muted, round and round. Without moving pictures (reduced motion,
// low-effects mode, Save-Data) its first frame, held.
function LoopFilm({ loop, fallback, alt }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const moving = filmAllowed();
  if (failed) return fallback ? <img src={fallback} alt={alt || ""} className="absolute inset-0 h-full w-full object-cover" /> : null;
  return (
    <>
      {fallback && !ready && <img src={fallback} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <video
        src={loop}
        autoPlay={moving}
        muted
        loop
        playsInline
        preload="auto"
        aria-label={alt}
        onLoadedData={() => setReady(true)}
        onError={() => setFailed(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}
      />
    </>
  );
}

function OnceFilm({ src, fallback, alt, children, still = false }) {
  const ref = useRef(null);
  const promoUp = usePromoOpen();
  const [failed, setFailed] = useState(false);
  // "rest" = parked on the last frame, "playing" = running from the start.
  const [mode, setMode] = useState("rest");
  const [ready, setReady] = useState(false);
  // Whether this card has had its one autoplay already (decided once the film
  // is there: the series list, and with it `src`, may arrive after mount).
  const played = useRef(false);

  const rest = () => {
    const v = ref.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.pause();
    v.currentTime = Math.max(0, v.duration - REST_OFFSET_S);
    setMode("rest");
  };
  const play = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = true; // the property, which is what autoplay rules look at
    v.currentTime = 0;
    setMode("playing");
    v.play().catch(rest);
  };

  // The first visit of the session plays it, once the promo page is out of
  // the way and the film knows its length.
  useEffect(() => {
    if (!ready || promoUp || played.current) return;
    played.current = true;
    if (still || !filmAllowed() || seenFilm(src)) return;
    markFilmSeen(src);
    play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, promoUp, src, still]);

  const showFilm = src && !failed;
  return (
    <>
      {fallback && (!showFilm || !ready) && (
        <img src={fallback} alt={showFilm ? "" : alt || ""} className="absolute inset-0 h-full w-full object-cover" />
      )}
      {showFilm && (
        <video
          ref={ref}
          src={src}
          muted
          playsInline
          preload="auto"
          aria-label={alt}
          onLoadedMetadata={() => {
            // Park on the last frame until (and unless) it is played.
            if (mode === "rest") rest();
            setReady(true);
          }}
          onEnded={() => setMode("rest")}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {!showFilm && children}
      {showFilm && ready && !still && (
        <button
          type="button"
          onClick={mode === "playing" ? rest : play}
          className="absolute right-4 top-4 z-10 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-black/50 px-4 font-mono text-[11px] font-bold uppercase tracking-widest text-white backdrop-blur transition hover:bg-black/70"
        >
          {mode === "playing" ? (
            <>
              Skip
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
                <path d="M5 5l9 7-9 7zM15 5h3v14h-3z" />
              </svg>
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v5h5" />
              </svg>
              Replay
            </>
          )}
        </button>
      )}
    </>
  );
}
