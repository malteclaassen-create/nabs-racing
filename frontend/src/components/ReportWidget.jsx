import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";
import SlidingTabs from "./SlidingTabs.jsx";
import { useDismiss, useFocusTrap, useScrollLock } from "./overlay.jsx";

// ---------------------------------------------------------------------------
// "Somebody hit me on lap 14." The stewarding side of the site, in the corner
// where the Feedback button used to live.
//
// One panel, two halves: file a report, or read the ones you are part of. They
// are together on purpose — the moment after you send one is exactly when you
// want to see it sitting there, and the driver answering an accusation arrives
// through the same button as the driver making one.
//
// A report needs a Discord login. Not gatekeeping: an anonymous accusation is
// not something a league can act on, and there would be nobody to tell how it
// turned out.
//
// Nothing here is public. A thread is visible to the person who filed it, the
// driver it names, the admins, and anyone an admin lets in. The server enforces
// that on every read; this component only ever shows what it was given.
// ---------------------------------------------------------------------------

export const REPORT_OPEN_EVENT = "nabs-report-open";

// Other parts of the site ask for the panel by firing this (the race page's
// Report button, the burger menu).
export function openReport(detail = {}) {
  window.dispatchEvent(new CustomEvent(REPORT_OPEN_EVENT, { detail }));
}

const STATUS_UI = {
  NEW: { label: "Waiting", cls: "bg-surface2 text-light" },
  REVIEWING: { label: "Being looked at", cls: "bg-sky-500/15 text-link" },
  PENALTY: { label: "Penalty", cls: "bg-red-500/15 text-bad" },
  NO_PENALTY: { label: "No penalty", cls: "bg-emerald-500/15 text-ok" },
  DISMISSED: { label: "Closed", cls: "bg-surface2 text-light" },
};

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4M5 4h11l-1.6 3.5L16 11H5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

