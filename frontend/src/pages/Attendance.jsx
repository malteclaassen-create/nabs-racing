import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { ErrorBox, PageHeader, TableSkeleton, EmptyState, Notice } from "../components/ui.jsx";
import RaceSignupCard from "../components/RaceSignupCard.jsx";
import RaceCountdown from "../components/RaceCountdown.jsx";
import VideoEmbed from "../components/VideoEmbed.jsx";
import Flag from "../components/Flag.jsx";
import { flagFor } from "../data/circuits.js";
import { fmtRaceTime } from "../utils/raceTime.js";
import { currentSignupRace } from "../utils/signupQueue.js";
import { fmtRaceDate } from "../utils/format.js";

// Which answer a ?rsvp= link stands for. Deliberately a fixed map, so an
// arbitrary value in the URL can never be forwarded to the API as a status.
const RSVP_FROM_LINK = { yes: "ACCEPTED", maybe: "TENTATIVE", no: "DECLINED" };


// Hotlap videos for the circuit, from the admin's Attendance tab. One player
// with a picker above it when there's more than one lap on file (a season's car
// each, say). Renders nothing at all for a track without videos — an empty
// player window would just be a hole in the page.
function TrackVideos({ track, videos }) {
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [track]);
  if (!videos?.length) return null;
  const current = videos[Math.min(i, videos.length - 1)];
  return (
    <div className="card reveal overflow-hidden p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow">Hotlap</h3>
        <span className="font-mono text-[11px] uppercase tracking-wider text-light">Learn {track} before Friday</span>
      </div>
      {videos.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {videos.map((v, idx) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={idx === i}
              onClick={() => setI(idx)}
              className={`inline-flex min-h-[36px] items-center rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                idx === i ? "bg-brand text-ink" : "bg-surface2 text-medium hover:text-dark"
              }`}
            >
              {v.title || `Lap ${idx + 1}`}
            </button>
          ))}
        </div>
      )}
      {/* `poster` is normally absent, and the player uses YouTube's own still.
          The stand-in lap sends `false`, meaning "no still" — see the backend's
          lib/trackInfo.js for why. */}
      <VideoEmbed
        videoId={current.id}
        poster={current.poster}
        title={current.title || `${track} hotlap`}
        className="rounded-xl"
      />
      {current.title && videos.length === 1 && (
        <p className="mt-2.5 text-sm font-semibold text-medium">{current.title}</p>
      )}
    </div>
  );
}

