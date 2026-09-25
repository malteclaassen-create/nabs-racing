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
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeries } from "../context/SeriesContext.jsx";
import { CardHead, Skeleton } from "./ui.jsx";
import { useAsk, Modal } from "./overlay.jsx";
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
          Messages already posted on Discord keep their old preview. After a change, use{" "}
          <span className="font-semibold text-medium">Copy fresh link</span>: Discord caches previews per link, and
          the fresh one shows the current preview right away.
        </p>
        {data?.series && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <span className="text-sm font-semibold text-dark">Series default (all pages)</span>
            <SharePictureGenerator series={series} onSaved={saved} onError={setError} />
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
          <CopyFreshLink path={preview.path} />
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

// Copies the page's link with a fresh ?v=<stamp> on it. Discord caches a
// link's preview per URL, so after a change the plain link can keep showing
// the old one for hours; a URL it has never seen is fetched right away. The
// site ignores the parameter (and the canonical tag drops it, lib/seo.js),
// so the page opens exactly as without it.
function CopyFreshLink({ path }) {
  const [state, setState] = useState(null); // null | "copied" | "failed"
  async function copy() {
    const url = `${window.location.origin}${path}?v=${Math.floor(Date.now() / 1000).toString(36)}`;
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      // No clipboard (insecure context, denied permission): show the link so
      // it can still be copied by hand.
      window.prompt("Copy this link:", url);
      setState(null);
      return;
    }
    setTimeout(() => setState(null), 2000);
  }
  return (
    <button type="button" className="btn-primary" onClick={copy}
      title="Copies the link with a new ?v= so Discord shows the current preview right away">
      {state === "copied" ? "Copied!" : "Copy fresh link"}
    </button>
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

// ---------------------------------------------------------------------------
// The series' own default picture, drawn in the browser.
//
// The shipped og-image.jpg has the NABS pink baked in (the stripe, the mark,
// "LEAGUE"), which looks wrong under a series in another colour. This draws
// the same layout on a canvas in the series' colours instead: the race photo
// (or one of the admin's own), the series' logo (or the NABS mark tinted in
// its colour), and its name, then uploads the result as the series default.
// Drawn here rather than on the server because the site's fonts are already
// loaded in the page, and the admin sees exactly what gets saved.
// ---------------------------------------------------------------------------
const OG_W = 1200;
const OG_H = 630;
const DEFAULT_PINK = "#f4afc6";

function defaultLines(series) {
  const name = String(series?.name || "").trim();
  const rest = name.replace(/^nabs\s+racing\s*/i, "").trim();
  return {
    line1: "NABS RACING",
    line2: (rest || "League").toUpperCase(),
    sub1: "COMMUNITY SIM RACING · ASSETTO CORSA",
    sub2: "RESULTS · STANDINGS · LIVE TIMING",
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

// The largest font size (up to `max`) at which `text` fits `width`.
function fitFont(ctx, text, weight, max, width) {
  let size = max;
  for (; size > 24; size -= 2) {
    ctx.font = `${weight} ${size}px Archivo, Inter, sans-serif`;
    if (ctx.measureText(text).width <= width) break;
  }
  return size;
}

async function drawSharePicture(canvas, { background, logo, tintLogo, color, line1, line2, sub1, sub2 }) {
  await Promise.all([
    document.fonts?.load("900 100px Archivo"),
    document.fonts?.load("800 30px Archivo"),
  ]).catch(() => {});
  const [bg, mark] = await Promise.all([loadImage(background), loadImage(logo)]);
  const ctx = canvas.getContext("2d");
  canvas.width = OG_W;
  canvas.height = OG_H;

  // The photo, cropped to fill, darkened so the words read on any of it.
  const scale = Math.max(OG_W / bg.width, OG_H / bg.height);
  const bw = bg.width * scale;
  const bh = bg.height * scale;
  ctx.drawImage(bg, (OG_W - bw) / 2, (OG_H - bh) / 2, bw, bh);
  ctx.fillStyle = "rgba(12, 14, 24, 0.62)";
  ctx.fillRect(0, 0, OG_W, OG_H);
  const shade = ctx.createLinearGradient(0, 0, OG_W * 0.75, 0);
  shade.addColorStop(0, "rgba(12, 14, 24, 0.55)");
  shade.addColorStop(1, "rgba(12, 14, 24, 0)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, OG_W, OG_H);

  // The stripe down the left edge.
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 12, OG_H);

  // The mark: the series' own logo as it is, or the NABS mark in its colour.
  const size = 130;
  if (tintLogo) {
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const o = off.getContext("2d");
    o.drawImage(mark, 0, 0, size, size);
    o.globalCompositeOperation = "source-in";
    o.fillStyle = color;
    o.fillRect(0, 0, size, size);
    ctx.drawImage(off, 62, 60);
  } else {
    ctx.drawImage(mark, 62, 60, size, size);
  }

  const left = 72;
  const width = OG_W - left - 70;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  fitFont(ctx, line1, 900, 104, width);
  ctx.fillText(line1, left, 345);
  ctx.fillStyle = color;
  fitFont(ctx, line2, 900, 104, width);
  ctx.fillText(line2, left, 450);
  ctx.fillStyle = "#ffffff";
  fitFont(ctx, sub1, 800, 32, width);
  ctx.fillText(sub1, left, 528);
  ctx.fillStyle = "#b8c4dd";
  fitFont(ctx, sub2, 800, 27, width);
  ctx.fillText(sub2, left, 572);
}

function SharePictureGenerator({ series, onSaved, onError }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(() => defaultLines(series));
  const [color, setColor] = useState(series.accentColor || DEFAULT_PINK);
  const [background, setBackground] = useState("/hero.jpg");
  const [busy, setBusy] = useState(false);
  const [drawError, setDrawError] = useState(null);
  // State, not a ref: the modal mounts its content after `open` flips, so the
  // canvas appears a render later and the drawing effect has to rerun then.
  const [canvas, setCanvas] = useState(null);
  const bgFileRef = useRef(null);

  function start() {
    setFields(defaultLines(series));
    setColor(series.accentColor || DEFAULT_PINK);
    setBackground("/hero.jpg");
    setOpen(true);
  }

  // Redraw on every change; the canvas IS the preview.
  useEffect(() => {
    if (!open || !canvas) return;
    let live = true;
    drawSharePicture(canvas, {
      ...fields,
      background,
      color,
      logo: series.logoDarkUrl || "/logo-dark.png",
      tintLogo: !series.logoDarkUrl,
    })
      .then(() => live && setDrawError(null))
      .catch((e) => live && setDrawError(e.message));
    return () => { live = false; };
  }, [open, canvas, fields, background, color, series.logoDarkUrl]);

  // A picked background lives as an object URL until it is replaced.
  useEffect(() => () => { if (background.startsWith("blob:")) URL.revokeObjectURL(background); }, [background]);

  function pickBackground(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setBackground(URL.createObjectURL(file));
  }

  async function save() {
    setBusy(true);
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("Could not create the picture");
      const file = new File([blob], `${series.slug}-share.jpg`, { type: "image/jpeg" });
      await api.uploadSeriesShareImage(series.id, file, "");
      setOpen(false);
      onSaved(`New default link picture for ${series.name} saved.`);
    } catch (err) { onError(err.message); } finally { setBusy(false); }
  }

  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <button type="button" className="btn-primary" onClick={start}
        title="Draws a picture in this series' colour, logo and name">
        Generate in series colours
      </button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title={`Link picture for ${series.name}`} size="xl"
        description="Drawn in the series' colour and logo. Change anything below; the preview follows."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={busy || !!drawError} onClick={save}>
              {busy ? "Saving…" : "Use as default for all pages"}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <canvas ref={setCanvas} width={OG_W} height={OG_H} className="aspect-[1200/630] w-full rounded-lg border border-border" />
          {drawError && <p className="text-sm text-red-500">{drawError}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-medium">First line (white)</span>
              <input className="input w-full" value={fields.line1} onChange={set("line1")} maxLength={40} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-medium">Second line (series colour)</span>
              <input className="input w-full" value={fields.line2} onChange={set("line2")} maxLength={40} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-medium">Small line</span>
              <input className="input w-full" value={fields.sub1} onChange={set("sub1")} maxLength={80} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-medium">Small line (grey)</span>
              <input className="input w-full" value={fields.sub2} onChange={set("sub2")} maxLength={80} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-medium">
              Colour
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                className="h-8 w-10 cursor-pointer rounded-lg border border-border bg-transparent" />
            </label>
            <input aria-label="Background photo" ref={bgFileRef} type="file" accept="image/png,image/jpeg,image/webp"
              className="hidden" onChange={pickBackground} />
            <button type="button" className="btn-secondary" onClick={() => bgFileRef.current?.click()}>Own background photo</button>
            {background !== "/hero.jpg" && (
              <button type="button" className="btn-secondary" onClick={() => setBackground("/hero.jpg")}>Default photo</button>
            )}
            <span className="text-xs text-light">
              {series.logoDarkUrl ? "Uses the series logo." : "Uses the NABS mark in the series colour (no series logo uploaded)."}
            </span>
          </div>
        </div>
      </Modal>
    </>
  );
}
