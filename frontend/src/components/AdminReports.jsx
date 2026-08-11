import { useCallback, useEffect, useMemo, useState } from "react";
import { api, myDiscordId } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar, ErrorBox, Field, Notice } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import { fmtStamp } from "../utils/format.js";
import ReportChat, { ReportComposer } from "./ReportChat.jsx";

// ---------------------------------------------------------------------------
// Admin → Reports: the stewarding desk.
//
// Grouped by round, because that is how stewarding actually happens — you sit
// down with one race's replay and work through everything that happened in it,
// rather than picking incidents off a single long list in the order they were
// filed.
//
// Recording a decision here does NOT put the penalty on the driver. The seconds
// live in the results editor, which owns the points; this records what was
// decided and tells the people involved. Edit Results shows what was decided
// here beside its own penalty column, so the gap between "we agreed five
// seconds" and "five seconds are in the table" is visible instead of being
// something you have to remember.
// ---------------------------------------------------------------------------

// Fired whenever a report is decided, deleted or answered here, so the counter
// on the tab strip takes itself down instead of waiting for a page reload.
export const REPORTS_CHANGED_EVENT = "nabs-reports-changed";
const changed = () => window.dispatchEvent(new Event(REPORTS_CHANGED_EVENT));

const STATUS = [
  { key: "NEW", label: "Waiting", cls: "bg-surface2 text-light" },
  { key: "REVIEWING", label: "Looking at it", cls: "bg-sky-500/15 text-link" },
  { key: "PENALTY", label: "Penalty", cls: "bg-red-500/15 text-bad" },
  { key: "NO_PENALTY", label: "No penalty", cls: "bg-emerald-500/15 text-ok" },
  { key: "DISMISSED", label: "Closed", cls: "bg-surface2 text-light" },
];
const DECIDED = ["PENALTY", "NO_PENALTY", "DISMISSED"];
const uiOf = (s) => STATUS.find((x) => x.key === s) || STATUS[0];
const when = (iso) => (iso ? fmtStamp(iso) : "");

