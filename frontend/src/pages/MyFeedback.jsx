import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { PageHeader, ErrorBox, EmptyState, Spinner } from "../components/ui.jsx";
import { SocialIcon } from "../components/SocialLinks.jsx";
import { openFeedback } from "../components/FeedbackWidget.jsx";

// ---------------------------------------------------------------------------
// The sender's side of the feedback conversation: everything you have written
// to the admins through the Feedback button, and everything they wrote back.
//
// It exists because an answer needs somewhere to land. The admins reply from
// their Feedback tab, which rings the bell here ("The admins replied to your
// feedback") and links straight to the thread on this page, where you can write
// back. Only your own entries are ever loaded (the API scopes them to your
// account), and only reports sent while signed in can be answered at all.
//
// Deliberately not a tab on /profile: that page needs a linked roster driver
// behind it, and a brand-new login who reported something broken on their first
// evening has neither. Any signed-in member can open this one.
// ---------------------------------------------------------------------------

const KIND_LABEL = { BUG: "Bug report", IDEA: "Idea", OTHER: "Feedback" };

// What the admins' filing means for the person waiting on an answer. NEW gets no
// pill: "we have not looked at it yet" is not news worth a badge.
const STATUS_META = {
  PLANNED: { label: "On the list", cls: "bg-sky-500/15 text-link" },
  DONE: { label: "Done", cls: "bg-emerald-500/15 text-ok" },
  DECLINED: { label: "Not planned", cls: "bg-surface2 text-light" },
};

function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function LoginGate() {
  const discord = useApi(useCallback(() => api.discordConfig(), []));
  const start = () => {
    if (discord.data?.url) window.location.href = discord.data.url;
  };
  return (
    <div className="mx-auto max-w-md">
      <div className="card flex flex-col items-center gap-5 p-8 text-center">
        <div>
          <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark">
            Sign in to see your messages
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-light">
            Anyone can send feedback without an account, but an answer needs somewhere to arrive. Sign in with
            Discord and whatever you write from then on keeps its thread here.
          </p>
        </div>
        {discord.loading ? (
          <span className="text-sm text-light">…</span>
        ) : discord.data?.enabled ? (
          <button
            onClick={start}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#4752c4]"
          >
            <SocialIcon name="discord" className="h-5 w-5" />
            Continue with Discord
          </button>
        ) : (
          <p className="text-sm text-medium">Discord login is not configured yet.</p>
        )}
      </div>
    </div>
  );
}

// One message inside a thread. The admins' answers are tinted and indented, your
// own words stay plain: the same two-voice layout the admin side uses, so a
// thread reads the same from both ends.
function Message({ r }) {
  const fromAdmin = r.author === "ADMIN";
  return (
    <li
      className={`rounded-lg border-l-2 px-3.5 py-2.5 ${
        fromAdmin ? "border-brand/60 bg-brand/5" : "ml-4 border-border bg-surface2/60"
      }`}
    >
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-eyebrow">
          {fromAdmin ? r.authorName || "League admins" : "You"}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-light">{fmtWhen(r.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-medium">{r.body}</p>
    </li>
  );
}

function Thread({ item, highlight, onChanged }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const replies = item.replies || [];
  const answered = replies.some((r) => r.author === "ADMIN");
  const status = STATUS_META[item.status];
  // Whether the admins are waiting on you rather than the other way round.
  const yourTurn = answered && replies[replies.length - 1].author === "ADMIN";

  // Arriving from the notification: the bell links to ?id=<this entry>, so put it
  // on screen instead of leaving it somewhere down a long page.
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);

  async function send() {
    if (text.trim().length < 2) {
      setError("Write something first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.sendFeedbackReply(item.id, text);
      setText("");
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      ref={ref}
      className={`card scroll-mt-28 space-y-4 p-5 ${highlight ? "ring-2 ring-brand" : ""} ${
        busy ? "opacity-50" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-eyebrow">
          {KIND_LABEL[item.kind] || "Feedback"}
        </span>
        {status && <span className={`pill ${status.cls}`}>{status.label}</span>}
        {yourTurn && <span className="pill bg-brand/20 text-dark">Answered</span>}
        <span className="ml-auto font-mono text-[11px] text-light">{fmtWhen(item.createdAt)}</span>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-dark">{item.message}</p>

      {replies.length > 0 && (
        <ul className="space-y-2">
          {replies.map((r) => (
            <Message key={r.id} r={r} />
          ))}
        </ul>
      )}

      {answered ? (
        <div className="space-y-2 border-t border-border pt-3">
          <textarea
            className="input"
            rows={3}
            maxLength={2000}
            placeholder="Write back to the admins"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && <p className="text-sm font-medium text-bad">{error}</p>}
          <div className="flex items-center gap-3">
            <button type="button" onClick={send} disabled={busy} className="btn-primary py-1.5 text-xs">
              {busy ? "Sending..." : "Send"}
            </button>
            <span className="text-xs text-light">The admins get a notification.</span>
          </div>
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-xs leading-relaxed text-light">
          Nobody has answered yet. If they do, you will get a notification and can reply right here.
        </p>
      )}
    </li>
  );
}

function MyThreads() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.myFeedback(), []));
  const [params] = useSearchParams();
  const focusId = params.get("id");
  const items = useMemo(() => data?.items || [], [data]);
  // The entry the notification pointed at goes first, so it is the one you land
  // on whether or not the scroll happens.
  const ordered = useMemo(
    () => (focusId ? [...items].sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId)) : items),
    [items, focusId]
  );

  if (loading && !data) return <Spinner label="Loading your messages…" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing sent yet"
        hint="Found a bug, or thought of something the site should do? The Feedback button is on every page (bottom right on a computer, in the menu on a phone)."
      >
        <button type="button" onClick={openFeedback} className="btn-primary mt-5">
          Write to the admins
        </button>
      </EmptyState>
    );
  }

  return (
    <ul className="space-y-4">
      {ordered.map((item) => (
        <Thread key={item.id} item={item} highlight={item.id === focusId} onChanged={reload} />
      ))}
    </ul>
  );
}

export default function MyFeedback() {
  const { isLoggedIn } = useAuth();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="You and the admins"
        title="Your Messages"
        subtitle="Bug reports and ideas you have sent, and what the admins said back."
        right={
          isLoggedIn ? (
            <button type="button" onClick={openFeedback} className="btn-secondary whitespace-nowrap">
              Write something new
            </button>
          ) : null
        }
      />
      {isLoggedIn ? <MyThreads /> : <LoginGate />}
    </div>
  );
}
