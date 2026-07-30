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
// An entry from a SIGNED-IN member is also a conversation: replying here lands
// in their notification bell and on their own /feedback page, where they can
// write back (which rings the bells in this office). An entry sent without a
// login has no account to answer to, so it shows whatever contact line the
// sender left instead.
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
  { key: "WAITING", label: "Waiting on you" },
  { key: "ALL", label: "Everything" },
  { key: "BUG", label: "Bugs" },
  { key: "IDEA", label: "Ideas" },
];

function statusMeta(key) {
  return STATUSES.find((s) => s.key === key) || STATUSES[0];
}

// The last message in the thread came from the sender, so the ball is here.
// Counts a brand-new entry too: nobody has answered it yet.
function awaitingAdmin(item) {
  const replies = item.replies || [];
  const last = replies[replies.length - 1];
  return !last || last.author === "SENDER";
}

// The sender wrote back AFTER an answer. Easiest thing on this page to miss (it
// can sit under an entry that was long since marked done), so it earns a pill,
// a slot at the top of the list, and a place in the Open view whatever the
// status says.
function hasNewSenderReply(item) {
  const replies = item.replies || [];
  return replies.length > 0 && replies[replies.length - 1].author === "SENDER";
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

// One message of the conversation under the original report. The admins' side
// is tinted and sits slightly indented; the sender's side stays plain, so a
// thread reads as two voices without any colour having to mean anything new.
function Message({ r }) {
  const mine = r.author === "ADMIN";
  return (
    <li
      className={`rounded-lg border-l-2 px-3 py-2 ${
        mine ? "ml-4 border-brand/60 bg-brand/5" : "mr-4 border-border bg-surface2/60"
      }`}
    >
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-eyebrow">
          {mine ? r.authorName || "League office" : r.authorName || "Sender"}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-light">{fmtWhen(r.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-medium">{r.body}</p>
    </li>
  );
}

function Entry({ item, onChanged }) {
  const [note, setNote] = useState(item.adminNote || "");
  const [busy, setBusy] = useState(false);
  const [openNote, setOpenNote] = useState(false);
  const [openReply, setOpenReply] = useState(false);
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState(null);
  const meta = statusMeta(item.status);
  const agent = shortAgent(item.userAgent);
  const replies = item.replies || [];
  // Only a signed-in sender has an account for the answer to arrive in.
  const canReply = !!item.discordId;

  async function setStatus(status) {
    setBusy(true);
    try {
      await api.updateFeedback(item.id, { status });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (reply.trim().length < 2) {
      setReplyError("Write something first.");
      return;
    }
    setBusy(true);
    setReplyError(null);
    try {
      // Answering a new report also means it is being worked on, so it moves out
      // of the "nobody has looked at this" pile in the same click.
      await api.replyToFeedback(item.id, reply, item.status === "NEW" ? "PLANNED" : undefined);
      setReply("");
      setOpenReply(false);
      onChanged();
    } catch (e) {
      setReplyError(e.message);
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
        {hasNewSenderReply(item) && <span className="pill bg-brand/20 text-dark">New reply</span>}
        <span className="ml-auto font-mono text-[11px] text-light">{fmtWhen(item.createdAt)}</span>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-medium">{item.message}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-light">
        {item.pageUrl && <span>Page: {item.pageUrl}</span>}
        {agent && <span>{agent}</span>}
      </div>

      {replies.length > 0 && (
        <ul className="space-y-2">
          {replies.map((r) => (
            <Message key={r.id} r={r} />
          ))}
        </ul>
      )}

      {openReply && (
        <div className="space-y-2">
          <textarea
            className="input"
            rows={3}
            maxLength={2000}
            placeholder={`Your answer to ${item.senderName || "the sender"}. They get a notification and can write back.`}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          {replyError && <p className="text-sm font-medium text-bad">{replyError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={sendReply} className="btn-primary py-1.5 text-xs">
              Send reply
            </button>
            <button
              type="button"
              onClick={() => { setReply(""); setReplyError(null); setOpenReply(false); }}
              className="btn-secondary py-1.5 text-xs"
            >
              Cancel
            </button>
            {item.status === "NEW" && (
              <span className="text-xs text-light">Sending also moves this to planned.</span>
            )}
          </div>
        </div>
      )}

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
        {canReply ? (
          !openReply && (
            <button
              type="button"
              onClick={() => setOpenReply(true)}
              className="rounded-lg bg-brand/15 px-2.5 py-1 text-xs font-bold text-dark transition hover:bg-brand/25"
            >
              {replies.some((r) => r.author === "ADMIN") ? "Reply again" : "Reply"}
            </button>
          )
        ) : (
          <span className="mr-1 text-xs text-light">
            {item.contact
              ? `Sent without a login. Answer them at ${item.contact}.`
              : "Sent without a login, so there is no way to answer."}
          </span>
        )}
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
    const picked =
      filter === "ALL"
        ? items
        : filter === "OPEN"
        ? // A done entry the sender has since written back on belongs here too,
          // otherwise the reply is only findable by remembering it exists.
          items.filter((i) => i.status === "NEW" || i.status === "PLANNED" || hasNewSenderReply(i))
        : filter === "WAITING"
        ? items.filter((i) => awaitingAdmin(i))
        : items.filter((i) => i.kind === filter);
    // Unanswered replies to the top; the server's order (new, then planned, then
    // newest first) holds underneath.
    return [...picked].sort((a, b) => Number(hasNewSenderReply(b)) - Number(hasNewSenderReply(a)));
  }, [items, filter]);
  const waiting = items.filter(hasNewSenderReply).length;

  if (error) return <ErrorBox message={error} />;

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-surface2/60 px-4 py-3 text-sm leading-relaxed text-medium">
        Everything sent through the <b>Feedback</b> button on the site (bottom right on a computer, in the
        menu on a phone). Members and visitors both can write; only you see it here. <b>Reply</b> sends your
        answer to the sender&rsquo;s notification bell and onto their own feedback page, where they can write
        back to you. Marking something <b>done</b> or <b>won&rsquo;t do</b> only files it away, that alone
        tells the sender nothing.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SlidingTabs items={FILTERS} value={filter} onChange={setFilter} btnClassName="px-3 py-1.5 text-xs" />
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
          {items.filter((i) => i.status === "NEW").length} new
          {waiting > 0 && <span className="text-brand"> · {waiting} replied</span>} · {items.length} total
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
