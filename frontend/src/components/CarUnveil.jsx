import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client.js";
import "./carUnveil.css";

// ---------------------------------------------------------------------------
// The season's car under a cover, a countdown to the moment the cover comes
// off, the reveal, and the film after it.
//
// The admin can set the time the cover comes off by itself (the start of the
// briefing). Every page counts down to it on the server's clock, and the
// countdown screen ("Watch the unveil", or a link with ?unveil=watch) shows a
// big clock over the covered car that turns into the reveal at zero. After the
// car is out, the film plays, if one was uploaded.
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

// The car's state on a page: covered or not, when the cover comes off, its
// picture and film once unveiled, and the screens (countdown, reveal) to render.
export function useCarUnveil({
  series,
  number,
  name,
  game,
  covered,
  unveiledAt,
  unveilAt,
  serverNow,
  carImageUrl,
  carVideoUrl,
}) {
  const initial = () => ({
    covered: !!covered,
    unveiledAt: unveiledAt || null,
    unveilAt: unveilAt || null,
    url: carImageUrl || null,
    video: carVideoUrl || null,
  });
  const [state, setState] = useState(initial);
  // Server clock minus this device's clock, so every page counts to the same
  // moment however wrong the device's clock is.
  const [offset, setOffset] = useState(() => (serverNow ? Date.parse(serverNow) - Date.now() : 0));
  const [screen, setScreen] = useState(null); // null | "countdown" | "reveal"
  const [fromCountdown, setFromCountdown] = useState(false);
  const screenRef = useRef(null);
  screenRef.current = screen;

  useEffect(() => {
    setState(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, number, covered, unveiledAt, unveilAt, carImageUrl, carVideoUrl]);

  const open = useCallback((which) => {
    // The countdown turns into the reveal on the same screen; anything else
    // waits for the screen that is up to be closed.
    if (overlayOpen && screenRef.current !== "countdown") return;
    overlayOpen = true;
    setFromCountdown(screenRef.current === "countdown" && which === "reveal");
    setScreen(which);
  }, []);

  const apply = useCallback(
    (r) => {
      if (!r) return;
      if (r.serverNow) setOffset(Date.parse(r.serverNow) - Date.now());
      if (r.covered) {
        setState((s) => ({ ...s, unveilAt: r.unveilAt || null }));
        return;
      }
      setState({
        covered: false,
        unveiledAt: r.unveiledAt || null,
        unveilAt: null,
        url: r.carImageUrl || null,
        video: r.carVideoUrl || null,
      });
      if (r.carImageUrl) open("reveal");
    },
    [open]
  );

  // While the cover is on, keep asking: right away (for the server's clock),
  // then every few seconds, and every second once the set time has come.
  useEffect(() => {
    if (!state.covered || number == null) return undefined;
    let stopped = false;
    let busy = false;
    const ask = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        const r = await api.carUnveilState(series, number);
        if (!stopped) apply(r);
      } catch {
        // The next tick tries again.
      } finally {
        busy = false;
      }
    };
    let last = 0;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden && screenRef.current == null) return;
      const due = state.unveilAt && Date.now() + offset >= Date.parse(state.unveilAt) - 500;
      if (due || Date.now() - last >= POLL_MS) {
        last = Date.now();
        ask();
      }
    };
    ask();
    last = Date.now();
    const id = setInterval(tick, 1000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [state.covered, state.unveilAt, offset, series, number, apply]);

  // A link with ?unveil=watch opens the countdown (or, once the car is out,
  // plays the reveal); arriving just after the unveil plays it once.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("unveil");
    if (state.covered) {
      if (param === "watch") open("countdown");
      return;
    }
    if (!state.unveiledAt || !state.url) return;
    const fresh = Date.now() - Date.parse(state.unveiledAt) < LATE_WINDOW_MS;
    if (param === "replay" || param === "watch" || (fresh && !hasSeen(series, number, state.unveiledAt))) open("reveal");
  }, [state.covered, state.unveiledAt, state.url, series, number, open]);

  const close = useCallback(() => {
    overlayOpen = false;
    setScreen(null);
    if (state.unveiledAt) markSeen(series, number, state.unveiledAt);
  }, [series, number, state.unveiledAt]);

  let overlay = null;
  if (screen === "countdown" && state.covered) {
    overlay = (
      <UnveilCountdown
        target={state.unveilAt ? Date.parse(state.unveilAt) - offset : null}
        number={number}
        name={name}
        onClose={close}
      />
    );
  } else if (screen === "reveal" && state.url) {
    overlay = (
      <UnveilShow
        src={state.url}
        video={state.video}
        number={number}
        name={name}
        game={game}
        quick={fromCountdown}
        onClose={close}
      />
    );
  }

  return {
    covered: state.covered,
    url: state.url,
    // When the cover comes off, on this device's clock (null: no set time).
    unveilTarget: state.unveilAt ? Date.parse(state.unveilAt) - offset : null,
    openCountdown: () => open("countdown"),
    overlay,
  };
}

