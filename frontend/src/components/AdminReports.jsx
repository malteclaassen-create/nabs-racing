import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar, ErrorBox, Field, Notice } from "./ui.jsx";
import { fmtStamp } from "../utils/format.js";

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
// decided and tells the people involved. The results editor shows what was
// decided here beside its own penalty column, so the gap between "we agreed
// five seconds" and "five seconds are in the table" is visible instead of being
// something you have to remember.
// ---------------------------------------------------------------------------

const STATUS = [
  { key: "NEW", label: "Waiting", cls: "bg-surface2 text-light" },
  { key: "REVIEWING", label: "Looking at it", cls: "bg-sky-500/15 text-link" },
  { key: "PENALTY", label: "Penalty", cls: "bg-red-500/15 text-bad" },
  { key: "NO_PENALTY", label: "No penalty", cls: "bg-emerald-500/15 text-ok" },
  { key: "DISMISSED", label: "Closed", cls: "bg-surface2 text-light" },
];
const uiOf = (s) => STATUS.find((x) => x.key === s) || STATUS[0];
const when = (iso) => (iso ? fmtStamp(iso) : "");

function Thread({ id, onChanged }) {
  const [data, setData] = useState(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [viewer, setViewer] = useState("");

  const load = useCallback(() => {
    api.adminReport(id).then(setData).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} />;
  if (!data) return <p className="px-5 py-3 text-sm text-light">Loading…</p>;
  const r = data.report;

  return (
    <div className="space-y-4 px-5 py-4">
      {/* what was reported */}
      <p className="whitespace-pre-line text-sm leading-relaxed text-dark">{r.body}</p>

      {/* the conversation */}
      <ul className="space-y-2">
        {data.messages.map((m) => (
          <li
            key={m.id}
            className={`rounded-lg border-l-2 px-3 py-2 ${
              m.author === "ADMIN" ? "border-brand/60 bg-brand/5" : "ml-3 border-border bg-surface2/60"
            }`}
          >
            <div className="font-mono text-[10px] uppercase tracking-wider text-light">
              {m.author === "ADMIN" ? "Stewards" : m.authorName || m.author} · {when(m.createdAt)}
            </div>
            <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-dark">{m.body}</p>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-2">
        <textarea
          aria-label="Write in this thread"
          className="input h-16 min-w-60 flex-1 resize-none"
          placeholder="Write to the drivers…"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
        <button
          className="btn-secondary"
          disabled={busy || !reply.trim()}
          onClick={() => run(async () => { await api.replyToReport(id, reply.trim()); setReply(""); })}
        >
          Send
        </button>
      </div>

      {/* the decision */}
      <div className="border-t border-border pt-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">Decision</div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Outcome" tone="plain">
            <select
              className="input py-1.5 text-sm"
              value={r.status}
              disabled={busy}
              onChange={(e) => run(() => api.decideReport(id, { ...r, status: e.target.value }))}
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
              defaultValue={r.penaltySeconds ?? ""}
              disabled={busy}
              onBlur={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                if (v !== r.penaltySeconds) run(() => api.decideReport(id, { ...r, penaltySeconds: v }));
              }}
            />
          </Field>
        </div>
        <textarea
          aria-label="What the stewards decided"
          className="input mt-2 h-16 resize-none"
          placeholder="What you decided, in the drivers' words rather than yours…"
          defaultValue={r.verdict || ""}
          disabled={busy}
          onBlur={(e) => {
            if (e.target.value !== (r.verdict || "")) run(() => api.decideReport(id, { ...r, verdict: e.target.value }));
          }}
        />
        <p className="mt-1.5 text-xs text-light">
          Recording seconds here does not put them on the driver. Enter the penalty in Edit Results as well.
        </p>
      </div>

      {/* who else may read it */}
      <div className="border-t border-border pt-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">
          Who can read this
        </div>
        <p className="text-xs leading-relaxed text-light">
          The driver who filed it, the driver it names and every admin, always. Add a Discord user ID to let one more
          person in, for this report only.
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {data.viewers.map((v) => (
            <li key={v.discordId} className="flex items-center gap-1.5 rounded-full bg-surface2 px-2.5 py-1 text-xs">
              <span className="font-mono text-medium">{v.name || v.discordId}</span>
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
          <input
            aria-label="Discord user ID"
            className="input w-56 py-1.5 font-mono text-xs"
            placeholder="Discord user ID"
            value={viewer}
            onChange={(e) => setViewer(e.target.value.trim())}
          />
          <button
            className="btn-secondary py-1.5 text-sm"
            disabled={busy || !viewer}
            onClick={() => run(async () => { await api.addReportViewer(id, viewer); setViewer(""); })}
          >
            Let in
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminReports() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.adminReports(), []));
  const [openId, setOpenId] = useState(null);

  // By round, newest race first, with anything that names no race at the end.
  const groups = useMemo(() => {
    if (!data) return [];
    const byRace = new Map((data.races || []).map((r) => [r.id, r]));
    const out = new Map();
    for (const rep of data.reports) {
      const key = rep.raceId || "";
      if (!out.has(key)) out.set(key, { race: byRace.get(rep.raceId) || null, reports: [] });
      out.get(key).reports.push(rep);
    }
    return [...out.values()].sort((a, b) => {
      if (!a.race) return 1;
      if (!b.race) return -1;
      return new Date(b.race.date || 0) - new Date(a.race.date || 0);
    });
  }, [data]);

  return (
    <div className="space-y-5">
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <p className="text-sm text-light">Loading…</p>}

      {data && data.reports.length === 0 && (
        <Notice kind="info">
          No incident reports yet. Drivers file them from the flag button in the corner of the site, or from the
          Report button on a round.
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
              const open = openId === r.id;
              return (
                <li key={r.id}>
                  <button
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left transition hover:bg-surface2/60"
                    onClick={() => setOpenId(open ? null : r.id)}
                  >
                    <span className={`pill ${s.cls}`}>{s.label}</span>
                    {r.source === "INGAME" && (
                      <span className="pill bg-brand/15 text-brand" title="Fired from inside the race by webPenalty">
                        in-game
                      </span>
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
                  {open && <Thread id={r.id} onChanged={reload} />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
