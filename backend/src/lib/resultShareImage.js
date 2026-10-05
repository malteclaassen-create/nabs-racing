// ---------------------------------------------------------------------------
// The link-preview picture of the results page, drawn from the latest result.
//
// The league posts the results link in Discord after every round. Discord
// shows the page's og:image under the link, and that used to be the same
// league picture every week. Now the server paints one itself: the round's
// track, its photo, and the podium with times, the same classification the
// results page shows (penalties applied).
//
// Discord keeps a preview per ADDRESS for a while, both the page's and the
// picture's. So the picture's address carries a version that changes whenever
// what is drawn on it changes, and the results page writes the same version
// into the browser's address bar (?result=8-3fa2c), so the link people copy
// after a round, or after the stewards' penalties, is one Discord has never
// seen and has to fetch fresh. The site itself ignores the parameter and the
// canonical tag drops it (lib/seo.js).
//
// An admin's own uploaded picture for the results page (Site texts > Link
// previews) still wins over this one.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSeason, getPrivateSeasonIds } from "../services/seasonService.js";
import { raceDetailPayload } from "../services/raceDetailService.js";
import { resolveSeries } from "./series.js";
import { seasonLabel } from "./seo.js";
import { prettyTrack, themeColorOf, sharePageOf, resolveShareImage, pageShareImage } from "./pageMeta.js";
import { readParentIds } from "./sprintRaces.js";
import { readRaceCountries, staticCountryFor } from "./raceCountries.js";
import { readRaceHeroes } from "./raceHero.js";
import { readRacePhotos, racePhotoUrl } from "./racePhotos.js";
import { UPLOADS_DIR } from "./dataDirs.js";

const W = 1200;
const H = 630;
// Bump when the drawing itself changes, so every version string changes with
// it and Discord fetches the new look instead of the cached old one.
const DRAWING_REV = 1;

// The drawing library is a native module, loaded on first use: should it ever
// fail to load on a host, only this picture is lost (the page falls back to
// the uploaded or shipped one), not the whole server at start-up.
let canvasLib = null;
const canvasModule = async () => (canvasLib ||= await import("@napi-rs/canvas"));

const __dir = dirname(fileURLToPath(import.meta.url));
// The built site first (what production serves), then the source folder (a
// dev checkout that has never run the build).
const STATIC_DIRS = [join(__dir, "../../../frontend/dist"), join(__dir, "../../../frontend/public")];

function staticFile(urlPath) {
  const rel = normalize(String(urlPath).split("?")[0]).replace(/^[\\/]+/, "");
  if (!rel || rel.startsWith("..")) return null;
  for (const dir of STATIC_DIRS) {
    const p = join(dir, rel);
    if (p.startsWith(dir + sep) && existsSync(p)) return p;
  }
  return null;
}

