import { useCallback, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { Notice, CardHead } from "./ui.jsx";
import RacePreview from "./RacePreview.jsx";
import { canonicalTrack } from "../data/circuits.js";
import { fmtTimeCell } from "../utils/raceDuration.js";

const STATUSES = ["FINISHED", "DNS", "DNF", "DSQ"];

function fmtRemote(r) {
  const d = r.date ? new Date(r.date) : null;
  const when = d
    ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : r.id;
  return `${when} · ${r.trackShort || r.track || r.type}`;
}

export default function AdminImport({ onCommitted }) {
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  const remote = useApi(useCallback(() => api.remoteResults("RACE"), []));
  const drivers = useMemo(
    () => (teams || []).flatMap((t) => t.drivers.map((d) => ({ ...d, team: t }))),
    [teams]
  );
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const [parsed, setParsed] = useState(null);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ number: "", track: "", date: "" });
  const [remoteId, setRemoteId] = useState("");
  const [remoteQuery, setRemoteQuery] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  // Shared: turn a parsed AC result (from upload or server) into the review form.
  function applyParsed(res) {
    setParsed(res);
    const trackName = canonicalTrack(res.track) || "";
    setMeta((m) => ({
      ...m,
      track: trackName,
      date: res.date ? String(res.date).slice(0, 10) : "",
    }));
    // Driver Market: pre-fill the "team this race" column for reserves who were
    // picked to sub. Prefer takeovers whose race matches this file's track; fall
    // back to all confirmed takeovers when none match (the admin still confirms
    // against who actually drove).
    const takeovers = res.seatTakeovers || [];
    const matching = takeovers.filter((t) => t.track && t.track === trackName);
    const pool = matching.length ? matching : takeovers;
    const takeoverByDriver = new Map(pool.map((t) => [t.reserveDriverId, t]));
    setRows(
      res.entries.map((en) => {
        const driverId = en.suggestedDriverId || "";
        const takeover = driverId ? takeoverByDriver.get(driverId) : null;
        return {
          acDriverName: en.acDriverName,
          position: en.position,
          driverId,
          status: en.disqualified ? "DSQ" : "FINISHED",
          subForTeamId: takeover ? takeover.teamId : "",
          marketFor: takeover ? takeover.forName : null,
          penaltySeconds: 0,
          bestLapMs: en.bestLap || null,
          grid: en.grid ?? null,
          totalTimeMs: en.totalTimeMs ?? null,
          suggestions: en.suggestions,
        };
      })
    );
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      applyParsed(await api.importRace(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadRemote() {
    if (!remoteId) return;
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      applyParsed(await api.importRemoteResult(remoteId));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function setRow(i, patch) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function commit() {
    setError(null);
    if (!meta.number) return setError("Enter a round number.");
    const mapped = rows.filter((r) => r.driverId);
    const dupes = mapped.map((r) => r.driverId).filter((id, i, a) => a.indexOf(id) !== i);
    if (dupes.length) return setError("A driver is mapped to more than one entry.");

    setBusy(true);
    try {
      const results = mapped.map((r) => ({
        driverId: r.driverId,
        position: r.position,
        status: r.status,
        subForTeamId: r.subForTeamId || null,
        penaltySeconds: Number(r.penaltySeconds) || 0,
        // AC stores a huge sentinel for "no valid lap" — drop those.
        bestLapMs: r.bestLapMs > 0 && r.bestLapMs <= 1800000 ? r.bestLapMs : null,
        grid: r.grid ?? null,
        totalTimeMs: r.totalTimeMs ?? null,
      }));
      const res = await api.commitRace({
        number: Number(meta.number),
        track: meta.track,
        date: meta.date || null,
        results,
      });
      setDone(`Round ${res.number} saved. Standings recalculated.`);
      setParsed(null);
      setRows([]);
      setRemoteId("");
      onCommitted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Leader's race time (fastest total among finishers) -> drives the gap column.
  const leaderMs = useMemo(() => {
    const t = rows.filter((r) => r.status === "FINISHED" && r.totalTimeMs > 0).map((r) => r.totalTimeMs);
    return t.length ? Math.min(...t) : null;
  }, [rows]);

  const remoteList = remote.data?.results || [];
  const filteredRemote = remoteQuery.trim()
    ? remoteList.filter((r) =>
        `${r.dateStr || ""} ${r.track || ""}`.toLowerCase().includes(remoteQuery.trim().toLowerCase())
      )
    : remoteList;

  return (
    <div className="space-y-5">
      <div className="card space-y-5 p-5">
        <CardHead eyebrow="Step 1" title="Import a race result" />

        {/* Source A — straight from the race server */}
        <div className="rounded-xl border border-border bg-surface2/40 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-bold uppercase tracking-tight text-dark">
              From the race server
            </span>
            <span className="pill bg-emerald-500/15 text-emerald-600">recommended · penalty-corrected</span>
          </div>
          <p className="mt-1 text-sm text-light">
            Pull any finished race — current or past rounds — straight from NABS Server 1, no file
            export needed.
          </p>
          {remote.error ? (
            <p className="mt-3 text-sm text-amber-600">
              Couldn’t reach the race server. Use the file upload below instead.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {remoteList.length > 8 && (
                <input
                  className="input max-w-sm"
                  placeholder="Filter by track or date… (e.g. Monza, Spa)"
                  value={remoteQuery}
                  onChange={(e) => setRemoteQuery(e.target.value)}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <select
                  className="input max-w-sm"
                  value={remoteId}
                  onChange={(e) => setRemoteId(e.target.value)}
                  disabled={remote.loading || busy}
                >
                  <option value="">
                    {remote.loading
                      ? "Loading sessions…"
                      : remoteList.length
                      ? `Choose a race… (${filteredRemote.length})`
                      : "No races on server"}
                  </option>
                  {filteredRemote.map((r) => (
                    <option key={r.id} value={r.id}>
                      {fmtRemote(r)}
                    </option>
                  ))}
                </select>
                <button className="btn-primary" onClick={loadRemote} disabled={!remoteId || busy}>
                  {busy ? "Loading…" : "Load"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* divider */}
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider text-faint">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* Source B — manual file upload */}
        <div>
          <div className="font-display text-sm font-bold uppercase tracking-tight text-dark">
            Upload a result file
          </div>
          <p className="mt-1 text-sm text-light">
            The AC result JSON exported from Content Manager / AC Server. Driver names are
            fuzzy-matched; review and confirm the mapping before saving.
          </p>
          <input
            type="file"
            accept="application/json,.json"
            onChange={handleFile}
            className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-primary-dark"
          />
        </div>
      </div>

      {busy && !parsed && <p className="text-sm text-light">Working…</p>}
      {error && <Notice kind="error">{error}</Notice>}
      {done && <Notice kind="success">{done}</Notice>}

      {parsed && (
        <div className="space-y-4">
          <div className="card grid gap-4 p-5 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-semibold text-medium">Round #</label>
              <input
                className="input"
                type="number"
                value={meta.number}
                onChange={(e) => setMeta((m) => ({ ...m, number: e.target.value }))}
                placeholder="10"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-medium">Track</label>
              <input
                className="input"
                value={meta.track}
                onChange={(e) => setMeta((m) => ({ ...m, track: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-medium">Date</label>
              <input
                className="input"
                type="date"
                value={meta.date}
                onChange={(e) => setMeta((m) => ({ ...m, date: e.target.value }))}
              />
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface2 text-left text-light">
                    <th className="px-3 py-2 text-center" title="Finishing position from the race file">Finish</th>
                    <th className="px-3 py-2 text-center" title="Total race time (leader) or gap behind the leader">Time / Gap</th>
                    <th className="px-3 py-2">AC Name</th>
                    <th className="px-3 py-2">Driver</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Team (this race)</th>
                    <th
                      className="px-3 py-2 text-center"
                      title="Time penalty in seconds (e.g. 5 or 10). It's added to the driver's race time and the field is re-sorted. The preview below updates live."
                    >
                      Penalty (sec)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const driver = driverById.get(r.driverId);
                    return (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-center font-mono">{r.position}</td>
                        <td className="px-3 py-2 text-center font-mono text-xs text-light">{fmtTimeCell(r, leaderMs)}</td>
                        <td className="px-3 py-2 font-medium text-dark">{r.acDriverName}</td>
                        <td className="px-3 py-2">
                          <select
                            className="input py-1"
                            value={r.driverId}
                            onChange={(e) => setRow(i, { driverId: e.target.value, subForTeamId: "", marketFor: null })}
                          >
                            <option value="">— skip —</option>
                            {drivers.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name} ({d.team.name})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="input py-1"
                            value={r.status}
                            onChange={(e) => setRow(i, { status: e.target.value })}
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="input py-1 disabled:opacity-40"
                            disabled={!r.driverId}
                            value={r.subForTeamId}
                            onChange={(e) => setRow(i, { subForTeamId: e.target.value })}
                          >
                            <option value="">
                              {driver ? `Default · ${driver.team.name}` : "— map a driver first —"}
                            </option>
                            {(teams || [])
                              .filter((t) => t.tier === 1 || t.tier === 2)
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            {(teams || [])
                              .filter((t) => t.tier === 0)
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  No team ({t.name})
                                </option>
                              ))}
                          </select>
                          {r.marketFor && r.subForTeamId && (
                            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-emerald-600">
                              ↩ Driver Market · for {r.marketFor}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            className="input w-16 py-1 text-center"
                            type="number"
                            min="0"
                            step="5"
                            value={r.penaltySeconds}
                            onChange={(e) => setRow(i, { penaltySeconds: e.target.value })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <RacePreview request={{ number: meta.number, results: rows }} />

          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={commit} disabled={busy}>
              {busy ? "Saving…" : "Confirm & save round"}
            </button>
            <button className="btn-secondary" onClick={() => setParsed(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
