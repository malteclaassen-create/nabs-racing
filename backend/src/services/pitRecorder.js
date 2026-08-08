// ---------------------------------------------------------------------------
// Observes the live feed and writes every pit stop of a RACE session to disk
// (lib/pitEventsStore.js), so the result import afterwards can place a
// driver's stops as fact instead of inferring them from slow laps.
//
// This is the only possible source of that fact: the stored result JSON has no
// pit fields at all, and the server keeps pit state (IsInPits / NumPits) only
// for the session currently running. Miss the race, and the information is
// gone for good — which is what happened to every race before this recorder.
//
// Trust model — the adversarial review of the first version reshaped this:
//   - A stop is recorded ONLY when the SERVER's own NumPits counter rises, and
//     only as read from a full ET200 snapshot, where the value is keyed by the
//     driver's guid. Nothing is ever inferred: the first version logged a stop
//     whenever IsInPits flipped true and invented the counter value itself,
//     which turned post-flag returns to the pit lane into phantom stops for
//     the whole field, and — because the high-frequency ET53 stream is keyed
//     by CarID against a mapping refreshed only per snapshot — could pin a
//     stop on a driver who had already left the server.
//   - ET53 pit-lane edges are kept ONLY in memory, as lap/time hints that make
//     the next snapshot-confirmed stop precise. They never reach the disk on
//     their own.
//   - A driver's counter going BACKWARDS is written down (`regress`) rather
//     than papered over: one driver regressing means a reconnect (their
//     earlier stops still happened), many at once means the admin restarted
//     the race in place (the earlier stops belong to an aborted running).
//     The reader (loadPitStops) tells the two apart; the recorder just
//     testifies.
//   - After the leader completes the race distance a `flag` line is written;
//     stops confirmed later carry postFlag and the importer ignores them.
//
// Deliberately tiny on memory: one Map of small records per grid slot, pruned
// every snapshot, cleared on session change. Events go straight to an append
// of one JSON line — no buffers, no timers. Race night has a history of
// memory incidents; the recorder must never be the next suspect.
// ---------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import { appendPitEvent, pitFileFor, pitTrackKey } from "../lib/pitEventsStore.js";

const state = new Map(); // serverKey -> recorder state

function fresh() {
  return {
    uid: null, // non-null while a race session is open
    file: null,
    sessionKey: null,
    raceLaps: null,
    flagged: false,
    drivers: new Map(), // guid -> { pits, lap, name, entry: {lap, at} | null, entryAt }
  };
}

function stateFor(serverKey) {
  if (!state.has(serverKey)) state.set(serverKey, fresh());
  return state.get(serverKey);
}

// Called from ingestSnapshot after every full ET200 snapshot.
export function onSnapshot(serverKey, status, sessionKey) {
  const st = stateFor(serverKey);
  const si = status?.SessionInfo || {};
  const isRace = si.Type === 3;

  if (sessionKey !== st.sessionKey) {
    st.sessionKey = sessionKey;
    st.drivers = new Map();
    st.uid = null;
    st.file = null;
    st.flagged = false;
    st.raceLaps = null;
    if (isRace) {
      const dayIso = new Date().toISOString().slice(0, 10);
      const trackKey = pitTrackKey(si.TrackConfig, si.Track);
      st.uid = randomUUID();
      st.raceLaps = Number(si.Laps) > 0 ? Number(si.Laps) : null;
      st.file = pitFileFor(serverKey, dayIso, trackKey);
      appendPitEvent(st.file, {
        v: 2,
        t: "session",
        uid: st.uid,
        at: new Date().toISOString(),
        sessionKey,
        track: si.Track || null,
        trackConfig: si.TrackConfig || null,
        trackName: status?.TrackInfo?.name || null,
        raceLaps: st.raceLaps,
        server: serverKey,
      });
    }
  }
  if (!st.uid) return; // not a race — record nothing (practice teleports would spam)

  const connected = status?.ConnectedDrivers?.Drivers || {};
  const seen = new Set();
  let leaderLaps = 0;
  for (const [guid, d] of Object.entries(connected)) {
    const ci = d.CarInfo || {};
    if (ci.IsSpectator) continue;
    seen.add(guid);
    const car = (d.Cars && ci.CarModel && d.Cars[ci.CarModel]) || null;
    const lap = Math.max(1, car?.NumLaps ?? d.TotalNumLaps ?? 1);
    if (lap > leaderLaps) leaderLaps = lap;
    const pits = Number(d.NumPits ?? car?.NumPits ?? 0) || 0;
    let rec = st.drivers.get(guid);
    if (!rec) {
      // First sight seeds from current values — a mid-race (re)start must not
      // read the existing count as fresh stops. The seed line also proves this
      // driver WAS observed, so "no stop events" later reads as "made no
      // stops" rather than "recorder wasn't looking".
      rec = { pits, lap, name: ci.DriverName || null, entry: null, entryAt: null };
      st.drivers.set(guid, rec);
      appendPitEvent(st.file, {
        v: 2,
        t: "seed",
        uid: st.uid,
        guid,
        name: rec.name,
        at: new Date().toISOString(),
        lap,
        numPits: pits,
      });
      continue;
    }
    if (pits > rec.pits) {
      // The server says this driver stopped (once per missing count — normally
      // one, more after a feed gap). The freshest un-consumed pit-lane entry
      // hint pins the lap; without one the snapshot lap is close enough for
      // the importer's evidence-based placement to finish the job.
      for (let p = rec.pits + 1; p <= pits; p++) {
        appendPitEvent(st.file, {
          v: 2,
          t: "stop",
          uid: st.uid,
          guid,
          name: rec.name,
          at: new Date().toISOString(),
          numPits: p,
          lap: rec.entry?.lap ?? lap,
          lapPrecise: !!rec.entry,
          pitLaneMs: rec.entry && rec.entryAt ? Date.now() - rec.entryAt : null,
          postFlag: st.flagged || undefined,
        });
      }
      rec.entry = null;
      rec.entryAt = null;
    } else if (pits < rec.pits) {
      // Counter went backwards. Testify and re-anchor; the reader decides
      // whether this was one reconnect or a whole-field race restart.
      appendPitEvent(st.file, {
        v: 2,
        t: "regress",
        uid: st.uid,
        guid,
        at: new Date().toISOString(),
        from: rec.pits,
        to: pits,
        lap,
      });
    }
    rec.pits = pits;
    rec.lap = lap;
  }
  // The flag: the leader has completed the distance. Stops confirmed after
  // this line are cooldown returns, not race stops.
  if (!st.flagged && st.raceLaps && leaderLaps > st.raceLaps) {
    st.flagged = true;
    appendPitEvent(st.file, { v: 2, t: "flag", uid: st.uid, at: new Date().toISOString(), lap: leaderLaps });
  }
  // Drop cars that left the server; a returning car re-seeds safely above.
  for (const g of [...st.drivers.keys()]) if (!seen.has(g)) st.drivers.delete(g);
}

// Called from the ET53 per-car telemetry handler. Memory-only lap/time hints —
// the CarID->guid mapping this rides on refreshes only per snapshot and can be
// stale, so nothing here is allowed to reach the disk or fabricate a count.
export function onTelemetry(serverKey, guid, live) {
  const st = state.get(serverKey);
  if (!st?.uid || !guid || !live) return;
  const rec = st.drivers.get(guid);
  if (!rec) return; // unknown until the next snapshot names the car
  const inPits = !!live.IsInPits;
  if (inPits && !rec.wasInPits) {
    rec.entry = { lap: rec.lap };
    rec.entryAt = Date.now();
  }
  rec.wasInPits = inPits;
}
