import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Notice, EmptyState } from "./ui.jsx";
import { shrinkImage, shrinkImages, REENCODE_OVER_BYTES } from "../utils/imageResize.js";
import { fmtStamp } from "../utils/format.js";

// Admin: the photo gallery of a round. Pick a race, drop the night's
// screenshots in, caption and order them, and they appear as a carousel under
// the round's results on the Races page.
//
// Editing is local until Save, so reordering four photos and captioning two of
// them is one request, not six — and a mis-click is undone by walking away.

const MAX_PHOTOS = 40;
// What the browser shrinks a picked file to before it is uploaded. A race
// screenshot off a 4K monitor is ~10 MB; this puts it around 300 KB with no
// visible loss at the size the gallery ever shows it.
const SHRINK = { maxSide: 1920, quality: 0.82 };

const ICON = {
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  trash: "M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12H8",
};

function Icon({ d, className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const fmtDate = (d) => (d ? fmtStamp(d) : "");

function fmtSize(bytes) {
  if (bytes == null) return null;
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function AdminRacePhotos() {
  const { data: races, reload: reloadRaces } = useApi(useCallback(() => api.races(), []));
  const [raceId, setRaceId] = useState("");
  // The gallery as it will be saved: order, captions, and which rows survive.
  const [photos, setPhotos] = useState([]);
  const [loaded, setLoaded] = useState(null); // what the server last told us
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  // Whether the upload rings the members' bell. On by default, and it stays as
  // set while the tab is open, so working through a season's worth of old
  // galleries is one click here rather than one per round. Deliberately NOT
  // remembered beyond that: a switch that silences notifications forever is one
  // nobody remembers having flipped.
  const [notify, setNotify] = useState(true);

  const race = (races || []).find((r) => r.id === raceId) || null;
  const dirty = loaded != null && JSON.stringify(photos) !== JSON.stringify(loaded);

  const load = useCallback(async (id) => {
    if (!id) {
      setPhotos([]);
      setLoaded(null);
      return;
    }
    setError(null);
    setMsg(null);
    try {
      const d = await api.racePhotos(id);
      setPhotos(d.photos || []);
      setLoaded(d.photos || []);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load(raceId);
  }, [raceId, load]);

  async function pick(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length || !raceId) return;
    // Unsaved edits would be thrown away by the reload the upload answers with,
    // so they go up first and the batch lands on top of them.
    if (dirty) {
      const ok = await save({ silent: true });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    setMsg("Preparing photos…");
    try {
      const shrunk = await shrinkImages(files, SHRINK);
      setMsg(`Uploading ${shrunk.length} photo${shrunk.length === 1 ? "" : "s"}…`);
      const d = await api.uploadRacePhotos(raceId, shrunk, !notify);
      setPhotos(d.photos || []);
      setLoaded(d.photos || []);
      const parts = [`${d.added} photo${d.added === 1 ? "" : "s"} added.`];
      if (d.rejected?.length) parts.push(`Not an image we can show: ${d.rejected.join(", ")}.`);
      if (d.skipped?.length) parts.push(`Over the limit of ${MAX_PHOTOS}, left out: ${d.skipped.join(", ")}.`);
      setMsg(parts.join(" "));
      reloadRaces();
    } catch (err) {
      setError(err.message);
      setMsg(null);
    } finally {
      setBusy(false);
    }
  }

  // Photos already on the server that are heavier than a shrunk one ever is.
  // Uploads before 2026-08-01 slipped through untouched when their dimensions
  // were already small enough, however much they weighed.
  const heavy = photos.filter((p) => (p.bytes || 0) > REENCODE_OVER_BYTES);

  // Fetch each heavy photo back, shrink it the same way an upload is shrunk,
  // and swap the file in place. Id, caption and order survive; the gallery
  // just gets lighter. A photo that can't be improved is left exactly as it is.
  async function optimise() {
    if (!heavy.length) return;
    if (dirty) {
      const ok = await save({ silent: true });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    let done = 0;
    let saved = 0;
    try {
      for (const [i, p] of heavy.entries()) {
        setMsg(`Optimising photo ${i + 1} of ${heavy.length}…`);
        const res = await fetch(p.url);
        if (!res.ok) continue;
        const blob = await res.blob();
        const original = new File([blob], `${p.id}.jpg`, { type: blob.type || "image/jpeg" });
        const smaller = await shrinkImage(original, SHRINK);
        // shrinkImage hands back the SAME object when it couldn't do better.
        if (smaller === original) continue;
        const d = await api.replaceRacePhoto(raceId, p.id, smaller);
        setPhotos(d.photos || []);
        setLoaded(d.photos || []);
        done++;
        saved += original.size - smaller.size;
      }
      setMsg(
        done
          ? `${done} photo${done === 1 ? "" : "s"} optimised, ${fmtSize(saved)} freed.`
          : "Nothing to gain. These are already as small as they get."
      );
      reloadRaces();
    } catch (err) {
      setError(err.message);
      setMsg(null);
    } finally {
      setBusy(false);
    }
  }

  async function save({ silent = false } = {}) {
    if (!raceId) return false;
    setBusy(true);
    setError(null);
    try {
      const d = await api.saveRacePhotos(raceId, photos);
      setPhotos(d.photos || []);
      setLoaded(d.photos || []);
      if (!silent) setMsg("Gallery saved.");
      reloadRaces();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const move = (i, step) => {
    const j = i + step;
    if (j < 0 || j >= photos.length) return;
    const next = [...photos];
    [next[i], next[j]] = [next[j], next[i]];
    setPhotos(next);
  };
  const drop = (i) => setPhotos(photos.filter((_, k) => k !== i));
  const caption = (i, value) =>
    setPhotos(photos.map((p, k) => (k === i ? { ...p, caption: value } : p)));

  // Completed rounds first (that is where the photos come from), but every
  // round is offered — a training session gets a gallery just as happily.
  const list = [...(races || [])].sort((a, b) => (a.number ?? 999) - (b.number ?? 999));

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h2 className="mb-1 font-display text-lg font-extrabold uppercase tracking-tight text-dark">Race photos</h2>
        <p className="mb-4 text-sm text-light">
          The night's screenshots for a round. They show up as a gallery under the results on the Races page,
          and open as a carousel when someone clicks one. Big photos are shrunk in your browser before they
          are uploaded, so a folder full of 4K screenshots is fine.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Round"
            className="input max-w-[22rem] py-1.5 text-sm"
            value={raceId}
            onChange={(e) => setRaceId(e.target.value)}
            disabled={busy}
          >
            <option value="">Choose a round…</option>
            {list.map((r) => (
              <option key={r.id} value={r.id}>
                {r.number != null ? `R${r.number}` : r.type === "TRAINING" ? "Training" : "Event"} · {r.track}
                {r.date ? ` · ${fmtDate(r.date)}` : ""}
                {r.photoCount ? ` · ${r.photoCount} photo${r.photoCount === 1 ? "" : "s"}` : ""}
              </option>
            ))}
          </select>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={pick}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={!raceId || busy || photos.length >= MAX_PHOTOS}
            onClick={() => fileRef.current?.click()}
          >
            Add photos
          </button>
          {/* Sits next to the button it governs, and keeps its setting while
              the tab is open — untick once, then work through as many old
              rounds as you like. */}
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-light">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand"
              checked={notify}
              disabled={busy}
              onChange={(e) => setNotify(e.target.checked)}
            />
            <span title="A round's gallery rings the bell once, the first time photos go up. Untick this when filling in old races, because nobody needs a notification for a season that finished months ago.">
              Tell members
            </span>
          </label>
          {dirty && (
            <>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => save()}>
                Save changes
              </button>
              <button
                type="button"
                className="text-sm font-semibold text-light transition hover:text-dark"
                disabled={busy}
                onClick={() => setPhotos(loaded || [])}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon d={ICON.undo} className="h-3.5 w-3.5" />
                  Discard
                </span>
              </button>
            </>
          )}
          {heavy.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={optimise}
              title="Fetches these photos back, shrinks them the way a new upload is shrunk, and puts them back in place. Captions and order stay."
            >
              Shrink {heavy.length} large photo{heavy.length === 1 ? "" : "s"}
            </button>
          )}
          {raceId && (
            <span className="font-mono text-[11px] uppercase tracking-wider text-light">
              {photos.length} / {MAX_PHOTOS}
              {/* What this round's gallery weighs on the server, after the
                  browser-side shrink — the honest number, not the picked files'. */}
              {photos.some((p) => p.bytes != null) &&
                ` · ${fmtSize(photos.reduce((s, p) => s + (p.bytes || 0), 0))}`}
            </span>
          )}
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {msg && <Notice kind="success">{msg}</Notice>}
      {/* A round with no result saved still shows the sign-up panel on the
          Races page, not the results and the gallery. Uploading early is
          allowed — it just wouldn't be visible yet, and finding that out by
          waiting is the wrong way round. */}
      {race && !race.isCompleted && (
        <Notice kind="info">
          This round has no result yet, so its page still shows the sign-up panel. The gallery appears
          under the results as soon as the result is saved.
        </Notice>
      )}
      {dirty && (
        <Notice kind="info">
          Unsaved changes. Nothing on the site moves until you press Save changes.
        </Notice>
      )}

      {!raceId && (
        <EmptyState
          title="Pick a round"
          hint="Choose the round the photos belong to, then add them. Every round can have its own gallery."
        />
      )}

      {raceId && photos.length === 0 && (
        <EmptyState
          title={`No photos for ${race?.track || "this round"} yet`}
          hint="Add photos puts them here. You can pick several files at once."
        />
      )}

      {photos.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p, i) => (
            <div key={p.id} className="card overflow-hidden">
              <div className="relative aspect-[4/3] bg-surface2">
                <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                <span className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                {fmtSize(p.bytes) && (
                  /* Amber on the heavy ones, so "which of these is the problem"
                     is answered by looking rather than by comparing numbers. */
                  <span
                    className={`absolute right-2 top-2 rounded-md px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums ${
                      (p.bytes || 0) > REENCODE_OVER_BYTES ? "bg-amber-500/90 text-ink" : "bg-black/60 text-white/85"
                    }`}
                    title={
                      (p.bytes || 0) > REENCODE_OVER_BYTES
                        ? "Larger than a shrunk photo ever is. Use Shrink large photos above"
                        : undefined
                    }
                  >
                    {fmtSize(p.bytes)}
                  </span>
                )}
              </div>
              <div className="space-y-2 p-3">
                <input
                  aria-label={`Caption for photo ${i + 1}`}
                  className="input w-full py-1.5 text-sm"
                  placeholder="Caption (optional)"
                  value={p.caption || ""}
                  maxLength={140}
                  onChange={(e) => caption(i, e.target.value)}
                  disabled={busy}
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded-lg border border-border p-1.5 text-light transition hover:text-dark disabled:opacity-40"
                      disabled={busy || i === 0}
                      onClick={() => move(i, -1)}
                      aria-label="Move earlier"
                    >
                      <Icon d={ICON.left} />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-border p-1.5 text-light transition hover:text-dark disabled:opacity-40"
                      disabled={busy || i === photos.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Move later"
                    >
                      <Icon d={ICON.right} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-light transition hover:text-rose-500 disabled:opacity-40"
                    disabled={busy}
                    onClick={() => drop(i)}
                  >
                    <Icon d={ICON.trash} className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
