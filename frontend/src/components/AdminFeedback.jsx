import { useCallback, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox } from "./ui.jsx";
import SlidingTabs from "./SlidingTabs.jsx";

// Everything members and visitors wrote through the Feedback button: bug
// reports, feature wishes, the rest. Each entry can be moved along (new →
// planned → done, or declined), gets a private note, and can be deleted once
// it has served its purpose.
//
// Deliberately plain rows rather than a wall of cards: this is a working list,
// read top to bottom, and the only colour on it means something (the status).

const KIND_LABEL = { BUG: "Bug", IDEA: "Idea", OTHER: "Other" };

const STATUSES = [
  { key: "NEW", label: "New", cls: "bg-brand/20 text-dark" },
  { key: "PLANNED", label: "Planned", cls: "bg-sky-500/15 text-link" },
  { key: "DONE", label: "Done", cls: "bg-emerald-500/15 text-ok" },
  { key: "DECLINED", label: "Won't do", cls: "bg-surface2 text-light" },
];

const FILTERS = [
  { key: "OPEN", label: "Open" },
  { key: "ALL", label: "Everything" },
  { key: "BUG", label: "Bugs" },
  { key: "IDEA", label: "Ideas" },
];

function statusMeta(key) {
  return STATUSES.find((s) => s.key === key) || STATUSES[0];
}

function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// "Chrome 126 on Windows" out of the raw user-agent string. Only a hint for
// reproducing a bug, so anything unrecognised simply falls back to the raw
// text (truncated) rather than pretending to know.
function shortAgent(ua) {
  if (!ua) return null;
  const os = /Android/i.test(ua) ? "Android"
    : /iPhone|iPad|iPod/i.test(ua) ? "iOS"
    : /Windows/i.test(ua) ? "Windows"
    : /Mac OS X/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux"
    : null;
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : null;
  if (!os && !browser) return ua.slice(0, 60);
  return [browser, os].filter(Boolean).join(" on ");
}

function Entry({ item, onChanged }) {
  const [note, setNote] = useState(item.adminNote || "");
  const [busy, setBusy] = useState(false);
  const [openNote, setOpenNote] = useState(false);
  const meta = statusMeta(item.status);
  const agent = shortAgent(item.userAgent);

  async function setStatus(status) {
    setBusy(true);
    try {
      await api.updateFeedback(item.id, { status });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    setBusy(true);
    try {
      await api.updateFeedback(item.id, { adminNote: note });
      setOpenNote(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this entry for good?")) return;
    setBusy(true);
    try {
      await api.deleteFeedback(item.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`space-y-3 py-4 ${busy ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`pill ${meta.cls}`}>{meta.label}</span>
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-eyebrow">
          {KIND_LABEL[item.kind] || item.kind}
        </span>
        <span className="text-sm font-semibold text-dark">{item.senderName || "Anonymous"}</span>
        {item.contact && <span className="text-xs text-light">via {item.contact}</span>}
        <span className="ml-auto font-mono text-[11px] text-light">{fmtWhen(item.createdAt)}</span>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-medium">{item.message}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-light">
        {item.pageUrl && <span>Page: {item.pageUrl}</span>}
        {agent && <span>{agent}</span>}
      </div>

      {item.adminNote && !openNote && (
        <p className="rounded-lg bg-surface2/60 px-3 py-2 text-xs leading-relaxed text-medium">
          <span className="font-mono font-bold uppercase tracking-wider text-eyebrow">Note </span>
          {item.adminNote}
        </p>
      )}

      {openNote && (
        <div className="space-y-2">
          <textarea
            className="input"
            rows={2}
            maxLength={2000}
            placeholder="Private note (only admins see this)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" onClick={saveNote} className="btn-primary py-1.5 text-xs">Save note</button>
            <button type="button" onClick={() => { setNote(item.adminNote || ""); setOpenNote(false); }} className="btn-secondary py-1.5 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {STATUSES.filter((s) => s.key !== item.status).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setStatus(s.key)}
            className="rounded-lg bg-surface2 px-2.5 py-1 text-xs font-semibold text-medium transition hover:bg-border hover:text-dark"
          >
            {s.key === "NEW" ? "Back to new" : `Mark ${s.label.toLowerCase()}`}
          </button>
        ))}
        {!openNote && (
          <button
            type="button"
            onClick={() => setOpenNote(true)}
            className="rounded-lg bg-surface2 px-2.5 py-1 text-xs font-semibold text-medium transition hover:bg-border hover:text-dark"
          >
            {item.adminNote ? "Edit note" : "Add note"}
          </button>
        )}
        <button
          type="button"
          onClick={remove}
          className="ml-auto rounded-lg px-2.5 py-1 text-xs font-semibold text-bad transition hover:bg-red-500/10"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

// Anything that changes an entry says so, so the counter on the tab above
// stops showing a number the admin has just worked through.
export const FEEDBACK_CHANGED_EVENT = "nabs-feedback-changed";

export default function AdminFeedback() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.adminFeedback(), []));
  const [filter, setFilter] = useState("OPEN");

  const refresh = useCallback(() => {
    reload();
    window.dispatchEvent(new Event(FEEDBACK_CHANGED_EVENT));
  }, [reload]);

  const items = data?.items || [];
  const shown = useMemo(() => {
    if (filter === "ALL") return items;
    if (filter === "OPEN") return items.filter((i) => i.status === "NEW" || i.status === "PLANNED");
    return items.filter((i) => i.kind === filter);
  }, [items, filter]);

  if (error) return <ErrorBox message={error} />;

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-surface2/60 px-4 py-3 text-sm leading-relaxed text-medium">
        Everything sent through the <b>Feedback</b> button on the site (bottom right on a computer, in the
        menu on a phone). Members and visitors both can write; only you see it here. Marking something{" "}
        <b>done</b> or <b>won&rsquo;t do</b> just files it away, the sender is never notified.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SlidingTabs items={FILTERS} value={filter} onChange={setFilter} btnClassName="px-3 py-1.5 text-xs" />
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
          {items.filter((i) => i.status === "NEW").length} new · {items.length} total
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-light">Loading&hellip;</p>
      ) : shown.length === 0 ? (
        <p className="card p-6 text-sm leading-relaxed text-light">
          {items.length === 0
            ? "Nothing yet. When someone reports a bug or asks for a feature, it lands here."
            : "Nothing in this view. Try Everything."}
        </p>
      ) : (
        <ul className="card divide-y divide-border px-5">
          {shown.map((item) => (
            <Entry key={item.id} item={item} onChanged={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}
