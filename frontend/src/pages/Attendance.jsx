import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { ErrorBox, PageHeader, TableSkeleton } from "../components/ui.jsx";
import RaceSignupCard from "../components/RaceSignupCard.jsx";
import RatingCard from "../components/RatingCard.jsx";
import RaceCountdown from "../components/RaceCountdown.jsx";
import Flag from "../components/Flag.jsx";
import { flagFor } from "../data/circuits.js";
import { fmtRaceTime } from "../utils/raceTime.js";

const MAX_LAP_MS = 1_800_000;
function fmtLap(ms) {
  if (!ms || ms <= 0 || ms > MAX_LAP_MS) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

// Personal history at the selected track (from trackHistory.me).
function MyTrackHistory({ track, me }) {
  if (!me || !me.editions?.length) {
    return (
      <div className="card p-5">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-light">Your history here</h3>
        <p className="mt-2 text-sm text-light">You have not raced at {track} yet. Time to make some history.</p>
      </div>
    );
  }
  return (
    <div className="card p-5">
      <h3 className="mb-3 font-mono text-xs font-bold uppercase tracking-widest text-light">Your history at {track}</h3>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="font-display text-2xl font-black tabular-nums text-dark">{me.starts}</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-light">starts</div>
        </div>
        <div>
          <div className="font-display text-2xl font-black tabular-nums text-dark">{me.wins}</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-light">wins</div>
        </div>
        <div>
          <div className="font-display text-2xl font-black tabular-nums text-dark">{me.bestFinish ? `P${me.bestFinish}` : "–"}</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-light">best</div>
        </div>
      </div>
      <ul className="space-y-1.5">
        {me.editions.map((e, i) => (
          <li key={i} className="flex items-center justify-between gap-2 border-b border-border py-1.5 text-sm last:border-0">
            <span className="font-mono text-xs text-light">Season {e.seasonNumber}</span>
            <span className="font-display font-bold text-dark">
              {e.status === "FINISHED" && e.position != null ? `P${e.position}` : e.status}
            </span>
            <span className="font-mono text-xs tabular-nums text-medium">{fmtLap(e.bestLapMs) || "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Attendance() {
  const [params] = useSearchParams();
  const wantRace = params.get("race");
  const { user, isLoggedIn } = useAuth();
  const driverId = isLoggedIn ? user?.driverId : null;
  const canSignUp = isLoggedIn && !!driverId;

  const events = useApi(useCallback(() => api.events(), []));
  const market = useApi(useCallback(() => api.market(), []));
  const marketByRace = useMemo(() => new Map((market.data?.races || []).map((r) => [r.id, r])), [market.data]);

  const list = useMemo(
    () => [...(events.data || [])].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)),
    [events.data]
  );
  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => {
    if (!list.length) return;
    setSelectedId((cur) => cur || (wantRace && list.find((e) => e.id === wantRace) ? wantRace : list[0].id));
  }, [list, wantRace]);
  const ev = list.find((e) => e.id === selectedId) || list[0] || null;

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
  async function clearStatus(raceId) {
    setBusy(`${raceId}:clear`);
    try {
      await api.removeRsvp(raceId, driverId);
      await events.reload();
    } finally {
      setBusy(null);
    }
  }

  // Member's rating card (profile for the driver object + rating).
  const mine = useApi(
    useCallback(
      () => (driverId ? Promise.all([api.driverProfile(driverId), api.driverRating(driverId)]) : Promise.resolve(null)),
      [driverId]
    )
  );
  // Personal history at the selected track.
  const hist = useApi(useCallback(() => (ev ? api.trackHistory(ev.track) : Promise.resolve(null)), [ev?.track]));

  const circuit = ev ? flagFor(ev.track, ev.country) : null;

  return (
    <div className="content-in space-y-6">
      <PageHeader eyebrow="Race Attendance" title="Attendance" />

      {events.loading && <TableSkeleton rows={6} />}

      {!events.loading && list.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-medium">Nothing on the calendar right now. The next race will show up here as soon as it is scheduled.</p>
          <Link to="/races" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">See the calendar →</Link>
        </div>
      )}

      {ev && (
        <>
          {/* race picker (when more than one upcoming) */}
          {list.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {list.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  className={`pill ${e.id === ev.id ? "bg-primary text-white" : "bg-surface2 text-medium hover:text-dark"}`}
                >
                  {e.type === "TRAINING" ? "Training" : `R${e.number}`} {e.track}
                </button>
              ))}
            </div>
          )}

          {/* hero strip: race identity on the left, the live broadcast-style
              countdown (same clock as the home page) on the right. No circuit
              watermark here on purpose — it collided with the countdown tiles. */}
          <div className="card relative overflow-hidden p-5 sm:p-6">
            <div className="relative flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  {circuit && <Flag code={circuit.country} w={26} h={19} />}
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
                    {ev.type === "TRAINING" ? "Training session" : `Round ${ev.number}`}
                  </span>
                </div>
                <h2 className="mt-1 font-display text-3xl font-black uppercase tracking-tight text-dark sm:text-4xl">{ev.track}</h2>
                <div className="mt-1 font-mono text-sm font-bold uppercase tracking-wide text-medium">
                  {ev.date ? (
                    <>
                      {fmtDate(ev.date)} <span className="text-light">· {fmtRaceTime(ev.date)}</span>
                    </>
                  ) : (
                    "Date to be confirmed"
                  )}
                </div>
                {(ev.qualiMinutes || ev.raceLaps) && (
                  <div className="mt-1.5 font-mono text-xs font-bold uppercase tracking-wide text-light">
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

          {error && <ErrorBox message={error} />}

          {/* driver card top-left, sign-up next to it; the personal track
              history sits under the sign-up. Members without a linked driver
              (and logged-out visitors) just get the sign-up list full width. */}
          {canSignUp && mine.data && mine.data[1] ? (
            <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
              <div className="flex justify-center lg:sticky lg:top-28">
                <RatingCard driver={mine.data[0].driver} rating={mine.data[1]} />
              </div>
              <div className="min-w-0 space-y-6">
                <RaceSignupCard
                  ev={ev}
                  marketRace={marketByRace.get(ev.id)}
                  me={market.data?.me}
                  reloadMarket={market.reload}
                  driverId={driverId}
                  canSignUp={canSignUp}
                  busy={busy}
                  onSetStatus={setStatus}
                  onClear={clearStatus}
                />
                <MyTrackHistory track={ev.track} me={hist.data?.me} />
              </div>
            </div>
          ) : (
            <>
              <RaceSignupCard
                ev={ev}
                marketRace={marketByRace.get(ev.id)}
                me={market.data?.me}
                reloadMarket={market.reload}
                driverId={driverId}
                canSignUp={canSignUp}
                busy={busy}
                onSetStatus={setStatus}
                onClear={clearStatus}
              />
              {canSignUp && <MyTrackHistory track={ev.track} me={hist.data?.me} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
