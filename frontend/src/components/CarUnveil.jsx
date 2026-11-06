import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client.js";
import "./carUnveil.css";

// ---------------------------------------------------------------------------
// The season's car under a cover, and the moment the cover comes off.
//
// An admin uploads the car and puts it under the cover (Seasons tab). Until
// they press "Unveil now" the site hands out no picture at all, only the cover
// (backend lib/carUnveil.js). A page showing the cover asks every few seconds
// whether it is still on; the first answer without it plays the reveal over
// the whole screen, so everyone watching the briefing sees it at once.
//
// Who sees the reveal:
//   - everyone who had the cover on screen when the car was unveiled
//   - whoever opens the page in the first 15 minutes after it, once per browser
//   - anyone with ?unveil=replay in the address, after the unveil
//   - an admin's preview from the Seasons tab, before anything is unveiled
// ---------------------------------------------------------------------------

const POLL_MS = 5000;
const LATE_WINDOW_MS = 15 * 60 * 1000;
const SEEN_PREFIX = "nabs_unveil_seen:";

// One reveal on screen at a time, however many panels on the page carry the car.
let overlayOpen = false;

function seenKey(series, number) {
  return `${SEEN_PREFIX}${series || ""}:${number}`;
}
function hasSeen(series, number, unveiledAt) {
  try {
    return localStorage.getItem(seenKey(series, number)) === String(unveiledAt);
  } catch {
    return false;
  }
}
function markSeen(series, number, unveiledAt) {
  try {
    localStorage.setItem(seenKey(series, number), String(unveiledAt));
  } catch {
    // A private window: the reveal may just play again next visit.
  }
}

// The car's state on a page: covered or not, its picture once unveiled, and
// the reveal to render while it plays.
export function useCarUnveil({ series, number, name, game, covered, unveiledAt, carImageUrl }) {
  const [state, setState] = useState({ covered: !!covered, unveiledAt: unveiledAt || null, url: carImageUrl || null });
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setState({ covered: !!covered, unveiledAt: unveiledAt || null, url: carImageUrl || null });
  }, [series, number, covered, unveiledAt, carImageUrl]);

  const play = useCallback(() => {
    if (overlayOpen) return;
    overlayOpen = true;
    setPlaying(true);
  }, []);

  // While the cover is on, keep asking. Not while the tab is in the background:
  // the next look when it comes back is soon enough.
  useEffect(() => {
    if (!state.covered || number == null) return undefined;
    let stopped = false;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await api.carUnveilState(series, number);
        if (stopped || !r || r.covered) return;
        setState({ covered: false, unveiledAt: r.unveiledAt || null, url: r.carImageUrl || null });
        if (r.carImageUrl) play();
      } catch {
        // The next tick tries again.
      }
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [state.covered, series, number, play]);

  // Arriving just after the unveil, or with ?unveil=replay.
  useEffect(() => {
    if (state.covered || !state.unveiledAt || !state.url) return;
    const replay = new URLSearchParams(window.location.search).get("unveil") === "replay";
    const fresh = Date.now() - Date.parse(state.unveiledAt) < LATE_WINDOW_MS;
    if (replay || (fresh && !hasSeen(series, number, state.unveiledAt))) play();
  }, [state.covered, state.unveiledAt, state.url, series, number, play]);

  const close = useCallback(() => {
    overlayOpen = false;
    setPlaying(false);
    if (state.unveiledAt) markSeen(series, number, state.unveiledAt);
  }, [series, number, state.unveiledAt]);

  const overlay =
    playing && state.url ? (
      <UnveilShow src={state.url} number={number} name={name} game={game} onClose={close} />
    ) : null;

  return { covered: state.covered, url: state.url, overlay };
}

