import { useCallback, useEffect, useMemo, useState } from "react";
import { api, myDiscordId } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar, ErrorBox, Field, Notice } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import { fmtStamp } from "../utils/format.js";
import ReportChat, { ReportComposer } from "./ReportChat.jsx";
import ReplayAnchor from "./ReplayAnchor.jsx";
import { REPORTS_CHANGED_EVENT } from "../data/adminEvents.js";
import { PENALTY_KINDS, filterReports, penaltyLabel, resultsGap } from "./reportDesk.mjs";

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
// "R5 Spa", "R5 Spa Sprint". The desk's races already carry their event's
// round number and the sprint flag (routes/admin.js, withSprintRounds).
const raceLabel = (r) =>
  `${r.number != null ? `R${r.number} ` : ""}${r.track}${r.sprint ? " Sprint" : r.hasSprint ? " Feature" : ""}`;

// A decision as the form edits it, from the stored report. A penalty from
// before kinds existed comes back from the server as TIME already; the default
// here is for a report that has never been decided at all.
const draftOf = (rep) => ({
  status: rep.status,
  penaltyKind: rep.penaltyKind || "TIME",
  penaltySeconds: rep.penaltySeconds ?? "",
  verdict: rep.verdict || "",
});

const draftDirty = (draft, rep) =>
  draft.status !== rep.status ||
  (draft.status === "PENALTY" && draft.penaltyKind !== (rep.penaltyKind || "TIME")) ||
  String(draft.penaltySeconds) !== String(rep.penaltySeconds ?? "") ||
  draft.verdict !== (rep.verdict || "");

// What the server is sent. The kind only means something on a penalty, and the
// seconds only on a TIME one: the backend drops them on any other kind anyway,
// so a warning with "5" left in the box can never reach the results editor.
const decisionBody = (draft) => ({
  status: draft.status,
  penaltyKind: draft.status === "PENALTY" ? draft.penaltyKind : null,
  penaltySeconds: draft.penaltySeconds === "" ? null : Number(draft.penaltySeconds),
  verdict: draft.verdict,
});

// The line under the Save button: what saving does and, as important, what it
// does NOT do. Only a time penalty goes anywhere near the results.
function decisionNote(draft, who = "the drivers") {
  if (!DECIDED.includes(draft.status)) return "Nothing is sent yet.";
  if (draft.status !== "PENALTY" || draft.penaltyKind === "TIME") {
    return `Saving tells ${who}. Enter the penalty in Edit Results too.`;
  }
  if (draft.penaltyKind === "WARNING") return `Saving tells ${who}. A warning changes nothing in the results.`;
  return `Saving tells ${who}. Nothing reaches the results by itself: a ${
    draft.penaltyKind === "GRID" ? "grid drop" : "disqualification"
  } is carried out by hand.`;
}

// The controls of one decision, shared by the open report's box and every
// linked driver's. The kind only appears on a penalty, and seconds only
// on a time penalty, so the form never offers a number that would be thrown
// away.
function DecisionFields({ draft, setDraft, busy }) {
  const penalty = draft.status === "PENALTY";
  return (
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
      {penalty && (
        <Field label="Kind" tone="plain">
          <select
            className="input py-1.5 text-sm"
            value={draft.penaltyKind}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, penaltyKind: e.target.value })}
          >
            {PENALTY_KINDS.map((k) => (
              <option key={k.key} value={k.key}>{k.label}</option>
            ))}
          </select>
        </Field>
      )}
      {(!penalty || draft.penaltyKind === "TIME") && (
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
      )}
    </div>
  );
}

