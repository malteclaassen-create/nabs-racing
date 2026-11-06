import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, getToken } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";
import "./carUnveil.css";

// ---------------------------------------------------------------------------
// The season's car under its cover, a countdown to the briefing, the reveal
// and the film after it.
//
// How it goes on the night:
//   1. The car waits under its cover: the league's own picture of it under the
//      foil where one was uploaded, else a drawn one. The site hands out no
//      picture of the car itself (backend lib/carUnveil.js).
//   2. Pages count down to the set time on the server's clock. At zero nothing
//      happens by itself: they say "Season reveal soon".
//   3. An admin presents the car (on the countdown screen itself, or in the
//      Seasons tab). Every open page plays the reveal within seconds.
//   4. An admin releases the film. Every open page plays it.
//
// The countdown screen opens from "Watch the unveil" on the home page, or a
// link with ?unveil=watch. Late arrivals (15 minutes) see the reveal once;
// ?unveil=replay plays it again after the unveil.
// ---------------------------------------------------------------------------

const POLL_MS = 5000;
const LATE_WINDOW_MS = 15 * 60 * 1000;
const SEEN_PREFIX = "nabs_unveil_seen:";

// One unveil screen at a time, however many panels on the page carry the car.
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

const seasonTitle = (name, number) =>
  name && /^\d+$/.test(String(name).trim()) ? `Season ${name}` : name || (number != null ? `Season ${number}` : "The new car");

