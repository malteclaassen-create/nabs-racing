import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox } from "./ui.jsx";

// Admin tab "Notifications": league-wide control over the nav-bar bell.
// Which events post a notification, who hears about seat offers, and when the
// race reminders go out — admin decisions, not per-member ones.

const labelCls = "font-mono text-[11px] font-bold uppercase tracking-wider text-light";

// One on/off switch row.
function ToggleRow({ label, help, value, onChange }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <span>
        <span className="block text-sm font-semibold text-dark">{label}</span>
        {help && <span className="mt-0.5 block text-xs leading-relaxed text-light">{help}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-surface2 ring-1 ring-border transition peer-checked:bg-primary" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-card shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

// Labels for the reminder offsets the backend offers (hours before kickoff).
const OFFSET_LABELS = { 72: "3 days before", 24: "1 day before", 6: "6 hours before", 1: "1 hour before" };

const STATUS_LABELS = { ACCEPTED: "Accepted", DECLINED: "Declined", TENTATIVE: "Tentative" };

// Manual "please answer the attendance" nudge for one upcoming race. Separate
// from the settings form on purpose: it's an action, not a setting.
function AttendanceNudge() {
  const events = useApi(useCallback(() => api.events(), []));
  const [raceId, setRaceId] = useState("");
  const [state, setState] = useState(null); // {ok, text}
  const [busy, setBusy] = useState(false);
  const list = events.data || [];
  const selected = raceId || list[0]?.id || "";

  async function send() {
    if (!selected) return;
    setBusy(true);
    setState(null);
    try {
      await api.adminAttendancePing(selected);
      setState({ ok: true, text: "Sent. Every member's bell has the nudge now." });
    } catch (e) {
      setState({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (!list.length) return null;
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-2 text-sm font-semibold text-dark">Send a nudge now</div>
      <p className="mb-3 text-xs leading-relaxed text-light">
        Posts a &ldquo;please confirm or update your attendance&rdquo; note to everyone&rsquo;s
        bell for the chosen race. Works any number of times — use it when the list looks thin.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(e) => { setRaceId(e.target.value); setState(null); }}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-dark"
        >
          {list.map((e) => (
            <option key={e.id} value={e.id}>
              {e.type === "TRAINING" ? "Training" : `Round ${e.number}`} · {e.track}
            </option>
          ))}
        </select>
        <button onClick={send} disabled={busy || !selected} className="btn-secondary">
          {busy ? "Sending…" : "Send nudge"}
        </button>
      </div>
      {state && (
        <p className={`mt-2 text-sm font-medium ${state.ok ? "text-emerald-600" : "text-red-500"}`}>{state.text}</p>
      )}
    </div>
  );
}

export default function AdminNotifications() {
  const { data, loading, error } = useApi(useCallback(() => api.adminNotificationSettings(), []));
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !error && !form && data?.settings) setForm(data.settings);
  }, [loading, error, data, form]);

  if (error) return <ErrorBox message={error} />;
  if (loading || !form) return <p className="text-sm text-light">Loading…</p>;

  const offsets = data?.reminderOffsets || [72, 24, 6, 1];
  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setMsg(null);
  };
  const toggleReminder = (h) =>
    set(
      "reminders",
      form.reminders.includes(h) ? form.reminders.filter((x) => x !== h) : [...form.reminders, h]
    );

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.saveNotificationSettings(form);
      setForm(res.settings);
      setMsg({ ok: true, text: "Saved. Applies to the next notification right away." });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-lg bg-surface2/60 px-4 py-3 text-sm leading-relaxed text-medium">
        Controls the <b>notification bell</b> in the site&rsquo;s top bar. These are league-wide
        settings: members can&rsquo;t change what they receive. Notifications reach members who
        have logged in with Discord; personal ones additionally need the driver&rsquo;s Discord id
        (Drivers tab).
      </div>

      <div className="card p-5">
        <h3 className={`${labelCls} mb-1`}>Events</h3>
        <div className="divide-y divide-border">
          <ToggleRow
            label="Race results"
            help="Everyone gets a note when a round's results are saved for the first time. Edits stay silent."
            value={form.results}
            onChange={(v) => set("results", v)}
          />
          <ToggleRow
            label="New downloads"
            help="Everyone gets a note when a published download or link is added."
            value={form.downloads}
            onChange={(v) => set("downloads", v)}
          />
          <ToggleRow
            label="Seat filled"
            help="The picked reserve gets a personal note when a driver (or an admin) hands them the seat."
            value={form.seatFilled}
            onChange={(v) => set("seatFilled", v)}
          />
        </div>
      </div>

      <div className="card p-5">
        <h3 className={`${labelCls} mb-1`}>Seat offers</h3>
        <p className="mb-3 text-xs leading-relaxed text-light">
          Who hears about it when a full-time driver puts their seat on the market.
        </p>
        <div className="flex flex-col gap-2">
          {[
            { value: "reserves", label: "Reserve drivers only", help: "Only members linked to this season's reserve roster. The usual choice, since they're the ones who can take the seat." },
            { value: "all", label: "All members", help: "Every logged-in member, full-time drivers included." },
            { value: "off", label: "Nobody", help: "Seat offers post no notification at all." },
          ].map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                form.seatOffers === o.value ? "border-primary/60 bg-primary/5" : "border-border hover:bg-surface2"
              }`}
            >
              <input
                type="radio"
                name="seatOffers"
                className="mt-1 accent-[var(--c-primary,#db2777)]"
                checked={form.seatOffers === o.value}
                onChange={() => set("seatOffers", o.value)}
              />
              <span>
                <span className="block text-sm font-semibold text-dark">{o.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-light">{o.help}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h3 className={`${labelCls} mb-1`}>Race reminders</h3>
        <p className="mb-3 text-xs leading-relaxed text-light">
          When members get reminded of an upcoming championship round (everyone; based on the
          race&rsquo;s kickoff time, the usual Friday 19:00 CET/CEST when no time is set).
          Pick as many as you like. Each fires once per race; none selected turns reminders off.
        </p>
        <div className="flex flex-wrap gap-2">
          {offsets.map((h) => (
            <label
              key={h}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                form.reminders.includes(h)
                  ? "border-primary/60 bg-primary/10 text-dark"
                  : "border-border text-medium hover:bg-surface2"
              }`}
            >
              <input
                type="checkbox"
                className="accent-[var(--c-primary,#db2777)]"
                checked={form.reminders.includes(h)}
                onChange={() => toggleReminder(h)}
              />
              {OFFSET_LABELS[h] || `${h} hours before`}
            </label>
          ))}
        </div>
        <div className="mt-2 divide-y divide-border">
          <ToggleRow
            label="Remind for training sessions too"
            help="The reminders above also fire for scheduled training sessions (results notifications cover trainings either way)."
            value={form.trainingReminders !== false}
            onChange={(v) => set("trainingReminders", v)}
          />
        </div>
      </div>

      <div className="card p-5">
        <h3 className={`${labelCls} mb-1`}>Attendance sign-up</h3>
        <p className="mb-3 text-xs leading-relaxed text-light">
          When the Attendance page starts taking answers for a race, and what it shows.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-dark">
          <span className="font-semibold">Sign-up opens</span>
          <select
            value={form.attendanceOpenDays ?? ""}
            onChange={(e) => set("attendanceOpenDays", e.target.value === "" ? null : Number(e.target.value))}
            className="rounded-lg border border-border bg-card px-3 py-2"
          >
            <option value="">always (no window)</option>
            {[1, 2, 3, 4, 5, 6, 7, 10, 14].map((d) => (
              <option key={d} value={d}>{d} {d === 1 ? "day" : "days"} before race day</option>
            ))}
          </select>
          {form.attendanceOpenDays != null && (
            <>
              <span className="font-semibold">at</span>
              <select
                value={form.attendanceOpenHour ?? 8}
                onChange={(e) => set("attendanceOpenHour", Number(e.target.value))}
                className="rounded-lg border border-border bg-card px-3 py-2"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                ))}
              </select>
              <span className="text-light">CET/CEST (league time)</span>
            </>
          )}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-light">
          Example: a Friday race with &ldquo;5 days, 08:00&rdquo; opens the Sunday before at 08:00.
          Before that, the page shows when the sign-up opens (in each visitor&rsquo;s own timezone)
          and takes no answers. While it&rsquo;s closed the Attendance item also stays out of the
          navigation, and it leaves again once the race&rsquo;s result is saved.
        </p>
        {form.attendanceOpenDays != null && (
          <div className="mt-1 divide-y divide-border">
            <ToggleRow
              label="Announce when the sign-up opens"
              help="Everyone's bell gets a note the moment a race's sign-up window opens."
              value={form.attendanceOpenNotify !== false}
              onChange={(v) => set("attendanceOpenNotify", v)}
            />
          </div>
        )}
        <div className="mt-4 border-t border-border pt-4">
          <div className="mb-2 text-sm font-semibold text-dark">Answers shown on the page</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(STATUS_LABELS).map(([key, label]) => {
              const on = !Array.isArray(form.attendanceShow) || form.attendanceShow.includes(key);
              return (
                <label
                  key={key}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    on ? "border-primary/60 bg-primary/10 text-dark" : "border-border text-medium hover:bg-surface2"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--c-primary,#db2777)]"
                    checked={on}
                    onChange={() => {
                      const cur = Array.isArray(form.attendanceShow)
                        ? form.attendanceShow
                        : Object.keys(STATUS_LABELS);
                      set("attendanceShow", on ? cur.filter((s) => s !== key) : [...cur, key]);
                    }}
                  />
                  {label}
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-light">
            Hidden columns disappear from the Attendance page for everyone (answering still works
            for all three). Hiding everything falls back to showing all.
          </p>
        </div>
        <AttendanceNudge />
      </div>

      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-lg">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-white transition hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && <span className={`text-sm font-medium ${msg.ok ? "text-emerald-600" : "text-red-500"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
