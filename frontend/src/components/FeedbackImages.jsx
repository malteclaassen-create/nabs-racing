import { useEffect, useRef, useState } from "react";
import { feedbackImageUrl } from "../api/client.js";

// ---------------------------------------------------------------------------
// Pictures in a feedback conversation: shown under a message, and picked for
// the next one. Used by both ends of the thread — the admins' Feedback tab and
// the sender's own /feedback page — so a screenshot looks the same from both.
//
// The pictures are private (backend lib/feedbackFiles.js), so each one is
// fetched with the reader's own session and rendered from memory, exactly like
// a report's attachments in ReportChat.jsx.
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * MB;
// An explicit list rather than image/*: an iPhone then converts a HEIC photo to
// JPEG on the way out instead of handing over a format the server refuses.
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const TYPES = new Set(ACCEPT.split(","));

function useImageUrl(feedbackId, imageId, admin) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let made = null;
    feedbackImageUrl(feedbackId, imageId, admin)
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
  }, [feedbackId, imageId, admin]);
  return { url, failed };
}

function Picture({ feedbackId, image, admin }) {
  const { url, failed } = useImageUrl(feedbackId, image.id, admin);
  if (failed || !url) {
    return (
      <span className="inline-flex h-20 w-28 items-center justify-center rounded-lg border border-border bg-surface2 px-2 text-center text-[11px] text-light">
        {failed ? "Picture could not be loaded" : "Loading…"}
      </span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      <img
        src={url}
        alt={image.name || "Picture"}
        className="max-h-60 w-auto max-w-full rounded-lg border border-border object-contain"
      />
    </a>
  );
}

// The pictures on one message. Nothing at all when there are none.
export function ReplyImages({ feedbackId, images, admin = false }) {
  if (!images?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {images.map((img) => (
        <Picture key={img.id} feedbackId={feedbackId} image={img} admin={admin} />
      ))}
    </div>
  );
}

// Which of these files can go, and the sentence for the first one that can't.
// The server checks the same again; this is so a phone user hears about a
// 30 MB photo before it has been uploaded rather than after.
export function acceptImages(current, picked) {
  const ok = [];
  let error = null;
  for (const f of picked) {
    if (current.length + ok.length >= MAX_IMAGES) {
      error = `Up to ${MAX_IMAGES} pictures per message.`;
      break;
    }
    if (!TYPES.has(f.type)) error = `${f.name || "That file"} is not a PNG, JPEG, WEBP or GIF picture.`;
    else if (f.size > MAX_IMAGE_BYTES) error = `${f.name || "That picture"} is too big. The limit is 10 MB per picture.`;
    else ok.push(f);
  }
  return { files: [...current, ...ok], error };
}

// Pictures pasted into a text box (a screenshot straight from the clipboard).
// Returns the files, or [] when the paste was only text and should go ahead.
export function pastedImages(e) {
  return Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
}

function Preview({ file, onRemove, disabled }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <span className="relative inline-block">
      {url && <img src={url} alt={file.name} className="h-16 w-16 rounded-lg border border-border object-cover" />}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${file.name}`}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-dark text-[11px] font-bold leading-none text-card shadow"
      >
        ×
      </button>
    </span>
  );
}

// The "add a picture" button and the pictures picked so far. `files` is owned
// by the composer, so sending can clear it along with the text.
export function ImagePicker({ files, onChange, onError, disabled = false }) {
  const input = useRef(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {files.map((f, i) => (
        <Preview
          key={`${f.name}-${f.size}-${f.lastModified}-${i}`}
          file={f}
          disabled={disabled}
          onRemove={() => onChange(files.filter((_, j) => j !== i))}
        />
      ))}
      {files.length < MAX_IMAGES && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg bg-surface2 px-2.5 py-1.5 text-xs font-semibold text-medium transition hover:bg-border hover:text-dark"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          {files.length ? "Add another" : "Add picture"}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const { files: next, error } = acceptImages(files, Array.from(e.target.files || []));
          onChange(next);
          onError?.(error);
          // Picking the same file again after removing it must fire again.
          e.target.value = "";
        }}
      />
    </div>
  );
}