function uploadFile(urlPath) {
  const rel = normalize(String(urlPath).split("?")[0].replace(/^\/api\/uploads\//, ""));
  if (!rel || rel.startsWith("..")) return null;
  const p = join(UPLOADS_DIR, rel);
  return p.startsWith(UPLOADS_DIR + sep) && existsSync(p) ? p : null;
}

// A site address ("/api/uploads/…" or a static "/heroes/s8.jpg") as a file on
// this machine, or null.
function localFileOf(url) {
  if (typeof url !== "string" || !url.startsWith("/")) return null;
  return url.startsWith("/api/uploads/") ? uploadFile(url) : staticFile(url);
}

// Driver photos are uploads or Discord avatars. Nothing else is fetched: the
// picture is drawn on request, and a stored address must not be able to make
// the server call anywhere it likes.
const REMOTE_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

async function loadAny(url) {
  if (!url) return null;
  try {
    const { loadImage } = await canvasModule();
    const file = localFileOf(url);
    if (file) return await loadImage(readFileSync(file));
    const u = new URL(url);
    if (u.protocol !== "https:" || !REMOTE_HOSTS.has(u.hostname)) return null;
    const res = await fetch(u, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

let fontsReady = false;
function registerFonts(GlobalFonts) {
  if (fontsReady) return;
  const faces = [
    ["fonts/archivo-900-latin.woff2", "OgDisplay"],
    ["fonts/archivo-800-latin.woff2", "OgLabel"],
    ["fonts/jetbrains-mono-700-latin.woff2", "OgMono"],
  ];
  for (const [file, family] of faces) {
    const p = staticFile(file);
    if (p) GlobalFonts.registerFromPath(p, family);
  }
  fontsReady = true;
}

// ---------------------------------------------------------------------------
// Which round, and what goes on the picture
// ---------------------------------------------------------------------------

async function seasonSeriesId(prisma, seasonId) {
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT "seriesId" FROM "Season" WHERE "id" = ?`, seasonId);
    return rows[0]?.seriesId ?? null;
  } catch {
    return null;
  }
}

// The championship round the results page opens on: the latest one with a
// result in. Sprint halves live on child rows and are skipped; the round is
// its feature race.
async function latestRound(prisma, seasonId) {
  const done = await prisma.race.findMany({
    where: { seasonId, isCompleted: true, isSpecialEvent: false, number: { not: null } },
    orderBy: [{ date: "desc" }, { number: "desc" }],
  });
  const children = await readParentIds(prisma, done.map((r) => r.id));
  for (const r of done) {
    if (children.has(r.id)) continue;
    if (await prisma.raceResult.count({ where: { raceId: r.id } })) return r;
  }
  return null;
}

// The round a results address is about, or null: ?race=<id> names one (any
// finished round of this series), otherwise the latest of the season shown
// (?season=<n>, else the active one). Private seasons never answer.
async function roundFor(prisma, series, query) {
  const raceId = typeof query?.race === "string" ? query.race.trim() : "";
  if (raceId) {
    const race = await prisma.race.findUnique({ where: { id: raceId } }).catch(() => null);
    if (!race?.isCompleted || !race.seasonId) return null;
    if ((await getPrivateSeasonIds(prisma)).has(race.seasonId)) return null;
    if ((await seasonSeriesId(prisma, race.seasonId)) !== series.id) return null;
    const season = await prisma.season.findUnique({ where: { id: race.seasonId } });
    return season ? { race, season } : null;
  }
  const season = await resolveSeason(prisma, query?.season, { series: series.slug }).catch(() => null);
  if (!season || (await getPrivateSeasonIds(prisma)).has(season.id)) return null;
  const race = await latestRound(prisma, season.id);
  return race ? { race, season } : null;
}

const adjustedMs = (r) => (r.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);

function fmtDuration(ms) {
  const total = Math.round(ms);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = String(total % 1000).padStart(3, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}.${milli}` : `${m}:${ss}.${milli}`;
}

function fmtGap(ms) {
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = String(total % 1000).padStart(3, "0");
  return m ? `+${m}:${String(s).padStart(2, "0")}.${milli}` : `+${s}.${milli}`;
}

// What stands at the right end of a podium row: the winner's race time, the
// others' gap to it (laps down when they were lapped), or the points when the
// round was scored from a sheet without times.
export function podiumTimes(rows) {
  const win = rows[0];
  const winMs = win ? adjustedMs(win) : null;
  return rows.map((r, i) => {
    const ms = adjustedMs(r);
    if (i === 0) return ms ? fmtDuration(ms) : r.points != null ? `${r.points} PTS` : "";
    if (win?.laps != null && r.laps != null && r.laps < win.laps) {
      const n = win.laps - r.laps;
      return `+${n} LAP${n > 1 ? "S" : ""}`;
    }
    if (ms && winMs) return fmtGap(ms - winMs);
    return r.points != null ? `${r.points} PTS` : "";
  });
}

async function backgroundFor(prisma, race, season) {
  const heroes = await readRaceHeroes(prisma, [race.id]);
  if (heroes.get(race.id)) return heroes.get(race.id);
  const photos = await readRacePhotos(prisma, race.id);
  if (photos[0]) return racePhotoUrl(photos[0].file);
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT "heroImageUrl" FROM "Season" WHERE "id" = ?`, season.id);
    if (rows[0]?.heroImageUrl) return rows[0].heroImageUrl;
  } catch {
    /* column missing pre-migration */
  }
  if (season.number != null && staticFile(`heroes/s${season.number}.jpg`)) return `/heroes/s${season.number}.jpg`;
  return "/hero.jpg";
}

// Everything the picture shows, plus the version string naming exactly that.
// Null when the address has no finished round with a classification.
export async function resultShareState(prisma, series, query = {}) {
  if (!series) return null;
  const found = await roundFor(prisma, series, query);
  if (!found) return null;
  const { race, season } = found;
  const detail = await raceDetailPayload(prisma, race);
  const top = (detail.results || [])
    .filter((r) => r.status === "FINISHED" && r.position != null)
    .sort((a, b) => a.position - b.position)
    .slice(0, 3);
  if (!top.length) return null;
  const times = podiumTimes(top);
  const countries = await readRaceCountries(prisma, [race.id]);
  const state = {
    series: {
      name: series.name,
      accent: themeColorOf(series),
      logoDarkUrl: series.logoDarkUrl || null,
    },
    season: seasonLabel(season),
    race: {
      id: race.id,
      number: race.number,
      track: prettyTrack(race.track),
      country: countries.get(race.id) || staticCountryFor(race.track) || null,
      laps: top[0].laps ?? null,
    },
    podium: top.map((r, i) => ({
      position: r.position,
      name: r.name,
      team: (r.effectiveTeam || r.team)?.name || "",
      color: (r.effectiveTeam || r.team)?.color || "#888888",
      photoUrl: r.photoUrl || null,
      time: times[i],
    })),
    background: await backgroundFor(prisma, race, season),
  };
  const hash = createHash("sha1").update(JSON.stringify([DRAWING_REV, state])).digest("hex").slice(0, 5);
  state.version = `${race.number ?? "x"}-${hash}`;
  return state;
}

// A few seconds of memory, because every page load of the results page asks
// (the server writes the picture's address into the HTML it sends). Short
// enough that a link copied right after an import already carries the new
// version.
const STATE_TTL_MS = 10 * 1000;
const stateCache = new Map(); // key -> { at, state }

export async function cachedResultShareState(prisma, series, query = {}) {
  const key = `${series?.id}|${query?.race || ""}|${query?.season || ""}`;
  const hit = stateCache.get(key);
  if (hit && Date.now() - hit.at < STATE_TTL_MS) return hit.state;
  const state = await resultShareState(prisma, series, query);
  stateCache.set(key, { at: Date.now(), state });
  if (stateCache.size > 200) stateCache.delete(stateCache.keys().next().value);
  return state;
}

// The picture's address (site-relative) for a state.
export function resultShareImagePath(series, state) {
  const q = new URLSearchParams({ series: series.slug, race: state.race.id, v: state.version });
  return `/api/share/result.jpg?${q}`;
}

// The og:image of any address: the results page's own drawing when the page
// is the results page and no picture was uploaded for it, else whatever
// lib/pageMeta.js picks (own upload, series default, the shipped one).
export async function shareImageFor(prisma, pathname, query, origin) {
  try {
    if (sharePageOf(pathname) === "races" && origin) {
      const slug = decodeURIComponent(String(pathname).split("/").filter(Boolean)[1] || "");
      const series = await resolveSeries(prisma, slug, { includePrivate: false });
      if (series && resolveShareImage(series, "races").source !== "page") {
        const state = await cachedResultShareState(prisma, series, query);
        if (state) return `${origin}${resultShareImagePath(series, state)}`;
      }
    }
  } catch {
    /* fall through to the uploaded or shipped picture */
  }
  return pageShareImage(prisma, pathname, origin);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function fit(ctx, text, family, max, min, width) {
  let size = max;
  for (; size > min; size -= 2) {
    ctx.font = `${size}px ${family}`;
    if (ctx.measureText(text).width <= width) break;
  }
  return size;
}

function cover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function initials(name) {
  return String(name || "?").trim().slice(0, 2).toUpperCase();
}

const renderCache = new Map(); // version|host -> jpeg

export async function renderResultShareImage(state, { host } = {}) {
  const key = `${state.race.id}|${state.version}|${host || ""}`;
  if (renderCache.has(key)) return renderCache.get(key);
  const { createCanvas, GlobalFonts } = await canvasModule();
  registerFonts(GlobalFonts);

  const [bg, mark, flag, ...faces] = await Promise.all([
    loadAny(state.background).then((i) => i || loadAny("/hero.jpg")),
    loadAny(state.series.logoDarkUrl || "/logo-dark.png"),
    state.race.country ? loadAny(`/flags/w80/${state.race.country}.png`) : null,
    ...state.podium.map((p) => loadAny(p.photoUrl)),
  ]);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const accent = state.series.accent;
  const MUTE = "#b8c4dd";
  const DIM = "#8f9bb8";

  // The photo, darkened so the words read on any of it, darker on the left
  // where the words are.
  ctx.fillStyle = "#0c0e18";
  ctx.fillRect(0, 0, W, H);
  if (bg) {
    cover(ctx, bg, 0, 0, W, H);
    ctx.fillStyle = "rgba(12, 14, 24, 0.55)";
    ctx.fillRect(0, 0, W, H);
  }
  const shade = ctx.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, "rgba(12, 14, 24, 0.85)");
  shade.addColorStop(0.55, "rgba(12, 14, 24, 0.45)");
  shade.addColorStop(1, "rgba(12, 14, 24, 0.15)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 12, H);

  // The mark: the series' own logo as it is, or the NABS mark in its colour.
  const MARK = 76;
  if (mark) {
    if (state.series.logoDarkUrl) {
      ctx.drawImage(mark, 62, 46, MARK, MARK);
    } else {
      const off = createCanvas(MARK, MARK);
      const o = off.getContext("2d");
      o.drawImage(mark, 0, 0, MARK, MARK);
      o.globalCompositeOperation = "source-in";
      o.fillStyle = accent;
      o.fillRect(0, 0, MARK, MARK);
      ctx.drawImage(off, 62, 46);
    }
  }
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  const series = state.series.name.toUpperCase();
  ctx.font = "25px OgDisplay";
  ctx.fillText(series, 160, 85);
  const sw = ctx.measureText(series).width;
  if (state.season) {
    ctx.fillStyle = MUTE;
    ctx.font = "25px OgLabel";
    ctx.fillText(`  ·  ${state.season.toUpperCase()}`, 160 + sw, 85);
  }
  if (host) {
    ctx.fillStyle = DIM;
    ctx.font = "21px OgMono";
    ctx.textAlign = "right";
    ctx.fillText(host, W - 58, 85);
    ctx.textAlign = "left";
  }

  // The track, with its flag.
  ctx.textBaseline = "alphabetic";
  let x = 72;
  if (flag) {
    const fh = 52;
    const fw = (flag.width / flag.height) * fh;
    ctx.save();
    roundRect(ctx, x, 186, fw, fh, 4);
    ctx.clip();
    ctx.drawImage(flag, x, 186, fw, fh);
    ctx.restore();
    x += fw + 22;
  }
  const track = state.race.track.toUpperCase();
  fit(ctx, track, "OgDisplay", 92, 48, W - 60 - x);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(track, x, 246);

  const label = [
    state.race.number != null ? `ROUND ${state.race.number}` : "SPECIAL EVENT",
    "RESULT",
    state.race.laps ? `${state.race.laps} LAPS` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  ctx.fillStyle = accent;
  ctx.font = "24px OgLabel";
  ctx.fillText(label, 74, 292);

  // The podium, one row per car.
  const top = 318;
  const rowH = 86;
  state.podium.forEach((p, i) => {
    const y = top + i * (rowH + 10);
    ctx.fillStyle = "rgba(12, 14, 24, 0.68)";
    ctx.fillRect(72, y, W - 132, rowH);
    ctx.fillStyle = p.color;
    ctx.fillRect(72, y, 6, rowH);

    ctx.textBaseline = "middle";
    ctx.fillStyle = i === 0 ? accent : "#ffffff";
    ctx.font = "52px OgDisplay";
    ctx.textAlign = "center";
    ctx.fillText(String(p.position), 122, y + rowH / 2 + 2);
    ctx.textAlign = "left";

    // The face in a ring of the team's colour, or the initials when there is
    // no picture (or it could not be fetched in time).
    const cx = 196;
    const cy = y + rowH / 2;
    const r = 31;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (faces[i]) {
      cover(ctx, faces[i], cx - r, cy - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = "#2a2f40";
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = "#ffffff";
      ctx.font = "24px OgDisplay";
      ctx.textAlign = "center";
      ctx.fillText(initials(p.name), cx, cy + 1);
      ctx.textAlign = "left";
    }
    ctx.restore();
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
    ctx.stroke();

    // Time first, so the name knows how much room is left.
    ctx.font = "30px OgMono";
    const tw = ctx.measureText(p.time).width;
    ctx.fillStyle = i === 0 ? "#ffffff" : MUTE;
    ctx.textAlign = "right";
    ctx.fillText(p.time, W - 86, cy + 1);
    ctx.textAlign = "left";

    const nameX = 248;
    const room = W - 86 - tw - 30 - nameX;
    ctx.fillStyle = "#ffffff";
    fit(ctx, p.name, "OgDisplay", 34, 20, room);
    ctx.fillText(p.name, nameX, cy - 10);
    ctx.fillStyle = DIM;
    ctx.font = "17px OgLabel";
    ctx.fillText(p.team.toUpperCase(), nameX, cy + 22);
  });

  const jpeg = await canvas.encode("jpeg", 88);
  renderCache.set(key, jpeg);
  if (renderCache.size > 30) renderCache.delete(renderCache.keys().next().value);
  return jpeg;
}
