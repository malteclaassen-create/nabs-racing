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

// Whether members can see any door to reporting. The gaps that kept it shut
// are closed: the accused is told, both drivers hear the outcome, the decision
// is one act, and the notifications land on a page that exists.
//
// It stays a switch rather than becoming nothing, because turning the feature
// off for a week is a thing a league might want and re-deleting four buttons is
// not. Every entry point asks this one constant — the home page, a round on the
// Races page, the burger menu, the Personal Area and the corner button — so
// there is no door left open when it goes false.
export const REPORTS_OPEN_TO_MEMBERS = true;

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
function Thread({ id, onBack, onWithdrawn }) {
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

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      await api.withdrawReport(id);
      onWithdrawn?.();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!data) return <p className="text-sm text-light">Loading…</p>;
  const s = STATUS_UI[data.report.status] || STATUS_UI.NEW;
  const canWithdraw = data.report.status === "NEW" && data.messages.length === 0;

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
        {/* Filed by mistake. Only while nothing has happened to it: once the
            stewards have picked it up or somebody has answered, it is a
            conversation with other people in it and taking it away is not one
            person's to do. The server enforces the same rule. */}
        {canWithdraw && (
          <button
            className="w-full text-xs font-semibold text-light transition hover:text-bad"
            disabled={busy}
            onClick={withdraw}
          >
            Withdraw this report
          </button>
        )}
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
  // Set when the driver just named has never signed in with Discord: the thread
  // exists and the stewards can see it, but there is no account to tell and
  // nobody on the other side to answer. Better said out loud than assumed.
  const [unreachable, setUnreachable] = useState(null);
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
    // Every round that has HAPPENED, not only the ones with a result imported.
    // The race you want to report is the one you finished twenty minutes ago,
    // and the result does not usually go in until the next day — so filtering
    // on isCompleted hid exactly the round anybody would be filing about.
    api
      .races()
      .then((r) => {
        const now = Date.now();
        setRaces(
          (r || [])
            .filter((x) => x.isCompleted || (x.date && new Date(x.date).getTime() <= now))
            .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
            .slice(0, 40)
        );
      })
      .catch(() => {});
    api.teams().then((t) => setDrivers((t || []).flatMap((x) => x.drivers.map((d) => ({ ...d, team: x.name }))))).catch(() => {});
    api.myReports().then((r) => setMine(r.reports || [])).catch(() => {});
  }, [open, isLoggedIn]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const accused = drivers.find((d) => d.id === form.accusedDriverId);
      const res = await api.createReport({
        raceId: form.raceId || null,
        lap: form.lap === "" ? null : Number(form.lap),
        accusedDriverId: form.accusedDriverId || null,
        accusedName: accused?.name || null,
        body: form.body,
      });
      // Three different outcomes, and only one of them is "the other driver
      // can see it": named and reachable, named but with no Discord account,
      // or nobody named at all — which used to fall through to the reassuring
      // sentence even though there was nobody on the other end.
      setSent(
        !form.accusedDriverId
          ? "nobody"
          : res?.accusedReachable === false
            ? "unreachable"
            : "ok"
      );
      setUnreachable(res?.accusedReachable === false ? accused?.name || "That driver" : null);
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
      {REPORTS_OPEN_TO_MEMBERS && (
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
      )}

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
              <Thread
                key={openId}
                id={openId}
                onBack={() => setOpenId(null)}
                onWithdrawn={() => {
                  setOpenId(null);
                  api.myReports().then((r) => setMine(r.reports || [])).catch(() => {});
                }}
              />
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
                        {sent === "ok"
                          ? "Sent. The stewards can see it now, and so can the driver you named."
                          : "Sent. The stewards can see it now."}
                      </p>
                      {sent === "nobody" && (
                        <p className="text-sm leading-relaxed text-light">
                          You did not name a driver, so for now only the stewards can read it. If they work out
                          who it was about, that driver joins the thread and can answer.
                        </p>
                      )}
                      {sent === "unreachable" && (
                        <p className="text-sm leading-relaxed text-light">
                          {unreachable} has never signed in with Discord, so they cannot be told about this or
                          answer it. The stewards will have to reach them another way.
                        </p>
                      )}
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
