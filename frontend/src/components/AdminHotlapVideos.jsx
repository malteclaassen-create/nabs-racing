import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Notice, CardHead } from "./ui.jsx";
import { trackKey, flagFor } from "../data/circuits.js";
import VideoEmbed from "./VideoEmbed.jsx";
import { youtubeId as ytId } from "../utils/videoLinks.js";
import Flag from "./Flag.jsx";
import { fmtDateShort } from "../utils/format.js";

// The hotlap videos a sign-up shows next to it, one of the three views of the
// Photos & Videos tab. It used to sit in the Attendance tab, which is where the
// videos are SHOWN — but managing them is the same job as managing a race's
// photos and its highlights cut, and looking for a video in three different
// tabs is the thing this tab exists to end.
//
// TWO places a lap can live, and the picker offers both:
//
//   * an EVENT — this round, this training session, and nothing else. A circuit
//     can hold two events in one season with two different cars, and then one
//     lap per track is the wrong unit: the training car's lap has nothing to
//     say about the round.
//   * a CIRCUIT — every season the track is raced, for every event that has no
//     lap of its own. That is still the right answer for an ordinary round, and
//     it is why the circuit list did not go away.
//
// An event with its own laps shows those INSTEAD of the circuit's, so the two
// never stack up in one player.

const MAX_VIDEOS = 6;
const fmtDate = (d) => (d ? fmtDateShort(d) : "date TBA");
// What each option says about what it already holds. Undefined/null is a count
// still on its way; it reads as "no lap yet" rather than flickering through a
// placeholder, which is also what it turns out to be for most of them.
const lapLabel = (n) => (n ? `${n} lap${n === 1 ? "" : "s"}` : "no lap yet");
const eventLabel = (e) => `${e.type === "TRAINING" ? "Training" : `R${e.number}`} ${e.track}`;