// The car's state on a page and the screens to render.
export function useCarUnveil({
  seasonId = null,
  series,
  number,
  name,
  game,
  covered,
  unveiledAt,
  unveilAt,
  serverNow,
  coverUrl,
  carImageUrl,
  hasFilm,
  filmAt,
  carVideoUrl,
}) {
  const initial = () => ({
    covered: !!covered,
    unveiledAt: unveiledAt || null,
    unveilAt: unveilAt || null,
    coverUrl: coverUrl || null,
    url: carImageUrl || null,
    hasFilm: !!hasFilm,
    filmAt: filmAt || null,
    video: carVideoUrl || null,
  });
  const [state, setState] = useState(initial);
  // Server clock minus this device's clock, so every page counts to the same
  // moment however wrong the device's clock is.
  const [offset, setOffset] = useState(() => (serverNow ? Date.parse(serverNow) - Date.now() : 0));
  const [screen, setScreen] = useState(null); // null | "countdown" | "reveal"
  const [mode, setMode] = useState("full"); // how the reveal starts: full | quick | film
  const screenRef = useRef(null);
  screenRef.current = screen;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    setState(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, number, covered, unveiledAt, unveilAt, coverUrl, carImageUrl, hasFilm, filmAt, carVideoUrl]);

  const open = useCallback((which, how = "full") => {
    // The countdown turns into the reveal on the same screen; anything else
    // waits for the screen that is up to be closed.
    if (overlayOpen && screenRef.current !== "countdown") return;
    overlayOpen = true;
    setMode(screenRef.current === "countdown" && which === "reveal" ? "quick" : how);
    setScreen(which);
  }, []);

  const apply = useCallback(
    (r) => {
      if (!r) return;
      if (r.serverNow) setOffset(Date.parse(r.serverNow) - Date.now());
      const prev = stateRef.current;
      const next = {
        covered: !!r.covered,
        unveiledAt: r.unveiledAt || null,
        unveilAt: r.unveilAt || null,
        coverUrl: r.coverUrl || null,
        url: r.carImageUrl || null,
        hasFilm: !!r.hasFilm,
        filmAt: r.filmAt || null,
        video: r.carVideoUrl || null,
      };
      setState(next);
      // The cover just came off: the reveal.
      if (prev.covered && !next.covered && next.url) open("reveal");
      // The film was just released and no screen is up: the film, straight away.
      else if (!prev.filmAt && next.filmAt && next.video && screenRef.current == null) open("reveal", "film");
    },
    [open]
  );

  // Keep asking while the cover is on, and after it while a film waits for
  // its release: right away (for the server's clock), then every few seconds.
  const listening = state.covered || (state.hasFilm && !state.filmAt);
  useEffect(() => {
    if (!listening || number == null) return undefined;
    let stopped = false;
    let busy = false;
    const ask = async () => {
      if (busy || stopped) return;
      if (typeof document !== "undefined" && document.hidden && screenRef.current == null) return;
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
    ask();
    const id = setInterval(ask, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [listening, series, number, apply]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.covered, state.unveiledAt, state.url, series, number]);

  const close = useCallback(() => {
    overlayOpen = false;
    setScreen(null);
    if (stateRef.current.unveiledAt) markSeen(series, number, stateRef.current.unveiledAt);
  }, [series, number]);

  // An admin acting from the screen itself. The answer is applied right away,
  // so the admin's own screen does not wait for the next poll.
  const act = useCallback(
    async (what) => {
      if (!seasonId) return;
      await api.setCarUnveil(seasonId, what);
      const r = await api.carUnveilState(series, number);
      apply(r);
    },
    [seasonId, series, number, apply]
  );

  let overlay = null;
  if (screen === "countdown" && state.covered) {
    overlay = (
      <UnveilCountdown
        target={state.unveilAt ? Date.parse(state.unveilAt) - offset : null}
        number={number}
        name={name}
        coverUrl={state.coverUrl}
        onPresent={seasonId ? () => act("unveiled") : null}
        onClose={close}
      />
    );
  } else if (screen === "reveal" && state.url) {
    overlay = (
      <UnveilShow
        src={state.url}
        video={state.video}
        coverUrl={state.coverUrl}
        number={number}
        name={name}
        game={game}
        start={mode}
        onReleaseFilm={seasonId && state.hasFilm && !state.filmAt ? () => act("film") : null}
        onClose={close}
      />
    );
  }

  return {
    covered: state.covered,
    url: state.url,
    coverUrl: state.coverUrl,
    // The countdown's end on this device's clock (null: no set time).
    unveilTarget: state.unveilAt ? Date.parse(state.unveilAt) - offset : null,
    openCountdown: () => open("countdown"),
    overlay,
  };
}

// Is the person looking an admin? Admin buttons on the unveil screens; the
// server checks again on every call.
function useIsAdmin() {
  const { user } = useAuth();
  return !!user?.isAdmin || !!getToken();
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

// Ticks while mounted; returns now.
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
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

// A button an admin presses twice: the first press asks, the second does it.
// Inline rather than a dialog, so it works the same over a full-screen view.
function AdminButton({ label, sure, onRun }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <span className="unveil-admin-item">
      <button
        type="button"
        disabled={busy}
        className={`unveil-close unveil-close-on unveil-admin-btn ${armed ? "unveil-admin-armed" : ""}`}
        onClick={async () => {
          if (!armed) {
            setArmed(true);
            return;
          }
          setBusy(true);
          setErr(null);
          try {
            await onRun();
          } catch (e) {
            setErr(e.message || "That did not work.");
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        {busy ? "One moment" : armed ? sure : label}
      </button>
      {err && <span className="unveil-admin-err">{err}</span>}
    </span>
  );
}

// What stands for the car while it is covered: the league's photo of it under
// the foil, or the drawn cover.
export function CoverVisual({ coverUrl, number, className = "", lifting = false, fill = false }) {
  if (coverUrl) {
    return (
      <img
        src={coverUrl}
        alt="The new car, under its cover"
        className={`car-cover-photo ${fill ? "car-cover-photo-fill" : ""} ${lifting ? "car-cover-photo-lift" : ""} ${className}`}
      />
    );
  }
  return <CoveredCar number={number} className={className} lifting={lifting} />;
}

// The countdown screen: the covered car under a spotlight and a big clock to
// the briefing. At zero it says the reveal is coming; it turns into the reveal
// the moment an admin presents the car.
export function UnveilCountdown({ target, number, name, coverUrl, onPresent, onClose }) {
  const now = useNow(true);
  const isAdmin = useIsAdmin();
  const left = target == null ? null : target - now;
  const last = left != null && left <= 10000 && left > 0;
  const title = seasonTitle(name, number);
  useOverlayChrome(onClose);

  const fullScreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return createPortal(
    <div className="unveil is-wait" role="dialog" aria-modal="true" aria-label={`${title}: countdown to the new car`}>
      <div className="unveil-spot" />
      <div className="unveil-top">
        <span className="unveil-eyebrow">NABS Racing League</span>
        <span className="unveil-sub">{title} · the new car</span>
      </div>
      <div className="unveil-stage">
        <CoverVisual coverUrl={coverUrl} number={number} className="unveil-cover" />
      </div>
      <div className="unveil-clock-wrap">
        {left != null && left > 0 ? (
          <>
            <div className="unveil-clock-label">Unveiled in</div>
            <div className={`unveil-clock ${last ? "unveil-clock-last" : ""}`} key={last ? Math.ceil(left / 1000) : "clock"}>
              {last ? Math.ceil(left / 1000) : fmtCountdown(left)}
            </div>
            <div className="unveil-clock-when">
              {new Date(target).toLocaleString(undefined, { weekday: "long", hour: "2-digit", minute: "2-digit" })}
            </div>
          </>
        ) : (
          <div className="unveil-soon">{left == null ? "Unveiled at the briefing" : "Season reveal soon"}</div>
        )}
      </div>
      <div className="unveil-actions">
        <button type="button" onClick={fullScreen} className="unveil-close unveil-close-on">Full screen</button>
        <button type="button" onClick={onClose} className="unveil-close unveil-close-on">Close</button>
      </div>
      {isAdmin && onPresent && (
        <div className="unveil-admin">
          <span className="unveil-admin-label">Admin</span>
          <AdminButton label="Present the car" sure="Press again to confirm" onRun={onPresent} />
        </div>
      )}
    </div>,
    document.body
  );
}

// The drawn cover, for when no photo of the covered car was uploaded.
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
//   start "full":  with its own 3-2-1
//   start "quick": straight from the countdown screen, without the count
//   start "film":  the car is already out and the film was just released
// The film plays once it is released (`video` arrives); the admin preview
// passes it in from the start and gets the whole evening in one go.
export function UnveilShow({ src, video = null, coverUrl = null, number, name, game, start = "full", onReleaseFilm = null, onClose }) {
  // dark -> count -> pull -> car -> done -> film -> after
  const [phase, setPhase] = useState(start === "quick" ? "pull" : start === "film" ? "done" : "dark");
  const [count, setCount] = useState(3);
  const [carReady, setCarReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const closeRef = useRef(null);
  const filmRef = useRef(null);
  const isAdmin = useIsAdmin();
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
    if (!carReady || start === "film") return undefined;
    const steps = reduce
      ? [[0, "car"], [1200, "done"]]
      : start === "quick"
        ? [[150, "pull"], [1050, "car"], [2750, "done"]]
        : [[1200, "count"], [3600, "pull"], [4500, "car"], [6200, "done"]];
    const timers = steps.map(([ms, p]) => setTimeout(() => setPhase(p), ms));
    if (!reduce && start === "full") {
      timers.push(setTimeout(() => setCount(2), 2000), setTimeout(() => setCount(1), 2800));
    }
    return () => timers.forEach(clearTimeout);
  }, [carReady, reduce, start]);

  // The film: a few seconds after the car is out when it was there from the
  // start, at once when it is released while the car is on screen.
  const hadVideo = useRef(!!video);
  useEffect(() => {
    if (!video) return undefined;
    if (phase === "done" || (phase === "after" && !hadVideo.current)) {
      const wait = start === "film" || !hadVideo.current ? 300 : 3500;
      const t = setTimeout(() => {
        hadVideo.current = true;
        setPhase("film");
      }, wait);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase, video, start]);

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
          <CoverVisual coverUrl={coverUrl} number={number} className="unveil-cover" lifting={pulling && !reduce} />
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

      {isAdmin && onReleaseFilm && !video && (phase === "done" || phase === "after") && (
        <div className="unveil-admin">
          <span className="unveil-admin-label">Admin</span>
          <AdminButton label="Play the film for everyone" sure="Press again to confirm" onRun={onReleaseFilm} />
        </div>
      )}

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