export default function Attendance() {
  const [params, setParams] = useSearchParams();
  const wantRace = params.get("race");
  const { user, isLoggedIn } = useAuth();
  const driverId = isLoggedIn ? user?.driverId : null;
  const canSignUp = isLoggedIn && !!driverId;

  const events = useApi(useCallback(() => api.events(), []));
  const market = useApi(useCallback(() => api.market(), []));
  // Logged in but no driver profile anywhere (never raced with us): they can't
  // RSVP, but they can raise a hand — "I want to race" — which the admin sees
  // in Members → Needs attention.
  const raceRequest = useApi(
    useCallback(
      () => (isLoggedIn && !driverId ? api.myRaceRequest() : Promise.resolve(null)),
      [isLoggedIn, driverId]
    )
  );
  async function requestSeat(raceId) {
    setError(null);
    setBusy(`${raceId}:request`);
    try {
      await api.requestRace(raceId);
      await raceRequest.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }
  const marketByRace = useMemo(() => new Map((market.data?.races || []).map((r) => [r.id, r])), [market.data]);

  const list = useMemo(
    () => [...(events.data || [])].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)),
    [events.data]
  );
  // The page shows exactly ONE race. It used to put every upcoming round on
  // screen as a row of buttons, which on a full season meant the whole year sat
  // on top of a page whose entire job is the question "are you racing on
  // Friday". Which one that is comes from the shared queue rule (utils/
  // signupQueue.js), so this page and the Races page always name the same
  // round — including when an admin has forced a later one open. A ?race= link
  // still wins, so a one-tap answer out of a notification or a Discord post
  // lands on the round it was sent for even when that isn't the next one.
  const ev = useMemo(() => currentSignupRace(list, wantRace), [list, wantRace]);

  // RSVP actions (identity from the Discord login; forgery-proof server-side).
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  async function setStatus(raceId, status) {
    setError(null);
    setBusy(`${raceId}:${status}`);
    try {
      await api.rsvp(raceId, driverId, status);
      await events.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }
  // One-tap answer straight out of a notification or a Discord post:
  // /attendance?race=<id>&rsvp=yes|maybe|no submits that answer on arrival, so
  // the weekly "are you racing" question is a single click instead of
  // open page -> find race -> press button.
  //
  // Guarded on purpose: it fires once per page load, only for a signed-in
  // member who can actually sign up, and only for the race named in the link.
  // The parameter is stripped afterwards so a refresh (or the back button)
  // can't silently answer again.
  const [autoAnswered, setAutoAnswered] = useState(null);
  const autoFired = useRef(false);
  useEffect(() => {
    const wanted = RSVP_FROM_LINK[(params.get("rsvp") || "").toLowerCase()];
    if (!wanted || autoFired.current) return;
    if (!canSignUp || !wantRace) return;
    const race = list.find((e) => e.id === wantRace);
    if (!race) return; // list not loaded yet, or an unknown race id
    autoFired.current = true;
    (async () => {
      try {
        await api.rsvp(race.id, driverId, wanted);
        await events.reload();
        setAutoAnswered(wanted);
      } catch (e) {
        setError(e.message);
      } finally {
        const next = new URLSearchParams(params);
        next.delete("rsvp");
        setParams(next, { replace: true });
      }
    })();
  }, [params, canSignUp, wantRace, list, driverId]);

  async function clearStatus(raceId) {
    setBusy(`${raceId}:clear`);
    try {
      await api.removeRsvp(raceId, driverId);
      await events.reload();
    } finally {
      setBusy(null);
    }
  }

  // The hotlap for the selected track (public) — the only per-track fetch this
  // page still makes. The member's own rating card used to be fetched here too;
  // the page shows one arrangement now and that card is not part of it.
  const hist = useApi(useCallback(() => (ev ? api.trackHistory(ev.track) : Promise.resolve(null)), [ev?.track]));

  const circuit = ev ? flagFor(ev.track, ev.country) : null;

  return (
    <div className="content-in space-y-6">
      <PageHeader eyebrow="Race Attendance" title="Attendance" />

      {/* Confirms a one-tap answer that came in through the link, so the click
          visibly did something instead of just landing on the page. */}
      {autoAnswered && (
        <Notice kind="success">
          {autoAnswered === "ACCEPTED" && "You're in. See you on the grid."}
          {autoAnswered === "TENTATIVE" && "Marked as tentative. Update it any time below."}
          {autoAnswered === "DECLINED" && "Marked as not racing. Thanks for letting the grid know."}
        </Notice>
      )}

      {events.loading && <TableSkeleton rows={6} />}

      {/* A failed read is not an empty calendar. Without this the page answered
          a server problem with "Nothing on the calendar", which reads as "no
          races are scheduled" — the one message that makes a member close the
          page instead of trying again. */}
      {!events.loading && events.error && <ErrorBox message={events.error} onRetry={events.reload} />}

      {!events.loading && !events.error && list.length === 0 && (
        <EmptyState title="Nothing on the calendar" hint="The next race will show up here as soon as it is scheduled.">
          <Link to="/races" className="transition mt-3 inline-block text-sm font-semibold text-link hover:underline">See the calendar →</Link>
        </EmptyState>
      )}

      {ev && (
        <>
          {/* From here on the page is composed rather than written out: with a
              lap on file it splits in two — everything about the race and
              signing up on the left, the video on the right — and without one it
              stays the single column it has always been. Building the pieces as
              values first is what keeps those two arrangements from drifting
              apart as separate copies of the same JSX. */}
          {(() => {
          const heroCard = (
          /* hero strip: race identity on the left, the live broadcast-style
             countdown (same clock as the home page) on the right. No circuit
             watermark here on purpose — it collided with the countdown tiles. */
          <div className="card reveal relative overflow-hidden p-5 sm:p-6">
            <div className="relative flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  {circuit && <Flag code={circuit.country} w={26} h={19} />}
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
                    {ev.type === "TRAINING" ? "Training session" : `Round ${ev.number}`}
                  </span>
                </div>
                <h2 className="mt-1 font-display text-3xl font-black uppercase tracking-tight text-dark sm:text-4xl">{ev.track}</h2>
                <div className="mt-1 font-mono text-[13px] font-bold uppercase tracking-wider text-medium">
                  {ev.date ? (
                    <>
                      {fmtRaceDate(ev.date)} <span className="text-light">· {fmtRaceTime(ev.date)}</span>
                    </>
                  ) : (
                    "Date to be confirmed"
                  )}
                </div>
                {(ev.qualiMinutes || ev.raceLaps) && (
                  <div className="mt-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                    {[
                      ev.qualiMinutes && `Qualifying ${ev.qualiMinutes} min`,
                      ev.raceLaps && `Race ${ev.raceLaps} laps`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </div>
              {ev.date && <RaceCountdown date={ev.date} className="w-full sm:w-80" />}
            </div>
            {/* free-text race details (rules, mods, links) — as the admin wrote them */}
            {ev.info && (
              <p className="relative mt-4 whitespace-pre-line border-t border-border pt-4 text-sm leading-relaxed text-medium">
                {ev.info}
              </p>
            )}
          </div>
          );

          const signUpCard = (
            <RaceSignupCard
              ev={ev}
              marketRace={marketByRace.get(ev.id)}
              me={market.data?.me}
              reloadMarket={market.reload}
              driverId={driverId}
              canSignUp={canSignUp}
              isLoggedIn={isLoggedIn}
              raceRequest={raceRequest.data}
              onRequestSeat={requestSeat}
              busy={busy}
              onSetStatus={setStatus}
              onClear={clearStatus}
              // Takes the height the video leaves over in the split layout; no
              // effect in the single-column one, where nothing is flexing.
              className="lg:grow"
            />
          );

          // Shown to everyone, signed in or not: the lap is public.
          const videoPanel = <TrackVideos track={ev.track} videos={hist.data?.videos} />;
          const errorBox = error ? <ErrorBox message={error} /> : null;

          // ONE arrangement, always: the race and the sign-up down the left,
          // the hotlap on the right. The page used to pick between this and a
          // driver-card-plus-history version depending on whether the circuit
          // had a lap on file, which was both busier than it needed to be and
          // the source of a flicker — React remounts a card the moment it moves
          // to a different parent, and a remounted card replays its reveal, so
          // every layout switch made the page fade itself in twice.
          //
          // With a single arrangement the hero and the sign-up mount once and
          // stay put; the hotlap simply fills its column when the answer
          // arrives (TrackVideos renders nothing without one, leaving the left
          // column full width on circuits with no lap).
          //
          // Half and half, so the video is a window you can actually watch
          // rather than a thumbnail parked in a margin. Shares rather than a
          // fixed sidebar width: the split then holds on a wider screen
          // instead of leaving the video behind.
          return (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-6">
                {heroCard}
                {errorBox}
                {signUpCard}
              </div>
              {/* The sticky wrapper sits INSIDE the stretched column: a sticky
                  element that is itself as tall as the row has nothing left to
                  scroll within. */}
              <div className="min-w-0">
                <div className="lg:sticky lg:top-28">{videoPanel}</div>
              </div>
            </div>
          );
          })()}
        </>
      )}
    </div>
  );
}