export default function AdminHotlapVideos() {
  const events = useApi(useCallback(() => api.events(true), []));
  const { data: races } = useApi(useCallback(() => api.races(), []));

  // "race:<id>" or "track:<key>" — one picker, two kinds of target, and the
  // prefix is what the editor reads to know where a save goes.
  const [selected, setSelected] = useState("");
  const [info, setInfo] = useState(null); // a circuit's whole blob, kept intact
  const [videos, setVideos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  // Which circuits already have a lap on file, so the picker can say so.
  const [have, setHave] = useState({}); // trackKey -> count

  // Upcoming events, in calendar order. Every one of them, training sessions
  // included and a circuit visited twice listed twice — the whole point here is
  // that two events at one track are two different things.
  const upcoming = useMemo(
    () => [...(events.data || [])].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)),
    [events.data]
  );

  // Every track of the season, for the circuit half of the picker.
  const allTracks = useMemo(() => {
    const seen = new Map();
    for (const r of races || []) {
      if (r.isSpecialEvent || !r.track) continue;
      const k = trackKey(r.track);
      if (!seen.has(k)) seen.set(k, r.track);
    }
    return [...seen.entries()].map(([key, name]) => ({ key, name }));
  }, [races]);

  // Start on the next event — that's the one the attendance page is showing.
  useEffect(() => {
    if (!selected && upcoming.length) setSelected(`race:${upcoming[0].id}`);
  }, [upcoming, selected]);

  const kind = selected.startsWith("race:") ? "race" : selected.startsWith("track:") ? "track" : null;
  const raceId = kind === "race" ? selected.slice(5) : "";
  const event = raceId ? upcoming.find((e) => e.id === raceId) || null : null;
  // A circuit target names itself; an event's circuit comes from its track.
  const key = kind === "track" ? selected.slice(6) : event ? trackKey(event.track) : "";
  const trackName = kind === "track" ? allTracks.find((t) => t.key === key)?.name || key : event?.track || "";
  const circuit = trackName ? flagFor(trackName) : null;

  // The rows the editor is holding. An event reads its own list; a circuit
  // reads the blob it shares with the facts and the map image.
  useEffect(() => {
    if (!kind) return;
    setError(null);
    setMsg(null);
    const rows = (list) => (list || []).map((v) => ({ url: `https://youtu.be/${v.id}`, title: v.title || "" }));
    if (kind === "race") {
      setInfo(null);
      api
        .adminRaceHotlaps(raceId)
        .then((d) => setVideos(rows(d.videos)))
        .catch((e) => setError(e.message));
      return;
    }
    api
      .adminTrackInfo(key)
      .then((d) => {
        setInfo(d);
        setVideos(rows(d.videos));
        setHave((h) => ({ ...h, [key]: (d.videos || []).length }));
      })
      .catch((e) => setError(e.message));
  }, [kind, raceId, key]);

  // A count for every circuit the picker names, so "which ones still need a
  // lap?" is answerable at a glance instead of by clicking through them. The
  // events carry their own counts in the feed, so only circuits are asked for.
  useEffect(() => {
    const keys = [...new Set([...upcoming.map((e) => trackKey(e.track)), ...allTracks.map((t) => t.key)])].filter(Boolean);
    for (const k of keys) {
      if (k in have) continue;
      setHave((h) => ({ ...h, [k]: null })); // claim it, so it's asked for once
      api
        .adminTrackInfo(k)
        .then((d) => setHave((h) => ({ ...h, [k]: (d.videos || []).length })))
        .catch(() => setHave((h) => ({ ...h, [k]: 0 })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming, allTracks]);

  function setVideo(i, patch) {
    setVideos((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const wanted = videos.filter((v) => v.url.trim());
      let kept;
      if (kind === "race") {
        kept = (await api.saveRaceHotlaps(raceId, wanted)).videos || [];
        // The feed carries each event's own laps, so the picker's counts and
        // the fallback note both come back right after a save.
        events.reload();
      } else {
        // Spread the loaded blob: the facts and the map image live in the same
        // record and must survive a save made from this page.
        const res = await api.saveTrackInfo(key, { ...info, videos: wanted });
        kept = res?.content?.videos || [];
        setInfo((prev) => ({ ...prev, ...res.content }));
        setHave((h) => ({ ...h, [key]: kept.length }));
      }
      setVideos(kept.map((v) => ({ url: `https://youtu.be/${v.id}`, title: v.title || "" })));
      const dropped = wanted.length - kept.length;
      setMsg(
        dropped > 0
          ? `Saved, but ${dropped} link ${dropped === 1 ? "was" : "were"} not a YouTube video and got dropped.`
          : "Saved. It's on the attendance page now."
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const circuitCount = have[key];
  // Upcoming events at the selected circuit that film their own lap — the ones
  // a change to the circuit's list would NOT reach.
  const ownAtCircuit = key ? upcoming.filter((e) => trackKey(e.track) === key && e.hotlapVideos?.length).length : 0;

  return (
    <div className="space-y-5">
      <div className="card space-y-4 p-5">
        <CardHead eyebrow="Attendance page" title="Hotlap videos" />
        <p className="text-sm text-light">
          A lap of the circuit, shown in its own player under the sign-up. Save it on an EVENT and only that round or
          training session shows it, which is what a track running twice in a season with two different cars needs. Save
          it on a CIRCUIT and it comes back every season this track is on the calendar, for every event that has no lap
          of its own. Add more than one and drivers get a picker.
        </p>

        {events.error && <ErrorBox message={events.error} onRetry={events.reload} />}

        {/* One picker, both halves of the question: every event coming up, in
            calendar order and with the next one selected on arrival, then the
            circuits underneath. Each option carries what it already holds,
            which is the thing you are usually scanning for. */}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="hotlap-target" className="text-sm font-semibold text-medium">
            Show it under
          </label>
          {/* Next to the picker rather than in it: an option list is text only. */}
          {circuit && <Flag code={circuit.country} w={20} h={15} />}
          <select
            id="hotlap-target"
            className="input max-w-md"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select an event or a circuit…</option>
            {upcoming.length > 0 && (
              <optgroup label="One event only">
                {upcoming.map((e) => (
                  <option key={e.id} value={`race:${e.id}`}>
                    {eventLabel(e)} · {fmtDate(e.date)} ·{" "}
                    {e.hotlapVideos?.length ? lapLabel(e.hotlapVideos.length) : "circuit's lap"}
                  </option>
                ))}
              </optgroup>
            )}
            {allTracks.length > 0 && (
              <optgroup label="A circuit, every season">
                {allTracks.map((t) => (
                  <option key={t.key} value={`track:${t.key}`}>
                    {t.name} · {lapLabel(have[t.key])}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {msg && <Notice kind="success">{msg}</Notice>}

      {kind && (
        <div className="card space-y-4 p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">
            {kind === "race" ? `Laps for ${event ? eventLabel(event) : "this event"} only` : `Laps at ${trackName}`}
          </div>

          <div className="space-y-3">
            {videos.map((v, i) => (
              <div key={i} className="flex flex-wrap items-start gap-3">
                <div className="flex min-w-60 flex-[2] flex-col gap-2">
                  <input
                    aria-label={`Lap ${i + 1} video link`}
                    className="input py-1.5 text-sm"
                    placeholder="https://www.youtube.com/watch?v=…"
                    value={v.url}
                    onChange={(e) => setVideo(i, { url: e.target.value })}
                  />
                  <input
                    aria-label={`Lap ${i + 1} label`}
                    className="input py-1.5 text-sm"
                    placeholder="Label (e.g. S8 hotlap, onboard 2024)"
                    value={v.title}
                    onChange={(e) => setVideo(i, { title: e.target.value })}
                  />
                </div>
                {/* Live proof the link is the video you meant, before saving. */}
                <div className="w-48 shrink-0">
                  {ytId(v.url) ? (
                    <VideoEmbed videoId={ytId(v.url)} title={v.title || "Preview"} className="rounded-xl" />
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-border text-center font-mono text-[10px] uppercase tracking-wider text-faint">
                      {v.url.trim() ? "not a YouTube link" : "preview"}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Remove this video"
                  title="Remove this video"
                  className="transition mt-2 text-light hover:text-bad"
                  onClick={() => setVideos((vs) => vs.filter((_, idx) => idx !== i))}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            ))}
            {videos.length === 0 && (
              <p className="text-sm text-light">
                {kind === "race" ? "This event has no lap of its own." : "No lap on file for this circuit yet."}
              </p>
            )}
          </div>

          {/* What an empty list actually means, which is a different answer for
              each half of the picker — and for an event it depends on whether
              its circuit has anything to fall back on. */}
          {videos.length === 0 && kind === "race" && (
            <Notice kind="info">
              {circuitCount
                ? `${trackName} has ${lapLabel(circuitCount)} on file, and that is what this event shows. Add one here and it takes over for this event alone.`
                : `Nothing here and nothing on ${trackName} either, so this event shows a “hotlap coming soon” panel.`}
            </Notice>
          )}
          {videos.length === 0 && kind === "track" && (
            <Notice kind="info">
              Nothing here, so every event at this circuit without a lap of its own shows a &ldquo;hotlap coming
              soon&rdquo; panel. Add a lap and it takes that panel&rsquo;s place.
            </Notice>
          )}
          {videos.length > 0 && kind === "race" && circuitCount > 0 && (
            <Notice kind="info">
              These replace the {lapLabel(circuitCount)} saved on {trackName} for this event. Remove them all and the
              circuit&rsquo;s laps come back.
            </Notice>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {videos.length < MAX_VIDEOS && (
              <button
                className="transition text-sm font-semibold text-link hover:underline"
                onClick={() => setVideos((vs) => [...vs, { url: "", title: "" }])}
              >
                + Add a lap
              </button>
            )}
            <button className="btn-primary" onClick={save} disabled={busy || (kind === "track" && !info)}>
              {busy ? "Saving…" : "Save"}
            </button>
            {/* The other place this event's lap could live, one click away —
                without hunting for the circuit in the picker. */}
            {kind === "race" && key && (
              <button
                type="button"
                className="transition text-sm font-semibold text-link hover:underline"
                onClick={() => setSelected(`track:${key}`)}
              >
                Edit {trackName}&rsquo;s laps instead ({lapLabel(circuitCount)})
              </button>
            )}
            {kind === "track" && ownAtCircuit > 0 && (
              <span className="text-sm text-light">
                {ownAtCircuit === 1
                  ? "Note: one event at this circuit shows its own lap and is not affected by this list."
                  : `Note: ${ownAtCircuit} events at this circuit show their own laps and are not affected by this list.`}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
