import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useSeries } from "../context/SeriesContext.jsx";
import { useDismiss, useFocusTrap, useScrollLock } from "./overlay.jsx";
import Flag from "./Flag.jsx";
import { flagFor } from "../data/circuits.js";
import { raceKickoff, racePhase, fmtRaceTime } from "../utils/raceTime.js";
import { deriveSeriesAccent, DEFAULT_THEME_COLOR } from "../utils/seriesColor.js";

// ---------------------------------------------------------------------------
// The promo page of a special event: the whole screen, the event's film behind
// it, and everything a driver wants to know before signing up. It stands in
// front of the site rather than replacing a page, so whatever was asked for is
// right there once it is closed.
//
// When it shows (PromoHost below):
//   - an admin switched it on for the series (Series.promoAt), the series is
//     public, its event is not over, and this browser has not closed this
//     promo yet. Switching it off and on again counts as a new promo.
//   - or the address carries ?promo=<slug>: the admin's preview (works for a
//     private series too, for whoever may see it) and a link to share.
// Never over the admin area, a login callback or the race-control desk.
// ---------------------------------------------------------------------------

const SEEN_PREFIX = "nabs_promo_seen:";
const NO_PROMO_PATHS = /^\/(admin|auth|race-control)/;

function seenPromo(series) {
  try {
    return localStorage.getItem(SEEN_PREFIX + series.id) === series.promoAt;
  } catch {
    return false;
  }
}
function markPromoSeen(series) {
  try {
    if (series.promoAt) localStorage.setItem(SEEN_PREFIX + series.id, series.promoAt);
  } catch {
    /* private mode: it simply shows again next visit */
  }
}

// An event counts as over a day after its race (the same grace the switcher
// and the server give it).
function eventOver(series, now = Date.now()) {
  const t = series.eventAt ? new Date(series.eventAt).getTime() : NaN;
  return Number.isFinite(t) && t < now - 24 * 3600e3;
}

export default function PromoHost() {
  const { seriesList, loaded } = useSeries();
  const location = useLocation();
  const navigate = useNavigate();
  const [closed, setClosed] = useState(() => new Set());

  const asked = new URLSearchParams(location.search).get("promo");
  let show = null;
  if (loaded && !NO_PROMO_PATHS.test(location.pathname)) {
    if (asked) {
      show = seriesList.find((s) => s.slug === asked) || null;
    } else {
      show =
        seriesList.find(
          (s) => s.promoAt && s.isPublic !== false && !eventOver(s) && !closed.has(s.id) && !seenPromo(s)
        ) || null;
    }
  }

  const close = useCallback(
    (series) => {
      markPromoSeen(series);
      setClosed((c) => new Set(c).add(series.id));
      // Drop the ?promo= so closing a preview does not reopen it.
      const params = new URLSearchParams(location.search);
      if (params.has("promo")) {
        params.delete("promo");
        const q = params.toString();
        navigate({ pathname: location.pathname, search: q ? `?${q}` : "" }, { replace: true });
      }
    },
    [location.pathname, location.search, navigate]
  );

  if (!show || (asked && closed.has(show.id))) return null;
  return (
    <EventPromo
      key={show.id}
      slug={show.slug}
      onClose={() => close(show)}
      // Not closed by anybody, so not "seen": it comes back once it can load.
      onUnavailable={() => setClosed((c) => new Set(c).add(show.id))}
    />
  );
}

// Days / hours / minutes / seconds to kickoff, ticking.
function useCountdown(date) {
  const target = raceKickoff(date)?.getTime() ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target == null) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (target == null || target <= now) return null;
  const s = Math.floor((target - now) / 1000);
  return { days: Math.floor(s / 86400), hours: Math.floor(s / 3600) % 24, minutes: Math.floor(s / 60) % 60, seconds: s % 60 };
}

const pad2 = (n) => String(n).padStart(2, "0");

