import { useCallback, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox } from "./ui.jsx";

// Admin: link a person's per-season driver rows together so career stats
// aggregate and archive tables show their current name with a "raced as <old>"
// note. Suggestions are same-name rows spanning more than one season; the manual
// linker covers people who changed handles between seasons.
function seasonLabel(d) {
  return d.seasonName || (d.seasonNumber != null ? `Season ${d.seasonNumber}` : "—");
}

export default function AdminPersons() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.adminPersons(), []));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [picks, setPicks] = useState([]); // driverIds selected in the manual linker

  const drivers = data?.drivers || [];
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  async function run(fn) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const linkGroup = (ids) => run(() => api.linkPersons(ids));
  const unlink = (driverId) => run(() => api.unlinkPerson(driverId));

  function addPick(id) {
    if (id && !picks.includes(id)) setPicks((p) => [...p, id]);
  }

  if (error) return <ErrorBox message={error} />;

  return (
    <div className="card p-5">
      <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Same person across seasons</h3>
      <p className="mt-1 text-sm text-light">
        Group a driver&rsquo;s entries from different seasons under one person. Their profile then shows a combined career,
        and older seasons display their current name with a small &ldquo;raced as&rdquo; note.
      </p>
      {msg && <div className="mt-3"><ErrorBox message={msg} /></div>}
      {loading && <p className="mt-3 text-sm text-light">Loading…</p>}

      {/* suggestions: identical names spanning seasons, not yet linked */}
      {data?.candidates?.length > 0 && (
        <div className="mt-4">
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Suggestions</div>
          <ul className="mt-2 space-y-2">
            {data.candidates.map((group, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface2/60 px-3 py-2">
                <span className="font-semibold text-dark">{group[0].name}</span>
                <span className="flex flex-wrap gap-1.5">
                  {group.map((d) => (
                    <span key={d.id} className="pill bg-card text-light">{seasonLabel(d)}</span>
                  ))}
                </span>
                <button
                  className="btn-primary ml-auto py-1 text-sm disabled:opacity-50"
                  disabled={busy}
                  onClick={() => linkGroup(group.map((d) => d.id))}
                >
                  Link these
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* manual linker: build a group from arbitrary rows */}
      <div className="mt-5 rounded-lg border border-border p-3">
        <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Link manually</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select className="input max-w-xs py-1.5 text-sm" value="" onChange={(e) => addPick(e.target.value)} disabled={busy}>
            <option value="">Add a driver entry…</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {seasonLabel(d)}{d.teamName ? ` · ${d.teamName}` : ""}
              </option>
            ))}
          </select>
          {picks.map((id) => (
            <span key={id} className="pill bg-surface2 text-dark">
              {driverById.get(id)?.name} ({driverById.get(id)?.seasonNumber ?? "?"})
              <button className="ml-1.5 text-light hover:text-dark" onClick={() => setPicks((p) => p.filter((x) => x !== id))}>×</button>
            </span>
          ))}
          {picks.length >= 2 && (
            <button
              className="btn-primary py-1 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => run(async () => { await api.linkPersons(picks); setPicks([]); })}
            >
              Link {picks.length}
            </button>
          )}
        </div>
      </div>

      {/* existing linked groups */}
      {data?.persons?.length > 0 && (
        <div className="mt-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Linked people</div>
          <ul className="mt-2 space-y-2">
            {data.persons.map((p) => (
              <li key={p.personId} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface2/60 px-3 py-2">
                {p.drivers.map((d) => (
                  <span key={d.id} className="pill bg-card text-dark">
                    {d.name} · {seasonLabel(d)}
                    <button className="ml-1.5 text-light hover:text-red-600" disabled={busy} onClick={() => unlink(d.id)}>×</button>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
