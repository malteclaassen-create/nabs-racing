import { useEffect, useRef, useState } from "react";
import { fmtStamp } from "../utils/format.js";
import { reportFileUrl } from "../api/client.js";

// ---------------------------------------------------------------------------
// A report, read as the conversation it is.
//
// The thing that was reported is the FIRST message, written by the driver who
// filed it, in the same shape as every answer under it. It used to sit in a box
// of its own above the thread, which read like a case file with a comment
// section — and a case file is not what two drivers arguing about lap 14 are
// doing. What follows is the accused, the stewards and anyone let in, in order.
//
// Pictures and clips play in the thread. A still of the contact or ten seconds
// of replay settles more than a paragraph, which is the whole reason the league
// asked for them. They are fetched with the reader's own session and rendered
// from memory rather than pointed at by a URL — see useAttachmentUrl below.
//
// One component for all three places a thread is read — the panel, /reports and
// the stewards' desk — so a conversation looks the same from both ends.
// ---------------------------------------------------------------------------

const when = (iso) => (iso ? fmtStamp(iso) : "");

const MB = 1024 * 1024;
export const MAX_FILE_BYTES = 20 * MB;
export const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf";

const fmtSize = (n) => (n >= MB ? `${(n / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Bare URLs typed into a message become links. Only http(s), and only as far as
// the first whitespace: a driver pasting a YouTube timestamp is the common case
// and it should not need markdown to work.
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
function Linkified({ text }) {
  const parts = String(text || "").split(URL_RE);
  return parts.map((p, i) =>
    URL_RE.test(p) && i % 2 === 1 ? (
      <a
        key={i}
        href={p}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="break-all text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
      >
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

// Fetches the bytes with the caller's own session and hands back a blob: URL.
//
// Not a plain src. The endpoint needs an Authorization header and an <img> or a
// <video> cannot send one, so the obvious fix is a signed URL — and a signed
// URL is a URL that works for whoever it is forwarded to. A report is a private
// argument between two drivers; the thing you copy out of it should not be a
// working link. One fetch per file, revoked when the message leaves the screen.
function useAttachmentUrl(file, admin) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let made = null;
    reportFileUrl(file, admin)
      .then((u) => {
        if (!live) return URL.revokeObjectURL(u);
        made = u;
        setUrl(u);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file, admin]);
  return { url, failed };
}

function Attachment({ file, admin }) {
  const { url, failed } = useAttachmentUrl(file, admin);

  if (failed) {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface2 px-3 py-2 text-xs text-light">
        {file.name} could not be loaded
      </span>
    );
  }
  if (!url) {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface2 px-3 py-2 text-xs text-light">
        Loading {file.name}…
      </span>
    );
  }

  if (file.mime.startsWith("image/")) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        {/* No loading="lazy". The bytes are already in memory by the time this
            renders — the fetch is what got the blob — so deferring the decode
            saves nothing, and a lazily-loaded blob: URL was observed never
            decoding at all. */}
        <img
          src={url}
          alt={file.name}
          className="max-h-72 w-auto max-w-full rounded-lg border border-border object-contain"
        />
      </a>
    );
  }
  if (file.mime.startsWith("video/")) {
    // No autoplay and no loop: it is evidence, not a background.
    return (
      <video src={url} controls preload="metadata" className="max-h-72 w-full max-w-md rounded-lg border border-border" />
    );
  }
  return (
    <a
      href={url}
      download={file.name}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface2 px-3 py-2 text-xs font-semibold text-medium transition hover:border-link hover:text-dark"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 3v5h5M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
      </svg>
      <span className="truncate">{file.name}</span>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-light">{fmtSize(file.size)}</span>
    </a>
  );
}

// What a voice is CALLED, next to the name. Never instead of it: half this
// league's drivers are also admins, and replacing their name with "Stewards"
// when they answered a report about themselves was the whole confusion.
//
// "Stewards" means written FROM THE ADMIN AREA — the league office speaking,
// whoever was sitting at it. An admin answering from their normal view is just
// themselves, and gets no tag at all beyond their part in the thread.
const VOICE = { REPORTER: "reported this", ACCUSED: "named in this", ADMIN: "stewards", VIEWER: "" };

function Bubble({ voice, name, at, body, files, first, admin, mine }) {
  const fromAdmin = voice === "ADMIN";
  return (
    // Yours down one side, everybody else's down the other. Nothing about a
    // thread said who was talking except a name in small type, and a name is
    // the thing you stop reading after the second message.
    <li className={`flex ${mine ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] min-w-0 rounded-xl px-3.5 py-2.5 ${
          mine
            ? "rounded-bl-sm border border-border bg-surface2/70"
            : fromAdmin
              ? "rounded-br-sm border border-brand/40 bg-brand/10"
              : "rounded-br-sm border border-link/25 bg-link/5"
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          {/* The name, always. Then what they are in this thread. */}
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-eyebrow">
            {name || (fromAdmin ? "Stewards" : "Driver")}
          </span>
          {(first || voice !== "REPORTER") && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-light">
              {first ? VOICE.REPORTER : VOICE[voice] || ""}
            </span>
          )}
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint">{when(at)}</span>
        </div>
        {body && (
          <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-dark">
            <Linkified text={body} />
          </p>
        )}
        {files.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {files.map((f) => (
              <Attachment key={f.id} file={f} admin={admin} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

// `admin` picks which endpoint the bytes come from: the stewards' desk runs on
// the PIN token, which the member route does not accept.
export default function ReportChat({ report, messages = [], attachments = [], admin = false, mineIsReporter = false }) {
  // Files hung on the report itself rather than on a message (an upload whose
  // message is gone) ride with the opening one, so nothing is ever orphaned out
  // of sight.
  const byMessage = new Map();
  const loose = [];
  for (const a of attachments) {
    if (!a.messageId) loose.push(a);
    else byMessage.set(a.messageId, [...(byMessage.get(a.messageId) || []), a]);
  }

  return (
    <ul className="space-y-2.5">
      <Bubble
        first
        voice="REPORTER"
        name={report.reporterName}
        at={report.createdAt}
        body={report.body}
        files={loose}
        admin={admin}
        mine={mineIsReporter}
      />
      {messages.map((m) => (
        <Bubble
          key={m.id}
          voice={m.author}
          name={m.authorName}
          at={m.createdAt}
          body={m.body}
          files={byMessage.get(m.id) || []}
          admin={admin}
          mine={m.mine}
        />
      ))}
    </ul>
  );
}

// The box you write in. Text, files, or both — "here, look" with a clip
// attached is a complete message and should not need a full stop typed into it
// to be sendable.
export function ReportComposer({ onSend, busy, placeholder = "Add something to this report…", full = false }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const pick = (list) => {
    const next = [...files, ...list].slice(0, 4);
    const tooBig = next.find((f) => f.size > MAX_FILE_BYTES);
    setError(tooBig ? `${tooBig.name} is ${fmtSize(tooBig.size)}. The limit is 20 MB.` : null);
    setFiles(next);
  };

  const canSend = !busy && (text.trim() || files.length) && !error;

  async function send() {
    if (!canSend) return;
    await onSend(text.trim(), files);
    setText("");
    setFiles([]);
    setError(null);
  }

  return (
    <div className="space-y-2">
      <textarea
        aria-label="Write in this report"
        className={`input resize-none ${full ? "h-24" : "h-20"}`}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg bg-surface2 px-2.5 py-1 text-xs">
              <span className="max-w-40 truncate font-semibold text-medium">{f.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-light">{fmtSize(f.size)}</span>
              <button
                className="transition text-light hover:text-bad"
                aria-label={`Remove ${f.name}`}
                onClick={() => {
                  const next = files.filter((_, n) => n !== i);
                  setFiles(next);
                  setError(next.some((x) => x.size > MAX_FILE_BYTES) ? error : null);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            pick([...e.target.files]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1.5"
          disabled={busy || files.length >= 4}
          onClick={() => fileRef.current?.click()}
          title="A picture, a clip or a PDF. Up to 20 MB each, four at a time."
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21.4 11.05l-8.49 8.49a5 5 0 01-7.07-7.07l8.49-8.49a3.5 3.5 0 014.95 4.95l-8.49 8.49a2 2 0 01-2.83-2.83l7.78-7.78" />
          </svg>
          Attach
        </button>
        <button className={`btn-primary ${full ? "" : "flex-1"}`} disabled={!canSend} onClick={send}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
