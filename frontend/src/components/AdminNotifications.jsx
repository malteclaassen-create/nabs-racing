import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Megaphone } from "lucide-react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeries } from "../context/SeriesContext.jsx";
import { ErrorBox, Field, CheckField, Notice } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import { useAttendanceReminder, LastReminder } from "./AdminAttendanceReminder.jsx";

// Admin tab "Notifications": league-wide control over the nav-bar bell.
// Which events post a notification, who hears about seat offers, and when the
// race reminders go out — admin decisions, not per-member ones.

const labelCls = "font-mono text-[11px] font-bold uppercase tracking-wider text-light";
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
// from the settings form on purpose: it's an action, not a setting. The same
// reminder as the Attendance tab's button (AdminAttendanceReminder.jsx): only
// the drivers who haven't answered, and it says how many before it goes.
function AttendanceNudge() {
  const events = useApi(useCallback(() => api.events(), []));
  const [raceId, setRaceId] = useState("");
  const [state, setState] = useState(null); // {ok, text}
  const { remind, busyId } = useAttendanceReminder();
  const [pings, setPings] = useState({});
  useEffect(() => {
    api.adminAttendancePings().then(setPings).catch(() => {});
  }, []);
  const list = events.data || [];
  const selected = raceId || list[0]?.id || "";

  async function send() {
    const race = list.find((e) => e.id === selected);
    if (!race) return;
    setState(null);
    const res = await remind(race);
    if (!res) return;
    setState(res);
    if (res.lastSentAt) setPings((p) => ({ ...p, [race.id]: { ...p[race.id], at: res.lastSentAt } }));
  }

  if (!list.length) return null;
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-2 text-sm font-semibold text-dark">Send a nudge now</div>
      <p className="mb-3 text-xs leading-relaxed text-light">
        A personal &ldquo;you haven&rsquo;t answered yet&rdquo; note in the bell of every driver who
        hasn&rsquo;t answered the chosen race. People who already answered hear nothing. Works any
        number of times; use it when the list looks thin.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Race to nudge"
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
        <button onClick={send} disabled={!!busyId || !selected} className="btn-secondary">
          {busyId ? "Checking…" : "Send nudge"}
        </button>
        <LastReminder at={pings[selected]?.at} className="text-xs text-light" />
      </div>
      {state && (
        <p className={`mt-2 text-sm font-medium ${state.ok ? "text-ok" : "text-bad"}`}>{state.text}</p>
      )}
    </div>
  );
}

// --- announcements -------------------------------------------------------------
// Words the admin writes, to the bell and/or the Discord events channel. The
// server (backend lib/announcements.js) is the one that decides what is valid
// and who each audience reaches; the checks here only say so sooner.

const AUDIENCE_HELP = {
  everyone: "One note every member sees, including anybody who logs in for the first time later.",
  season: "Every driver on the running season's roster, full-timers and reserves.",
  reserves: "Only the reserve pool: seat news, a call for stand-ins.",
  fulltime: "Only drivers with a team seat.",
};

// A fresh id per announcement. It is what the server recognises a resend by,
// so it is minted when the form starts and only replaced once a send went
// through: a double click or a retry after a timeout sends the SAME id.
const newAnnounceId = () =>
  (window.crypto?.randomUUID?.() || `${Date.now().toString(36)}${String(Math.random()).slice(2)}`).replace(/-/g, "");

// The same two shapes the server accepts: a path on this site, or an http(s)
// address. Everything else is refused there anyway; saying it under the field
// saves a round trip and a dialog.
function linkProblem(link) {
  const l = link.trim();
  if (!l) return null;
  if (/\s/.test(l)) return "No spaces in a link.";
  if (l.startsWith("//") || l.startsWith("/\\")) return "A site link starts with a single /, like /attendance.";
  if (l.startsWith("/")) return null;
  if (/^https?:\/\/[^/\s]+/i.test(l)) return null;
  return "A site path like /attendance, or a web address starting with https://.";
}