// "2d 04:12:09", "04:12:09", "12:09".
export function fmtCountdown(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const two = (n) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${two(h)}:${two(m)}:${two(sec)}`;
  if (h > 0) return `${two(h)}:${two(m)}:${two(sec)}`;
  return `${two(m)}:${two(sec)}`;
}

// Ticks once a second while mounted; returns now.
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const seasonTitle = (name, number) =>
  name && /^\d+$/.test(String(name).trim()) ? `Season ${name}` : name || (number != null ? `Season ${number}` : "The new car");

// The countdown screen: the covered car under a spotlight and a big clock to
// the moment the cover comes off. When it comes off, this screen turns into
// the reveal by itself. Without a set time it simply waits for the unveil.
export function UnveilCountdown({ target, number, name, onClose }) {
  const now = useNow(true);
  const left = target == null ? null : target - now;
  const last = left != null && left <= 10000 && left > 0;
  const title = seasonTitle(name, number);
  useOverlayChrome(onClose);

  const fullScreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  return createPortal(
    <div className="unveil is-wait" role="dialog" aria-modal="true" aria-label={`${title}: countdown to the new car`}>
      <div className="unveil-spot" />
      <div className="unveil-top">
        <span className="unveil-eyebrow">NABS Racing League</span>
        <span className="unveil-sub">{title} · the new car</span>
      </div>
      <div className="unveil-stage">
        <CoveredCar number={number} className="unveil-cover" />
      </div>
      <div className="unveil-clock-wrap" aria-live="off">
        <div className="unveil-clock-label">
          {left == null ? "Unveiled during the briefing" : left > 0 ? "Unveiled in" : "Any second now"}
        </div>
        {left != null && left > 0 && (
          <div className={`unveil-clock ${last ? "unveil-clock-last" : ""}`} key={last ? Math.ceil(left / 1000) : "clock"}>
            {last ? Math.ceil(left / 1000) : fmtCountdown(left)}
          </div>
        )}
        {left != null && left > 0 && (
          <div className="unveil-clock-when">
            {new Date(target).toLocaleString(undefined, { weekday: "long", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>
      <div className="unveil-actions">
        <button type="button" onClick={fullScreen} className="unveil-close unveil-close-on">Full screen</button>
        <button type="button" onClick={onClose} className="unveil-close unveil-close-on">Close</button>
      </div>
    </div>,
    document.body
  );
}

// Escape closes, and the page behind does not scroll.
function useOverlayChrome(onClose) {
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
// name; then the film, if there is one. It stays until it is closed, so it can
// be held on a shared screen. `quick` skips the count when the countdown
// screen has just done it.
export function UnveilShow({ src, video = null, number, name, game, quick = false, onClose }) {
  // dark -> count -> pull -> car -> done -> film -> after
  const [phase, setPhase] = useState(quick ? "pull" : "dark");
  const [count, setCount] = useState(3);
  const [carReady, setCarReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const closeRef = useRef(null);
  const filmRef = useRef(null);
  const reduce =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  useOverlayChrome(onClose);

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
    const steps = reduce
      ? [[0, "car"], [1200, "done"]]
      : quick
        ? [[150, "pull"], [1050, "car"], [2750, "done"]]
        : [[1200, "count"], [3600, "pull"], [4500, "car"], [6200, "done"]];
    const timers = steps.map(([ms, p]) => setTimeout(() => setPhase(p), ms));
    if (!reduce && !quick) {
      timers.push(setTimeout(() => setCount(2), 2000), setTimeout(() => setCount(1), 2800));
    }
    return () => timers.forEach(clearTimeout);
  }, [carReady, reduce, quick]);

  // The film follows a few seconds after the car is out.
  useEffect(() => {
    if (phase !== "done" || !video) return undefined;
    const t = setTimeout(() => setPhase("film"), 3500);
    return () => clearTimeout(t);
  }, [phase, video]);

  // Played with sound where the browser lets it, muted where it does not
  // (nobody touched the page yet): then a button turns the sound on.
  useEffect(() => {
    if (phase !== "film") return;
    const el = filmRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.muted = false;
    el.play()
      .then(() => setMuted(false))
      .catch(() => {
        el.muted = true;
        setMuted(true);
        el.play().catch(() => {});
      });
  }, [phase]);

  useEffect(() => {
    if (phase === "done" || phase === "after") closeRef.current?.focus();
  }, [phase]);

  const title = seasonTitle(name, number);
  const shown = ["car", "done", "after"].includes(phase);
  const pulling = phase === "pull" || shown;
  const film = phase === "film";

  return createPortal(
    <div className={`unveil is-${phase}`} role="dialog" aria-modal="true" aria-label={`${title}: the new car`}>
      <div className="unveil-spot" />
      <div className="unveil-top">
        <span className="unveil-eyebrow">NABS Racing League</span>
        <span className="unveil-sub">{title} · the new car</span>
      </div>

      <div className="unveil-stage">
        <img
          src={src}
          alt={`The ${title} car`}
          className={`unveil-car ${shown ? "unveil-car-on" : pulling ? "unveil-car-under" : ""}`}
        />
        {/* Gone for good once the car is out: drawn again later, it would fly off a second time. */}
        {["dark", "count", "pull", "car"].includes(phase) && !(reduce && shown) && (
          <CoveredCar number={number} className="unveil-cover" lifting={pulling && !reduce} />
        )}
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

      <div className="unveil-actions">
        {phase === "after" && video && (
          <button type="button" onClick={() => setPhase("film")} className="unveil-close unveil-close-on">
            Watch the film again
          </button>
        )}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className={`unveil-close ${phase === "done" || phase === "after" ? "unveil-close-on" : ""}`}
        >
          Close
        </button>
      </div>

      {video && (
        <div className={`unveil-film ${film ? "unveil-film-on" : ""}`} aria-hidden={!film}>
          <video
            ref={filmRef}
            src={video}
            playsInline
            preload="auto"
            onEnded={() => setPhase("after")}
            className="unveil-film-video"
          />
          {film && (
            <div className="unveil-film-bar">
              {muted && (
                <button
                  type="button"
                  className="unveil-close unveil-close-on"
                  onClick={() => {
                    const el = filmRef.current;
                    if (el) {
                      el.muted = false;
                      setMuted(false);
                    }
                  }}
                >
                  Sound on
                </button>
              )}
              <button
                type="button"
                className="unveil-close unveil-close-on"
                onClick={() => {
                  filmRef.current?.pause();
                  setPhase("after");
                }}
              >
                Skip
              </button>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