// One thread, opened from the list.
function Thread({ id, onBack }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.report(id).then(setData).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.replyToReport(id, text.trim());
      setData((d) => ({ ...d, messages: r.messages }));
      setText("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!data) return <p className="text-sm text-light">Loading…</p>;
  const s = STATUS_UI[data.report.status] || STATUS_UI.NEW;

  return (
    <div className="space-y-3">
      <button className="transition text-xs font-semibold text-link hover:underline" onClick={onBack}>
        ← All reports
      </button>

      <div className="rounded-lg border border-border bg-surface2/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`pill ${s.cls}`}>{s.label}</span>
          {data.report.lap != null && (
            <span className="font-mono text-[11px] uppercase tracking-wider text-light">Lap {data.report.lap}</span>
          )}
          {data.report.accusedName && (
            <span className="text-xs text-light">about {data.report.accusedName}</span>
          )}
        </div>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-dark">{data.report.body}</p>
        {data.report.verdict && (
          <p className="mt-2 border-t border-border pt-2 text-sm leading-relaxed text-medium">
            <span className="font-semibold text-dark">The stewards: </span>
            {data.report.verdict}
            {data.report.penaltySeconds != null && ` (${data.report.penaltySeconds}s)`}
          </p>
        )}
      </div>

      <ul className="space-y-2">
        {data.messages.map((m) => (
          <li
            key={m.id}
            className={`rounded-lg border-l-2 px-3 py-2 ${
              m.author === "ADMIN" ? "border-brand/60 bg-brand/5" : "ml-3 border-border bg-surface2/60"
            }`}
          >
            <div className="font-mono text-[10px] uppercase tracking-wider text-light">
              {m.author === "ADMIN" ? "Stewards" : m.authorName || "Driver"} · {when(m.createdAt)}
            </div>
            <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-dark">{m.body}</p>
          </li>
        ))}
        {data.messages.length === 0 && <li className="text-sm text-light">Nothing written yet.</li>}
      </ul>

      <div className="space-y-2">
        <textarea
          className="input h-20 resize-none"
          placeholder="Add something to this report…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn-primary w-full" disabled={busy || !text.trim()} onClick={send}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

export default function ReportWidget() {
  const location = useLocation();
  const { isLoggedIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("new");
  const [openId, setOpenId] = useState(null);
  const [races, setRaces] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [mine, setMine] = useState([]);
  const [form, setForm] = useState({ raceId: "", lap: "", accusedDriverId: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const panelRef = useRef(null);
  const fabRef = useRef(null);
  const textRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onOpen = (e) => {
      setError(null);
      setSent(false);
      setOpenId(null);
      setView(e.detail?.view === "mine" ? "mine" : "new");
      // Opened from a race page, that race is the one being reported about.
      if (e.detail?.raceId) setForm((f) => ({ ...f, raceId: e.detail.raceId }));
      setOpen(true);
    };
    window.addEventListener(REPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(REPORT_OPEN_EVENT, onOpen);
  }, []);

  useDismiss(open, close, { ref: panelRef, anchorRef: fabRef });
  useFocusTrap(open, panelRef, { initialFocus: sent ? undefined : textRef });
  useScrollLock(open);

  useEffect(() => setOpen(false), [location.pathname]);

  // Loaded when the panel opens, not on every page: this is a rarely-pressed
  // button and the roster is not small.
  useEffect(() => {
    if (!open || !isLoggedIn) return;
    api.races().then((r) => setRaces((r || []).filter((x) => x.isCompleted).slice(0, 40))).catch(() => {});
    api.teams().then((t) => setDrivers((t || []).flatMap((x) => x.drivers.map((d) => ({ ...d, team: x.name }))))).catch(() => {});
    api.myReports().then((r) => setMine(r.reports || [])).catch(() => {});
  }, [open, isLoggedIn]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const accused = drivers.find((d) => d.id === form.accusedDriverId);
      await api.createReport({
        raceId: form.raceId || null,
        lap: form.lap === "" ? null : Number(form.lap),
        accusedDriverId: form.accusedDriverId || null,
        accusedName: accused?.name || null,
        body: form.body,
      });
      setSent(true);
      setForm({ raceId: "", lap: "", accusedDriverId: "", body: "" });
      api.myReports().then((r) => setMine(r.reports || [])).catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* The floating button. Desktop only, like the Feedback one it replaced:
          on a phone this corner belongs to the page and to the thumb. */}
      <button
        ref={fabRef}
        type="button"
        aria-label="Report an incident"
        onClick={() => (open ? close() : openReport())}
        className="fab-morph group fixed bottom-6 right-6 z-chrome hidden h-12 items-center justify-start overflow-hidden rounded-full border border-border bg-card pl-[13px] text-sm font-bold text-medium shadow-lg shadow-ink/10 transition-[width,padding,color,border-color] duration-base ease-out-soft hover:border-brand/50 hover:text-dark lg:flex"
      >
        <span className="shrink-0">{open ? <CloseIcon /> : <FlagIcon />}</span>
        <span className="ml-2 whitespace-nowrap pr-4 opacity-0 transition-opacity duration-base group-hover:opacity-100">
          Report an incident
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Report an incident"
          className="fixed inset-x-3 bottom-3 top-3 z-overlay flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl sm:inset-x-auto sm:right-6 sm:top-auto sm:bottom-24 sm:h-[min(34rem,80vh)] sm:w-[26rem]"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
              Incident reports
            </h2>
            <button aria-label="Close" onClick={close} className="text-light transition hover:text-dark">
              <CloseIcon />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!isLoggedIn ? (
              <p className="text-sm leading-relaxed text-light">
                Reports need a Discord login. The stewards have to know who filed one, and you need somewhere to be
                told how it went.
              </p>
            ) : openId ? (
              <Thread id={openId} onBack={() => setOpenId(null)} />
            ) : (
              <div className="space-y-4">
                <SlidingTabs
                  items={[
                    { key: "new", label: "New report" },
                    { key: "mine", label: `Mine${mine.length ? ` (${mine.length})` : ""}` },
                  ]}
                  value={view}
                  onChange={(v) => {
                    setView(v);
                    setSent(false);
                  }}
                  btnClassName="px-3 py-1.5 text-xs"
                />

                {view === "new" &&
                  (sent ? (
                    <div className="space-y-3">
                      <p className="text-sm leading-relaxed text-ok">
                        Sent. The stewards can see it now, and so can the driver you named.
                      </p>
                      <button className="btn-secondary w-full" onClick={() => setView("mine")}>
                        See my reports
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <select
                        aria-label="Which race"
                        className="input"
                        value={form.raceId}
                        onChange={(e) => setForm({ ...form, raceId: e.target.value })}
                      >
                        <option value="">Which race?</option>
                        {races.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.number != null ? `R${r.number}` : "Session"} {r.track}
                          </option>
                        ))}
                      </select>

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          aria-label="Lap"
                          type="number"
                          min="1"
                          className="input"
                          placeholder="Lap"
                          value={form.lap}
                          onChange={(e) => setForm({ ...form, lap: e.target.value })}
                        />
                        <select
                          aria-label="Which driver"
                          className="input"
                          value={form.accusedDriverId}
                          onChange={(e) => setForm({ ...form, accusedDriverId: e.target.value })}
                        >
                          <option value="">Who?</option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <textarea
                        ref={textRef}
                        className="input h-28 resize-none"
                        placeholder="What happened? Where on the track, and what did it cost you?"
                        value={form.body}
                        onChange={(e) => setForm({ ...form, body: e.target.value })}
                      />

                      {error && <p className="text-sm text-bad">{error}</p>}

                      <button className="btn-primary w-full" disabled={busy || form.body.trim().length < 5} onClick={submit}>
                        {busy ? "Sending…" : "Send to the stewards"}
                      </button>
                      <p className="text-xs leading-relaxed text-light">
                        Only you, the driver you name and the admins can read this.
                      </p>
                    </div>
                  ))}

                {view === "mine" &&
                  (mine.length === 0 ? (
                    <p className="text-sm text-light">You are not part of any report.</p>
                  ) : (
                    <ul className="divide-y divide-border border-y border-border">
                      {mine.map((r) => {
                        const s = STATUS_UI[r.status] || STATUS_UI.NEW;
                        return (
                          <li key={r.id}>
                            <button
                              className="flex w-full flex-col gap-1 py-2.5 text-left transition hover:bg-surface2/60"
                              onClick={() => setOpenId(r.id)}
                            >
                              <span className="flex flex-wrap items-center gap-2">
                                <span className={`pill ${s.cls}`}>{s.label}</span>
                                <span className="text-sm font-semibold text-dark">
                                  {r.accusedName || "An incident"}
                                </span>
                                {r.lap != null && (
                                  <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                                    lap {r.lap}
                                  </span>
                                )}
                              </span>
                              <span className="line-clamp-2 text-xs text-light">{r.body}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
