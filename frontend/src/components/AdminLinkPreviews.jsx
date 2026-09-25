// ---------------------------------------------------------------------------
// Link previews: what a link into each page of the series looks like when it
// is pasted on Discord, and the pictures behind it.
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
          Each page of the series can have its own picture. A page without one uses the series default, and without
          that the NABS picture. Best at <span className="font-semibold text-medium">1200×630</span>, JPG or PNG.
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
            <div key={p.page} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-dark">{p.label}</div>
                  <div className="font-mono text-[11px] text-light">{p.path}</div>
                </div>
                <span className="pill bg-surface2 text-[10px] text-light">{SOURCE_LABEL[p.imageSource]}</span>
              </div>
              <DiscordEmbed preview={p} />
              <div className="flex flex-wrap items-center gap-3">
                <PictureButtons seriesId={series.id} page={p.page} label={p.label}
                  url={p.imageSource === "page" ? p.image : null} onSaved={saved} onError={setError} />
              </div>
            </div>
          ))}
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
      <button type="button" className="transition text-xs font-semibold text-link hover:underline" disabled={busy}
        onClick={() => fileRef.current?.click()}>
        {url ? "Replace picture" : page ? "Upload own picture" : "Upload default picture"}
      </button>
      {url && (
        <button type="button" className="text-xs font-semibold text-light transition hover:text-link" disabled={busy}
          onClick={clear}>
          Reset
        </button>
      )}
    </>
  );
}