// Each browser has its own way of telling; one that has none says yes, so the
// button is never hidden from a film that might have sound.
function filmHasAudio(v) {
  if (!v) return false;
  if (typeof v.mozHasAudio === "boolean") return v.mozHasAudio;
  if (typeof v.webkitAudioDecodedByteCount === "number") return v.webkitAudioDecodedByteCount > 0;
  if (v.audioTracks) return v.audioTracks.length > 0;
  return true;
}

function EventPromo({ slug, onClose, onUnavailable }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const videoRef = useRef(null);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [sound, setSound] = useState(false);
  const [filmReady, setFilmReady] = useState(false);
  // Whether the film has a sound track at all (null until it has played a
  // moment): a sound button on a silent film would do nothing.
  const [hasAudio, setHasAudio] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .seriesPromo(slug)
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [slug]);

  // Tells the event page's film (components/EventFilm.jsx, utils/promoOpen.js)
  // to wait until this is closed. A layout effect, so it is set before the
  // card can start playing.
  useLayoutEffect(() => {
    document.documentElement.dataset.promo = "open";
    window.dispatchEvent(new Event("nabs-promo"));
    return () => {
      delete document.documentElement.dataset.promo;
      window.dispatchEvent(new Event("nabs-promo"));
    };
  }, []);

  useScrollLock(true);
  useFocusTrap(true, panelRef, { initialFocus: closeRef });
  useDismiss(true, onClose, { outside: false });

  const series = data?.series;
  const race = data?.race;
  const countdown = useCountdown(race?.date);

  // Nothing to promote (the series went away, or its season is still private
  // for this visitor): step aside rather than show an empty screen.
  useEffect(() => {
    if (failed) onUnavailable();
  }, [failed, onUnavailable]);

  const accent = series?.accentColor || DEFAULT_THEME_COLOR;
  const onAccent = deriveSeriesAccent(accent)?.onBrand || "#0f172a";
  const flag = race ? flagFor(race.track, race.country) : null;
  const kickoff = race ? raceKickoff(race.date) : null;
  const phase = race ? racePhase(race.date) : null;
  const poster = data?.heroImageUrl || data?.carImageUrl || null;
  const film = series?.promoVideoUrl || null;

  const facts = race
    ? [
        race.raceLaps && { label: "Laps", value: race.raceLaps },
        race.raceFormat === "SPRINT_FEATURE" && race.sprintLaps && { label: "Sprint", value: `${race.sprintLaps} laps` },
        race.qualiMinutes && { label: "Qualifying", value: `${race.qualiMinutes} min` },
        race.capacity && { label: "Grid", value: `${race.capacity} cars` },
        race.game && { label: "Car", value: race.game },
      ].filter(Boolean)
    : [];

  function toggleSound() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = sound;
    if (!sound) v.play().catch(() => {});
    setSound(!sound);
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={series ? `${series.name}, special event` : "Special event"}
      tabIndex={-1}
      className="promo-in fixed inset-0 z-overlay overflow-y-auto bg-black text-white"
      style={{ "--promo": accent, "--promo-on": onAccent }}
    >
      {/* Backdrop: the film, else the season's picture, else the accent glow. */}
      <div className="pointer-events-none fixed inset-0">
        {poster && <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />}
        {film && (
          <video
            ref={videoRef}
            src={film}
            poster={poster || undefined}
            autoPlay
            muted
            loop
            playsInline
            onPlaying={() => {
              setFilmReady(true);
              if (hasAudio === null) setTimeout(() => setHasAudio(filmHasAudio(videoRef.current)), 1500);
            }}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
              filmReady ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
        {!poster && !film && (
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(ellipse at 70% 30%, color-mix(in srgb, var(--promo) 45%, transparent), transparent 65%)" }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/25 to-transparent" />
      </div>

      {/* Top bar: who is talking, and the way out. */}
      <div className="relative flex items-center justify-between gap-4 px-5 pt-5 sm:px-10 sm:pt-8">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: "var(--promo)" }}>
          ★ NABS Special Event
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wider backdrop-blur transition hover:bg-white/20"
        >
          <span className="sm:hidden">Skip</span>
          <span className="hidden sm:inline">Continue to site</span>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="relative mx-auto flex min-h-[calc(100dvh-5rem)] max-w-6xl flex-col justify-end px-5 pb-10 pt-16 sm:px-10 sm:pb-16">
        {!data ? (
          <div className="h-40" aria-busy="true" />
        ) : (
          <div className="max-w-3xl space-y-6">
            {race && (
              <div className="promo-rise flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-white/80 sm:text-sm">
                {flag && <Flag code={flag.country} title={flag.countryName} className="rounded-sm" />}
                <span>{race.track}</span>
                {kickoff && (
                  <>
                    <span className="hidden h-3 w-px bg-white/30 sm:inline-block" />
                    <span>
                      {kickoff.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} ·{" "}
                      {fmtRaceTime(race.date)}
                    </span>
                  </>
                )}
              </div>
            )}

            <h1
              className="promo-rise font-display text-5xl font-black uppercase leading-[0.9] tracking-tight sm:text-7xl lg:text-8xl"
              style={{ animationDelay: "80ms" }}
            >
              {series.name}
            </h1>

            {series.description && (
              <p className="promo-rise max-w-2xl text-base text-white/85 sm:text-lg" style={{ animationDelay: "160ms" }}>
                {series.description}
              </p>
            )}

            {countdown ? (
              <div className="promo-rise flex gap-2 sm:gap-3" style={{ animationDelay: "240ms" }} aria-label="Time to lights out">
                {[
                  ["Days", countdown.days],
                  ["Hrs", countdown.hours],
                  ["Min", countdown.minutes],
                  ["Sec", countdown.seconds],
                ].map(([label, n]) => (
                  <div key={label} className="w-16 rounded-xl bg-white/10 px-2 py-2 text-center backdrop-blur sm:w-20">
                    <div className="font-mono text-2xl font-bold tabular-nums sm:text-3xl">{pad2(n)}</div>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-white/60">{label}</div>
                  </div>
                ))}
              </div>
            ) : (
              phase === "live" && (
                <div
                  className="promo-rise inline-flex rounded-full px-4 py-2 font-mono text-xs font-bold uppercase tracking-widest"
                  style={{ background: "var(--promo)", color: "var(--promo-on)" }}
                >
                  Lights out · racing now
                </div>
              )
            )}

            {facts.length > 0 && (
              <dl className="promo-rise flex flex-wrap gap-x-8 gap-y-3" style={{ animationDelay: "320ms" }}>
                {facts.map((f) => (
                  <div key={f.label}>
                    <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--promo)" }}>
                      {f.label}
                    </dt>
                    <dd className="font-display text-xl font-bold uppercase tracking-tight">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="promo-rise flex flex-wrap gap-3 pt-2" style={{ animationDelay: "400ms" }}>
              <Link
                to={`/s/${series.slug}/attendance`}
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-xl px-6 py-3.5 text-sm font-bold uppercase tracking-wide transition hover:brightness-110"
                style={{ background: "var(--promo)", color: "var(--promo-on)" }}
              >
                Sign up
              </Link>
              <Link
                to={`/s/${series.slug}`}
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-xl border border-white/30 px-6 py-3.5 text-sm font-bold uppercase tracking-wide transition hover:bg-white/10"
              >
                Event page
              </Link>
            </div>
          </div>
        )}
      </div>

      {film && hasAudio && (
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={sound}
          aria-label={sound ? "Mute the film" : "Play the film with sound"}
          className="fixed bottom-5 right-5 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20 sm:bottom-8 sm:right-8"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="M22 9l-6 6M16 9l6 6" />}
          </svg>
        </button>
      )}
    </div>
  );
}
