import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { ErrorBox, PageHeader, TableSkeleton } from "../components/ui.jsx";
import RaceSignupCard from "../components/RaceSignupCard.jsx";
import RatingCard from "../components/RatingCard.jsx";
import CircuitMap from "../components/CircuitMap.jsx";
import Flag from "../components/Flag.jsx";
import { circuitFor } from "../data/circuits.js";

const MAX_LAP_MS = 1_800_000;
function fmtLap(ms) {
  if (!ms || ms <= 0 || ms > MAX_LAP_MS) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
function countdown(date) {
  if (!date) return "Date to be confirmed";
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
  if (days <= 0) return "Race day";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
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

  const circuit = ev ? circuitFor(ev.track) : null;

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
                  R{e.number} {e.track}
                </button>
              ))}
            </div>
          )}

          {/* hero strip: countdown + circuit watermark */}
          <div className="card relative overflow-hidden p-5 sm:p-6">
            <span className="absolute inset-x-0 top-0 h-1.5 bg-brand" />
            {circuit && (
              <CircuitMap track={ev.track} className="pointer-events-none absolute right-4 top-1/2 h-32 -translate-y-1/2 text-faint opacity-20" strokeWidth={2} />
            )}
            <div className="relative flex items-center gap-2.5">
              {circuit && <Flag code={circuit.country} w={26} h={19} />}
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Round {ev.number}</span>
            </div>
            <h2 className="relative mt-1 font-display text-3xl font-black uppercase tracking-tight text-dark sm:text-4xl">{ev.track}</h2>
            <div className="relative mt-1 font-mono text-sm font-bold uppercase tracking-wide text-medium">{countdown(ev.date)}</div>
          </div>

          {error && <ErrorBox message={error} />}

          {/* the sign-up card (moved from the Races page) */}
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

          {/* member extras: rating card + personal track history */}
          {canSignUp && (
            <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-start">
              <div className="flex justify-center">
                {mine.data && mine.data[1] && <RatingCard driver={mine.data[0].driver} rating={mine.data[1]} />}
              </div>
              <MyTrackHistory track={ev.track} me={hist.data?.me} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
