// ---------------------------------------------------------------------------
// Link previews: what a link into each page of the series looks like when it
// is pasted on Discord, and the pictures and wording behind it.
//
// Every card is drawn from the server's own answer (GET
// /admin/series/:id/link-previews), i.e. the same title, description, picture
// and stripe colour the unfurler is sent, not a guess at them. A page picks
// its picture in this order: its own, the series default, the NABS picture
// (og-image.jpg). Discord caches unfurls, so a link already posted keeps the
// picture it had; fresh pastes show the new one.
// ---------------------------------------------------------------------------
import { useCallback, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeries } from "../context/SeriesContext.jsx";
import { CardHead, Skeleton } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import TabNotice from "./TabNotice.jsx";

// Same limits as the server (backend lib/series.js SHARE_TITLE_MAX and
// SHARE_DESCRIPTION_MAX). Discord itself cuts an embed title at 256.
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 400;

const SOURCE_LABEL = {
  page: "Own picture",
  series: "Series default",
  default: "NABS picture",
};

export default function AdminLinkPreviews() {
  const { current: series } = useSeries();
  const { data, reload } = useApi(
    useCallback(() => (series ? api.adminLinkPreviews(series.id) : Promise.resolve(null)), [series?.id])
  );
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const saved = (m) => { setMsg(m); setError(null); reload(); };

  if (!series) return <p className="text-sm text-light">Pick a series in the header first.</p>;

  return (
    <div className="space-y-4">
      <TabNotice msg={msg} error={error} onClose={() => { setMsg(null); setError(null); }} />
      <div className="card p-5">
        <CardHead eyebrow="Link previews" title={`How ${series.name} links look on Discord`} />
        <p className="text-sm text-light">
          Each page of the series can have its own picture, title and description. A page without its own picture
          uses the series default, and without that the NABS picture; without its own text it uses the automatic
          one. Best at <span className="font-semibold text-medium">1200×630</span>, JPG or PNG.
          Links already posted on Discord keep their old picture; new pastes show the new one.
        </p>
        {data?.series && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <span className="text-sm font-semibold text-dark">Series default (all pages)</span>
            <PictureButtons seriesId={series.id} page="" label="all pages" url={data.series.shareImageUrl}
              onSaved={saved} onError={setError} />
          </div>
        )}
      </div>
      {!data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.pages.map((p) => (
            <PageCard key={p.page} seriesId={series.id} preview={p} onSaved={saved} onError={setError} />
          ))}
        </div>
      )}
    </div>
  );
}

// One page: its preview, where its picture comes from, and the controls for
// its picture and its wording. While the wording is being edited the preview
// follows the draft, so the admin sees the result before saving it.
function PageCard({ seriesId, preview, onSaved, onError }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const customText = !!(preview.ownTitle || preview.ownDescription);

  function startEdit() {
    setTitle(preview.ownTitle || "");
    setDescription(preview.ownDescription || "");
    setEditing(true);
  }

  async function save(body, message) {
    setBusy(true);
    try {
      await api.saveSeriesShareText(seriesId, preview.page, body);
      setEditing(false);
      onSaved(message);
    } catch (err) { onError(err.message); } finally { setBusy(false); }
  }

  const shown = editing
    ? { ...preview, title: title.trim() || preview.autoTitle, description: description.trim() || preview.autoDescription }
    : preview;

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-dark">{preview.label}</div>
          <div className="font-mono text-[11px] text-light">{preview.path}</div>
        </div>
        <div className="flex flex-wrap gap-1">
          {customText && <span className="pill bg-surface2 text-[10px] text-light">Own text</span>}
          <span className="pill bg-surface2 text-[10px] text-light">{SOURCE_LABEL[preview.imageSource]}</span>
        </div>
      </div>
      <DiscordEmbed preview={shown} />
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save({ title, description }, `Link text for ${preview.label} saved.`);
          }}
        >
          <label className="block space-y-1">
            <span className="flex justify-between text-xs font-semibold text-medium">
              <span>Title</span>
              <span className="font-normal text-light">{title.length}/{TITLE_MAX}</span>
            </span>
            <input className="input w-full" value={title} maxLength={TITLE_MAX} placeholder={preview.autoTitle}
              onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="flex justify-between text-xs font-semibold text-medium">
              <span>Description</span>
              <span className="font-normal text-light">{description.length}/{DESCRIPTION_MAX}</span>
            </span>
            <textarea className="input min-h-24 w-full" value={description} maxLength={DESCRIPTION_MAX}
              placeholder={preview.autoDescription} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <p className="text-xs text-light">
            Leave a field empty to use the automatic text (shown greyed out). This only changes the Discord preview;
            the page title and the Google snippet stay as they are.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>Save text</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" onClick={startEdit}>Edit text</button>
          {customText && (
            <button type="button" className="btn-secondary" disabled={busy}
              onClick={() => save({}, `Link text for ${preview.label} back to automatic.`)}>
              Automatic text
            </button>
          )}
          <PictureButtons seriesId={seriesId} page={preview.page} label={preview.label}
            url={preview.imageSource === "page" ? preview.image : null} onSaved={onSaved} onError={onError} />
        </div>
      )}
    </div>
  );
}

// A Discord link embed, drawn the way the desktop client draws one: the
// stripe in the page's theme colour, the site name, the title as a link, the
// description, and the large picture underneath. Always Discord's dark theme,
// whatever the admin's, since that is where the links are looked at.
function DiscordEmbed({ preview }) {
  return (
    <div className="rounded-md p-3" style={{ background: "#313338" }}>
      <div
        className="max-w-[432px] rounded border-l-4 p-3"
        style={{ background: "#2b2d31", borderLeftColor: preview.color }}
      >
        <div className="text-xs" style={{ color: "#dbdee1" }}>NABS Racing League</div>
        <div className="mt-1 text-sm font-semibold leading-snug" style={{ color: "#00a8fc" }}>{preview.title}</div>
        <div className="mt-1 text-[13px] leading-snug" style={{ color: "#dbdee1" }}>{preview.description}</div>
        <img src={preview.image} alt="" loading="lazy" className="mt-3 aspect-[1200/630] w-full rounded object-cover" />
      </div>
    </div>
  );
}

function PictureButtons({ seriesId, page, label, url, onSaved, onError }) {
  const ask = useAsk();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadSeriesShareImage(seriesId, file, page);
      onSaved(`Link picture for ${label} updated.`);
    } catch (err) { onError(err.message); } finally { setBusy(false); }
  }

  async function clear() {
    if (
      !(await ask({
        title: `Remove the link picture for ${label}?`,
        body: page ? "This page falls back to the series default picture." : "Pages without their own picture fall back to the NABS picture.",
        danger: true,
        confirmLabel: "Remove picture",
      }))
    )
      return;
    setBusy(true);
    try {
      await api.clearSeriesShareImage(seriesId, page);
      onSaved(`Link picture for ${label} reset.`);
    } catch (err) { onError(err.message); } finally { setBusy(false); }
  }

  return (
    <>
      <input aria-label={`Link picture for ${label}`} ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={pick} />
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
        {url ? "Replace picture" : page ? "Upload picture" : "Upload default picture"}
      </button>
      {url && (
        <button type="button" className="btn-secondary" disabled={busy} onClick={clear}>
          Remove picture
        </button>
      )}
    </>
  );
}
