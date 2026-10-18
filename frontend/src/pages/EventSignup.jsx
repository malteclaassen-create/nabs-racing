import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useDiscordLogin } from "../hooks/useDiscordLogin.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeries, useSeriesPath } from "../context/SeriesContext.jsx";
import { ErrorBox, PageHeader, TableSkeleton, EmptyState } from "../components/ui.jsx";
import RaceCountdown from "../components/RaceCountdown.jsx";
import SessionPlan from "../components/SessionPlan.jsx";
import Flag from "../components/Flag.jsx";
import { SocialIcon } from "../components/SocialLinks.jsx";
import { flagFor } from "../data/circuits.js";
import { fmtRaceTime } from "../utils/raceTime.js";
import { fmtRaceDate } from "../utils/format.js";
import { currentSignupRace } from "../utils/signupQueue.js";
import { Download } from "lucide-react";
import { defaultLiveriesFor, carStoreUrl } from "../data/defaultLiveries.js";
import { announceRsvpChanged } from "../hooks/useMyEventEntry.js";
import { EventCarFields, takenNumbers, draftFrom, draftProblem, draftBody, holdsCar } from "../components/EventCar.jsx";

// A special event's sign-up, a page of its own: the car number and the livery
// first, then the seat. Somebody who is in goes to the attendance page instead,
// where the entry list is and where the car can still be changed (in the
// column a championship uses for its hotlap). The nav points here until then.

