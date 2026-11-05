import { useCallback, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardHead, ErrorBox, Field } from "./ui.jsx";

// Admin "Admin log": who changed what, and what it was before. Written by
// backend/src/lib/adminActivity.js. Read-only on purpose: nobody can tidy this
// page up from the admin area.

const PAGE = 100;

function fmtTime(iso) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function Change({ change }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="text-light">{change.field}</span>
      {change.from !== undefined && (
        <>
          <span className="text-medium">{change.from}</span>
          <ArrowRight aria-label="changed to" size={14} strokeWidth={2} className="shrink-0 self-center text-light" />
        </>
      )}
      <span className="font-medium text-dark">{change.to}</span>
    </li>
  );
}

function Entry({ entry }) {
  const known = !!entry.who;
  return (
    <li className="py-3">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <p className="min-w-0 text-sm text-dark">
          <span className="font-medium">{entry.label}</span>
          {entry.target && <span className="text-medium">: {entry.target}</span>}
        </p>
        <span className="shrink-0 font-mono text-xs text-light">{fmtTime(entry.t)}</span>
      </div>
      <p className={`mt-0.5 text-xs ${known ? "text-medium" : "text-light"}`}>
        {known ? `by ${entry.who.name}` : "Name not recorded"}
      </p>
      {entry.changes?.length > 0 && (
        <ul className="mt-2 space-y-1 border-l-2 border-border pl-3">
          {entry.changes.map((c, i) => <Change key={i} change={c} />)}
          {entry.more > 0 && <li className="text-sm text-light">and {entry.more} more</li>}
        </ul>
      )}
    </li>
  );
}

export default function AdminActivityLog() {
  const [who, setWho] = useState("");
  const [area, setArea] = useState("");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  // Waits for a pause in the typing: the server reads the log for every search.
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);
  useEffect(() => setShown(PAGE), [who, area, q]);

  const log = useApi(useCallback(() => api.activity({ who, area, q, limit: shown }), [who, area, q, shown]));
  const data = log.data;
  const entries = data?.entries || [];
  const filtering = !!(who || area || q);

  return (
    <section className="card p-5">
      <CardHead title="Admin log" />
      <p className="-mt-2 mb-4 text-sm text-light">
        Every change made in the admin area, who made it and what it was before. Nobody can edit or delete these
        lines. Changes made with the shared PIN show as PIN login, because the PIN cannot tell people apart. Sign in
        with Discord to have your name on your changes.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Who">
          <select className="input w-full py-1.5 text-sm" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everybody</option>
            {(data?.people || []).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Area">
          <select className="input w-full py-1.5 text-sm" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">All areas</option>
            {(data?.areas || []).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </Field>
        <Field label="Search">
          <input
            className="input w-full py-1.5 text-sm"
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Driver, track, penalty"
          />
        </Field>
      </div>

      <div className="mt-4">
        {log.error ? (
          <ErrorBox message={log.error} onRetry={log.reload} title="Couldn't read the admin log" />
        ) : entries.length === 0 ? (
          <p className="text-sm text-light">
            {log.loading ? "Reading the log…" : filtering ? "Nothing matches that." : "No changes logged yet."}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {entries.map((e, i) => <Entry key={`${e.t}-${i}`} entry={e} />)}
            </ul>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-light">{entries.length} of {data.total}</span>
              {entries.length < data.total && (
                <button type="button" className="btn-secondary" disabled={log.loading} onClick={() => setShown((n) => n + PAGE)}>
                  Show more
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
