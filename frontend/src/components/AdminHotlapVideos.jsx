import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Notice, CardHead } from "./ui.jsx";
import { trackKey, flagFor } from "../data/circuits.js";
import VideoEmbed from "./VideoEmbed.jsx";
import { youtubeId as ytId } from "../utils/videoLinks.js";
import Flag from "./Flag.jsx";
import { fmtDateShort } from "../utils/format.js";

// The hotlap videos a circuit shows next to its sign-up, one of the three views
// of the Photos & Videos tab. It used to sit in the Attendance tab, which is
// where the videos are SHOWN — but managing them is the same job as managing a
// race's photos and its highlights cut, and looking for a video in three
// different tabs is the thing this tab exists to end.
//
// The videos belong to the CIRCUIT, not to one running of it, so a lap put in
// here comes back every season the track is raced. The rounds coming up sit at
// the top of the picker because that's what you're almost always here for; the
// full list underneath is for preparing a track long before its round.

const MAX_VIDEOS = 6;
const fmtDate = (d) => (d ? fmtDateShort(d) : "date TBA");
// What each option says about the circuit it names. Undefined/null is a count
// still on its way; it reads as "no lap yet" rather than flickering through a
// placeholder, which is also what it turns out to be for most of them.
const lapLabel = (n) => (n ? `${n} lap${n === 1 ? "" : "s"}` : "no lap yet");

export default function AdminHotlapVideos() {
  const events = useApi(useCallback(() => api.events(true), []));
  const { data: races } = useApi(useCallback(() => api.races(), []));

  const [selected, setSelected] = useState(""); // track display name
  const [info, setInfo] = useState(null); // the whole stored blob, kept intact
  const [videos, setVideos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  // Which tracks already have a lap on file, so the picker can say so.
  const [have, setHave] = useState({}); // trackKey -> count

  // Upcoming rounds, in calendar order.
  const upcoming = useMemo(
    () => [...(events.data || [])].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)),
    [events.data]
  );

  // Every track of the season, for anything not coming up next.
  const allTracks = useMemo(() => {
    const seen = new Map();
    for (const r of races || []) {
      if (r.isSpecialEvent || !r.track) continue;
      const k = trackKey(r.track);
      if (!seen.has(k)) seen.set(k, r.track);
    }
    return [...seen.entries()].map(([key, name]) => ({ key, name }));
  }, [races]);

  // The picker's two groups. A hotlap belongs to the CIRCUIT, so a season that
  // visits one twice must not offer it twice — the first (earliest) round wins,
  // and the lower group drops whatever the upper one already lists.
  const comingUp = useMemo(() => {
    const seen = new Set();
    return upcoming.filter((e) => {
      const k = trackKey(e.track);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [upcoming]);
  const otherTracks = useMemo(() => {
    const shown = new Set(comingUp.map((e) => trackKey(e.track)));
    return allTracks.filter((t) => !shown.has(t.key));
  }, [allTracks, comingUp]);

  // Start on the next race — that's the one the attendance page is showing.
  useEffect(() => {
    if (!selected && upcoming.length) setSelected(upcoming[0].track);
  }, [upcoming, selected]);

  const key = selected ? trackKey(selected) : "";
  const selectedCircuit = selected ? flagFor(selected) : null;

  useEffect(() => {
    if (!key) return;
    setError(null);
    setMsg(null);
    api
      .adminTrackInfo(key)
      .then((d) => {
        setInfo(d);
        setVideos((d.videos || []).map((v) => ({ url: `https://youtu.be/${v.id}`, title: v.title || "" })));
        setHave((h) => ({ ...h, [key]: (d.videos || []).length }));
      })
      .catch((e) => setError(e.message));
  }, [key]);

  // A count for every track the picker shows, so "which ones still need a lap?"
  // is answerable at a glance instead of by clicking through them.
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
      // Spread the loaded blob: the facts and the map image live in the same
      // record and must survive a save made from this page.
      const res = await api.saveTrackInfo(key, { ...info, videos: wanted });
      const kept = res?.content?.videos || [];
      setInfo((prev) => ({ ...prev, ...res.content }));
      setVideos(kept.map((v) => ({ url: `https://youtu.be/${v.id}`, title: v.title || "" })));
      setHave((h) => ({ ...h, [key]: kept.length }));
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

  return (
    <div className="space-y-5">
      <div className="card space-y-4 p-5">
        <CardHead eyebrow="Attendance page" title="Hotlap videos" />
        <p className="text-sm text-light">
          A lap of the circuit, shown in its own player under the sign-up. It belongs to the track, not to one race, so
          it comes back every season this circuit is on the calendar. Add more than one and drivers get a picker.
        </p>

        {events.error && <ErrorBox message={events.error} onRetry={events.reload} />}

        {/* One picker for both halves of the question: the rounds that are
            coming up are the top group, in calendar order, with the next one
            selected on arrival; everything else the season visits is
            underneath. Each option carries whether that circuit already has a
            lap, which is the thing you are usually scanning for. */}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="hotlap-track" className="text-sm font-semibold text-medium">
            Track
          </label>
          {/* Next to the picker rather than in it: an option list is text only. */}
          {selectedCircuit && <Flag code={selectedCircuit.country} w={20} h={15} />}
          <select
            id="hotlap-track"
            className="input max-w-sm"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select a track…</option>
            {comingUp.length > 0 && (
              <optgroup label="Coming up">
                {comingUp.map((e) => (
                  <option key={e.id} value={e.track}>
                    {e.type === "TRAINING" ? "Training" : `R${e.number}`} {e.track} · {fmtDate(e.date)} ·{" "}
                    {lapLabel(have[trackKey(e.track)])}
                  </option>
                ))}
              </optgroup>
            )}
            {otherTracks.length > 0 && (
              <optgroup label="Any other track">
                {otherTracks.map((t) => (
                  <option key={t.key} value={t.name}>
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

      {key && (
        <div className="card space-y-4 p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">
            Laps at {selected}
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
              <p className="text-sm text-light">No lap on file for this circuit yet.</p>
            )}
          </div>

          {videos.length === 0 && (
            <Notice kind="info">
              Nothing here, so the attendance page shows a &ldquo;hotlap coming soon&rdquo; panel for this circuit.
              Add a lap and it takes that panel&rsquo;s place.
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
            <button className="btn-primary" onClick={save} disabled={busy || !info}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
