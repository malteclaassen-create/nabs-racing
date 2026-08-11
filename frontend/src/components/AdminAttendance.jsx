import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Notice, CardHead } from "./ui.jsx";
import SlidingTabs from "./SlidingTabs.jsx";
import AdminAttendanceHistory from "./AdminAttendanceHistory.jsx";
import AdminAttendanceMissing from "./AdminAttendanceMissing.jsx";
import { fmtDateShort } from "../utils/format.js";

// Admin "Attendance" tab, in three views: who may answer which race, who has
// not answered the next one yet, and what people answered for the races already
// run. Panels stacked in one column had grown into a page you scrolled past
// rather than read.
//
// The hotlap videos used to be a fourth view here, because the attendance page
// is where they are shown. They now live in Photos & Videos with the rest of
// the league's media, which is how the person filling them in thinks of them.

const fmtDate = (d) => (d ? fmtDateShort(d) : "date TBA");

// `jumpView` is a view named by the admin search ("Still to answer" rather than
// just "Attendance"); `jumpKey` counts the jumps so searching the same entry a
// second time lands again instead of being ignored as an unchanged prop.
export default function AdminAttendance({ jumpView = null, jumpKey = null }) {
  // includeHidden: this tab is the only place a race that was taken off the
  // attendance page can be put back, so it has to be able to see them.
  const events = useApi(useCallback(() => api.events(true), []));

  const [view, setView] = useState(jumpView || "signups");
  useEffect(() => {
    if (jumpView) setView(jumpView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpView, jumpKey]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

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

  // Upcoming rounds, in calendar order, shared by the views below.
  const upcoming = useMemo(
    () => [...(events.data || [])].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)),
    [events.data]
  );

  return (
    <div className="space-y-5">
      <SlidingTabs
        items={[
          { key: "signups", label: "Who can sign up" },
          { key: "missing", label: "Still to answer" },
          { key: "history", label: "Past sign-ups" },
        ]}
        value={view}
        onChange={setView}
      />

      {view === "history" && <AdminAttendanceHistory />}

      {view === "missing" && (
        <AdminAttendanceMissing races={upcoming} racesError={events.error} onReloadRaces={events.reload} />
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
