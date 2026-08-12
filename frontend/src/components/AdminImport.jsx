import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { Notice, CardHead, Field } from "./ui.jsx";
import RacePreview from "./RacePreview.jsx";
import { useAsk } from "./overlay.jsx";
import { canonicalTrack } from "../data/circuits.js";
import { fmtTimeCell } from "../utils/raceDuration.js";
import { fmtStamp } from "../utils/format.js";

const STATUSES = ["FINISHED", "DNS", "DNF", "DSQ"];

// The round is picked FIRST and everything below is scoped to it. This value
// stands for the one case the calendar can't answer: a round that was raced but
// never entered, which is created on the fly from a typed number.
const NEW_ROUND = "new";

// How far from a round's stored date a server session may sit and still be
// taken for that round's session. Wide enough for a date stored as a bare day
// in either timezone and a race that rolls past midnight, tight enough that
// last season's visit to the same circuit can never be mistaken for this one.
const BEFORE_MS = 12 * 3600 * 1000;
const AFTER_MS = 30 * 3600 * 1000;

function fmtRemote(r) {
  const d = r.date ? new Date(r.date) : null;
  const when = d
    ? fmtStamp(d)
    : r.id;
  return `${when} · ${r.trackShort || r.track || r.type}`;
}

// "Round 9 · Spa · 12 Aug 2026" — how a race of this season reads in a picker.
function raceLabel(r) {
  const kind = r.number != null ? `Round ${r.number}` : r.type === "TRAINING" ? "Training" : "Event";
  return `${kind} · ${r.track}${r.date ? ` · ${fmtStamp(r.date)}` : ""}`;
}

// What the picker says about a race without the admin having to open it.
function raceState(r) {
  if (!r.resultCount) return "nothing imported yet";
  return r.hasQuali ? "race + qualifying" : "race only, no qualifying";
}