// The car under a fitted cover: a low racing car's outline drawn as cloth,
// with the bulges of the wheels, the cockpit, the airbox and the rear wing,
// and the hem lying on the floor. Drawn rather than a photo, so the cover
// gives nothing away about the car under it.
export function CoveredCar({ number, className = "", lifting = false }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 800 300"
      className={`car-cover ${lifting ? "car-cover-lift" : ""} ${className}`}
      role="img"
      aria-label="The new car, under a cover"
    >
      <defs>
        <linearGradient id={`cloth-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a4f60" />
          <stop offset="0.45" stopColor="#262a36" />
          <stop offset="1" stopColor="#0d0f15" />
        </linearGradient>
        <radialGradient id={`sheen-${uid}`} cx="0.55" cy="0.2" r="0.6">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`floor-${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.75" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`clip-${uid}`}>
          <path d={CLOTH} />
        </clipPath>
      </defs>
      <ellipse cx="410" cy="256" rx="400" ry="22" fill={`url(#floor-${uid})`} />
      <g className="car-cover-cloth">
        <path d={CLOTH} fill={`url(#cloth-${uid})`} />
        <g clipPath={`url(#clip-${uid})`}>
          <rect x="0" y="0" width="800" height="300" fill={`url(#sheen-${uid})`} className="car-cover-sheen" />
          {FOLDS.map((d, i) => (
            <path key={i} d={d} className="car-cover-fold" />
          ))}
          {FOLDS.map((d, i) => (
            <path key={`s${i}`} d={d} className="car-cover-fold-shade" transform="translate(7 2)" />
          ))}
          {number != null && (
            <text x="520" y="238" className="car-cover-number" textAnchor="middle" transform="skewX(-10)">
              {number}
            </text>
          )}
        </g>
        <path d={CLOTH} className="car-cover-edge" />
      </g>
    </svg>
  );
}

const CLOTH =
  "M 28 252 C 28 240 34 232 48 230 L 104 228 C 116 228 122 232 132 228 " +
  "C 140 200 158 186 190 186 C 222 186 238 200 244 214 C 262 210 290 206 318 202 " +
  "C 350 198 380 190 404 184 C 418 166 440 160 458 166 C 466 150 482 142 498 146 " +
  "C 512 150 520 170 540 182 C 556 186 566 188 574 194 C 584 176 604 170 624 170 " +
  "C 650 170 664 180 670 194 C 680 186 688 168 694 150 L 764 146 C 770 150 772 200 776 252 " +
  "C 730 258 690 248 640 255 C 590 261 540 249 480 256 C 420 262 360 249 300 256 " +
  "C 240 262 180 249 120 256 C 80 259 50 250 28 252 Z";

// Where the cloth falls from the high points to the floor.
const FOLDS = [
  "M 190 188 C 188 210 186 232 184 254",
  "M 228 194 C 232 214 236 236 240 256",
  "M 330 204 C 328 222 325 240 322 256",
  "M 452 166 C 446 196 438 226 430 258",
  "M 498 148 C 494 186 490 222 486 258",
  "M 624 172 C 622 202 620 230 618 258",
  "M 660 182 C 664 208 668 234 672 256",
  "M 722 148 C 720 186 718 222 716 256",
  "M 748 148 C 748 186 748 222 750 256",
];

// The reveal, over the whole screen: the covered car under a spotlight, a
// short count, the cover pulled off, a flash, and the car with the season's
// name. It stays until it is closed, so it can be held on a shared screen.
export function UnveilShow({ src, number, name, game, onClose }) {
  const [phase, setPhase] = useState("dark"); // dark -> count -> pull -> car -> done
  const [count, setCount] = useState(3);
  const [carReady, setCarReady] = useState(false);
  const closeRef = useRef(null);
  const reduce =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Load the picture before the cover comes off, so the reveal never pulls the
  // cover away from an empty floor.
  useEffect(() => {
    const img = new Image();
    img.onload = () => setCarReady(true);
    img.onerror = () => setCarReady(true);
    img.src = src;
  }, [src]);

  useEffect(() => {
    if (!carReady) return undefined;
    if (reduce) {
      setPhase("car");
      const t = setTimeout(() => setPhase("done"), 1200);
      return () => clearTimeout(t);
    }
    const timers = [
      setTimeout(() => setPhase("count"), 1200),
      setTimeout(() => setCount(2), 2000),
      setTimeout(() => setCount(1), 2800),
      setTimeout(() => setPhase("pull"), 3600),
      setTimeout(() => setPhase("car"), 4500),
      setTimeout(() => setPhase("done"), 6200),
    ];
    return () => timers.forEach(clearTimeout);
  }, [carReady, reduce]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    if (phase === "done") closeRef.current?.focus();
  }, [phase]);

  const title = name && /^\d+$/.test(String(name).trim()) ? `Season ${name}` : name || (number != null ? `Season ${number}` : "The new car");
  const shown = phase === "car" || phase === "done";
  const pulling = phase === "pull" || shown;

  return createPortal(
    <div className={`unveil is-${phase}`} role="dialog" aria-modal="true" aria-label={`${title}: the new car`}>
      <div className="unveil-spot" />
      <div className="unveil-top">
        <span className="unveil-eyebrow">NABS Racing League</span>
        <span className="unveil-sub">{title} · the new car</span>
      </div>

      <div className="unveil-stage">
        <img src={src} alt={`The ${title} car`} className={`unveil-car ${shown ? "unveil-car-on" : pulling ? "unveil-car-under" : ""}`} />
        {!(reduce && shown) && <CoveredCar number={number} className="unveil-cover" lifting={pulling && !reduce} />}
        {phase === "count" && (
          <div className="unveil-count" key={count} aria-live="polite">
            {count}
          </div>
        )}
      </div>

      <div className={`unveil-flash ${phase === "car" && !reduce ? "unveil-flash-on" : ""}`} />

      <div className={`unveil-title ${shown ? "unveil-title-on" : ""}`}>
        <div className="unveil-name">{title}</div>
        {game && <div className="unveil-game">{game}</div>}
      </div>

      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className={`unveil-close ${phase === "done" ? "unveil-close-on" : ""}`}
      >
        Close
      </button>
    </div>,
    document.body
  );
}
