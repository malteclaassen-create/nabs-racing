import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
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
  const { current: currentSeason } = useSeason();
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  const remote = useApi(useCallback(() => api.remoteResults("RACE"), []));
  // QUALIFY sessions on the server — for the auto-found qualifying row below.
  const remoteQuali = useApi(useCallback(() => api.remoteResults("QUALIFY"), []));
  const drivers = useMemo(
    () => (teams || []).flatMap((t) => t.drivers.map((d) => ({ ...d, team: t }))),
    [teams]
  );
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const [parsed, setParsed] = useState(null);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ number: "", track: "", date: "" });
  // Where the result goes: "round" = a championship round (by number), or the
  // id of an existing training/special race of the season (those carry no
  // round number and never score, but their results become viewable).
  const [target, setTarget] = useState("round");
  const seasonRaces = useApi(useCallback(() => api.races(currentSeason?.number), [currentSeason?.number]));
  const nonChampRaces = useMemo(
    () =>
      (seasonRaces.data || []).filter(
        (r) => (r.type || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP")) !== "CHAMPIONSHIP"
      ),
    [seasonRaces.data]
  );
  const [remoteId, setRemoteId] = useState("");
  const [remoteQuery, setRemoteQuery] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  // Optional qualifying JSON riding along with the race import: uploaded to the
  // committed race right after the results save (auto-matched, no review step).
  const [qualiFile, setQualiFile] = useState(null);
  // Standalone quali attach (for past races): target race + file + status.
  const [qualiRaceId, setQualiRaceId] = useState("");
  const [qualiBusy, setQualiBusy] = useState(false);
  const [qualiNote, setQualiNote] = useState(null);
  // The server-side option of the standalone attach: picking a stored race
  // auto-suggests the matching QUALIFY session (same circuit, same day —
  // preferring the newest that day). Falls back to a track-only match for
  // races whose stored date is missing.
  const [qualiAttachRemoteId, setQualiAttachRemoteId] = useState("");
  const [qualiAttachAuto, setQualiAttachAuto] = useState(false);
  useEffect(() => {
    const race = (seasonRaces.data || []).find((r) => r.id === qualiRaceId);
    if (!race) {
      setQualiAttachRemoteId("");
      setQualiAttachAuto(false);
      return;
    }
    const sameTrack = (remoteQuali.data?.results || []).filter(
      (q) => canonicalTrack(q.trackShort) === race.track || (q.trackShort || "").toLowerCase() === (race.track || "").toLowerCase()
    );
    const sameDay = race.date
      ? sameTrack.filter((q) => q.date && q.date.slice(0, 10) === String(race.date).slice(0, 10))
      : [];
    const pick = (sameDay.length ? sameDay : sameTrack).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    setQualiAttachRemoteId(pick?.id || "");
    setQualiAttachAuto(!!pick);
  }, [qualiRaceId, seasonRaces.data, remoteQuali.data]);

  async function attachRemoteQuali() {
    if (!qualiRaceId || !qualiAttachRemoteId) return;
    setQualiNote(null);
    setQualiBusy(true);
    try {
      setQualiNote({ kind: "success", text: qualiSummary(await api.importRemoteQuali(qualiRaceId, qualiAttachRemoteId)) });
    } catch (err) {
      setQualiNote({ kind: "error", text: err.message });
    } finally {
      setQualiBusy(false);
    }
  }

  // One line summarising what a quali upload did, reused by both paths.
  const qualiSummary = (res) =>
    `Qualifying saved (${res.matched}/${res.entries} matched${
      res.unmatched?.length ? `; unmatched: ${res.unmatched.join(", ")}` : ""
    }).`;

  // Remote qualifying, auto-found: picking a race on the server looks for the
  // QUALIFY session of the same event — same circuit, and the closest session
  // in the 6 hours before the race started (quali runs right before the race
  // on race night). The admin can always override or clear the pick.
  const [qualiRemoteId, setQualiRemoteId] = useState("");
  const [qualiAuto, setQualiAuto] = useState(false);
  useEffect(() => {
    const race = (remote.data?.results || []).find((r) => r.id === remoteId);
    if (!race) {
      setQualiRemoteId("");
      setQualiAuto(false);
      return;
    }
    const cands = (remoteQuali.data?.results || [])
      .filter(
        (q) =>
          q.trackShort === race.trackShort &&
          q.ts != null &&
          race.ts != null &&
          q.ts <= race.ts &&
          race.ts - q.ts < 6 * 3600 * 1000
      )
      .sort((a, b) => b.ts - a.ts);
    setQualiRemoteId(cands[0]?.id || "");
    setQualiAuto(!!cands[0]);
  }, [remoteId, remote.data, remoteQuali.data]);

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
          // The safety car appears in the result file as a normal entrant; the
          // backend flags it so we can dim it and leave it unmapped.
          isSafetyCar: !!en.isSafetyCar,
          // Steam GUID (SteamID64) and how the suggestion was made ("steam" =
          // exact GUID, "name" = fuzzy). The GUID is forwarded on commit so the
          // backend can capture it onto the driver for future auto-matching.
          driverGuid: en.driverGuid ?? null,
          matchedBy: en.matchedBy ?? null,
          // Telemetry parsed from the AC file; carried through to the saved
          // result so ratings/race facts update automatically.
          contacts: en.contacts ?? null,
          envContacts: en.envContacts ?? null,
          cuts: en.cuts ?? null,
          overtakes: en.overtakes ?? null,
          lapsLed: en.lapsLed ?? null,
          laps: en.laps ?? null,
          cleanLaps: en.cleanLaps ?? null,
          consistencyMs: en.consistencyMs ?? null,
          consistencyPct: en.consistencyPct ?? null,
          gamePenalties: en.gamePenalties ?? null,
          gamePenaltySeconds: en.gamePenaltySeconds ?? null,
          stints: en.stints ?? null,
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
    if (target === "round" && !meta.number) return setError("Enter a round number.");
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
        // Steam GUID capture: the backend writes it onto Driver.steamId (only
        // when empty; a mismatch is reported, never overwritten). Never for the
        // safety car.
        driverGuid: r.driverGuid ?? null,
        isSafetyCar: !!r.isSafetyCar,
        // AC stores a huge sentinel for "no valid lap" — drop those.
        bestLapMs: r.bestLapMs > 0 && r.bestLapMs <= 1800000 ? r.bestLapMs : null,
        grid: r.grid ?? null,
        totalTimeMs: r.totalTimeMs ?? null,
        contacts: r.contacts ?? null,
        envContacts: r.envContacts ?? null,
        cuts: r.cuts ?? null,
        overtakes: r.overtakes ?? null,
        lapsLed: r.lapsLed ?? null,
        laps: r.laps ?? null,
        cleanLaps: r.cleanLaps ?? null,
        consistencyMs: r.consistencyMs ?? null,
        consistencyPct: r.consistencyPct ?? null,
        gamePenalties: r.gamePenalties ?? null,
        gamePenaltySeconds: r.gamePenaltySeconds ?? null,
        stints: r.stints ?? null,
      }));
      const body = {
        ...(target === "round" ? { number: Number(meta.number) } : { raceId: target }),
        track: meta.track,
        date: meta.date || null,
        // Save into the season the admin is editing (the season switcher),
        // matching the "Editing season: …" banner above the form.
        seasonId: currentSeason?.id,
        // Lets the server file the raw JSON under the right round on commit.
        archiveKey: parsed?.archiveKey || null,
        results,
      };
      let res;
      try {
        res = await api.commitRace(body);
      } catch (err) {
        // Overwrite guard: the round already has stored results. Ask, then
        // commit again with the explicit overwrite flag (a DB backup is taken
        // automatically right before the save).
        if (err.status === 409 && err.data?.needsConfirm) {
          if (!window.confirm(`${err.message}\n\nOverwrite the stored results?`)) {
            setBusy(false);
            return;
          }
          res = await api.commitRace({ ...body, overwrite: true });
        } else {
          throw err;
        }
      }
      // The optional quali rides along: attach it to the race that was just
      // committed — an uploaded file wins over the remote pick. Its failure
      // must never read as a failed race import.
      let qualiMsg = "";
      if ((qualiFile || qualiRemoteId) && res.raceId) {
        try {
          const qres = qualiFile
            ? await api.importQuali(res.raceId, qualiFile)
            : await api.importRemoteQuali(res.raceId, qualiRemoteId);
          qualiMsg = ` ${qualiSummary(qres)}`;
        } catch (err) {
          qualiMsg = ` Qualifying NOT saved: ${err.message}`;
        }
        setQualiFile(null);
        setQualiRemoteId("");
        setQualiAuto(false);
      }
      const conflicts = res.steamIdConflicts || [];
      const conflictNote = conflicts.length
        ? ` Note: ${conflicts.length} Steam ID ${conflicts.length === 1 ? "conflict" : "conflicts"} left unchanged (${conflicts
            .map((c) => c.name)
            .join(", ")}) — check for a mis-mapping or a shared account.`
        : "";
      setDone(
        res.number != null
          ? `Round ${res.number} saved. Standings recalculated.${qualiMsg}${conflictNote}`
          : `Training/event results saved (not scored).${qualiMsg}${conflictNote}`
      );
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
            Pull any finished race, current or past rounds, straight from NABS Server 1. No file
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
              {/* second row: the qualifying session, auto-found for the picked
                  race (same circuit, right before the start). Saved together
                  with the race on confirm. */}
              {remoteId && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="input max-w-sm"
                    value={qualiRemoteId}
                    onChange={(e) => { setQualiRemoteId(e.target.value); setQualiAuto(false); }}
                    disabled={remoteQuali.loading || busy}
                  >
                    <option value="">
                      {remoteQuali.loading ? "Looking for qualifying…" : "No qualifying session"}
                    </option>
                    {(remoteQuali.data?.results || []).map((q) => (
                      <option key={q.id} value={q.id}>
                        {fmtRemote(q)}
                      </option>
                    ))}
                  </select>
                  {qualiAuto && qualiRemoteId && (
                    <span className="pill bg-emerald-500/15 text-emerald-600">qualifying auto-found</span>
                  )}
                </div>
              )}
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

      {/* Qualifying for a race that's already stored (past rounds included):
          pick the race, upload the QUALIFY JSON, done — matching is automatic,
          re-uploading replaces the previous classification. */}
      <div className="card space-y-3 p-5">
        <CardHead eyebrow="Optional" title="Add qualifying to a stored race" />
        <p className="text-sm text-light">
          Attach the AC QUALIFY result JSON to any race of this season, including past rounds. The race then
          shows a Qualifying tab next to its result. Entrants are matched automatically by Steam ID, then name.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input max-w-md"
            value={qualiRaceId}
            onChange={(e) => { setQualiRaceId(e.target.value); setQualiNote(null); }}
            disabled={qualiBusy}
          >
            <option value="">Choose a race…</option>
            {(seasonRaces.data || []).map((r) => (
              <option key={r.id} value={r.id}>
                {(r.number != null ? `Round ${r.number}` : r.type === "TRAINING" ? "Training" : "Event") +
                  ` · ${r.track}` +
                  (r.date ? ` · ${new Date(r.date).toLocaleDateString("en-GB")}` : "")}
              </option>
            ))}
          </select>
          <input
            type="file"
            accept="application/json,.json"
            disabled={!qualiRaceId || qualiBusy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file || !qualiRaceId) return;
              setQualiNote(null);
              setQualiBusy(true);
              try {
                setQualiNote({ kind: "success", text: qualiSummary(await api.importQuali(qualiRaceId, file)) });
              } catch (err) {
                setQualiNote({ kind: "error", text: err.message });
              } finally {
                setQualiBusy(false);
              }
            }}
            className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-primary-dark file:disabled:opacity-50"
          />
        </div>
        {/* …or straight from the race server: the matching QUALIFY session is
            auto-found for the picked race (same circuit, same day). */}
        {qualiRaceId && !remoteQuali.error && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">or from the server:</span>
            <select
              className="input max-w-sm"
              value={qualiAttachRemoteId}
              onChange={(e) => { setQualiAttachRemoteId(e.target.value); setQualiAttachAuto(false); }}
              disabled={remoteQuali.loading || qualiBusy}
            >
              <option value="">
                {remoteQuali.loading ? "Looking for qualifying…" : "Choose a qualifying session…"}
              </option>
              {(remoteQuali.data?.results || []).map((q) => (
                <option key={q.id} value={q.id}>
                  {fmtRemote(q)}
                </option>
              ))}
            </select>
            {qualiAttachAuto && qualiAttachRemoteId && (
              <span className="pill bg-emerald-500/15 text-emerald-600">auto-found</span>
            )}
            <button className="btn-primary" onClick={attachRemoteQuali} disabled={!qualiAttachRemoteId || qualiBusy}>
              {qualiBusy ? "Saving…" : "Attach"}
            </button>
          </div>
        )}
        {qualiBusy && <p className="text-sm text-light">Uploading…</p>}
        {qualiNote && <Notice kind={qualiNote.kind}>{qualiNote.text}</Notice>}
      </div>

      {busy && !parsed && <p className="text-sm text-light">Working…</p>}
      {error && <Notice kind="error">{error}</Notice>}
      {done && <Notice kind="success">{done}</Notice>}

      {parsed && (
        <div className="space-y-4">
          <div className="card grid gap-4 p-5 sm:grid-cols-3">
            {nonChampRaces.length > 0 && (
              <div className="sm:col-span-3">
                <label className="mb-1 block text-sm font-semibold text-medium">Save as</label>
                <select className="input max-w-md" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="round">Championship round (scored, by round number)</option>
                  {nonChampRaces.map((r) => (
                    <option key={r.id} value={r.id}>
                      {(r.type === "TRAINING" ? "Training" : "Event") + ` · ${r.track}` + (r.date ? ` · ${new Date(r.date).toLocaleDateString("en-GB")}` : "") + (r.resultCount > 0 ? " (has results)" : "")}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-light">
                  Training/event results are stored and viewable on the Races page, but never count towards any standings.
                </p>
              </div>
            )}
            {target === "round" && (
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
            )}
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
            <div className="sm:col-span-3">
              <label className="mb-1 block text-sm font-semibold text-medium">
                Qualifying JSON <span className="font-normal text-light">(optional)</span>
              </label>
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => setQualiFile(e.target.files?.[0] || null)}
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface2 file:px-4 file:py-2 file:font-semibold file:text-dark hover:file:bg-border"
              />
              <p className="mt-1 text-xs text-light">
                The AC QUALIFY result JSON of the same event. Saved together with the race: entrants are matched
                automatically (Steam ID first, then name) and the race gets a Qualifying tab on the Races page.
              </p>
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
                      <tr
                        key={i}
                        className={`border-b border-border last:border-0 ${r.isSafetyCar ? "opacity-45" : ""}`}
                      >
                        <td className="px-3 py-2 text-center font-mono">{r.position}</td>
                        <td className="px-3 py-2 text-center font-mono text-xs text-light">{fmtTimeCell(r, leaderMs)}</td>
                        <td className="px-3 py-2 font-medium text-dark">
                          {r.acDriverName}
                          {r.isSafetyCar && (
                            <span className="ml-2 pill bg-surface2 text-light">safety car</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="input py-1"
                            value={r.driverId}
                            onChange={(e) => setRow(i, { driverId: e.target.value, subForTeamId: "", marketFor: null })}
                          >
                            <option value="">Skip this row</option>
                            {drivers.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name} ({d.team.name})
                              </option>
                            ))}
                          </select>
                          {r.driverId && r.matchedBy === "steam" && (
                            <div
                              className="mt-1 font-mono text-[10px] uppercase tracking-wider text-emerald-600"
                              title="Matched by Steam ID, not by name — a certain match"
                            >
                              ✓ matched by Steam ID
                            </div>
                          )}
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
                              {driver ? `Default · ${driver.team.name}` : "Map a driver first"}
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