// Does `name` contain `token` as a whole word? The guard that lets a three
// letter circuit be looked for at all: "Spa" is in "Spa 2022" and in
// "Circuit de Spa-Francorchamps", but not in "Spain".
function wordHit(name, token) {
  if (!name || !token) return false;
  const t = String(token).replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`, "i").test(String(name));
}

// Is this server session run at the round's circuit? The calendar names a
// circuit the way people do ("Hockenheim"); the server names it the way the
// MOD does ("NABS Hockenheim 2026", "Spa 2022", "Hockenheim - GP - LFM"). So:
// resolve both and compare, and failing that look for the round's circuit as a
// whole word inside the session's name.
function sameCircuit(session, track) {
  if (!track) return false;
  const name = session.trackShort || session.track || "";
  const canon = canonicalTrack(track);
  return canonicalTrack(name) === canon || wordHit(name, canon) || wordHit(name, track);
}

// The server session that belongs to a round: same circuit, on the round's
// race night. Several the same evening (a practice race before the real one)
// resolve to the last, which is how a race night runs. Returns null when the
// round has no date to compare against — guessing from the circuit alone would
// happily hand back the same race from a previous season.
function sessionForRace(sessions, track, dateIso) {
  if (!track || !dateIso) return null;
  const ts = new Date(dateIso).getTime();
  if (!Number.isFinite(ts)) return null;
  return (
    (sessions || [])
      .filter((s) => s.ts != null && s.ts > ts - BEFORE_MS && s.ts < ts + AFTER_MS && sameCircuit(s, track))
      .sort((a, b) => b.ts - a.ts)[0] || null
  );
}

// A select of server sessions with the picked round's circuit lifted to the
// top. Same list either way, just ordered so the right one isn't hunted for.
function SessionOptions({ sessions, track }) {
  if (!track) {
    return sessions.map((s) => (
      <option key={s.id} value={s.id}>
        {fmtRemote(s)}
      </option>
    ));
  }
  const here = sessions.filter((s) => sameCircuit(s, track));
  const rest = sessions.filter((s) => !sameCircuit(s, track));
  return (
    <>
      {here.length > 0 && (
        <optgroup label={`At ${track}`}>
          {here.map((s) => (
            <option key={s.id} value={s.id}>
              {fmtRemote(s)}
            </option>
          ))}
        </optgroup>
      )}
      {rest.length > 0 && (
        <optgroup label="Other sessions">
          {rest.map((s) => (
            <option key={s.id} value={s.id}>
              {fmtRemote(s)}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

export default function AdminImport({ onCommitted }) {
  const ask = useAsk();
  const { current: currentSeason } = useSeason();
  const { data: teams, reload: reloadTeams } = useApi(useCallback(() => api.teams(), []));
  const remote = useApi(useCallback(() => api.remoteResults("RACE"), []));
  // QUALIFY sessions on the server — for the auto-found qualifying row below.
  const remoteQuali = useApi(useCallback(() => api.remoteResults("QUALIFY"), []));
  const seasonRaces = useApi(useCallback(() => api.races(currentSeason?.number), [currentSeason?.number]));
  const drivers = useMemo(
    () => (teams || []).flatMap((t) => t.drivers.map((d) => ({ ...d, team: t }))),
    [teams]
  );
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const [parsed, setParsed] = useState(null);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ track: "", date: "" });

  // Step 1 — the race this import is for. Chosen before any file is touched,
  // because it decides everything else on this page: which server session is
  // the right one, whether a result is being added or replaced, and whether
  // attaching a qualifying is even possible yet. It also removes the old
  // "save as / round number" pair at the bottom, which asked the same question
  // a second time, after the work.
  const [targetRaceId, setTargetRaceId] = useState("");
  const [newRoundNumber, setNewRoundNumber] = useState("");
  const targetRace = useMemo(
    () => (seasonRaces.data || []).find((r) => r.id === targetRaceId) || null,
    [seasonRaces.data, targetRaceId]
  );
  const hasTarget = targetRaceId === NEW_ROUND ? Number(newRoundNumber) > 0 : !!targetRace;
  const champRaces = (seasonRaces.data || []).filter(
    (r) => (r.type || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP")) === "CHAMPIONSHIP"
  );
  const otherRaces = (seasonRaces.data || []).filter(
    (r) => (r.type || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP")) !== "CHAMPIONSHIP"
  );
  // Where the result goes on save, in the shape the commit endpoint wants.
  const targetBody = targetRace ? { raceId: targetRace.id } : { number: Number(newRoundNumber) };

  const [remoteId, setRemoteId] = useState("");
  const [remoteAuto, setRemoteAuto] = useState(false);
  const [remoteQuery, setRemoteQuery] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  // Optional qualifying JSON riding along with the race import: uploaded to the
  // committed race right after the results save (auto-matched, no review step).
  const [qualiFile, setQualiFile] = useState(null);
  // Standalone quali attach, for a race whose result is already stored.
  const [qualiBusy, setQualiBusy] = useState(false);
  const [qualiNote, setQualiNote] = useState(null);

  // Picking the round pre-selects its session on the race server: same circuit,
  // same race night. Keyed on the plain values rather than the race object so a
  // background refresh of the calendar doesn't quietly re-pick.
  const targetTrack = targetRace?.track || "";
  const targetDate = targetRace?.date ? String(targetRace.date) : "";
  useEffect(() => {
    const pick = sessionForRace(remote.data?.results, targetTrack, targetDate);
    setRemoteId(pick?.id || "");
    setRemoteAuto(!!pick);
  }, [targetTrack, targetDate, remote.data]);

  // The standalone attach's server pick, same idea. Here a circuit-only match
  // is an acceptable fallback for dateless archive rounds: a wrong qualifying
  // is one re-upload away from being replaced, unlike a wrong race result.
  const [qualiAttachRemoteId, setQualiAttachRemoteId] = useState("");
  const [qualiAttachAuto, setQualiAttachAuto] = useState(false);
  useEffect(() => {
    if (!targetTrack) {
      setQualiAttachRemoteId("");
      setQualiAttachAuto(false);
      return;
    }
    const list = remoteQuali.data?.results || [];
    const pick =
      sessionForRace(list, targetTrack, targetDate) ||
      (targetDate
        ? null
        : list.filter((q) => sameCircuit(q, targetTrack)).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0]) ||
      null;
    setQualiAttachRemoteId(pick?.id || "");
    setQualiAttachAuto(!!pick);
  }, [targetTrack, targetDate, remoteQuali.data]);

  async function attachRemoteQuali() {
    if (!targetRace || !qualiAttachRemoteId) return;
    setQualiNote(null);
    setQualiBusy(true);
    try {
      setQualiNote({ kind: "success", text: qualiSummary(await api.importRemoteQuali(targetRace.id, qualiAttachRemoteId)) });
      seasonRaces.reload();
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
  // on race night). The admin can always override or clear the pick. When one
  // is found it rides along on save, and the review form below drops its own
  // qualifying upload: the session is already accounted for.
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

  // The picked qualifying session, spelled out where the upload used to be.
  const pickedQuali = (remoteQuali.data?.results || []).find((q) => q.id === qualiRemoteId) || null;

  // Shared: turn a parsed AC result (from upload or server) into the review form.
  function applyParsed(res) {
    setParsed(res);
    const trackName = canonicalTrack(res.track) || "";
    setMeta({
      track: trackName,
      date: res.date ? String(res.date).slice(0, 10) : "",
    });
    // Driver Market: pre-fill the "team this race" column for reserves who were
    // picked to sub. Prefer takeovers whose race matches this file's track; fall
    // back to all confirmed takeovers when none match (the admin still confirms
    // against who actually drove).
    const takeovers = res.seatTakeovers || [];
    const matching = takeovers.filter((t) => t.track && t.track === trackName);
    const pool = matching.length ? matching : takeovers;
    const takeoverByDriver = new Map(pool.map((t) => [t.reserveDriverId, t]));
    // A fresh file is a fresh table: an acknowledgement earned on the previous
    // one must not carry over and let this one save on a single press.
    setSkipsAcknowledged(false);
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
          // Drives the safety car most weekends, but not in this car. The row
          // behaves like any other; the badge just says why it wasn't guessed.
          maybeSafetyCar: !!en.maybeSafetyCar,
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
    // The warning names people. Touch the table and it has to be re-earned,
    // otherwise a second Save could ship a list nobody has actually read.
    setSkipsAcknowledged(false);
  }

  // An entrant who isn't on this season's roster yet but clearly raced: create
  // them on the spot (into the reserve pool by default) and map the row to the
  // fresh driver. A KNOWN person (same Steam GUID or same name in the series'
  // driver database) is added via from-db, so identity, Discord link and
  // career carry over — only a genuinely new name gets a blank row. This is
  // the "only add people who actually raced" workflow.
  const [creatingRow, setCreatingRow] = useState(null);
  // Flips true on the first Save press while entrants are still unmapped, which
  // turns the button into an explicit "yes, without them". Any change to the
  // mapping clears it, so the warning always describes the CURRENT table.
  const [skipsAcknowledged, setSkipsAcknowledged] = useState(false);
  async function createFromRow(i) {
    const r = rows[i];
    if (!r?.acDriverName) return;
    const reserve = (teams || []).find((t) => t.tier === 0) || (teams || [])[0];
    if (!reserve) return setError("No team to create the driver in. Create a team first.");
    setCreatingRow(i);
    setError(null);
    try {
      let known = null;
      try {
        const db = await api.adminDriverDb();
        known = (db.entries || []).find(
          (e) =>
            (r.driverGuid && e.steamId && e.steamId === r.driverGuid) ||
            e.name.trim().toLowerCase() === r.acDriverName.trim().toLowerCase()
        );
      } catch {
        /* database unreachable: fall through to a fresh row */
      }
      const d = known
        ? await api.addDriverFromDb(known.sourceDriverId, reserve.id)
        : await api.createDriver({
            name: r.acDriverName.trim(),
            discordName: r.acDriverName.trim(),
            teamId: reserve.id,
            tier: reserve.tier,
          });
      setRow(i, { driverId: d.id });
      reloadTeams(); // the new driver appears in every row's picker
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingRow(null);
    }
  }

  // Entrants that will NOT reach the results. "Skip this row" is a real choice
  // and the dropdown says so — but it is also the DEFAULT for anyone the
  // matcher could not identify (rows start at `suggestedDriverId || ""`). So a
  // driver the import failed to recognise looks exactly like a driver the admin
  // deliberately left out, and on a twenty-car grid one missed picker means a
  // silent hole in the championship behind a green "Round saved". The safety
  // car is excluded on purpose and is never part of this.
  const willBeSkipped = rows.filter((r) => !r.driverId && !r.isSafetyCar);

  async function commit() {
    setError(null);
    if (!hasTarget) return setError("Choose the race this result belongs to first.");
    // Name them and make the admin press again. Not a block: leaving someone
    // out is legitimate. The point is that it has to be a decision.
    if (willBeSkipped.length && !skipsAcknowledged) {
      setSkipsAcknowledged(true);
      return;
    }
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
        ...targetBody,
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
          if (!(await ask({ title: "Overwrite the stored results?", body: err.message, danger: true, confirmLabel: "Overwrite results" }))) {
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
            .join(", ")}). Check for a mis-mapping or a shared account.`
        : "";
      setDone(
        res.number != null
          ? `Round ${res.number} saved. Standings recalculated.${qualiMsg}${conflictNote}`
          : `Training/event results saved (not scored).${qualiMsg}${conflictNote}`
      );
      setParsed(null);
      setRows([]);
      // A round created from a typed number now exists in the calendar, so the
      // picker can hold it like any other. Refresh and select it, which also
      // opens the qualifying card underneath for the session that just ran.
      seasonRaces.reload();
      if (targetRaceId === NEW_ROUND && res.raceId) {
        setTargetRaceId(res.raceId);
        setNewRoundNumber("");
      }
      setSkipsAcknowledged(false);
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
      {/* Step 1 — the round. Nothing else on the page opens until this is
          answered, because every later question depends on it. */}
      <div className="card space-y-3 p-5">
        <CardHead eyebrow="Step 1" title="Which race is this for?" />
        <p className="text-sm text-light">
          Pick the round of {currentSeason ? `Season ${currentSeason.number}` : "this season"} the result belongs
          to. The right session on the race server is then found for you, and what you can do with it depends on
          what that round already has.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Race this import is for"
            className="input max-w-md"
            value={targetRaceId}
            onChange={(e) => {
              setTargetRaceId(e.target.value);
              setNewRoundNumber("");
              setQualiNote(null);
              setDone(null);
            }}
            disabled={seasonRaces.loading || busy}
          >
            <option value="">{seasonRaces.loading ? "Loading the calendar…" : "Choose a race…"}</option>
            {champRaces.length > 0 && (
              <optgroup label="Championship rounds">
                {champRaces.map((r) => (
                  <option key={r.id} value={r.id}>
                    {`${raceLabel(r)} · ${raceState(r)}`}
                  </option>
                ))}
              </optgroup>
            )}
            {otherRaces.length > 0 && (
              <optgroup label="Training and events">
                {otherRaces.map((r) => (
                  <option key={r.id} value={r.id}>
                    {`${raceLabel(r)} · ${raceState(r)}`}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Not in the calendar">
              <option value={NEW_ROUND}>A round that isn’t in the calendar yet…</option>
            </optgroup>
          </select>
          {targetRaceId === NEW_ROUND && (
            <input
              aria-label="Round number"
              className="input w-32"
              type="number"
              min="1"
              value={newRoundNumber}
              onChange={(e) => setNewRoundNumber(e.target.value)}
              placeholder="Round #"
            />
          )}
        </div>
        {targetRace && (
          <p className="text-sm text-medium">
            {targetRace.resultCount > 0
              ? `${targetRace.resultCount} results are stored for this race${
                  targetRace.hasQuali ? ", qualifying included" : ", but no qualifying"
                }. Importing the race again replaces the stored classification.`
              : "Nothing is stored for this race yet."}
            {targetRace.number == null &&
              " Training and event results are viewable on the Races page but never count towards any standings."}
          </p>
        )}
        {targetRaceId === NEW_ROUND && (
          <p className="text-sm text-medium">
            The round is created with this number when you save. Use it only for a race that was run but never
            entered in the calendar.
          </p>
        )}
      </div>

      {hasTarget && (
        <div className="card space-y-5 p-5">
          <CardHead
            eyebrow="Step 2"
            title={targetRace?.resultCount ? "Import the race result again" : "Import the race result"}
          />

          {/* Source A — straight from the race server */}
          <div className="rounded-xl border border-border bg-surface2/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-sm font-bold uppercase tracking-tight text-dark">
                From the race server
              </span>
              <span className="pill bg-emerald-500/15 text-ok">recommended · penalty-corrected</span>
            </div>
            <p className="mt-1 text-sm text-light">
              Pull the finished race straight from NABS Server 1. No file export needed.
            </p>
            {remote.error ? (
              <p className="mt-3 text-sm text-warn">
                Couldn’t reach the race server. Use the file upload below instead.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {remoteList.length > 8 && (
                  <input
                    aria-label="Filter by track or date"
                    className="input max-w-sm"
                    placeholder="Filter by track or date… (e.g. Monza, Spa)"
                    value={remoteQuery}
                    onChange={(e) => setRemoteQuery(e.target.value)}
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Race on the server"
                    className="input max-w-sm"
                    value={remoteId}
                    onChange={(e) => { setRemoteId(e.target.value); setRemoteAuto(false); }}
                    disabled={remote.loading || busy}
                  >
                    <option value="">
                      {remote.loading
                        ? "Loading sessions…"
                        : remoteList.length
                        ? `Choose a race… (${filteredRemote.length})`
                        : "No races on server"}
                    </option>
                    <SessionOptions sessions={filteredRemote} track={targetTrack} />
                  </select>
                  {remoteAuto && remoteId && (
                    <span className="pill bg-emerald-500/15 text-ok">found for this round</span>
                  )}
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
                      aria-label="Qualifying session"
                      className="input max-w-sm"
                      value={qualiRemoteId}
                      onChange={(e) => { setQualiRemoteId(e.target.value); setQualiAuto(false); }}
                      disabled={remoteQuali.loading || busy}
                    >
                      <option value="">
                        {remoteQuali.loading ? "Looking for qualifying…" : "No qualifying session"}
                      </option>
                      <SessionOptions sessions={remoteQuali.data?.results || []} track={targetTrack} />
                    </select>
                    {qualiAuto && qualiRemoteId && (
                      <span className="pill bg-emerald-500/15 text-ok">qualifying auto-found</span>
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
              aria-label="Upload a result file"
              type="file"
              accept="application/json,.json"
              onChange={handleFile}
              className="transition mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-primary-dark"
            />
          </div>
        </div>
      )}

      {/* Qualifying on its own. Only for a race whose result is already stored:
          before that there is nothing to attach it to, and a fresh import
          carries its qualifying along in step 2 anyway. */}
      {targetRace && targetRace.resultCount > 0 && (
        <div className="card space-y-3 p-5">
          <CardHead
            eyebrow="Optional"
            title={targetRace.hasQuali ? "Replace the qualifying of this race" : "Add the qualifying of this race"}
          />
          <p className="text-sm text-light">
            {targetRace.hasQuali
              ? `${raceLabel(targetRace)} already has a qualifying classification. Attaching another one replaces it.`
              : `${raceLabel(targetRace)} has its result but no qualifying yet. Attach the QUALIFY session and the race gets a Qualifying tab next to its result.`}{" "}
            Entrants are matched automatically by Steam ID, then name.
          </p>
          {!remoteQuali.error && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Qualifying session on the server"
                className="input max-w-sm"
                value={qualiAttachRemoteId}
                onChange={(e) => { setQualiAttachRemoteId(e.target.value); setQualiAttachAuto(false); }}
                disabled={remoteQuali.loading || qualiBusy}
              >
                <option value="">
                  {remoteQuali.loading ? "Looking for qualifying…" : "Choose a qualifying session…"}
                </option>
                <SessionOptions sessions={remoteQuali.data?.results || []} track={targetTrack} />
              </select>
              {qualiAttachAuto && qualiAttachRemoteId && (
                <span className="pill bg-emerald-500/15 text-ok">found for this round</span>
              )}
              <button className="btn-primary" onClick={attachRemoteQuali} disabled={!qualiAttachRemoteId || qualiBusy}>
                {qualiBusy ? "Saving…" : "Attach"}
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              or upload the file:
            </span>
            <input
              aria-label="Qualifying result file"
              type="file"
              accept="application/json,.json"
              disabled={qualiBusy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setQualiNote(null);
                setQualiBusy(true);
                try {
                  setQualiNote({ kind: "success", text: qualiSummary(await api.importQuali(targetRace.id, file)) });
                  seasonRaces.reload();
                } catch (err) {
                  setQualiNote({ kind: "error", text: err.message });
                } finally {
                  setQualiBusy(false);
                }
              }}
              className="transition block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-primary-dark file:disabled:opacity-50"
            />
          </div>
          {qualiBusy && <p className="text-sm text-light">Uploading…</p>}
          {qualiNote && <Notice kind={qualiNote.kind}>{qualiNote.text}</Notice>}
        </div>
      )}

      {busy && !parsed && <p className="text-sm text-light">Working…</p>}
      {error && <Notice kind="error">{error}</Notice>}
      {done && <Notice kind="success">{done}</Notice>}

      {parsed && (
        <div className="space-y-4">
          <div className="card p-5">
            <CardHead
              eyebrow="Step 3"
              title={`Check the drivers and save into ${
                targetRace ? raceLabel(targetRace) : `Round ${newRoundNumber}`
              }`}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Track" tone="plain">
                <input
                  className="input"
                  value={meta.track}
                  onChange={(e) => setMeta((m) => ({ ...m, track: e.target.value }))}
                />
              </Field>
              <Field label="Date" tone="plain">
                <input
                  className="input"
                  type="date"
                  value={meta.date}
                  onChange={(e) => setMeta((m) => ({ ...m, date: e.target.value }))}
                />
              </Field>
              {/* The qualifying is only asked for once. A session picked in step
                  2 already rides along on save, so the upload would be a second
                  answer to a question that has one. */}
              {qualiRemoteId ? (
                <Field label="Qualifying" tone="plain">
                  <p className="pt-2 text-sm text-medium">
                    {pickedQuali ? fmtRemote(pickedQuali) : "Session from the race server"} is saved with the race.
                  </p>
                </Field>
              ) : (
                <Field
                  label={<>Qualifying JSON <span className="font-normal text-light">(optional)</span></>}
                  tone="plain"
                  className="sm:col-span-3"
                  hint="The AC QUALIFY result JSON of the same event. Saved together with the race: entrants are matched automatically (Steam ID first, then name) and the race gets a Qualifying tab on the Races page."
                >
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => setQualiFile(e.target.files?.[0] || null)}
                    className="transition block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface2 file:px-4 file:py-2 file:font-semibold file:text-dark hover:file:bg-border"
                  />
                </Field>
              )}
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
                          {!r.isSafetyCar && r.maybeSafetyCar && (
                            <span
                              className="ml-2 pill bg-surface2 text-light"
                              title="Usually drives the safety car, but this car isn't one, so this looks like a real drive. Nothing was guessed for it; pick them from the list. Their lap and incident data is kept either way."
                            >
                              safety car?
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Driver for ${r.acDriverName}`}
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
                          {!r.driverId && !r.isSafetyCar && (
                            <button
                              type="button"
                              className="transition mt-1 text-xs font-semibold text-link hover:underline disabled:opacity-50"
                              disabled={busy || creatingRow != null}
                              title="Creates this entrant as a new driver in the reserve pool and maps the row to them. Move them into a team later in the Drivers tab."
                              onClick={() => createFromRow(i)}
                            >
                              {creatingRow === i ? "Creating…" : `+ Create "${r.acDriverName}" as new driver`}
                            </button>
                          )}
                          {r.driverId && r.matchedBy === "steam" && (
                            <div
                              className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ok"
                              title="Matched by Steam ID, not by name. This one is certain."
                            >
                              ✓ matched by Steam ID
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`Status for ${r.acDriverName}`}
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
                            aria-label={`Team this race for ${r.acDriverName}`}
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
                            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ok">
                              ↩ Driver Market · for {r.marketFor}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            aria-label={`Penalty in seconds for ${r.acDriverName}`}
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

          <RacePreview request={{ ...targetBody, results: rows }} />

          {willBeSkipped.length > 0 && (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                skipsAcknowledged ? "border-warn/40 bg-warn/10 text-warn" : "border-border bg-surface2 text-medium"
              }`}
            >
              <p className="font-semibold">
                {willBeSkipped.length === 1
                  ? "1 entrant is set to Skip this row and will not appear in the results:"
                  : `${willBeSkipped.length} entrants are set to Skip this row and will not appear in the results:`}
              </p>
              <p className="mt-1">{willBeSkipped.map((r) => r.acDriverName).join(", ")}</p>
              <p className="mt-2 text-xs">
                {skipsAcknowledged
                  ? "Press save again to import the round without them, or pick a driver for each name above."
                  : "Anyone the file could not match to a driver starts out skipped, so check this list before saving."}
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={commit} disabled={busy}>
              {busy
                ? "Saving…"
                : skipsAcknowledged && willBeSkipped.length
                  ? `Save without ${willBeSkipped.length} ${willBeSkipped.length === 1 ? "entrant" : "entrants"}`
                  : "Confirm & save round"}
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
