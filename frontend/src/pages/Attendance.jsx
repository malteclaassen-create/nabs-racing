import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useDiscordLogin } from "../hooks/useDiscordLogin.js";
import { useReserveSeats } from "../hooks/useReserveSeats.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { seasonLabelOf } from "../utils/pageTitle.js";
import SeatCue from "../components/SeatCue.jsx";
import { ErrorBox, PageHeader, TableSkeleton, EmptyState, Notice } from "../components/ui.jsx";
import RaceSignupCard from "../components/RaceSignupCard.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";
import RaceCountdown from "../components/RaceCountdown.jsx";
import VideoEmbed from "../components/VideoEmbed.jsx";
import { SocialIcon } from "../components/SocialLinks.jsx";
import Flag from "../components/Flag.jsx";
import { flagFor } from "../data/circuits.js";
import { fmtRaceTime } from "../utils/raceTime.js";
import { currentSignupRace, signupRaceIds } from "../utils/signupQueue.js";
import { fmtRaceDate } from "../utils/format.js";
import { sessionSummary } from "../utils/raceFormat.js";

// Which answer a ?rsvp= link stands for. Deliberately a fixed map, so an
// arbitrary value in the URL can never be forwarded to the API as a status.
const RSVP_FROM_LINK = { yes: "ACCEPTED", maybe: "TENTATIVE", no: "DECLINED" };

// What a signed-out visitor sees first on the one page whose whole job needs a
// login. The page did say so — as a small "Sign in to respond" link inside the
// sign-up card, level with the buttons that weren't there — which reads as part
// of the furniture rather than as the reason the page looks empty.
//
// It comes back to THIS page afterwards, with the query intact, so a Discord
// link like /attendance?race=…&rsvp=yes still answers itself on arrival for
// somebody who had to sign in on the way.
function SignInBanner() {
  const { pathname, search } = useLocation();
  const { enabled, loading, start } = useDiscordLogin(`${pathname}${search}`);
  // Nothing while we don't know yet, and nothing on a deployment without
  // Discord login configured: a button that cannot work is worse than silence.
  if (loading || !enabled) return null;
  return (
    <div className="card reveal flex flex-wrap items-center gap-x-5 gap-y-3 p-4 sm:p-5">
      {/* The glyph is a nicety, and on a phone it costs a quarter of the width
          the sentence needs. The button carries one anyway. */}
      <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5865F2]/15 text-[#5865F2] sm:flex">
        <SocialIcon name="discord" className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-extrabold uppercase tracking-tight text-dark sm:text-base">
          Sign in with Discord to sign up to races
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-light sm:text-sm">
          You can read the entry list without one. Answering for a race needs the login.
        </p>
      </div>
      <button
        onClick={start}
        className="inline-flex w-full min-h-[42px] items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4752c4] sm:w-auto"
      >
        <SocialIcon name="discord" className="h-5 w-5" />
        Sign in
      </button>
    </div>
  );
}


// Hotlap videos for the circuit, from the admin's Attendance tab. One player
// with a picker above it when there's more than one lap on file (a season's car
// each, say).
//
// A circuit nobody has filmed yet says so, in the same panel the video would
// have filled. It used to play a stand-in lap — the rickroll — which was funny
// exactly once and unhelpful to somebody genuinely trying to learn the track
// before Friday.
//
// `loading` only suppresses the panel before the FIRST answer is in, so the
// page doesn't announce "coming soon" and then replace itself with a video half
// a second later. Once there is an answer it stays on screen while the next one
// is fetched, rather than blinking out.
function TrackVideos({ track, videos, loading = false }) {
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [track]);
  if (loading && !videos) return null;
  if (!videos?.length) return <HotlapComingSoon track={track} />;
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
      <VideoEmbed
        videoId={current.id}
        title={current.title || `${track} hotlap`}
        className="rounded-xl"
      />
      {current.title && videos.length === 1 && (
        <p className="mt-2.5 text-sm font-semibold text-medium">{current.title}</p>
      )}
    </div>
  );
}

// The circuit has no lap on file. Same card, same eyebrow, same shape as the
// player it stands in for, so the page doesn't rearrange itself the week a lap
// finally lands — only the window's contents change.
function HotlapComingSoon({ track }) {
  return (
    <div className="card reveal overflow-hidden p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow">Hotlap</h3>
        <span className="font-mono text-[11px] uppercase tracking-wider text-light">Coming soon</span>
      </div>
      <div
        style={{ aspectRatio: 16 / 9 }}
        className="flex w-full flex-col items-center justify-center gap-3 rounded-xl bg-surface2 px-6 text-center"
      >
        <svg viewBox="0 0 24 24" className="h-9 w-9 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="5" width="19" height="14" rx="3" />
          <path d="M10 9.5l5 2.5-5 2.5z" />
        </svg>
        <p className="font-display text-lg font-extrabold uppercase tracking-tight text-medium">
          No hotlap yet
        </p>
        <p className="max-w-xs text-sm leading-relaxed text-light">
          Nobody has filmed a lap of {track} for us yet. One turns up here as soon as somebody does.
        </p>
      </div>
    </div>
  );
}

