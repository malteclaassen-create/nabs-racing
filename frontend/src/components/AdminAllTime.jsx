import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { ErrorBox, DriverAvatar, CardHead } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";

// Admin "All time" tab: one search box across EVERY season of the series the
// admin is editing. Unlike the public NavBar search (which collapses a person
// to one career entry), every season row shows up separately, each with a
// jump button that switches the admin to that season and opens the right tab.

function SeasonChip({ item }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${
        item.seasonActive ? "bg-emerald-500/15 text-emerald-600" : "bg-surface2 text-medium"
      }`}
    >
      {item.seasonName || (item.seasonNumber != null ? `Season ${item.seasonNumber}` : "?")}
    </span>
  );
}

function JumpButton({ label, onClick }) {
  return (
    <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={onClick}>
      {label}
      <svg viewBox="0 0 24 24" className="ml-1 inline h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </button>
  );
}

function Section({ title, count, children }) {
  return (
    <div className="card p-4">
      <CardHead title={title}>
        <span className="font-mono text-xs text-light">{count}</span>
      </CardHead>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

export default function AdminAllTime({ gotoTab }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const seq = useRef(0);

  // Debounced search; stale responses are dropped via the sequence counter.
  useEffect(() => {
    clearTimeout(timer.current);
    const query = q.trim();
    if (query.length < 2) {
      setData(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    timer.current = setTimeout(async () => {
      const mySeq = ++seq.current;
      try {
        const res = await api.adminSearch(query);
        if (mySeq !== seq.current) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (mySeq !== seq.current) return;
        setError(e.message);
      } finally {
        if (mySeq === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q]);

  const drivers = data?.drivers || [];
  const teams = data?.teams || [];
  const races = data?.races || [];
  const empty = data && !drivers.length && !teams.length && !races.length;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="mb-1 font-display text-lg font-bold uppercase tracking-tight text-dark">All-time search</h3>
        <p className="mb-3 text-sm text-light">
          Search drivers, teams and races across every season of this series, private seasons included. Each result
          jumps you to the right season and tab to edit it.
        </p>
        <div className="relative max-w-md">
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-light" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            className="input w-full pl-9"
            placeholder="Name, team or track"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {busy && <div className="text-sm text-light">Searching all seasons...</div>}
      {empty && !busy && <div className="text-sm text-light">Nothing found in any season for "{data.query}".</div>}

      {drivers.length > 0 && (
        <Section title="Drivers" count={drivers.length}>
          {drivers.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 py-2">
              <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={d.teamColor || "#888"} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-dark">{d.name}</span>
                  <SeasonChip item={d} />
                </div>
                <div className="truncate text-xs text-light">
                  {[d.teamName, d.discordName && d.discordName !== d.name ? d.discordName : null]
                    .filter(Boolean)
                    .join(" · ") || "No team"}
                </div>
              </div>
              <JumpButton label="Edit in Drivers" onClick={() => gotoTab("drivers", d.seasonNumber)} />
            </div>
          ))}
        </Section>
      )}

      {teams.length > 0 && (
        <Section title="Teams" count={teams.length}>
          {teams.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 py-2">
              <TeamLogo id={t.id} name={t.name} color={t.color} logoUrl={t.logoUrl} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-dark">{t.name}</span>
                  <SeasonChip item={t} />
                </div>
                <div className="text-xs text-light">{t.tier === 0 ? "Reserve pool" : `Tier ${t.tier}`}</div>
              </div>
              <JumpButton label="Edit in Teams" onClick={() => gotoTab("teams", t.seasonNumber)} />
            </div>
          ))}
        </Section>
      )}

      {races.length > 0 && (
        <Section title="Races" count={races.length}>
          {races.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-dark">{r.track}</span>
                  <SeasonChip item={r} />
                </div>
                <div className="text-xs text-light">
                  {[
                    r.isSpecialEvent ? "Training/Event" : r.number != null ? `Round ${r.number}` : "Race",
                    r.date ? new Date(r.date).toLocaleDateString() : null,
                    r.isCompleted ? "Finished" : "Not run yet",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <JumpButton label="Races & Events" onClick={() => gotoTab("discord", r.seasonNumber)} />
                {r.isCompleted && <JumpButton label="Edit Results" onClick={() => gotoTab("edit", r.seasonNumber)} />}
              </div>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
