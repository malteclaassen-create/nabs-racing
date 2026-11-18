import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardHead, CheckField, ErrorBox, Notice, TeamDot } from "./ui.jsx";

// Admin System > Wrapped: who has watched their own season Wrapped, when, how
// often and how far they got. Written by backend/src/lib/wrappedViews.js when
// a signed-in member opens their own story; an admin looking at someone
// else's Wrapped is not counted.

function fmtTime(iso) {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Progress({ view }) {
  const done = view.slides > 0 && view.furthest >= view.slides;
  const share = view.slides > 0 ? Math.min(1, view.furthest / view.slides) : 0;
  return (
    <div className="flex min-w-[9rem] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full ${done ? "bg-emerald-500" : "bg-brand"}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-light">{done ? "to the end" : view.slides ? `${view.furthest}/${view.slides}` : "opened"}</span>
    </div>
  );
}

function Row({ row }) {
  const v = row.view;
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <TeamDot color={row.team?.tier === 0 ? "#F4AFC6" : row.team?.color} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-dark">{row.name}</div>
          <div className="truncate text-xs text-light">
            {row.team?.name || "Reserve"}
            {v?.name && v.name !== row.name ? ` · ${v.name}` : ""}
          </div>
        </div>
      </div>
      {v ? (
        <>
          <Progress view={v} />
          <div className="shrink-0 text-xs text-light sm:w-44 sm:text-right">
            {v.opens > 1 ? `${v.opens} times, last ${fmtTime(v.lastAt)}` : fmtTime(v.firstAt)}
          </div>
        </>
      ) : (
        <div className="shrink-0 text-xs text-light sm:w-[19.5rem] sm:text-right">
          {row.linked ? "Not yet" : "Not yet · no Discord account linked to this driver, so they can't open it. Link them under Drivers."}
        </div>
      )}
    </li>
  );
}

// A bell reminder to the ones who have not opened their Wrapped yet. Everyone
// who can get one starts ticked; untick whoever should be left out. Sent on a
// second click, so a stray tap does not ping the grid.
function Remind({ seasonId, rows, onSent }) {
  const open = useMemo(() => rows.filter((r) => !r.view && r.linked), [rows]);
  const [picked, setPicked] = useState(() => new Set(open.map((r) => r.driverId)));
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  // A new season, or a refresh that changed who is left: start from everyone again.
  const key = open.map((r) => r.driverId).join(",");
  useEffect(() => {
    setPicked(new Set(open.map((r) => r.driverId)));
    setArming(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId, key]);

  if (!open.length) return null;
  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const count = open.filter((r) => picked.has(r.driverId)).length;

  async function send() {
    if (!arming) return setArming(true);
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.remindWrapped(seasonId, open.filter((x) => picked.has(x.driverId)).map((x) => x.driverId));
      setResult(r);
      onSent?.();
    } catch (e) {
      setErr(e.message || "That didn't go through.");
    } finally {
      setBusy(false);
      setArming(false);
    }
  }

  return (
    <div className="card p-5">
      <CardHead eyebrow="Reminder" title="Remind the ones who haven't watched yet" />
      <p className="mt-2 text-sm text-light">
        A note in their bell that links straight to their Wrapped. Untick anyone who should not get it. Someone without a Wrapped (too few rounds) is skipped.
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {open.map((r) => (
          <li key={r.driverId}>
            <CheckField
              checked={picked.has(r.driverId)}
              onChange={() => {
                toggle(r.driverId);
                setArming(false);
              }}
              label={r.name}
              hint={r.remindedAt ? `Reminded ${fmtTime(r.remindedAt)}` : undefined}
            />
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className={arming ? "btn-primary" : "btn-secondary"} disabled={busy || count === 0} onClick={send}>
          {busy ? "Sending…" : arming ? `Yes, send to ${count}` : `Send reminder to ${count}`}
        </button>
        {arming && !busy && (
          <button className="text-sm text-light hover:text-dark" onClick={() => setArming(false)}>
            Cancel
          </button>
        )}
      </div>
      {err && <div className="mt-3"><Notice kind="error">{err}</Notice></div>}
      {result && (
        <div className="mt-3">
          <Notice kind={result.sent.length ? "success" : "warn"}>
            {result.sent.length ? `Sent to ${result.sent.length}: ${result.sent.join(", ")}.` : "Nobody was sent a reminder."}
            {result.skipped.length > 0 && ` Skipped: ${result.skipped.map((s) => `${s.name} (${s.why})`).join(", ")}.`}
          </Notice>
        </div>
      )}
    </div>
  );
}

export default function AdminWrappedViews() {
  const [seasonId, setSeasonId] = useState(null);
  const { data, loading, error, reload } = useApi(useCallback(() => api.adminWrappedViews(seasonId), [seasonId]));
  const rows = data?.rows || [];
  const watched = rows.filter((r) => r.view);
  const toEnd = watched.filter((r) => r.view.slides > 0 && r.view.furthest >= r.view.slides);
  const waiting = rows.filter((r) => !r.view);

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardHead eyebrow="Wrapped" title="Who has watched their Wrapped" />
          <div className="flex items-center gap-2">
            {data?.seasons?.length > 0 && (
              <select className="input py-1.5 text-sm" value={data.seasonId || ""} onChange={(e) => setSeasonId(e.target.value)} aria-label="Season">
                {data.seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.series?.name ? `${s.series.name} · ` : ""}
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <button className="btn-secondary py-1.5 text-sm" onClick={reload}>
              Refresh
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm text-light">
          Counted when someone signed in with Discord opens their own Wrapped (nobody can open anyone else's). &ldquo;To the end&rdquo; means they reached the last slide.
        </p>
        {data && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              ["Watched", watched.length],
              ["To the end", toEnd.length],
              ["Not yet", waiting.length],
            ].map(([label, n]) => (
              <div key={label} className="rounded-xl border border-border p-3">
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{label}</div>
                <div className="mt-1 font-display text-2xl font-black tabular-nums text-dark">
                  {n}
                  <span className="ml-1 text-sm font-bold text-light">/ {rows.length}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {data && !data.complete && <p className="mt-3 text-xs text-light">This season is still running, so its Wrapped is not open to drivers yet.</p>}
      </div>

      {data?.complete && data?.open && <Remind seasonId={data.seasonId} rows={rows} onSent={reload} />}

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <div className="card p-5 text-sm text-light">Loading…</div>}
      {data && rows.length > 0 && (
        <div className="card p-5">
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <Row key={r.driverId} row={r} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
