import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The round's photos: the night's screenshots, uploaded by an admin in the
// Photos tab. A quiet thumbnail grid under the race facts, and a full-screen
// carousel once you click one — arrows, keyboard, swipe, captions.
//
// Renders nothing at all for a round without photos, so the page reads exactly
// as it always has until somebody actually uploads something.

const ARROW = {
  prev: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
  close: "M6 6l12 12M6 18L18 6",
  camera: "M3 8a2 2 0 012-2h2.5l1.2-2h6.6L16.5 6H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8zM12 16a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  download: "M12 3v12M7 10l5 5 5-5M4 17v3h16v-3",
};

// What the photo is called once it's on somebody's disk. The round and the
// position in the gallery, so a folder of them from different races still
// makes sense — "photo (3).jpg" from the raw URL would not.
function downloadName(title, index, url) {
  const ext = (String(url).split("?")[0].match(/\.([a-z0-9]+)$/i)?.[1] || "jpg").toLowerCase();
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "race";
  return `nabs-${slug}-${String(index + 1).padStart(2, "0")}.${ext}`;
}

function Icon({ d, className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// Full-screen viewer. Mounted only while open, so the keyboard and scroll
// handlers below exist exactly as long as they are wanted.
function Lightbox({ photos, index, onIndex, onClose, title }) {
  const total = photos.length;
  const photo = photos[index];
  const touchX = useRef(null);
  const closeRef = useRef(null);

  const go = useCallback(
    (step) => onIndex((index + step + total) % total),
    [index, total, onIndex]
  );

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    }
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll away under the viewer, and on iOS it
    // will unless the body is pinned.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  // Save the picture the visitor is looking at. Reads the bytes and hands them
  // to the browser as a blob; anything that goes wrong falls through to the
  // link's own behaviour rather than leaving the click doing nothing.
  async function saveViaBlob(e) {
    const href = e.currentTarget.href;
    const name = e.currentTarget.getAttribute("download");
    // Synchronously, before any await: after one, the browser has already
    // decided what to do with the click and preventDefault comes too late.
    e.preventDefault();
    const save = (url, revoke) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      if (revoke) setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error(String(res.status));
      save(URL.createObjectURL(await res.blob()), true);
    } catch {
      // Offline, blocked, whatever: fall back to the plain link, which is
      // what would have happened without this handler at all.
      save(href, false);
    }
  }

  // Swipe: the only way this reads as a carousel on a phone.
  function onTouchStart(e) {
    touchX.current = e.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(e) {
    const start = touchX.current;
    touchX.current = null;
    if (start == null || total < 2) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1);
  }

  // Portalled to <body>: the viewer sits deep inside the round explorer, whose
  // entrance animations put a transform on the ancestors — and a transformed
  // ancestor turns position:fixed into "fixed to that ancestor". The viewer
  // then rendered down at the gallery's place in the page instead of over the
  // screen. From <body> there is nothing between it and the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-[68] flex flex-col bg-ink/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} photos`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 text-white/80">
        <span className="min-w-0 truncate font-mono text-[11px] font-bold uppercase tracking-widest">
          {title} <span className="text-white/45">· {index + 1} / {total}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {/* A plain same-origin link with `download` would normally be enough,
              and it stays the fallback (and keeps right-click "save link as"
              working). But uploads are served under a locked-down CSP that
              carries `sandbox`, and browsers have been known to refuse
              downloads that touch a sandboxed resource. Fetching the bytes
              ourselves and saving them from a blob takes that question off the
              table; if the fetch fails for any reason we simply let the link do
              what it was going to do. */}
          <a
            href={photo.url}
            download={downloadName(title, index, photo.url)}
            aria-label="Download this photo"
            title="Download this photo"
            onClick={saveViaBlob}
            className="rounded-lg p-2 transition hover:bg-white/10 hover:text-white"
          >
            <Icon d={ARROW.download} />
          </a>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 transition hover:bg-white/10 hover:text-white"
          >
            <Icon d={ARROW.close} />
          </button>
        </span>
      </div>

      {/* The image area takes what the header and caption leave over, and the
          picture is contained inside it — a tall screenshot must not push the
          controls off the screen. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2">
        {total > 1 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous photo"
            className="absolute left-2 z-10 rounded-full bg-black/40 p-2.5 text-white/85 transition hover:bg-black/70 hover:text-white sm:left-4"
          >
            <Icon d={ARROW.prev} className="h-6 w-6" />
          </button>
        )}
        <img
          key={photo.url}
          src={photo.url}
          alt={photo.caption || `${title} photo ${index + 1}`}
          className="content-in max-h-full max-w-full rounded-lg object-contain"
        />
        {total > 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next photo"
            className="absolute right-2 z-10 rounded-full bg-black/40 p-2.5 text-white/85 transition hover:bg-black/70 hover:text-white sm:right-4"
          >
            <Icon d={ARROW.next} className="h-6 w-6" />
          </button>
        )}
      </div>

      {photo.caption && (
        <p className="px-6 pb-5 pt-1 text-center text-sm leading-relaxed text-white/75">{photo.caption}</p>
      )}
    </div>,
    document.body
  );
}

export default function RaceGallery({ photos, title = "This round" }) {
  const [open, setOpen] = useState(null); // index, or null when closed
  if (!photos?.length) return null;

  return (
    <div className="card mt-6 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface2/50 px-5 py-3">
        <h3 className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">
          <Icon d={ARROW.camera} className="h-4 w-4" />
          Photos
        </h3>
        <span className="font-mono text-[11px] uppercase tracking-wider text-light">
          {photos.length} {photos.length === 1 ? "shot" : "shots"}
        </span>
      </div>
      {/* Fixed-height tiles rather than the pictures' own proportions: a row of
          portrait and landscape screenshots side by side otherwise turns the
          panel into a staircase. The full shape is one click away. */}
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(i)}
            title={p.caption || undefined}
            className="group relative aspect-[4/3] overflow-hidden rounded-lg bg-surface2 ring-1 ring-border transition hover:ring-brand/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <img
              src={p.url}
              alt={p.caption || `${title} photo ${i + 1}`}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition duration-base group-hover:scale-[1.04]"
            />
            {p.caption && (
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-5 text-left text-[11px] font-semibold text-white">
                {p.caption}
              </span>
            )}
          </button>
        ))}
      </div>
      {open != null && (
        <Lightbox photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} title={title} />
      )}
    </div>
  );
}
