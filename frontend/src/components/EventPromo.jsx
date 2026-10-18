import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useSeries } from "../context/SeriesContext.jsx";
import { useDismiss, useFocusTrap, useScrollLock } from "./overlay.jsx";
import { raceKickoff, racePhase, fmtRaceTime } from "../utils/raceTime.js";
import { deriveSeriesAccent, DEFAULT_THEME_COLOR } from "../utils/seriesColor.js";
import { filmAllowed } from "../hooks/useIdleFilm.js";

// ---------------------------------------------------------------------------
// The promo page of a special event: the whole screen, the event's film first,
// unobstructed, and in its last five seconds the facts a driver wants before
// signing up come in over its left side while the film settles on its last
// frame. It stands in front of the site rather than
// replacing a page, so whatever was asked for is right there once it is closed.
//
// When it shows (PromoHost below):
//   - on the event's own page (/s/<slug>), when an admin switched it on for
//     the series (Series.promoAt), its event is not over, and this browser has
//     not closed this promo yet. Switching it off and on again counts as a new
//     promo. Nowhere else on the site: whoever opens the league's pages or a
//     sign-up link is not stopped by a film.
//   - for whoever may see the series: a private one is in the series list of
//     admins only, so while it is unpublished only admins get its promo.
//   - or the address carries ?promo=<slug>: the admin's preview and a link to
//     share.
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