function Thread({ id, drivers, onChanged, onDeleted }) {
  const ask = useAsk();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [viewer, setViewer] = useState("");
  // The decision is edited as a whole and sent in ONE go. It used to post on
  // every keystroke's blur and on the dropdown's change, which meant the
  // drivers were told the outcome before the reasoning had been typed, and the
  // corrected version arrived as a repeat and was thrown away.
  const [draft, setDraft] = useState(null);

  const fromReport = (rep) => ({
    status: rep.status,
    penaltySeconds: rep.penaltySeconds ?? "",
    verdict: rep.verdict || "",
  });

  // `keepDraft` is every reload that is NOT the steward asking for the stored
  // version back. Writing a line to the drivers, naming the accused or letting
  // a witness in all reload the thread, and each one used to wipe a verdict
  // half typed in the box below — which defeats the whole point of composing
  // the decision as one act before sending it.
  const load = useCallback(
    (keepDraft = false) =>
      api
        .adminReport(id)
        .then((d) => {
          setData(d);
          setDraft((cur) => (keepDraft && cur ? cur : fromReport(d.report)));
        })
        .catch((e) => setError(e.message)),
    [id]
  );
  useEffect(() => {
    load();
  }, [load]);

  async function run(fn, doneMsg, isDecision = false) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fn();
      // Keep whatever is in the decision box unless this WAS the decision.
      await load(!isDecision);
      onChanged?.();
      changed();
      const text = typeof doneMsg === "function" ? doneMsg(res) : doneMsg;
      if (text) setMsg(text);
    } catch (e) {
      // Inline, not instead of the thread: replacing the whole panel with an
      // error box left a steward with no way back to what they were writing.
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data || !draft) {
    return error ? (
      <div className="px-5 py-3">
        <ErrorBox message={error} onRetry={() => load()} />
      </div>
    ) : (
      <p className="px-5 py-3 text-sm text-light">Loading…</p>
    );
  }
  const r = data.report;
  const dirty =
    draft.status !== r.status ||
    String(draft.penaltySeconds) !== String(r.penaltySeconds ?? "") ||
    draft.verdict !== (r.verdict || "");
  const willTell = DECIDED.includes(draft.status);

  return (
    // Two columns on a wide screen: the argument on the left, what you DO about
    // it on the right. Stacked, the decision form sat below a thread that grows
    // with every message, so the further a report got the further you had to
    // scroll past it to act on it — and reading a reply while typing a verdict
    // meant scrolling between the two.
    <div className="px-5 py-4">
      {error && <ErrorBox message={error} />}
      {msg && <Notice kind="success">{msg}</Notice>}

      <div className="mt-3 grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr),minmax(0,1fr)]">
        {/* LEFT — the conversation */}
        <div className="min-w-0 space-y-3">

      {/* the conversation, opening message and all */}
      <ReportChat
        report={r}
        messages={data.messages}
        attachments={data.attachments}
        admin
        mineIsReporter={!!myDiscordId() && r.reporterDiscordId === myDiscordId()}
      />

          <ReportComposer
            busy={busy}
            placeholder="Write to the drivers…"
            full
            onSend={(body, files) => run(() => api.adminReplyToReport(id, body, files))}
          />
        </div>

        {/* RIGHT — everything you do about it. Sticks on a tall screen so a
            long thread scrolls past it rather than pushing it away. */}
        <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
          {/* Who it is about, and only that. Naming a driver is the
              REPORTER's to do, from their own page: a steward who could
              re-point a report would be able to manufacture a case against
              somebody nobody complained about, in a thread that then reads as
              if the first driver wrote it. An in-game report with nobody named
              stays that way until the driver who sent it says. */}
          <div className="rounded-lg border border-border p-4">
            <div className="mb-1 font-mono text-[11px] font-bold uppercase tracking-widest text-light">
              The report is about
            </div>
            {r.accusedName ? (
              <p className="text-sm font-semibold text-dark">{r.accusedName}</p>
            ) : (
              <p className="text-sm leading-relaxed text-light">
                Nobody named yet. Only {r.reporterName || "the driver who filed it"} can say who it was, from
                their own reports page &mdash; until then the other driver cannot see this thread.
              </p>
            )}
          </div>


      {/* the decision */}
      <div className="rounded-lg border border-border p-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">Decision</div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Outcome" tone="plain">
            <select
              className="input py-1.5 text-sm"
              value={draft.status}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
            >
              {STATUS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Seconds" tone="plain">
            <input
              type="number"
              min="0"
              className="input w-24 py-1.5 text-sm"
              value={draft.penaltySeconds}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, penaltySeconds: e.target.value })}
            />
          </Field>
        </div>
        <textarea
          aria-label="What the stewards decided"
          className="input mt-2 h-16 resize-none"
          placeholder="What you decided, in the drivers' words rather than yours…"
          value={draft.verdict}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, verdict: e.target.value })}
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            className="btn-primary"
            disabled={busy || !dirty}
            onClick={() =>
              run(
                () =>
                  api.decideReport(id, {
                    status: draft.status,
                    penaltySeconds: draft.penaltySeconds === "" ? null : Number(draft.penaltySeconds),
                    verdict: draft.verdict,
                  }),
                // How many people it actually reached, from the server. "Both
                // drivers" is wrong when the accused has no account, and wrong
                // again when nobody is named at all.
                (res) => {
                  const n = res?.report?.told ?? 0;
                  if (!willTell) return "Saved.";
                  if (n === 0) return "Saved. Nobody could be told: there is no Discord account on this thread.";
                  return n === 1 ? "Saved. The one driver on this thread has been told." : `Saved. All ${n} people on this thread have been told.`;
                },
                true
              )
            }
          >
            {busy ? "Saving…" : "Save decision"}
          </button>
          {dirty && (
            <button className="btn-secondary" disabled={busy} onClick={load}>
              Undo
            </button>
          )}
          <p className="min-w-52 flex-1 text-xs leading-relaxed text-light">
            {willTell
              ? "Saving tells the drivers, once, with the outcome and this text. Recording seconds here does not put them on the driver: enter the penalty in Edit Results as well, where it is listed for you to check."
              : "Nothing is sent until the outcome is one of the three endings."}
          </p>
        </div>
      </div>

      {/* who else may read it */}
      <div className="rounded-lg border border-border p-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">
          Who can read this
        </div>
        <p className="text-xs leading-relaxed text-light">
          The driver who filed it, the driver it names and every admin, always. Add one more person for this
          report only. They get told they were added.
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {data.viewers.map((v) => (
            <li key={v.discordId} className="flex items-center gap-1.5 rounded-full bg-surface2 px-2.5 py-1 text-xs">
              <span className="font-semibold text-medium">{v.name || v.discordId}</span>
              <button
                className="transition text-light hover:text-bad"
                aria-label={`Remove ${v.name || v.discordId}`}
                disabled={busy}
                onClick={() => run(() => api.removeReportViewer(id, v.discordId))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          {/* By NAME. It used to want an 18-digit Discord user ID typed by
              hand, which meant leaving the site, turning on developer mode and
              copying a number — for what is meant to be "let the team mate who
              saw it read this". */}
          <select
            aria-label="Let a driver read this report"
            className="input w-auto max-w-64 py-1.5 text-sm"
            value={viewer}
            disabled={busy}
            onChange={(e) => setViewer(e.target.value)}
          >
            <option value="">Pick a driver…</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary py-1.5 text-sm"
            disabled={busy || !viewer}
            onClick={() =>
              run(async () => {
                await api.addReportViewer(id, { driverId: viewer });
                setViewer("");
              }, "Let in, and told.")
            }
          >
            Let in
          </button>
        </div>
      </div>

      {/* removing it entirely */}
      <div className="pt-1">
        <button
          className="transition text-xs font-semibold text-light hover:text-bad"
          disabled={busy}
          onClick={async () => {
            if (
              !(await ask({
                title: "Delete this report?",
                body: "The thread and everything written in it go with it. For a duplicate or something filed by mistake — a real report that came to nothing should be closed with 'No penalty' instead, so the drivers can still see what was decided.",
                danger: true,
                confirmLabel: "Delete report",
              }))
            )
              return;
            // Straight back to the list: reloading a thread that no longer
            // exists would answer 404 and leave an error where the report was.
            setBusy(true);
            try {
              await api.deleteReport(id);
              changed();
              onDeleted?.();
            } catch (e) {
              setError(e.message);
              setBusy(false);
            }
          }}
        >
          Delete this report
        </button>
      </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminReports() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.adminReports(), []));
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  // The report LIST is every report ever filed, across seasons, but the roster
  // above is only the season currently being edited. Without the series-wide
  // driver database, a report from an older season could not be pointed at the
  // driver it was about, because their name simply was not in the dropdown.
  // .entries, not the response. It answers { entries: [...] } — reading it as
  // an array threw "(db || []) is not iterable" out of the useMemo below and
  // took the whole tab down with it, which is what an admin actually saw:
  // "This page hit a snag" on /admin, because the admin restores the last tab
  // you were on.
  const { data: db } = useApi(useCallback(() => api.adminDriverDb().catch(() => ({ entries: [] })), []));
  const { data: ingest, reload: reloadIngest } = useApi(useCallback(() => api.reportIngest(), []));
  const [openId, setOpenId] = useState(null);
  const [show, setShow] = useState("open");
  const [busy, setBusy] = useState(false);

  // Everybody who could be named in a report, once, sorted.
  const drivers = useMemo(() => {
    const out = new Map();
    // This season first, so the people currently racing sort to their own
    // names rather than to an older row for the same person.
    for (const t of teams || []) for (const d of t.drivers || []) if (!out.has(d.id)) out.set(d.id, d);
    const seen = new Set([...out.values()].map((d) => d.name.trim().toLowerCase()));
    for (const e of db?.entries || []) {
      const key = String(e.name || "").trim().toLowerCase();
      if (!key || seen.has(key) || !e.sourceDriverId) continue;
      seen.add(key);
      out.set(e.sourceDriverId, { id: e.sourceDriverId, name: e.name });
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [teams, db]);

  const visible = useMemo(() => {
    const all = data?.reports || [];
    if (show === "all") return all;
    if (show === "decided") return all.filter((r) => DECIDED.includes(r.status));
    return all.filter((r) => !DECIDED.includes(r.status));
  }, [data, show]);

  // By round, newest race first, with anything that names no race at the end.
  const groups = useMemo(() => {
    const byRace = new Map((data?.races || []).map((r) => [r.id, r]));
    const out = new Map();
    for (const rep of visible) {
      const key = rep.raceId || "";
      if (!out.has(key)) out.set(key, { race: byRace.get(rep.raceId) || null, reports: [] });
      out.get(key).reports.push(rep);
    }
    return [...out.values()].sort((a, b) => {
      if (!a.race) return 1;
      if (!b.race) return -1;
      return new Date(b.race.date || 0) - new Date(a.race.date || 0);
    });
  }, [visible, data]);

  const counts = useMemo(() => {
    const all = data?.reports || [];
    return {
      open: all.filter((r) => !DECIDED.includes(r.status)).length,
      decided: all.filter((r) => DECIDED.includes(r.status)).length,
      all: all.length,
    };
  }, [data]);

  const openReportRow = (data?.reports || []).find((r) => r.id === openId) || null;
  const openRace = openReportRow
    ? (data?.races || []).find((x) => x.id === openReportRow.raceId) || null
    : null;

  // One report at a time, on its own screen. It used to unfold inside its row
  // in the list, which put a thread, a decision form, a viewer list and a
  // delete button inside a table cell — everything squeezed into what was left
  // of the width, and the rest of the list still shouting underneath.
  if (openReportRow) {
    const s = uiOf(openReportRow.status);
    return (
      <div className="space-y-4">
        <button
          className="transition text-sm font-semibold text-link hover:underline"
          onClick={() => setOpenId(null)}
        >
          &larr; All reports
        </button>
        {error && <ErrorBox message={error} onRetry={reload} />}
        <div className="card overflow-hidden">
          <CardBar
            title={
              openRace
                ? `${openRace.number != null ? `R${openRace.number} ` : ""}${openRace.track}`
                : "No round given"
            }
            right={
              <span className="flex flex-wrap items-center gap-2">
                {openReportRow.source === "INGAME" && (
                  <span className="pill bg-brand/15 text-brand">in-game</span>
                )}
                {openReportRow.lap != null && (
                  <span className="font-mono text-[11px] uppercase tracking-wider text-light">
                    lap {openReportRow.lap}
                  </span>
                )}
                <span className={`pill ${s.cls}`}>{s.label}</span>
              </span>
            }
          />
          <Thread
            id={openReportRow.id}
            drivers={drivers}
            onChanged={reload}
            onDeleted={() => {
              setOpenId(null);
              reload();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <p className="text-sm text-light">Loading…</p>}

      {data && (
        <div className="flex flex-wrap items-center gap-2">
          {[
            { key: "open", label: `Open (${counts.open})` },
            { key: "decided", label: `Decided (${counts.decided})` },
            { key: "all", label: `All (${counts.all})` },
          ].map((t) => (
            <button
              key={t.key}
              className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition ${
                show === t.key
                  ? "border-brand bg-brand/10 text-dark"
                  : "border-border text-light hover:border-link hover:text-dark"
              }`}
              onClick={() => setShow(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {data && visible.length === 0 && (
        <Notice kind="info">
          {counts.all === 0
            ? "No incident reports yet. Drivers file them from the report button, or from a round on the Races page."
            : show === "open"
              ? "Nothing waiting. Everything filed has been decided."
              : "Nothing decided yet."}
        </Notice>
      )}

      {groups.map((g) => (
        <div key={g.race?.id || "none"} className="card overflow-hidden">
          <CardBar
            title={g.race ? `${g.race.number != null ? `R${g.race.number} ` : ""}${g.race.track}` : "No round given"}
            right={
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                {g.reports.length} report{g.reports.length === 1 ? "" : "s"}
              </span>
            }
          />
          <ul className="divide-y divide-border">
            {g.reports.map((r) => {
              const s = uiOf(r.status);
              return (
                <li key={r.id}>
                  <button
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left transition hover:bg-surface2/60"
                    onClick={() => setOpenId(r.id)}
                  >
                    <span className={`pill ${s.cls}`}>{s.label}</span>
                    {r.source === "INGAME" && (
                      <span className="pill bg-brand/15 text-brand" title="Fired from inside the race by webPenalty">
                        in-game
                      </span>
                    )}
                    {r.status === "PENALTY" && r.penaltySeconds > 0 && (
                      <span className="pill bg-red-500/15 text-bad">+{r.penaltySeconds}s</span>
                    )}
                    <span className="text-sm font-semibold text-dark">
                      {r.reporterName || "Someone"}
                      {r.accusedName ? ` → ${r.accusedName}` : ""}
                    </span>
                    {r.lap != null && (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">lap {r.lap}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs text-light">{r.body}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                      {when(r.createdAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* the in-game app */}
      <div className="card overflow-hidden">
        <CardBar title="Reports from inside the race" />
        <div className="space-y-3 p-5">
          <p className="text-sm leading-relaxed text-light">
            The webPenalty app can post a report the moment a driver presses its button mid-race, so nobody has
            to remember the lap afterwards. Switching this on generates a key and gives you a URL to paste into
            the app&rsquo;s settings. Until then that door answers nothing at all.
          </p>
          {ingest?.configured ? (
            <>
              <label className="block font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                Paste this into webPenalty
              </label>
              <input
                readOnly
                aria-label="webPenalty URL"
                className="input w-full font-mono text-xs"
                value={`${window.location.origin}/api/reports/ingest?key=${ingest.key}`}
                onFocus={(e) => e.target.select()}
              />
              <p className="text-xs leading-relaxed text-light">
                Treat it like a password: anyone with this URL can file reports. Switching off and on again gives
                a new one and stops the old.
              </p>
            </>
          ) : (
            <p className="text-sm text-light">In-game reporting is off.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.setReportIngest(!ingest?.configured);
                  reloadIngest();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {ingest?.configured ? "Switch off" : "Switch on and make a key"}
            </button>
            {ingest?.configured && (
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.setReportIngest(true);
                    reloadIngest();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                New key
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