function SignIn() {
  const { pathname, search } = useLocation();
  const { enabled, loading, start } = useDiscordLogin(`${pathname}${search}`);
  if (loading || !enabled) return null;
  return (
    <div className="card flex flex-wrap items-center gap-x-5 gap-y-3 p-5">
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Sign in with Discord to sign up</p>
        <p className="mt-0.5 text-sm text-light">Your seat, number and livery go with your Discord account.</p>
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

export default function EventSignup() {
  const { user, isLoggedIn } = useAuth();
  const { current: season } = useSeason();
  const { current: series } = useSeries();
  const { seriesPath } = useSeriesPath();
  const navigate = useNavigate();
  const driverId = isLoggedIn ? user?.driverId : null;

  const events = useApi(useCallback(() => api.events(), []));
  const ev = useMemo(() => currentSignupRace(events.data || [], null), [events.data]);
  const myCar = useApi(
    useCallback(() => (ev?.id && isLoggedIn ? api.myCar(ev.id) : Promise.resolve(null)), [ev?.id, isLoggedIn])
  );

  const defaults = defaultLiveriesFor(season?.game || series?.game);
  const carUrl = carStoreUrl(season?.game || series?.game);
  const [draft, setDraft] = useState(() => draftFrom(null, defaults));
  // The default livery is the menu's first pick only once the car is known.
  useEffect(() => setDraft((d) => (d.number || d.link || d.old ? d : draftFrom(null, defaults))), [defaults.length]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // A championship has no sign-up page: its attendance page is the sign-up.
  if (series && series.kind !== "event") return <Navigate to={seriesPath("/attendance")} replace />;
  // Already in: the attendance page is where they belong now.
  if (ev && holdsCar(myCar.data?.status)) return <Navigate to={seriesPath("/attendance")} replace />;

  const firstLoad = events.loading && !events.data;
  const myIds = new Set([driverId, myCar.data?.driverId].filter(Boolean));
  const taken = takenNumbers(ev, myIds);
  const circuit = ev ? flagFor(ev.track, ev.country) : null;
  const opensAt = ev?.attendanceOpensAt ? new Date(ev.attendanceOpensAt) : null;
  const notYetOpen = !ev?.attendanceClosed && !!opensAt && opensAt.getTime() > Date.now();
  const closed = !!ev?.attendanceClosed;
  const status = ev?.gridFull ? "WAITLIST" : "ACCEPTED";
  const accepted = ev?.rsvps?.ACCEPTED?.length || 0;
  const capacity = ev?.capacity ?? 40;

  async function submit() {
    const p = draftProblem(draft, taken, defaults);
    if (p) return setError(p);
    setBusy(true);
    setError(null);
    try {
      await api.rsvp(ev.id, driverId, status, draftBody(draft));
      announceRsvpChanged();
      navigate(seriesPath("/attendance"), { replace: true });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="content-in space-y-6">
      <PageHeader
        eyebrow="Special event"
        title="Sign up"
        right={
          // The car itself: without it there is nothing to sign up with.
          carUrl && (
            <a href={carUrl} target="_blank" rel="noopener noreferrer" className="btn-primary gap-2">
              <Download className="h-4 w-4" aria-hidden="true" />
              Get the car
            </a>
          )
        }
      />

      {firstLoad && <TableSkeleton rows={5} />}
      {!firstLoad && events.error && <ErrorBox message={events.error} onRetry={events.reload} />}
      {!firstLoad && !events.error && !ev && (
        <EmptyState title="Nothing to sign up for" hint="The race shows up here as soon as it is scheduled." />
      )}

      {ev && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* The race: what you are signing up for. */}
          <div className="min-w-0">
            <div className="card p-5 sm:p-6 lg:sticky lg:top-28">
              <div className="flex items-center gap-2.5">
                {circuit && <Flag code={circuit.country} w={26} h={19} />}
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
                  {series?.name || "Special event"}
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
              <SessionPlan race={ev} className="mt-1.5 text-medium" />
              {ev.date && <RaceCountdown date={ev.date} className="mt-4 w-full" />}
              <div className="mt-5">
                <div className="flex justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                  <span>Seats taken</span>
                  <span className="tabular-nums">
                    {accepted} / {capacity}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface2">
                  <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, (accepted / capacity) * 100)}%` }} />
                </div>
              </div>
              <Link to={seriesPath("/attendance")} className="mt-4 inline-block text-sm font-bold text-link hover:underline">
                See who is in →
              </Link>
            </div>
          </div>

          {/* The car, then the seat. */}
          <div className="min-w-0 space-y-4">
            {!isLoggedIn ? (
              <SignIn />
            ) : !driverId ? (
              <div className="card p-5 text-sm leading-relaxed text-medium">
                You haven&rsquo;t raced with us yet, so there is no driver profile to sign up with.{" "}
                <Link to={seriesPath("/attendance")} className="font-semibold text-link hover:underline">
                  Ask for a seat on the attendance page
                </Link>{" "}
                and an admin sets you up.
              </div>
            ) : notYetOpen || closed ? (
              <div className="card p-5 text-sm leading-relaxed text-medium">
                {closed
                  ? "Sign-up for this race is closed."
                  : `Sign-up opens ${fmtRaceDate(ev.attendanceOpensAt)}. Come back then.`}
              </div>
            ) : myCar.loading && !myCar.data ? (
              <TableSkeleton rows={3} />
            ) : (
              <div className="card overflow-hidden">
                <div className="border-b border-border px-5 py-4">
                  <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">Your car</h3>
                  <p className="mt-0.5 font-display text-lg font-extrabold uppercase tracking-tight text-dark">
                    Number and livery
                  </p>
                  <p className="mt-1 text-sm text-light">
                    Pick your livery and a number nobody else has. You can change both on the attendance page later.
                  </p>
                </div>
                <div className="space-y-4 p-5">
                  <EventCarFields
                    draft={draft}
                    setDraft={setDraft}
                    taken={taken}
                    deadline={ev.liveryDeadline}
                    defaults={defaults}
                  />
                  {error && <p className="text-sm font-semibold text-bad">{error}</p>}
                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={submit} disabled={busy} className="btn-primary min-w-[9rem]">
                      {busy ? "..." : status === "WAITLIST" ? "Join the waiting list" : "Sign up"}
                    </button>
                    {status === "WAITLIST" && (
                      <span className="text-sm text-light">The grid is full. First in line moves up the moment a seat comes free.</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
