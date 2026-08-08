import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Notice, CardHead, Field, CheckField } from "./ui.jsx";
import { trackKey } from "../data/circuits.js";
import VideoEmbed from "./VideoEmbed.jsx";
import { youtubeId as ytId } from "../utils/videoLinks.js";
import Flag from "./Flag.jsx";
import { flagFor } from "../data/circuits.js";
import SlidingTabs from "./SlidingTabs.jsx";
import AdminAttendanceHistory from "./AdminAttendanceHistory.jsx";
import { fmtDateShort } from "../utils/format.js";

// Admin "Attendance" tab, in three views: the hotlap videos a circuit shows,
// who may answer which race, and what people answered for the races already run.
// Three panels stacked in one column had grown into a page you scrolled past
// rather than read.
//
// The videos belong to the CIRCUIT, not to one running of it, so a lap put in
// here comes back every season the track is raced. The upcoming rounds sit at
// the top because that's what you're almost always here for; the full list
// underneath is for preparing a track before its round comes round.

const MAX_VIDEOS = 6;
const fmtDate = (d) => (d ? fmtDateShort(d) : "date TBA");

export default function AdminAttendance() {
  // includeHidden: this tab is the only place a race that was taken off the
  // attendance page can be put back, so it has to be able to see them.
  const events = useApi(useCallback(() => api.events(true), []));
  const { data: races } = useApi(useCallback(() => api.races(), []));

  const [view, setView] = useState("hotlaps");
  const [selected, setSelected] = useState(""); // track display name
  const [info, setInfo] = useState(null); // the whole stored blob, kept intact
  const [videos, setVideos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  // Which tracks already have a lap on file, so the pickers can say so.
  const [have, setHave] = useState({}); // trackKey -> count

  // Per-race sign-up switches, plus the general rule they fall back to.
  const [gates, setGates] = useState({});
  const [rule, setRule] = useState(null);
  useEffect(() => {
    api.attendanceGates().then(setGates).catch((e) => setError(e.message));
    api.adminNotificationSettings().then((d) => setRule(d.settings || d)).catch(() => {});
  }, []);

  // On or off the attendance page. Separate from the gate below: a race that
  // has been hidden keeps whatever open/closed setting it had for when it
  // comes back.
  async function setVisible(e, hidden) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.setAttendanceVisible(e.id, hidden);
      await events.reload();
      const name = `${e.type === "TRAINING" ? "Training" : `Round ${e.number}`} · ${e.track}`;
      setMsg(hidden ? `${name} is off the attendance page.` : `${name} is back on the attendance page.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function setGate(raceId, state) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await api.setAttendanceGate(raceId, state);
      setGates(res.overrides || {});
      // The list carries the resulting open/closed state, so re-read it rather
      // than working out here what the server just decided.
      await events.reload();
      setMsg(state === "auto" ? "Back to the general rule." : `Sign-up forced ${state}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function ping(e) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.adminAttendancePing(e.id);
      setMsg(`Reminder sent for ${e.track}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // The stand-in lap (see the panel at the bottom of this tab).
  const [fallback, setFallback] = useState(null);
  const [fallbackUrl, setFallbackUrl] = useState("");
  useEffect(() => {
    api
      .hotlapFallback()
      .then((f) => {
        setFallback(f);
        setFallbackUrl(`https://youtu.be/${f.videoId}`);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function saveFallback() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const saved = await api.saveHotlapFallback({ ...fallback, url: fallbackUrl });
      setFallback(saved);
      setFallbackUrl(`https://youtu.be/${saved.videoId}`);
      setMsg(saved.enabled ? "Stand-in lap is on." : "Stand-in lap is off.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Upcoming rounds first — one button each.
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

  // Start on the next race — that's the one the attendance page is showing.
  useEffect(() => {
    if (!selected && upcoming.length) setSelected(upcoming[0].track);
  }, [upcoming, selected]);

  const key = selected ? trackKey(selected) : "";

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

  // A count for every track the pickers show, so "which ones still need a lap?"
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

  const pickerClass = (active) =>
    `inline-flex min-h-[38px] items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-bold transition ${
      active ? "bg-brand text-ink" : "bg-surface2 text-medium hover:text-dark"
    }`;

  return (
    <div className="space-y-5">
      <SlidingTabs
        items={[
          { key: "hotlaps", label: "Hotlap videos" },
          { key: "signups", label: "Who can sign up" },
          { key: "history", label: "Past sign-ups" },
        ]}
        value={view}
        onChange={setView}
      />

      {view === "history" && <AdminAttendanceHistory />}

      {view === "hotlaps" && (
      <div className="space-y-5">
      <div className="card space-y-4 p-5">
        <CardHead eyebrow="Attendance page" title="Hotlap videos" />
        <p className="text-sm text-light">
          A lap of the circuit, shown in its own player under the sign-up. It belongs to the track, not to one race, so
          it comes back every season this circuit is on the calendar. Add more than one and drivers get a picker.
        </p>

        {events.error && <ErrorBox message={events.error} onRetry={events.reload} />}

        {upcoming.length > 0 && (
          <div>
            <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">Coming up</div>
            <div className="flex flex-wrap gap-2">
              {upcoming.map((e) => {
                const k = trackKey(e.track);
                const circuit = flagFor(e.track, e.country);
                const n = have[k];
                return (
                  <button key={e.id} type="button" className={pickerClass(k === key)} onClick={() => setSelected(e.track)}>
                    {circuit && <Flag code={circuit.country} w={18} h={13} />}
                    <span>
                      {e.type === "TRAINING" ? "Training" : `R${e.number}`} {e.track}
                    </span>
                    <span className={`font-mono text-[10px] font-normal ${k === key ? "text-ink/70" : "text-faint"}`}>
                      {fmtDate(e.date)} · {n ? `${n} lap${n === 1 ? "" : "s"}` : "no lap yet"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-semibold text-medium">Any other track</label>
          <select aria-label="Any other track" className="input max-w-xs" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Select a track…</option>
            {allTracks.map((t) => (
              <option key={t.key} value={t.name}>
                {t.name}
                {have[t.key] ? ` (${have[t.key]})` : ""}
              </option>
            ))}
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

          {videos.length === 0 && fallback?.enabled && (
            <Notice kind="info">
              Nothing here, so this circuit currently plays the stand-in lap (see below). Add a real one and the
              stand-in steps aside on its own.
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

      {/* The joke lives with the hotlaps because that is what it stands in for.
          Named for what it is, so nobody inherits this site later and spends an
          afternoon wondering why every circuit already has a lap on it. */}
      {fallback && (
        <div className="card space-y-4 p-5">
          <CardHead eyebrow="Attendance page" title="Stand-in lap" />
          <p className="text-sm text-light">
            What a circuit with no real lap on file plays instead. It is announced as &ldquo;&lt;Track&gt; hotlap&rdquo;
            and shows no preview picture, so nobody sees it coming. The moment you add a real lap for a circuit, that
            circuit stops using this.
          </p>

          <CheckField
            checked={fallback.enabled}
            onChange={(e) => setFallback((f) => ({ ...f, enabled: e.target.checked }))}
            label="Play a stand-in lap where none is uploaded"
          />

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
            <Field label="Video" tone="plain">
              <input
                className="input py-1.5 text-sm"
                placeholder="https://youtu.be/…"
                value={fallbackUrl}
                onChange={(e) => setFallbackUrl(e.target.value)}
              />
            </Field>
            <Field label="Called" tone="plain">
              <input
                className="input py-1.5 text-sm"
                placeholder={`${selected || "<Track>"} hotlap`}
                value={fallback.label}
                onChange={(e) => setFallback((f) => ({ ...f, label: e.target.value }))}
              />
            </Field>
            <button className="btn-secondary py-1.5 text-sm sm:mt-6" onClick={saveFallback} disabled={busy}>
              Save
            </button>
          </div>
          {fallbackUrl.trim() && !ytId(fallbackUrl) && (
            <p className="text-xs text-bad">That isn&rsquo;t a YouTube link. The old one stays until this one works.</p>
          )}
        </div>
      )}
      </div>
      )}

      {/* Who may answer which race. The general rule ("opens N days before")
          lives in the Notifications tab and applies to everything; this is the
          per-race override for when you want answers on one round now, or want
          another one left alone. */}
      {view === "signups" && (
      <div className="card space-y-4 p-5">
        <CardHead eyebrow="Attendance page" title="Who can sign up" />
        <p className="text-sm text-light">
          <strong className="font-semibold text-medium">Auto</strong> follows the general rule in Notifications:{" "}
          {rule?.attendanceOpenDays
            ? `sign-up opens ${rule.attendanceOpenDays} day${rule.attendanceOpenDays === 1 ? "" : "s"} before the race at ${String(rule.attendanceOpenHour).padStart(2, "0")}:00 German time.`
            : "no rule set, so every race is open as soon as it exists."}{" "}
          <strong className="font-semibold text-medium">Open</strong> and{" "}
          <strong className="font-semibold text-medium">Closed</strong> decide one race yourself. A race stays on the
          page until you save its result, so a round that has already run keeps taking late answers.
        </p>
        <p className="text-sm text-light">
          The eye takes a race off the attendance page altogether, sign-up reminders included, for a session
          that is in the calendar early, or one that isn&rsquo;t happening after all. It keeps its date, its
          calendar card and its results, and a crossed-out eye here is the way back.
        </p>

        {upcoming.length === 0 ? (
          <p className="text-sm text-light">No upcoming races in this series.</p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((e) => {
              const state = gates[e.id] || "auto";
              const effective = e.attendanceClosed
                ? "closed"
                : e.attendanceOpensAt && new Date(e.attendanceOpensAt) > new Date()
                  ? `opens ${new Date(e.attendanceOpensAt).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
                  : "taking answers";
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-2 last:border-0 last:pb-0">
                  {/* The eye: on the attendance page, or not there at all.
                      A hidden row stays in THIS list (faded), because this is
                      the only place it can be brought back from. */}
                  <button
                    type="button"
                    aria-pressed={!!e.hidden}
                    aria-label={e.hidden ? "Show on the attendance page" : "Hide from the attendance page"}
                    title={
                      e.hidden
                        ? "Hidden: not on the attendance page, and it sends no sign-up reminders. Click to show it again."
                        : "On the attendance page. Click to hide it."
                    }
                    disabled={busy}
                    onClick={() => setVisible(e, !e.hidden)}
                    className={`shrink-0 rounded-lg border p-1.5 transition disabled:opacity-50 ${
                      e.hidden ? "border-border text-light hover:text-dark" : "border-brand/60 text-link"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
                      <circle cx="12" cy="12" r="3" />
                      {e.hidden && <path d="M3 3l18 18" />}
                    </svg>
                  </button>
                  <div className={`min-w-52 flex-1 ${e.hidden ? "opacity-55" : ""}`}>
                    <div className="text-sm font-semibold text-dark">
                      {e.type === "TRAINING" ? "Training" : `Round ${e.number}`} · {e.track}
                    </div>
                    <div className="font-mono text-[11px] uppercase tracking-wider text-light">
                      {fmtDate(e.date)} · {e.hidden ? "hidden" : effective} · {e.counts?.ACCEPTED ?? 0} in
                    </div>
                  </div>
                  {/* The open/closed switch is meaningless while the race isn't
                      on the page. It stays visible (the setting is remembered),
                      just out of reach until the eye is opened again. */}
                  <div className={`flex gap-1 ${e.hidden ? "pointer-events-none opacity-40" : ""}`}>
                    {["auto", "open", "closed"].map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={state === s}
                        disabled={busy || e.hidden}
                        onClick={() => setGate(e.id, s)}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-bold uppercase tracking-wide transition ${
                          state === s ? "border-brand bg-brand/10 text-dark" : "border-border text-light hover:text-dark"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="transition text-sm font-semibold text-link hover:underline disabled:opacity-50"
                    disabled={busy || e.hidden}
                    onClick={() => ping(e)}
                  >
                    Send reminder
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      )}
    </div>
  );
}