// The series whose home page this is ("/s/<slug>", nothing after it), else null.
export function slugOfHome(pathname) {
  const m = /^\/s\/([^/]+)\/?$/.exec(pathname || "");
  return m ? decodeURIComponent(m[1]) : null;
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
      const here = slugOfHome(location.pathname);
      show =
        seriesList.find(
          (s) => s.slug === here && s.promoAt && !eventOver(s) && !closed.has(s.id) && !seenPromo(s)
        ) || null;
    }
  }

  const close = useCallback(
    (series) => {
      const params = new URLSearchParams(location.search);
      // A preview (?promo=) is not the visit: closing it must not count as
      // having seen the promo, or the admin who checked it first never gets
      // it on the event page afterwards.
      if (!params.has("promo")) markPromoSeen(series);
      setClosed((c) => new Set(c).add(series.id));
      // Drop the ?promo= so closing a preview does not reopen it.
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
// The facts come in this long before the film ends, and the film then rests
// on its last frame.
const REVEAL_BEFORE_END_S = 5;
const REVEAL_FALLBACK_MS = 4000;

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
  // The facts over (or under) the film: in its last seconds, then for good.
  const [reveal, setReveal] = useState(false);

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

  // Straight to the last frame, facts up: Skip, and a visitor who gets no
  // moving pictures (reduced motion, low-effects mode, Save-Data).
  function toEnd() {
    const v = videoRef.current;
    if (v && Number.isFinite(v.duration)) {
      v.pause();
      v.currentTime = Math.max(0, v.duration - 0.05);
    }
    setReveal(true);
  }

  // A film that shows no frame in time (slow line, autoplay refused) does not
  // keep the facts back.
  useEffect(() => {
    if (!film || filmReady || reveal) return undefined;
    const t = setTimeout(() => setReveal(true), REVEAL_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [film, filmReady, reveal]);

  const moving = film && filmAllowed();
  const shown = reveal || (data && !film);

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
      {/* Top bar: who is talking, and the ways out. Over the film from md up,
          above it on a phone. */}
      <div className="relative z-20 flex items-center justify-between gap-3 px-5 py-4 sm:px-10 sm:py-7 md:absolute md:inset-x-0 md:top-0">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: "var(--promo)" }}>
          ★ NABS Special Event
        </span>
        <span className="flex shrink-0 gap-2">
          {film && hasAudio && (
            <button
              type="button"
              onClick={toggleSound}
              aria-pressed={sound}
              aria-label={sound ? "Mute the film" : "Play the film with sound"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="M22 9l-6 6M16 9l6 6" />}
              </svg>
            </button>
          )}
          {film && !shown && (
            <button
              type="button"
              onClick={toEnd}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wider backdrop-blur transition hover:bg-white/20"
            >
              Skip film
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wider backdrop-blur transition hover:bg-white/20"
          >
            <span className="sm:hidden">Close</span>
            <span className="hidden sm:inline">Continue to site</span>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      </div>

      {/* The stage: the film plays through once, unobstructed, and then rests
          on its last frame (which carries its own facts). Always the whole
          picture (contain, never cover): filling a screen of another shape
          would cut the film's own lettering off at the edges. The full screen
          from md up; on a phone the 16:9 picture at the top. */}
      <div className="pointer-events-none relative aspect-video w-full overflow-hidden md:fixed md:inset-0 md:aspect-auto">
        {poster && (!film || !filmReady) && (
          <img src={poster} alt="" className="absolute inset-0 h-full w-full object-contain opacity-70" />
        )}
        {film && (
          <video
            ref={videoRef}
            src={film}
            poster={poster || undefined}
            autoPlay={!!moving}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={() => {
              if (!moving) toEnd();
            }}
            onPlaying={() => {
              setFilmReady(true);
              if (hasAudio === null) setTimeout(() => setHasAudio(filmHasAudio(videoRef.current)), 1500);
            }}
            onSeeked={() => setFilmReady(true)}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (!reveal && Number.isFinite(v.duration) && v.duration - v.currentTime <= REVEAL_BEFORE_END_S) setReveal(true);
            }}
            onEnded={() => setReveal(true)}
            className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-1000 ${
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
      </div>

      {/* The facts: in the film's last seconds they come in over its left
          side (from md up), on a darkening that leaves the right of the
          picture free; on a phone, below the film. All of it from the race as
          stored: track, start, laps, qualifying, grid, car. */}
      <div
        aria-hidden={!shown}
        className={`relative z-10 transition-all duration-700 ease-out md:fixed md:inset-0 md:flex md:items-center md:overflow-y-auto md:bg-gradient-to-r md:from-black/85 md:via-black/45 md:to-transparent ${
          shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
        }`}
      >
        {data && (
          <div className="mx-auto w-full max-w-7xl px-5 pb-10 pt-6 sm:px-10 md:py-28">
            <div className="flex max-w-2xl flex-col gap-6">
              <div className="min-w-0 space-y-3">
                {race && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-white/85">
                    <span>{race.track}</span>
                    {kickoff && (
                      <>
                        <span className="h-3 w-px bg-white/40" aria-hidden="true" />
                        <span>
                          {kickoff.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} ·{" "}
                          {fmtRaceTime(race.date)}
                        </span>
                      </>
                    )}
                  </div>
                )}
                <h1 className="font-display text-5xl font-black uppercase leading-[0.9] tracking-tight sm:text-6xl lg:text-8xl">{series.name}</h1>
                {series.description && <p className="max-w-xl text-sm text-white/85 sm:text-base">{series.description}</p>}
              </div>

              <div className="flex flex-col gap-6">
                {countdown ? (
                  <div className="flex gap-2" aria-label="Time to lights out">
                    {[
                      ["Days", countdown.days],
                      ["Hrs", countdown.hours],
                      ["Min", countdown.minutes],
                      ["Sec", countdown.seconds],
                    ].map(([label, n]) => (
                      <div key={label} className="w-16 rounded-xl bg-white/10 px-2 py-2 text-center backdrop-blur">
                        <div className="font-mono text-2xl font-bold tabular-nums">{pad2(n)}</div>
                        <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-white/60">{label}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  phase === "live" && (
                    <div
                      className="inline-flex self-start rounded-full px-4 py-2 font-mono text-xs font-bold uppercase tracking-widest"
                      style={{ background: "var(--promo)", color: "var(--promo-on)" }}
                    >
                      Lights out · racing now
                    </div>
                  )
                )}

                {facts.length > 0 && (
                  <dl className="flex flex-wrap gap-x-6 gap-y-3">
                    {facts.map((f) => (
                      <div key={f.label}>
                        <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--promo)" }}>
                          {f.label}
                        </dt>
                        <dd className="whitespace-nowrap font-display text-lg font-bold uppercase tracking-tight">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                <div className="flex gap-3">
                  <Link
                    to={`/s/${series.slug}/attendance`}
                    onClick={onClose}
                    tabIndex={shown ? undefined : -1}
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-xl px-6 py-3.5 text-sm font-bold uppercase tracking-wide transition hover:brightness-110"
                    style={{ background: "var(--promo)", color: "var(--promo-on)" }}
                  >
                    Sign up
                  </Link>
                  <Link
                    to={`/s/${series.slug}`}
                    onClick={onClose}
                    tabIndex={shown ? undefined : -1}
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-xl border border-white/30 px-6 py-3.5 text-sm font-bold uppercase tracking-wide transition hover:bg-white/10"
                  >
                    Event page
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