// The named driver's season so far, beside the report being decided: their
// other reports and what was decided each time. A third incident is decided
// with the first two in view, rather than from whatever the steward happens to
// remember.
//
// Every report about them is listed, decided or not, in the order the rounds
// were raced. The ones that do not stand as penalties are dimmed. The one open
// now is marked, and any other opens on a tap.
function DriverRecord({ record, races, onOpen }) {
  const raceById = new Map((races || []).map((r) => [r.id, r]));
  const others = record.entries.filter((e) => !e.current);
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">
          Driver record · {record.name || "the driver named"}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
          {record.seasonNumber != null ? `Season ${record.seasonNumber} · ` : ""}
          {record.penalties} {record.penalties === 1 ? "penalty" : "penalties"}
        </span>
      </div>
      {others.length === 0 ? (
        <p className="text-xs text-light">No other reports about them this season.</p>
      ) : (
        <ol className="space-y-1.5">
          {record.entries.map((e) => {
            const race = raceById.get(e.raceId);
            const s = uiOf(e.status);
            const label = penaltyLabel(e);
            const body = (
              <>
                {/* The round on a line of its own on a phone, so the pills
                    share the next one instead of wrapping into a column of
                    fragments. */}
                <span className="w-full shrink-0 truncate font-mono text-[11px] uppercase tracking-wider text-light sm:w-24">
                  {race ? raceLabel(race) : "Round"}
                </span>
                <span className={`pill ${s.cls}`}>{s.label}</span>
                {label && <span className="pill bg-red-500/15 text-bad">{label}</span>}
              </>
            );
            const cls = `flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1.5 text-left ${
              e.current ? "bg-brand/10" : e.counts ? "" : "opacity-60"
            }`;
            return (
              <li key={e.id}>
                {e.current ? (
                  <div className={cls}>
                    {body}
                    <span className="w-full font-mono text-[10px] uppercase tracking-wider text-brand">this report</span>
                  </div>
                ) : (
                  <button
                    className={`${cls} transition hover:bg-surface2/60`}
                    title={e.verdict || undefined}
                    onClick={() => onOpen?.(e.id)}
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// Where the file's own guess at the accused came from, in the two words a
// steward needs to weigh it. "Matched" is the contact an in-game press was
// pinned to — the game recorded that these two cars touched a moment before the
// button was pressed. "Suggested" is one of up to three contacts the file
// offered for the lap the reporter gave, which is a thinner thing.
const SUGGEST_NOTE = {
  matched: "the contact the race file pinned this press to",
  suggested: "a contact the race file has around that lap",
};

// Saying who ONE report is about, at the desk.
//
// Naming and correcting, both. A named report shows a line of text and a
// Change button: a dropdown worked through after a long evening sometimes has
// the wrong row clicked, and deleting the report to re-file it lost the thread
// and the decision with it. Changing is not quiet — the backend tells the
// driver named by mistake as well as the right one (lib/reports.js
// dbRepointAccused) — and it is the desk's alone; the reporter's own naming
// stays once-only.
//
// The dropdown starts on what the result file says, where it says anything, and
// a steward either agrees with it or picks somebody else. It is never saved by
// itself — Assetto Corsa is good at "these two cars touched" and knows nothing
// whatever about fault.
//
// "Add another driver" is the third act here: an incident that ends with two
// penalties needs two reports, because a report is one private thread and one
// decision about ONE driver. The button files a linked sibling — same round,
// same moment, same words — about the second driver (`onSplit`), instead of the
// stewards entering the second penalty by hand with no thread behind it.
function NameAccused({ report, drivers, busy, onName, onSplit }) {
  const hint = report.accusedSuggestion || null;
  const [pick, setPick] = useState(hint?.driverId || "");
  // What the picker on a NAMED report is being used for: correcting the name,
  // or filing the same incident against one more driver. Closed until asked.
  const [mode, setMode] = useState(null); // null | "change" | "add"
  // A different report opened, or the file's answer arrived after the first
  // render: follow it, but never overwrite a steward who has already chosen.
  useEffect(() => {
    setPick((cur) => cur || hint?.driverId || "");
  }, [report.id, hint?.driverId]);
  useEffect(() => {
    setMode(null);
  }, [report.id, report.accusedDriverId]);

  const picker = (
    <select
      aria-label="Which driver this report is about"
      className="input w-auto max-w-64 py-1.5 text-sm"
      value={pick}
      disabled={busy}
      onChange={(e) => setPick(e.target.value)}
    >
      <option value="">Pick a driver…</option>
      {drivers.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-1 font-mono text-[11px] font-bold uppercase tracking-widest text-light">
        The report is about
      </div>
      {report.accusedName && !mode ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold text-dark">{report.accusedName}</p>
          <button
            className="btn-secondary py-1 text-xs"
            disabled={busy}
            onClick={() => {
              setPick(report.accusedDriverId || "");
              setMode("change");
            }}
          >
            Change
          </button>
          <button
            className="btn-secondary py-1 text-xs"
            disabled={busy}
            onClick={() => {
              setPick("");
              setMode("add");
            }}
          >
            Add another driver
          </button>
        </div>
      ) : report.accusedName ? (
        <>
          <p className="text-sm text-light">
            {mode === "change"
              ? "Named the wrong driver? Both are told: the one named by mistake that the report no longer names them, the right one that it does."
              : "The same incident, about one more driver: they get their own linked report and thread, and their own decision box appears below this one — so a two-penalty crash is decided on this screen."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {picker}
            <button
              className="btn-secondary py-1.5 text-sm"
              disabled={busy || !pick || pick === report.accusedDriverId}
              onClick={() => (mode === "change" ? onName(pick) : onSplit(pick))}
            >
              {mode === "change" ? "Change to them" : "File it about them"}
            </button>
            <button className="btn-secondary py-1.5 text-sm" disabled={busy} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-light">
            Nobody yet, so the other driver cannot see this thread or answer it.
            {report.source === "INGAME"
              ? " An in-game press knows who pressed the button and not who they are complaining about."
              : ""}
          </p>
          {hint?.name && (
            <p className="mt-2 text-xs leading-relaxed text-light">
              The race file says{" "}
              <span className="font-semibold text-medium">{hint.name}</span> was the other car —{" "}
              {SUGGEST_NOTE[hint.from] || "what the race file has"}.
              {hint.driverId
                ? " It is already picked below — check it against the replay before naming them."
                : " Nobody on the roster races under that name, so pick who it was."}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {picker}
            <button className="btn-secondary py-1.5 text-sm" disabled={busy || !pick} onClick={() => onName(pick)}>
              Name them
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-light">
            This lets them read the thread and tells them. Named the wrong driver? It can be changed here
            afterwards, and both drivers are told.
          </p>
        </>
      )}
    </div>
  );
}

// The decision box for one of the OTHER drivers in the same incident.
//
// A crash the stewards split into one report per driver still gets decided on
// one screen: the open report's own box above, and one of these for each
// driver split off it. Each saves through its own report's decide — so telling
// the drivers, the decided/applied bookkeeping and Edit Results all see plain
// single-driver reports — but the steward never has to leave the incident to
// give the second driver their seconds.
// `onRemove` takes the driver back OUT of the incident — the steward added the
// wrong person, or one car turned out blameless enough not to need a report at
// all. It deletes their linked report, thread and decision included, after a
// confirm; the report the steward has open stays exactly as it is.
function LinkedDecision({ linked, busy, onSave, onRemove }) {
  const [draft, setDraft] = useState(() => draftOf(linked));
  useEffect(() => {
    setDraft(draftOf(linked));
  }, [linked.id, linked.status, linked.penaltySeconds, linked.penaltyKind, linked.verdict]);
  const dirty = draftDirty(draft, linked);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">
          Decision · {linked.accusedName || "second driver"}
        </div>
        <button
          className="transition text-xs font-semibold text-light hover:text-bad"
          disabled={busy}
          onClick={onRemove}
        >
          Remove from this incident
        </button>
      </div>
      <DecisionFields draft={draft} setDraft={setDraft} busy={busy} />
      <textarea
        aria-label={`What the stewards decided about ${linked.accusedName || "the second driver"}`}
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
          onClick={() => onSave(decisionBody(draft))}
        >
          {busy ? "Saving…" : "Save decision"}
        </button>
        <p className="min-w-40 flex-1 text-xs text-light">
          {decisionNote(draft, `${linked.accusedName || "them"} in their own thread`)}
        </p>
      </div>
    </div>
  );
}

function Thread({ id, drivers, races, onChanged, onDeleted, onOpen }) {
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
          setDraft((cur) => (keepDraft && cur ? cur : draftOf(d.report)));
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
  // Who is in this thread by definition and can be shut out of it, and who
  // already has been. Somebody shut out is not offered twice, so the two lists
  // never show the same person.
  const blocked = data.blocked || [];
  const inThread = (data.participants || []).filter((p) => !blocked.some((b) => b.discordId === p.discordId));
  const dirty = draftDirty(draft, r);
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
          {/* Who it is about. A report written on the site always names
              somebody — the form will not send without it — so the blank ones
              are the in-game presses: webPenalty knows who pressed the button
              and nothing else. Either the driver who filed it says, from their
              own page, or the desk does, which is what this is.

              The desk can also change a name that is already there — a
              misclick in the dropdown used to mean deleting the report and
              filing it again, losing the thread and the decision with it.
              Changing is never quiet: the backend tells the driver named by
              mistake as well as the right one. The reporter's own naming
              stays once-only. */}
          <NameAccused
            report={r}
            drivers={drivers}
            busy={busy}
            onName={(driverId) => run(() => api.setReportAccusedAdmin(id, driverId), "Named, and told.")}
            onSplit={(driverId) =>
              run(
                () => api.splitReport(id, driverId),
                (res) =>
                  `Added ${res?.report?.accusedName || "them"} — their own decision box is below, next to this one.`
              )
            }
          />


      {/* the decision */}
      <div className="rounded-lg border border-border p-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">Decision</div>
        <DecisionFields draft={draft} setDraft={setDraft} busy={busy} />
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
                () => api.decideReport(id, decisionBody(draft)),
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
            // An arrow, not `onClick={load}`: handed straight over, the click
            // event arrived as `keepDraft`, which is truthy, and Undo kept the
            // very draft it was meant to throw away.
            <button className="btn-secondary" disabled={busy} onClick={() => load()}>
              Undo
            </button>
          )}
          {/* The one thing the controls do NOT say: saving sends a message to
              people, and these seconds never reach the classification. */}
          <p className="min-w-40 flex-1 text-xs text-light">{decisionNote(draft)}</p>
        </div>
        {/* Decided, and not in the classification yet. The editor fills the
            seconds in when the round is opened; until somebody does and
            saves, the stewards' decision and the table disagree. */}
        {resultsGap(r) && (
          <p className="mt-2">
            <span className="pill bg-amber-500/15 text-warn">{resultsGap(r)}</span>
          </p>
        )}
      </div>

      {/* The rest of the same incident: one decision box per driver the
          stewards split off. Each is its own report with its own thread —
          this screen just decides them all in one place. */}
      {(data.linked || []).map((l) => (
        <LinkedDecision
          key={l.id}
          linked={l}
          busy={busy}
          onSave={(body) =>
            run(
              () => api.decideReport(l.id, body),
              (res) => {
                const n = res?.report?.told ?? 0;
                if (!DECIDED.includes(body.status)) return "Saved.";
                return n > 0
                  ? `Saved. ${l.accusedName || "The driver"} has been told in their own thread.`
                  : "Saved. Nobody could be told: there is no Discord account on that thread.";
              }
            )
          }
          onRemove={async () => {
            if (
              !(await ask({
                title: `Remove ${l.accusedName || "this driver"} from the incident?`,
                body: "Their linked report is deleted — the thread with them and any decision in it go with it. The report you have open stays as it is. A driver whose part in the crash was judged and cleared is better kept with 'No penalty', so they can still see what was decided.",
                danger: true,
                confirmLabel: "Remove driver",
              }))
            )
              return;
            run(() => api.deleteReport(l.id), `Removed ${l.accusedName || "them"} from this incident.`);
          }}
        />
      ))}

      {/* The named driver's season so far. Only for a report that names
          somebody and belongs to a round: without a round there is no season
          to add anything up in. */}
      {data.record && (
        <DriverRecord record={data.record} races={races} onOpen={onOpen} />
      )}

      {/* who else may read it */}
      <div className="rounded-lg border border-border p-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">
          Who can read this
        </div>
        <p className="text-xs text-light">Both drivers and every admin, always. Add one more:</p>
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

        {/* Shutting somebody OUT. A thread is a conversation between two people
            who have just crashed into each other, and now and then one of them
            writes something that has no place in it. This is stronger than
            taking a viewer back off the list above: it beats being the reporter
            or the driver named, and the report stops existing for them. What
            they already wrote stays where it is, because the thread is the
            record of how the decision was reached. */}
        {(inThread.length > 0 || blocked.length > 0) && (
          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">
              In the argument
            </div>
            <ul className="flex flex-wrap gap-2">
              {inThread.map((p) => (
                <li
                  key={p.discordId}
                  className="flex items-center gap-2 rounded-full bg-surface2 px-2.5 py-1 text-xs"
                >
                  <span className="font-semibold text-medium">{p.name}</span>
                  <span className="text-faint">{p.role === "REPORTER" ? "reported it" : "named"}</span>
                  <button
                    className="font-semibold transition text-light hover:text-bad"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api.blockFromReport(id, { discordId: p.discordId, name: p.name }),
                        `${p.name} can no longer see this report.`
                      )
                    }
                  >
                    Shut out
                  </button>
                </li>
              ))}
            </ul>
            {blocked.length > 0 && (
              <>
                <div className="mb-2 mt-3 font-mono text-[11px] font-bold uppercase tracking-widest text-warn">
                  Shut out of this report
                </div>
                <ul className="flex flex-wrap gap-2">
                  {blocked.map((b) => (
                    <li
                      key={b.discordId}
                      className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs"
                    >
                      <span className="font-semibold text-warn">{b.name || b.discordId}</span>
                      <button
                        className="font-semibold transition text-light hover:text-dark"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => api.unblockFromReport(id, b.discordId),
                            `${b.name || "They"} can read this report again.`
                          )
                        }
                      >
                        Let back in
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
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
                body: "The thread and everything written in it go with it. Use this for a duplicate or something filed by mistake. A real report that came to nothing is better closed with 'No penalty', so the drivers can still see what was decided.",
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
  const { data: retention, reload: reloadRetention } = useApi(useCallback(() => api.reportRetention(), []));
  const [swept, setSwept] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [show, setShow] = useState("open");
  // Narrowing the list within open / decided / all. Kept up here rather than
  // in the list, so opening a report and coming back finds the same view —
  // a steward working through one driver's evening does it a report at a time.
  const [q, setQ] = useState("");
  const [roundId, setRoundId] = useState("");
  const [source, setSource] = useState("");
  const [unnamedOnly, setUnnamedOnly] = useState(false);
  const filtering = !!(q.trim() || roundId || source || unnamedOnly);
  const [busy, setBusy] = useState(false);
  const ask = useAsk();
  // The in-game URL's two destructive buttons stay out of reach until asked
  // for. Resets itself after either one runs.
  const [unlocked, setUnlocked] = useState(false);

  // What the result file has that could be the incident this report describes.
//
// A report filed after the race can pin itself to the exact contact, and then
// the chip at the top says everything. Most do not: they say "lap 32" and name
// somebody, and the steward is back to scrubbing a replay. So the file is asked
// the same question the reporter answered in words — this driver, that lap,
// that other car — and whatever it has is offered here.
//
// A suggestion, and drawn as one. Nothing is written to the report, nobody is
// named who was not named already, and where the file has nothing this renders
// nothing at all: an empty answer is a real one, and a confident wrong contact
// is worse than none.
function ContactSuggestions({ report }) {
  const hits = report?.contactSuggestions || [];
  if (!hits.length) return null;
  const named = report.accusedName;
  return (
    <div className="border-t border-border px-5 py-4">
      <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
        {hits.length === 1 ? "A contact this could be" : "Contacts this could be"}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-light">
        {named
          ? `What Assetto Corsa recorded between ${report.reporterName || "the reporter"} and ${named} around the lap they gave.`
          : `What Assetto Corsa recorded for ${report.reporterName || "the reporter"} around the lap they gave.`}{" "}
        Nobody picked these, so check one against the replay before acting on it.
      </p>
      <ul className="mt-3 space-y-2">
        {hits.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ReplayAnchor second={c.second} kph={c.kph} lap={c.lap} eventIndex={c.eventIndex} />
            {c.other?.name && <span className="text-xs text-medium">with {c.other.name}</span>}
            {/* The neighbouring lap is offered because the two lap countings
                disagree on the line, but a steward should know which one they
                are looking at before it becomes a verdict. */}
            {!c.exactLap && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                a lap off what was said
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

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

  const visible = useMemo(
    () => filterReports(data?.reports, { show, q, raceId: roundId, source, unnamed: unnamedOnly }),
    [data, show, q, roundId, source, unnamedOnly]
  );

  // The rounds the round filter offers: only ones that have reports, newest
  // first, the way the list itself is ordered.
  const rounds = useMemo(
    () => [...(data?.races || [])].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
    [data]
  );
  const anyWithoutRound = (data?.reports || []).some((r) => !r.raceId);

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
                ? raceLabel(openRace)
                : "No round given"
            }
            right={
              // The two SHORT labels first and the wide chip last. On a phone
              // this row has to wrap, and in the old order — pill, chip, pill —
              // the chip took a line of its own and left the status pill
              // stranded on a third, so the header ran to four lines with one
              // word on most of them. Pills together, chip beneath: two lines,
              // and what a report IS still reads as one group.
              <span className="flex flex-wrap items-center gap-2">
                {openReportRow.source === "INGAME" && (
                  <span className="pill bg-brand/15 text-brand">in-game</span>
                )}
                <span className={`pill ${s.cls}`}>{s.label}</span>
                {penaltyLabel(openReportRow) && (
                  <span className="pill bg-red-500/15 text-bad">{penaltyLabel(openReportRow)}</span>
                )}
                {/* Everything a steward needs to find the moment, in one chip
                    that copies the timeline figure. */}
                <ReplayAnchor
                  second={openReportRow.sessionSecond}
                  approx={openReportRow.sessionSecondApprox}
                  matched={openReportRow.contactMatched}
                  at={openReportRow.incidentAt}
                  kph={openReportRow.contactKph}
                  lap={openReportRow.lap}
                  eventIndex={openReportRow.contactIndex}
                />
              </span>
            }
          />
          <ContactSuggestions report={openReportRow} />
          <Thread
            key={openReportRow.id}
            id={openReportRow.id}
            drivers={drivers}
            races={data?.races || []}
            onOpen={(rid) => {
              setOpenId(rid);
              window.scrollTo({ top: 0 });
            }}
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

      {/* Narrowing within that: one driver's reports, one round, where they
          came from, and the ones nobody has been named on yet. */}
      {data && counts.all > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search by driver name"
            placeholder="Driver name…"
            className="input w-full py-1.5 text-sm sm:w-48"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            aria-label="Round"
            className="input w-auto max-w-56 py-1.5 text-sm"
            value={roundId}
            onChange={(e) => setRoundId(e.target.value)}
          >
            <option value="">Every round</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {raceLabel(r)}
              </option>
            ))}
            {anyWithoutRound && <option value="none">No round given</option>}
          </select>
          <select
            aria-label="Filed from"
            className="input w-auto py-1.5 text-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">Site and in-game</option>
            <option value="SITE">Filed on the site</option>
            <option value="INGAME">Filed in-game</option>
          </select>
          <button
            aria-pressed={unnamedOnly}
            className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition ${
              unnamedOnly
                ? "border-brand bg-brand/10 text-dark"
                : "border-border text-light hover:border-link hover:text-dark"
            }`}
            onClick={() => setUnnamedOnly((v) => !v)}
          >
            Names nobody
          </button>
          {filtering && (
            <button
              className="text-sm font-semibold text-link transition hover:underline"
              onClick={() => {
                setQ("");
                setRoundId("");
                setSource("");
                setUnnamedOnly(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {data && visible.length === 0 && (
        <Notice kind="info">
          {counts.all === 0
            ? "No incident reports yet. Drivers file them from the report button, or from a round on the Races page."
            : filtering
              ? "Nothing matches these filters."
              : show === "open"
                ? "Nothing waiting. Everything filed has been decided."
                : "Nothing decided yet."}
        </Notice>
      )}

      {groups.map((g) => (
        <div key={g.race?.id || "none"} className="card overflow-hidden">
          <CardBar
            title={g.race ? raceLabel(g.race) : "No round given"}
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
                    {penaltyLabel(r) && <span className="pill bg-red-500/15 text-bad">{penaltyLabel(r)}</span>}
                    {/* Decided and not in the classification yet — the one
                        thing on a decided report still waiting for somebody. */}
                    {resultsGap(r) && <span className="pill bg-amber-500/15 text-warn">{resultsGap(r)}</span>}
                    {/* Nobody on the other side of it, which is the one thing
                        that has to be fixed before anything else can happen:
                        that driver cannot read the thread or answer it. */}
                    {!r.accusedDriverId && !DECIDED.includes(r.status) && (
                      <span className="pill bg-amber-500/15 text-bad">names nobody</span>
                    )}
                    <span className="text-sm font-semibold text-dark">
                      {r.reporterName || "Someone"}
                      {r.accusedName ? ` → ${r.accusedName}` : ""}
                    </span>
                    {/* In the LIST too, not just inside the opened report: a
                        steward working through a round's dozen reports can see
                        at a glance which ones come with a replay position and
                        which are somebody's recollection. Read-only here — the
                        row is already a button, and nesting one inside it is
                        invalid HTML that breaks tab order. The copy is one
                        click away, in the opened report. */}
                    <ReplayAnchor
                      readOnly
                      second={r.sessionSecond}
                      approx={r.sessionSecondApprox}
                      matched={r.contactMatched}
                      at={r.incidentAt}
                      kph={r.contactKph}
                      lap={r.lap}
                      eventIndex={r.contactIndex}
                    />
                    {/* The first line of what was written, for triage — and
                        only where there is room to read some of it. On a phone
                        this shared its line with the name and the date and was
                        cut to two characters and an ellipsis, which tells a
                        steward nothing and cost a third of the row. The report
                        is one tap away. */}
                    <span className="hidden min-w-0 flex-1 truncate text-xs text-light sm:block">{r.body}</span>
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

      {/* Housekeeping. The dropdown says what it does, so nothing here says it
          again: WHY it exists (storage cost, and that the conversation always
          survives) is in HANDOVER.md, where somebody deciding the policy is
          looking. A page that explains itself in paragraphs is a page whose
          controls did not. */}
      <div className="card overflow-hidden">
        <CardBar title="Pictures on decided reports" />
        <div className="space-y-2 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Delete files when reports have been done for"
              className="input w-auto py-1.5 text-sm"
              value={retention?.days ?? 0}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                try {
                  const r = await api.setReportRetention(Number(e.target.value));
                  setSwept(r.removed);
                  reloadRetention();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <option value={0}>Keep them forever</option>
              <option value={1}>Delete after 1 day</option>
              <option value={7}>Delete after 7 days</option>
              <option value={30}>Delete after 30 days</option>
              <option value={90}>Delete after 90 days</option>
              <option value={180}>Delete after 180 days</option>
              <option value={365}>Delete after a year</option>
            </select>
            {swept != null && (
              <span className="text-sm text-ok">
                {swept === 0 ? "Saved. Nothing was old enough yet." : `Saved. ${swept} file${swept === 1 ? "" : "s"} removed.`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* the in-game app */}
      <div className="card overflow-hidden">
        <CardBar title="Reports from inside the race" />
        <div className="space-y-3 p-5">
          <p className="text-sm text-light">A URL for the webPenalty app, so a driver can report mid-race.</p>
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
              <p className="text-xs text-light">
                Treat it like a password. It is pasted once, into webPenalty on the PC that relays the
                reports, and then left alone.
              </p>
            </>
          ) : (
            <p className="text-sm text-light">In-game reporting is off.</p>
          )}
          {/* Both of these break a URL that is sitting in somebody ELSE's game,
              on another PC, and the only way to repair it is to catch that
              person and have them paste a new one. That is a phone call, not a
              click, so neither is reachable until the row is unlocked, and each
              then says out loud what it is about to cost. */}
          {ingest?.configured && !unlocked ? (
            <button className="btn-secondary" onClick={() => setUnlocked(true)}>
              Change this
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={async () => {
                  const off = !!ingest?.configured;
                  if (
                    off &&
                    !(await ask({
                      title: "Switch off in-game reporting?",
                      body:
                        "The URL stops working immediately. Nobody can report from inside a race until this is switched back on AND the new URL has been pasted into webPenalty again, on whichever PC relays the reports. Switching it on again does not bring the old URL back.",
                      danger: true,
                      confirmLabel: "Switch off",
                    }))
                  )
                    return;
                  setBusy(true);
                  try {
                    await api.setReportIngest(!off);
                    reloadIngest();
                    setUnlocked(false);
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
                    if (
                      !(await ask({
                        title: "Make a new key?",
                        body:
                          "The URL below stops working the moment this is done. In-game reporting stays dead until the new one has been pasted into webPenalty on the PC that relays. Only worth it if the old URL has got out to someone who should not have it.",
                        danger: true,
                        confirmLabel: "Make a new key",
                      }))
                    )
                      return;
                    setBusy(true);
                    try {
                      await api.setReportIngest(true);
                      reloadIngest();
                      setUnlocked(false);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  New key
                </button>
              )}
              {ingest?.configured && (
                <button
                  type="button"
                  className="text-sm font-semibold text-light transition hover:text-dark"
                  onClick={() => setUnlocked(false)}
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
