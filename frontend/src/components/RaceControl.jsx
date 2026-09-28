import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RotateCcw, ShieldAlert } from "lucide-react";
import { api } from "../api/client.js";
import { useVisiblePoll } from "../hooks/useVisiblePoll.js";

// Race control inside the TV board: collisions and stopped cars from the
// backend (services/liveIncidents.js), for stewards and admins only.

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
  const resetKey = `${server || ""}|${demo || ""}`;

  useEffect(() => {
    seenRef.current = null;
    freshRef.current = new Map();
    setData(null);
  }, [resetKey]);

  useVisiblePoll(
    async (alive) => {
      const d = await api.raceControlIncidents(server, demo).catch(() => null);
      if (!alive() || !d?.ok) return;
      const now = Date.now();
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

  const setStatus = useCallback(
    async (id, status) => {
      setData((d) => d && { ...d, incidents: d.incidents.map((i) => (i.id === id ? { ...i, status } : i)) });
      if (demo) return;
      try {
        await api.setIncidentStatus(id, status);
      } catch {
        setData((d) =>
          d && { ...d, incidents: d.incidents.map((i) => (i.id === id ? { ...i, status: status === "done" ? "open" : "done" } : i)) }
        );
      }
    },
    [demo]
  );

  const setMinKmh = useCallback(async (v) => {
    const r = await api.setRaceControlMinKmh(v);
    setData((d) => d && { ...d, minKmh: r.minKmh });
    return r.minKmh;
  }, []);

  return { data, isFresh, setStatus, setMinKmh };
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

function wallClock(at) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

function Row({ inc, match, onStatus }) {
  const meta = INCIDENT_META[inc.type] || INCIDENT_META.car;
  const { a, b } = incidentNames(inc, match);
  const done = inc.status === "done";
  const clock = fmtRaceClock(inc.raceMs) || wallClock(inc.at);
  let detail = null;
  if (inc.type === "stopped") {
    detail = inc.endedAt ? `Moving again after ${Math.max(1, Math.round((inc.endedAt - inc.at) / 1000))} s` : "Still stopped";
  } else if (inc.speedKmh != null) {
    detail = `${Math.round(inc.speedKmh)} km/h`;
  }
  return (
    <li className={`flex items-center gap-3 px-4 py-2 transition-opacity ${done ? "opacity-45" : ""}`}>
      <span className="w-14 shrink-0 font-mono text-xs tabular-nums text-light">{clock}</span>
      <span className={`w-[4.25rem] shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-bold uppercase tracking-wider ${meta.chip}`}>
        {meta.label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-dark">
          {a}
          {b && <span className="font-normal text-light"> with </span>}
          {b}
        </span>
        {detail && <span className="block truncate font-mono text-[11px] text-light">{detail}</span>}
      </span>
      <button
        type="button"
        onClick={() => onStatus(inc.id, done ? "open" : "done")}
        title={done ? "Open again" : "Mark as handled"}
        aria-label={done ? "Open again" : "Mark as handled"}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-light transition hover:bg-surface2 hover:text-dark"
      >
        {done ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
      </button>
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
      Ignore contacts under
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

// The list, newest first, with the stopped cars on top.
export function RaceControlPanel({ rc, match, className = "" }) {
  const { data, setStatus, setMinKmh } = rc;
  const incidents = data?.incidents || [];
  const stopped = data?.stopped || [];
  const open = incidents.filter((i) => i.status !== "done").length;
  const nm = (n) => (n && match ? match(n)?.nabsName : null) || n || "Unknown";
  return (
    <section className={`flex flex-col overflow-hidden rounded-2xl border border-border bg-card ${className}`}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Incidents</span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-light">
          {data ? `${open} open` : "Loading"}
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
      {incidents.length ? (
        <ul className="scrollbar-slim min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {incidents.map((i) => (
            <Row key={i.id} inc={i} match={match} onStatus={setStatus} />
          ))}
        </ul>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6 text-center">
          <p className="font-mono text-[11px] uppercase tracking-wider text-light">
            {data ? "Nothing yet this session" : "Loading incidents"}
          </p>
        </div>
      )}
      {data && (
        <div className="shrink-0 border-t border-border px-4 py-2">
          <Threshold value={data.minKmh} onSave={setMinKmh} />
        </div>
      )}
    </section>
  );
}
