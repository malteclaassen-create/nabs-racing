import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardHead, ErrorBox } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";

// Admin League > Team sign-ups. Opens or closes the form on a series' home
// page ("Season 7: which team do you want, who drives it?") and lists what
// came in. Backend: lib/teamSignups.js. An entry can be ticked off once it
// is dealt with, or deleted.

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Settings({ data, onSaved }) {
  const s = data.settings;
  const [seriesId, setSeriesId] = useState(s.seriesId || data.series[0]?.id || "");
  const [label, setLabel] = useState(s.label || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const openSeries = data.series.find((x) => x.id === s.seriesId);
  const changed = seriesId !== (s.seriesId || "") || label.trim() !== s.label;

  async function save(patch) {
    setBusy(true);
    setError(null);
    try {
      await api.setTeamSignupSettings(patch);
      await onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <CardHead eyebrow="Sign-up" title={s.open ? "Open" : "Closed"}>
        <span className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider ${s.open ? "bg-emerald-500/15 text-ok" : "bg-surface2 text-light"}`}>
          {s.open ? "On the home page" : "Not shown"}
        </span>
      </CardHead>
      <p className="text-sm text-light">
        While it is open, the home page of the series below shows a form: the team a driver wants and the two drivers. Someone on their own can leave the
        second driver empty. Members need to be signed in with Discord, and each person has one entry they can change or take back.
        {s.open && openSeries ? ` Showing now on ${openSeries.name}, as “${s.label}”.` : ""}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Series</span>
          <select className="input w-full" value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
            {data.series.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Name</span>
          <input className="input w-full" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Season 7" maxLength={60} />
        </label>
        <div className="flex gap-2">
          {changed && (
            <button className="btn-secondary text-sm" disabled={busy} onClick={() => save({ seriesId, label })}>
              Save
            </button>
          )}
          {s.open ? (
            <button className="btn-secondary text-sm" disabled={busy} onClick={() => save({ open: false })}>
              Close
            </button>
          ) : (
            <button className="btn-primary text-sm" disabled={busy || !seriesId} onClick={() => save({ open: true, seriesId, label })}>
              Open
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-light">Entries belong to the name. A new name (say “Season 8”) starts an empty list and keeps the old one below.</p>
      {error && <p className="mt-2 text-sm font-semibold text-warn">{error}</p>}
    </div>
  );
}

function Entry({ item, onChanged }) {
  const ask = useAsk();
  const [busy, setBusy] = useState(false);
  const done = item.status === "DONE";

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      window.alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:gap-4 ${done ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-base font-extrabold uppercase tracking-tight text-dark">{item.teamName}</span>
          {!done && <span className="rounded-full bg-brand/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-dark">New</span>}
        </div>
        <div className="mt-0.5 text-sm text-medium">
          {item.driver1}
          {item.driver2 ? <> and {item.driver2}</> : <span className="text-light">, no teammate yet</span>}
        </div>
        {item.note && <p className="mt-1 whitespace-pre-line text-sm text-light">{item.note}</p>}
        <div className="mt-1 text-xs text-light">
          Sent by {item.senderName || "a member"} · {fmtTime(item.createdAt)}
          {item.updatedAt ? ` · changed ${fmtTime(item.updatedAt)}` : ""}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          className="btn-secondary py-1.5 text-xs"
          disabled={busy}
          onClick={() => run(() => api.updateTeamSignup(item.id, { status: done ? "NEW" : "DONE" }))}
        >
          {done ? "Not done" : "Done"}
        </button>
        <button
          className="btn-secondary py-1.5 text-xs text-bad"
          disabled={busy}
          onClick={async () => {
            if (!(await ask({ title: `Delete the sign-up for ${item.teamName}?`, danger: true, confirmLabel: "Delete" }))) return;
            run(() => api.deleteTeamSignup(item.id));
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

export default function AdminTeamSignups() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.adminTeamSignups(), []));
  const [list, setList] = useState(null);

  // One list per sign-up (series + name), the running one first.
  const groups = useMemo(() => {
    if (!data) return [];
    const seriesName = new Map(data.series.map((s) => [s.id, s.name]));
    const by = new Map();
    for (const item of data.items) {
      const key = `${item.seriesId || ""}::${item.label}`;
      if (!by.has(key)) by.set(key, { key, seriesId: item.seriesId, label: item.label, seriesName: seriesName.get(item.seriesId) || null, items: [] });
      by.get(key).items.push(item);
    }
    const current = `${data.settings.seriesId || ""}::${data.settings.label}`;
    return [...by.values()].sort((a, b) => (a.key === current ? -1 : b.key === current ? 1 : 0));
  }, [data]);

  useEffect(() => {
    if (groups.length && !groups.some((g) => g.key === list)) setList(groups[0].key);
  }, [groups, list]);

  const group = groups.find((g) => g.key === list) || null;
  // Open ones first, then by team name so two entries for one team sit together.
  const items = group
    ? [...group.items].sort((a, b) => (a.status === b.status ? a.teamName.localeCompare(b.teamName) : a.status === "NEW" ? -1 : 1))
    : [];
  const teamCount = new Set(items.map((i) => i.teamName.toLowerCase())).size;
  const alone = items.filter((i) => !i.driver2).length;

  return (
    <div className="space-y-5">
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <div className="card p-5 text-sm text-light">Loading…</div>}
      {data && <Settings key={`${data.settings.seriesId}:${data.settings.label}:${data.settings.open}`} data={data} onSaved={reload} />}

      {data && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardHead eyebrow="Sign-ups" title={group ? `${group.seriesName ? `${group.seriesName} · ` : ""}${group.label}` : "Nothing yet"} />
            <div className="flex items-center gap-2">
              {groups.length > 1 && (
                <select className="input py-1.5 text-sm" value={list || ""} onChange={(e) => setList(e.target.value)} aria-label="Sign-up">
                  {groups.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.seriesName ? `${g.seriesName} · ` : ""}
                      {g.label} ({g.items.length})
                    </option>
                  ))}
                </select>
              )}
              <button className="btn-secondary py-1.5 text-sm" onClick={reload}>
                Refresh
              </button>
            </div>
          </div>
          {group ? (
            <>
              <p className="text-sm text-light">
                {items.length} sign-up{items.length === 1 ? "" : "s"} for {teamCount} team{teamCount === 1 ? "" : "s"}
                {alone ? `, ${alone} without a teammate yet` : ""}. If two people ask for the same team they are listed next to each other.
              </p>
              <ul className="mt-2 divide-y divide-border">
                {items.map((i) => (
                  <Entry key={i.id} item={i} onChanged={reload} />
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-light">Nobody has signed up yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