const fmtWhen = (iso) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// What the bell entry will look like: the same row the bell draws, with the
// megaphone and "just now", so the admin reads it the way a member will.
function BellPreview({ title, body, link }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-light">
        Notifications
      </div>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="mt-0.5 shrink-0 text-dark">
          <Megaphone className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block break-words text-sm font-bold leading-snug ${title ? "text-dark" : "text-faint"}`}>
            {title || "Your title"}
          </span>
          {/* No pre-line: the bell folds line breaks, so the preview does too. */}
          {body && <span className="mt-0.5 block break-words text-xs leading-relaxed text-light">{body}</span>}
          <span className="mt-1 block font-mono text-[10px] uppercase tracking-wider text-light">just now</span>
        </span>
        <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
      </div>
      {link && (
        <div className="border-t border-border px-4 py-2 text-xs text-light">
          Opens <span className="break-all font-mono text-medium">{link}</span>
        </div>
      )}
    </div>
  );
}

function AnnouncementLog({ list }) {
  if (!list?.length) return <p className="text-sm text-light">Nothing sent yet.</p>;
  return (
    <ul className="divide-y divide-border border-y border-border">
      {list.map((a) => {
        const channels = [a.channels?.bell && "Bell", a.channels?.discord && "Discord"].filter(Boolean).join(" + ");
        return (
          <li key={a.id} className="py-2.5 text-sm">
            <div className="font-semibold text-dark">{a.title}</div>
            {a.body && <div className="mt-0.5 line-clamp-2 text-xs text-light">{a.body}</div>}
            <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-light">
              {fmtWhen(a.at)} · {a.by} · {a.audienceLabel}
              {a.season?.number ? ` (S${a.season.number})` : ""} · {channels}
              {a.channels?.bell ? ` · ${a.reach} reached` : ""}
            </div>
            {a.discord === "failed" && (
              <div className="mt-0.5 text-xs font-semibold text-warn">Discord didn&rsquo;t take the post.</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AnnouncementComposer() {
  const ask = useAsk();
  const { current: series } = useSeries();
  const slug = series?.slug || null;
  // The series is in the list so switching it re-reads the audience sizes:
  // "drivers of the season" is the running season of the series being edited.
  const ctx = useApi(useCallback(() => api.adminAnnouncements(), [slug])); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState({ title: "", body: "", link: "", audience: "everyone", bell: true, discord: false });
  const [id, setId] = useState(newAnnounceId);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { kind, text }

  const limits = ctx.data?.limits || { title: 90, body: 500, link: 300 };
  const audiences = ctx.data?.audiences || {};
  const season = ctx.data?.season || null;
  const discordOn = !!ctx.data?.discord?.connected;
  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setResult(null);
  };

  const title = form.title.replace(/\s+/g, " ").trim();
  const linkErr = linkProblem(form.link);
  const titleErr = form.title.length > limits.title ? `${limits.title} characters at most.` : null;
  const bodyErr = form.body.length > limits.body ? `${limits.body} characters at most.` : null;
  const noChannel = !form.bell && !(form.discord && discordOn);
  const aud = audiences[form.audience];
  const needsSeason = form.audience !== "everyone";
  const canSend = !!title && !linkErr && !titleErr && !bodyErr && !noChannel && !(needsSeason && !season) && !busy;

  async function send() {
    if (!canSend) return;
    const reach = aud?.reach ?? 0;
    const of = season ? ` of Season ${season.number}` : "";
    const who = {
      everyone: "everyone",
      season: `the drivers${of}`,
      reserves: `the reserves${of}`,
      fulltime: `the full-time drivers${of}`,
    }[form.audience];
    const lines = [];
    if (form.bell) {
      lines.push(
        form.audience === "everyone"
          ? `${plural(reach, "member")} who ${reach === 1 ? "has" : "have"} logged in see it in the bell, and so does anybody who logs in later.`
          : `${plural(reach, "driver")} get${reach === 1 ? "s" : ""} it in the bell.` +
              (aud?.withoutLogin ? ` ${aud.withoutLogin} more ${aud.withoutLogin === 1 ? "has" : "have"} never logged in and won't see it.` : "")
      );
    }
    if (form.discord && discordOn) {
      lines.push("It is also posted in the Discord events channel, where everybody in the server can read it, whatever the audience above.");
    }
    const yes = await ask({
      title: `Send this to ${who}?`,
      body: lines.join("\n\n"),
      confirmLabel: form.bell ? `Send to ${reach}` : "Post to Discord",
    });
    if (!yes) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.sendAnnouncement({
        id,
        title: form.title,
        body: form.body,
        link: form.link,
        audience: form.audience,
        channels: { bell: form.bell, discord: form.discord && discordOn },
      });
      const a = res.announcement;
      const parts = [];
      if (a.channels?.bell) parts.push(`in ${plural(a.reach, "bell")}`);
      if (a.discord === "sent") parts.push("on Discord");
      setResult({
        kind: a.discord === "failed" ? "warn" : "success",
        text: res.duplicate
          ? "That one had already gone out, so it wasn't sent again."
          : a.discord === "failed"
            ? `Sent ${parts.join(" and ")}, but Discord didn't take the post. Check the webhook under Races & Events.`
            : `Sent ${parts.join(" and ")}.`,
      });
      // A new announcement starts from a clean form and a new id.
      setForm((f) => ({ ...f, title: "", body: "", link: "" }));
      setId(newAnnounceId());
      ctx.reload();
    } catch (e) {
      setResult({ kind: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h3 className={`${labelCls} mb-1`}>Announcement</h3>
      <p className="mb-4 text-xs leading-relaxed text-light">
        Say something the site doesn&rsquo;t say by itself: a server move, a rule change, a call for
        stand-ins. It goes to the bell, to Discord, or both.
      </p>
      {ctx.error && <ErrorBox message={ctx.error} onRetry={ctx.reload} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="space-y-4">
          <Field label="Title" required error={titleErr} accessory={`${form.title.length}/${limits.title}`}>
            <input
              className="input"
              value={form.title}
              maxLength={limits.title + 20}
              placeholder="Server moves to Frankfurt tonight"
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
          <Field label="Message" error={bodyErr} accessory={`${form.body.length}/${limits.body}`} hint="Optional. One or two sentences read best in the bell.">
            <textarea
              className="input min-h-24"
              value={form.body}
              rows={3}
              onChange={(e) => set("body", e.target.value)}
            />
          </Field>
          <Field label="Link" error={linkErr} hint="Optional. A page of the site like /attendance, or a web address starting with https://.">
            <input
              className="input font-mono"
              value={form.link}
              placeholder="/attendance"
              inputMode="url"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => set("link", e.target.value)}
            />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
            How it reads in the bell
          </div>
          <BellPreview title={title} body={form.body.trim()} link={linkErr ? null : form.link.trim()} />
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Who gets it</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(AUDIENCE_HELP).map(([key, help]) => {
            const a = audiences[key];
            const off = key !== "everyone" && !season;
            const count = !a
              ? ""
              : key === "everyone"
                ? `${plural(a.reach, "member")}`
                : `${a.reach} of ${plural(a.drivers ?? 0, "driver")} reachable`;
            return (
              <label
                key={key}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                  form.audience === key ? "border-accent/60 bg-accent/10" : "border-border hover:bg-surface2"
                } ${off ? "pointer-events-none opacity-50" : ""}`}
              >
                <input
                  type="radio"
                  name="announce-audience"
                  className="mt-1 accent-[var(--c-primary,#db2777)]"
                  checked={form.audience === key}
                  disabled={off}
                  onChange={() => set("audience", key)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-dark">
                    {a?.label || key}
                    {key !== "everyone" && season ? ` · S${season.number}` : ""}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-light">{help}</span>
                  {count && <span className="mt-1 block font-mono text-[11px] tabular-nums text-medium">{count}</span>}
                </span>
              </label>
            );
          })}
        </div>
        {!season && ctx.data && (
          <p className="mt-2 text-xs text-light">This series has no running season, so only &ldquo;Everyone&rdquo; can be picked.</p>
        )}
      </fieldset>

      <fieldset className="mt-5">
        <legend className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Where</legend>
        <div className="space-y-3">
          <CheckField
            checked={form.bell}
            onChange={(e) => set("bell", e.target.checked)}
            label="The bell on the site"
            hint="Everyone: one note for all members. The narrower audiences: a personal note to each linked login."
          />
          <CheckField
            checked={form.discord && discordOn}
            disabled={!discordOn}
            onChange={(e) => set("discord", e.target.checked)}
            label="The Discord events channel"
            hint={
              discordOn ? (
                "Posted through the events webhook, where the whole server reads it: the audience above only narrows the bell. @everyone and @here are defused."
              ) : (
                <>
                  Discord isn&rsquo;t connected, so only the bell is available.{" "}
                  <Link to="/admin?tab=discord" className="font-semibold text-link hover:underline">
                    Set the events webhook under Races &amp; Events
                  </Link>{" "}
                  to post there too.
                </>
              )
            }
          />
        </div>
        {noChannel && <p className="mt-2 text-xs font-semibold text-warn">Pick at least one place to send it.</p>}
      </fieldset>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={!canSend} onClick={send}>
          {busy ? "Sending…" : "Send announcement"}
        </button>
        {!title && <span className="text-xs text-light">A title is all it needs.</span>}
      </div>
      {result && (
        <div className="mt-3">
          <Notice kind={result.kind}>{result.text}</Notice>
        </div>
      )}

      <div className="mt-6 border-t border-border pt-4">
        <div className="mb-2 text-sm font-semibold text-dark">Last 20 announcements</div>
        {ctx.loading && !ctx.data ? <p className="text-sm text-light">Loading…</p> : <AnnouncementLog list={ctx.data?.list} />}
      </div>
    </div>
  );
}

export default function AdminNotifications() {
  const { data, loading, error } = useApi(useCallback(() => api.adminNotificationSettings(), []));
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const ask = useAsk();
  // The answer list as last saved, so a second save without a change asks nothing.
  const [savedShow, setSavedShow] = useState(null);

  useEffect(() => {
    if (!loading && !error && !form && data?.settings) {
      setForm(data.settings);
      setSavedShow(data.settings.attendanceShow || null);
    }
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
    // Switching an answer off takes back every answer of that kind on the
    // upcoming races (the server does it on save). Worth a second look first.
    const wasOn = savedShow || Object.keys(STATUS_LABELS);
    const nowOn = Array.isArray(form.attendanceShow) ? form.attendanceShow : Object.keys(STATUS_LABELS);
    const dropped = wasOn.filter((s) => !nowOn.includes(s)).map((s) => STATUS_LABELS[s]);
    if (dropped.length) {
      const yes = await ask({
        title: `Switch off "${dropped.join('" and "')}"?`,
        body: `Members can no longer give that answer, and everyone who already did for an upcoming race loses it. They get a note in their bell asking them to answer again with what is left.`,
        confirmLabel: "Switch off and take answers back",
        danger: true,
      });
      if (!yes) return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.saveNotificationSettings(form);
      setForm(res.settings);
      setSavedShow(res.settings.attendanceShow || null);
      const w = res.withdrawn;
      setMsg({
        ok: true,
        text: w?.removed
          ? `Saved. ${w.removed} answer${w.removed === 1 ? "" : "s"} taken back on ${w.races.length} race${w.races.length === 1 ? "" : "s"}; ${w.members} member${w.members === 1 ? "" : "s"} asked to answer again.`
          : "Saved. Applies to the next notification right away.",
      });
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

      {/* An action rather than a setting, so it sends on its own button and
          the Save bar at the bottom has nothing to do with it. First, because
          it is the part of this tab used every week; the settings below are
          set once. */}
      <AnnouncementComposer />

      {/* The settings, with the Save bar that belongs to them. Wrapped so the
          bar can only stick inside this block: over the composer above it
          would read as though Save sent the announcement. */}
      <div className="space-y-6">
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
              label="Race photos"
              help="One note per round when its photo gallery first goes up (later batches for the same round stay silent)."
              value={form.photos}
              onChange={(v) => set("photos", v)}
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
            {/* No "Admin alerts" switch any more: a login without a driver, a
                raised hand, a server reset and a seat given back are the To do
                card at the top of the admin area, not bell notifications. */}
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
                  form.seatOffers === o.value ? "border-accent/60 bg-accent/10" : "border-border hover:bg-surface2"
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
                    ? "border-accent/60 bg-accent/10 text-dark"
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
              aria-label="Sign-up opens"
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
                  aria-label="Sign-up opens at"
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
            <div className="mb-2 text-sm font-semibold text-dark">Answers members can give</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(STATUS_LABELS).map(([key, label]) => {
                const on = !Array.isArray(form.attendanceShow) || form.attendanceShow.includes(key);
                return (
                  <label
                    key={key}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                      on ? "border-accent/60 bg-accent/10 text-dark" : "border-border text-medium hover:bg-surface2"
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
              An answer you switch off loses its button and its column on the Attendance page and in
              the Discord post. Answers already given with it on upcoming races are taken back when
              you save, and those members are asked to answer again. Switching everything off falls
              back to all three.
            </p>
          </div>
          <AttendanceNudge />
        </div>

        <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-lg">
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-onbrand transition hover:bg-primary-dark disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {msg && <span className={`text-sm font-medium ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
        </div>
      </div>
    </div>
  );
}
