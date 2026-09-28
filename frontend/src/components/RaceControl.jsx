import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { api } from "../api/client.js";
import { useVisiblePoll } from "../hooks/useVisiblePoll.js";
import { useNow } from "../hooks/useNow.js";

// Race control inside the TV board: collisions (bursts on the map), stopped
// cars and who is off track, from services/liveIncidents.js. Stewards and
// admins only.

const POLL_MS = 2000;
// How long a new collision counts as "just happened" (the burst on the map).
const FRESH_MS = 4000;

export const INCIDENT_META = {
  car: { label: "Contact", color: "#ef4444", chip: "bg-red-500/15 text-red-600 dark:text-red-400" },
  env: { label: "Wall", color: "#f59e0b", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  stopped: { label: "Stopped", color: "#38bdf8", chip: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
};

// Is this viewer a steward (or admin)? Asked once; no answer means no.
export function useRaceControlAccess() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .raceControlAccess()
      .then((r) => alive && setAllowed(!!r?.allowed))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return allowed;
}

// The incidents of the session on air, polled while race control is on.
export function useRaceControl({ on, server, demo }) {
  const [data, setData] = useState(null);
  const seenRef = useRef(null); // ids we already had, null until the first load
  const freshRef = useRef(new Map()); // id -> fresh until (ms)
  // After the first answer only changes are asked for; the list is kept here.
  const cursorRef = useRef(null);
  const listRef = useRef([]);
  const sessionRef = useRef(null);
  const resetKey = `${server || ""}|${demo || ""}`;

  useEffect(() => {
    seenRef.current = null;
    freshRef.current = new Map();
    cursorRef.current = null;
    listRef.current = [];
    sessionRef.current = null;
    setData(null);
  }, [resetKey]);

  useVisiblePoll(
    async (alive) => {
      const d = await api.raceControlIncidents(server, demo, cursorRef.current).catch(() => null);
      if (!alive() || !d?.ok) return;
      const now = Date.now();
      // A new session starts the list from nothing.
      const sessionKey = d.session?.key ?? null;
      if (d.partial && sessionKey === sessionRef.current) {
        const byId = new Map(listRef.current.map((i) => [i.id, i]));
        for (const i of d.incidents || []) byId.set(i.id, i);
        listRef.current = [...byId.values()].sort((a, b) => b.at - a.at).slice(0, 300);
      } else {
        listRef.current = d.incidents || [];
      }
      sessionRef.current = sessionKey;
      cursorRef.current = d.cursor ?? null;
      d.incidents = listRef.current;
      const ids = (d.incidents || []).map((i) => i.id);
      // Only what shows up WHILE we watch gets the burst; opening the board
      // mid-race should not set off every old contact at once.
      if (seenRef.current) {
        for (const i of d.incidents || []) {
          if (!seenRef.current.has(i.id) && i.type !== "stopped") freshRef.current.set(i.id, now + FRESH_MS);
        }
      }
      seenRef.current = new Set([...(seenRef.current || []), ...ids]);
      for (const [id, until] of freshRef.current) if (until < now) freshRef.current.delete(id);
      setData(d);
    },
    POLL_MS,
    on,
    resetKey
  );

  const isFresh = useCallback((id) => (freshRef.current.get(id) || 0) > Date.now(), []);

  const setMinKmh = useCallback(async (v) => {
    const r = await api.setRaceControlMinKmh(v);
    setData((d) => d && { ...d, minKmh: r.minKmh });
    return r.minKmh;
  }, []);

  return { data, isFresh, setMinKmh };
}

// Session clock: 1:02:03 or 12:34.
export function fmtRaceClock(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function incidentNames(inc, match) {
  const nm = (n) => (n && match ? match(n)?.nabsName : null) || n || "Unknown";
  return { a: nm(inc.driverName), b: inc.type === "car" ? nm(inc.otherName) : null };
}

// The map's tooltip line for one incident.
export function incidentTitle(inc, match) {
  const { a, b } = incidentNames(inc, match);
  const who = b ? `${a} and ${b}` : a;
  const kmh = inc.speedKmh != null ? `, ${Math.round(inc.speedKmh)} km/h` : "";
  const when = fmtRaceClock(inc.raceMs);
  return `${INCIDENT_META[inc.type]?.label || "Incident"}: ${who}${kmh}${when ? ` at ${when}` : ""}`;
}

// The toggle in the TV header. Only rendered for stewards.
export function RaceControlToggle({ on, onChange, className = "" }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={on ? "Hide race control" : "Show incidents for race control"}
      className={`${className} ${on ? "border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-400" : ""}`}
    >
      <ShieldAlert className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
      <span className="hidden sm:inline">Race control</span>
    </button>
  );
}

// One car off the tarmac, with a clock on how long it has been out.
function OffRow({ car, match }) {
  const now = useNow();
  const m = match ? match(car.name) : null;
  const secs = Math.max(0, Math.floor((now - car.since) / 1000));
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <span className="h-7 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: m?.teamColor || "var(--c-border)" }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-bold uppercase tracking-tight text-dark">
          {m?.nabsName || car.name || "Unknown"}
        </span>
        {m?.teamName && <span className="block truncate text-[11px] text-light">{m.teamName}</span>}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-light" title="How far off the tarmac at most">
        {Math.round(car.metres)} m
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-amber-700 dark:text-amber-400">
        {secs} s
      </span>
    </li>
  );
}

function Threshold({ value, onSave }) {
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(value ?? ""), [value]);
  const save = async () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n === value) return setDraft(value ?? "");
    setBusy(true);
    try {
      await onSave(n);
    } catch {
      setDraft(value ?? "");
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-light">
      Bursts from
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={300}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-14 rounded-md border border-border bg-bg px-1.5 py-1 text-right text-dark"
      />
      km/h
    </label>
  );
}

// Who is off the tarmac right now (an estimate off the track map), with the
// stopped cars on top. Collisions are on the map as bursts, not in here.
export function RaceControlPanel({ rc, match, className = "" }) {
  const { data, setMinKmh } = rc;
  const off = data?.offTrack || [];
  const stopped = data?.stopped || [];
  const nm = (n) => (n && match ? match(n)?.nabsName : null) || n || "Unknown";
  return (
    <section className={`flex flex-col overflow-hidden rounded-2xl border border-border bg-card ${className}`}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Off track</span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-light">
          {data ? `${off.length} now` : "Loading"}
        </span>
      </div>
      <div
        className={`shrink-0 border-b border-border px-4 py-2 font-mono text-[11px] uppercase tracking-wider ${
          stopped.length ? "text-sky-700 dark:text-sky-400" : "text-light"
        }`}
      >
        {stopped.length === 0
          ? "No cars stopped"
          : `${stopped.length} ${stopped.length === 1 ? "car" : "cars"} stopped: ${stopped.map((s) => nm(s.name)).join(", ")}`}
      </div>
      {off.length ? (
        <ul className="scrollbar-slim min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {off.map((c) => (
            <OffRow key={c.guid} car={c} match={match} />
          ))}
        </ul>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6 text-center">
          <p className="font-mono text-[11px] uppercase tracking-wider text-light">
            {data ? "Everybody on the tarmac" : "Loading"}
          </p>
        </div>
      )}
      {data && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2">
          <Threshold value={data.minKmh} onSave={setMinKmh} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint">Off track is estimated from the map</span>
        </div>
      )}
    </section>
  );
}