export default function Attendance() {
  const [params, setParams] = useSearchParams();
  const wantRace = params.get("race");
  const { user, isLoggedIn } = useAuth();
  const { current: season } = useSeason();
  // The season belongs in the heading, not only in the switcher above it. Eight
  // seasons of this page otherwise share one H1, so neither a reader landing
  // from a search nor the search engine itself can tell them apart — and the
  // tab title has named the season all along. Same label as there
  // (utils/pageTitle.js), so the two never disagree.
  const seasonName = seasonLabelOf(season);
  const seasonHeading = seasonName ? `${seasonName} Attendance` : "Attendance";
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
  // A reserve who came here to answer "am I available" would otherwise never
  // scroll as far as the seat that is going begging. See hooks/useReserveSeats.
  const seats = useReserveSeats();
  // A callback ref into state, not useRef: SeatCue has to re-run when the
  // block appears, and a ref object never tells it that.
  const [seatEl, setSeatEl] = useState(null);
  const reloadMarketAndEvents = useCallback(
    () => Promise.all([market.reload(), events.reload()]),
    [market.reload, events.reload]
  );

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
  // More than one event can be taking answers at once: a one-off night (an F2
  // sprint + feature evening, say) sits in front of the round that an admin has
  // already forced open. The page still shows ONE of them — but it must not be
  // a dead end, so when there is a second, both get a tab. The race on screen
  // is always in the strip, even when its own sign-up has closed, so switching
  // away and back is possible.
  const openEvents = useMemo(() => {
    const ids = signupRaceIds(list);
    if (ev) ids.add(ev.id);
    return list.filter((e) => ids.has(e.id));
  }, [list, ev]);
  function showRace(id) {
    const next = new URLSearchParams(params);
    next.set("race", id);
    setParams(next, { replace: true });
  }

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
  // "Nothing on screen yet", as opposed to "a request is in flight". Every
  // answer, market action and one-tap link refetches this feed, and a reload
  // keeps the data it already has — so `loading` on its own is not a reason to
  // change what the page shows.
  const firstLoad = events.loading && !events.data;

  return (
    <div className="content-in space-y-6">
      <PageHeader eyebrow="Race Attendance" title={seasonHeading} />

      {!isLoggedIn && <SignInBanner />}

      {/* Confirms a one-tap answer that came in through the link, so the click
          visibly did something instead of just landing on the page. */}
      {autoAnswered && (
        <Notice kind="success">
          {autoAnswered === "ACCEPTED" && "You're in. See you on the grid."}
          {autoAnswered === "TENTATIVE" && "Marked as tentative. Update it any time below."}
          {autoAnswered === "DECLINED" && "Marked as not racing. Thanks for letting the grid know."}
        </Notice>
      )}

      {/* The skeleton belongs to the FIRST load only. Answering a race reloads
          this feed, and while that was in flight the skeleton reappeared ABOVE
          the race — which is still on screen, because a reload keeps the data
          it has — so every press of Accept shoved the whole page down six rows
          and pulled it back up a moment later. There is nothing to skeleton
          once the answer is already there. */}
      {firstLoad && <TableSkeleton rows={6} />}

      {/* A failed read is not an empty calendar. Without this the page answered
          a server problem with "Nothing on the calendar", which reads as "no
          races are scheduled" — the one message that makes a member close the
          page instead of trying again. */}
      {!firstLoad && events.error && <ErrorBox message={events.error} onRetry={events.reload} />}

      {!firstLoad && !events.error && list.length === 0 && (
        <EmptyState title="Nothing on the calendar" hint="The next race will show up here as soon as it is scheduled.">
          <Link to="/races" className="transition mt-3 inline-block text-sm font-semibold text-link hover:underline">See the calendar →</Link>
        </EmptyState>
      )}

      {ev && openEvents.length > 1 && (
        <SlidingTabs
          items={openEvents.map((e) => ({
            key: e.id,
            label: (
              <span className="flex items-center gap-2">
                <span className="font-semibold">{e.track}</span>
                <span className="font-mono text-[11px] uppercase tracking-wider opacity-70">
                  {e.date ? fmtRaceDate(e.date) : "TBA"}
                </span>
              </span>
            ),
            title: e.type === "TRAINING" ? "Training session" : `Round ${e.number}`,
          }))}
          value={ev.id}
          onChange={showRace}
          className="reveal"
        />
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
                {sessionSummary(ev).length > 0 && (
                  <div className="mt-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                    {sessionSummary(ev).join(" · ")}
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
              // A market action changes the sign-up list too now — offering a
              // seat files a DECLINED with it — so the answer columns and the
              // buttons above them have to be refetched with the market, or the
              // page would sit there showing the answer the member just left.
              reloadMarket={reloadMarketAndEvents}
              seatHighlight={seats.show}
              seatRef={setSeatEl}
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
          const videoPanel = <TrackVideos track={ev.track} videos={hist.data?.videos} loading={hist.loading} />;
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
          // arrives — with the lap itself, or with the "coming soon" panel for
          // a circuit nobody has filmed yet.
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
              {/* Floats over the page rather than sitting in a column: the whole
                  point is to be visible from wherever they stopped reading. */}
              {seats.show && (
                <SeatCue count={seats.openCount} target={seatEl} onSeen={seats.markSeen} />
              )}
            </div>
          );
          })()}
        </>
      )}
    </div>
  );
}
