// ---------------------------------------------------------------------------
// The link-preview picture of the results page, drawn from the latest result.
//
// The league posts the results link in Discord after every round. Discord
// shows the page's og:image under the link, and that used to be the same
// league picture every week. Now the server paints one itself, in the look of
// the Home page's hero card: the round's photo and track, and the podium
// cards with medal colours and points, the same classification the results
// page shows (penalties applied).
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
import { raceKickoff } from "./raceKickoff.js";
import { readRaceHeroes } from "./raceHero.js";
import { readRacePhotos, racePhotoUrl } from "./racePhotos.js";
import { UPLOADS_DIR } from "./dataDirs.js";

const W = 1200;
const H = 630;
// Bump when the drawing itself changes, so every version string changes with
// it and Discord fetches the new look instead of the cached old one.
const DRAWING_REV = 3;

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

// A site address ("/api/uploads/…" or a static "/heroes/s8.jpg") as a picture,
// or null. Only files on this machine: the picture is drawn on request, and a
// stored address must not be able to make the server call anywhere it likes.
async function loadLocal(url) {
  if (typeof url !== "string" || !url.startsWith("/")) return null;
  const file = url.startsWith("/api/uploads/") ? uploadFile(url) : staticFile(url);
  if (!file) return null;
  try {
    const { loadImage } = await canvasModule();
    return await loadImage(readFileSync(file));
  } catch {
    return null;
  }
}

// The site's own faces (frontend/public/fonts), the latin-ext cut behind each
// so a driver called Ondřej keeps his ř. They are variable fonts: one file
// per family holds every weight, and the weight is picked with the wght axis
// (setFont below). A weight in the font string alone is ignored, and the text
// came out at the file's default weight.
const FACES = { Display: "archivo-900", Body: "inter-400", Mono: "jetbrains-mono-500" };
let fontsReady = false;
function registerFonts(GlobalFonts) {
  if (fontsReady) return;
  for (const [name, file] of Object.entries(FACES)) {
    for (const [cut, suffix] of [["latin", ""], ["latin-ext", "Ext"]]) {
      const p = staticFile(`fonts/${file}-${cut}.woff2`);
      if (p) GlobalFonts.registerFromPath(p, `Og${name}${suffix}`);
    }
  }
  fontsReady = true;
}
function setFont(ctx, face, weight, size) {
  ctx.font = `${size}px Og${face}, Og${face}Ext`;
  ctx.fontVariationSettings = `"wght" ${weight}`;
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
    return season ? { race, season, latest: false } : null;
  }
  const season = await resolveSeason(prisma, query?.season, { series: series.slug }).catch(() => null);
  if (!season || (await getPrivateSeasonIds(prisma)).has(season.id)) return null;
  const race = await latestRound(prisma, season.id);
  return race ? { race, season, latest: true } : null;
}

// "Friday, 2 October 2026" in league time, the way the Home hero dates a round.
const fullDate = (d) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(raceKickoff(d) || new Date(d));

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
  const { race, season, latest } = found;
  const detail = await raceDetailPayload(prisma, race);
  const top = (detail.results || [])
    .filter((r) => r.status === "FINISHED" && r.position != null)
    .sort((a, b) => a.position - b.position)
    .slice(0, 3);
  if (!top.length) return null;
  const countries = await readRaceCountries(prisma, [race.id]);
  const state = {
    series: {
      name: series.name,
      accent: themeColorOf(series),
      logoDarkUrl: series.logoDarkUrl || null,
    },
    season: seasonLabel(season),
    latest,
    race: {
      id: race.id,
      number: race.number,
      track: prettyTrack(race.track),
      country: countries.get(race.id) || staticCountryFor(race.track) || null,
      date: race.date ? fullDate(race.date) : null,
      scores: !race.isSpecialEvent,
    },
    podium: top.map((r) => {
      // A sub drives for the team they stood in for, as on the Home hero.
      const team = (r.isSub && r.subForTeam) || r.team || {};
      return {
        position: r.position,
        name: r.name,
        country: r.country || null,
        team: { name: team.name || "", color: team.color || null, logoUrl: team.logoUrl || null },
        points: r.points ?? null,
      };
    }),
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
// Drawing: the Home hero card (pages/Home.jsx), at link-preview size.
// ---------------------------------------------------------------------------

// The dark theme's tokens (frontend/src/index.css, tailwind.config.js).
const PAGE_BG = "#080d18";
const INK = [15, 23, 42];
const ink = (a) => `rgba(${INK[0]}, ${INK[1]}, ${INK[2]}, ${a})`;
const white = (a) => `rgba(255, 255, 255, ${a})`;
const MEDAL = ["#eab308", "#94a3b8", "#c2410c"];

function cover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// Text in a box no wider than `width`: the largest size down to `min`, and
// past that cut with an ellipsis, like the site's `truncate`.
function fitText(ctx, text, face, weight, max, min, width) {
  let size = max;
  for (; size > min; size -= 1) {
    setFont(ctx, face, weight, size);
    if (ctx.measureText(text).width <= width) return text;
  }
  setFont(ctx, face, weight, min);
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return t === text ? t : `${t}…`;
}

function drawFlag(ctx, img, x, y, h, r = 3) {
  const w = (img.width / img.height) * h;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
  return w;
}

const renderCache = new Map(); // race|version -> jpeg

export async function renderResultShareImage(state) {
  const key = `${state.race.id}|${state.version}`;
  if (renderCache.has(key)) return renderCache.get(key);
  const { createCanvas, GlobalFonts } = await canvasModule();
  registerFonts(GlobalFonts);

  const flagOf = (cc) => (cc ? loadLocal(`/flags/w80/${cc}.png`) : null);
  const [bg, mark, flag, ...rest] = await Promise.all([
    loadLocal(state.background).then((i) => i || loadLocal("/hero.jpg")),
    loadLocal(state.series.logoDarkUrl || "/logo-dark.png"),
    flagOf(state.race.country),
    ...state.podium.map((p) => flagOf(p.country)),
    ...state.podium.map((p) => loadLocal(p.team.logoUrl)),
  ]);
  const flags = rest.slice(0, state.podium.length);
  const logos = rest.slice(state.podium.length);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const accent = state.series.accent;
  ctx.textBaseline = "alphabetic";

  // The page around the card.
  ctx.fillStyle = PAGE_BG;
  ctx.fillRect(0, 0, W, H);

  // The hero card: rounded, the photo filling it, the site's two scrims over
  // it (bottom-left to top-right, then up from the bottom), and the hatching
  // fading in at the right edge.
  const C = { x: 24, y: 24, w: W - 48, h: H - 48, r: 36 };
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(C.x, C.y, C.w, C.h, C.r);
  ctx.clip();
  ctx.fillStyle = `rgb(${INK.join(",")})`;
  ctx.fillRect(C.x, C.y, C.w, C.h);
  if (bg) cover(ctx, bg, C.x, C.y, C.w, C.h);
  const tr = ctx.createLinearGradient(C.x, C.y + C.h, C.x + C.w, C.y);
  tr.addColorStop(0, ink(1));
  tr.addColorStop(0.5, ink(0.75));
  tr.addColorStop(1, ink(0));
  ctx.fillStyle = tr;
  ctx.fillRect(C.x, C.y, C.w, C.h);
  const up = ctx.createLinearGradient(0, C.y + C.h, 0, C.y);
  up.addColorStop(0, ink(0.95));
  up.addColorStop(0.5, ink(0));
  ctx.fillStyle = up;
  ctx.fillRect(C.x, C.y, C.w, C.h);

  const hatchW = Math.round(C.w * 0.18);
  const hatch = createCanvas(hatchW, C.h);
  const hc = hatch.getContext("2d");
  hc.strokeStyle = white(0.06);
  hc.lineWidth = 3;
  for (let i = -C.h; i < hatchW + C.h; i += 16) {
    hc.beginPath();
    hc.moveTo(i, 0);
    hc.lineTo(i + C.h, C.h);
    hc.stroke();
  }
  const fade = hc.createLinearGradient(hatchW, 0, 0, 0);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(0.35, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  hc.globalCompositeOperation = "destination-in";
  hc.fillStyle = fade;
  hc.fillRect(0, 0, hatchW, C.h);
  ctx.drawImage(hatch, C.x + C.w - hatchW, C.y);
  ctx.restore();
  ctx.strokeStyle = white(0.1);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(C.x + 1, C.y + 1, C.w - 2, C.h - 2, C.r - 1);
  ctx.stroke();

  const L = C.x + 56;
  const R = C.x + C.w - 56;

  // Top: the brand as the nav bar has it (mark, name, series under it), and
  // the season as the pill the site puts above the hero.
  const MARK = 52;
  const markY = C.y + 44;
  if (mark) {
    if (state.series.logoDarkUrl) {
      ctx.drawImage(mark, L, markY, MARK, MARK);
    } else {
      const off = createCanvas(MARK, MARK);
      const o = off.getContext("2d");
      o.drawImage(mark, 0, 0, MARK, MARK);
      o.globalCompositeOperation = "source-in";
      o.fillStyle = accent;
      o.fillRect(0, 0, MARK, MARK);
      ctx.drawImage(off, L, markY);
    }
  }
  ctx.fillStyle = "#ffffff";
  setFont(ctx, "Display", 800, 25);
  ctx.letterSpacing = "0px";
  ctx.fillText("NABS Racing League", L + MARK + 16, markY + 24);
  ctx.fillStyle = white(0.55);
  setFont(ctx, "Mono", 700, 14);
  ctx.letterSpacing = "1.5px";
  ctx.fillText(state.series.name.toUpperCase(), L + MARK + 17, markY + 46);

  if (state.season) {
    const label = state.season.toUpperCase();
    setFont(ctx, "Mono", 700, 16);
    ctx.letterSpacing = "2.5px";
    const tw = ctx.measureText(label).width;
    const pw = tw + 64;
    const ph = 40;
    const px = R - pw;
    const py = markY + 6;
    ctx.fillStyle = ink(0.6);
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, ph / 2);
    ctx.fill();
    ctx.strokeStyle = white(0.15);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(px + 24, py + ph / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, px + 40, py + ph / 2 + 6);
  }

  // Eyebrow: flag, "Latest race", a short rule, the round.
  let y = C.y + 268;
  let x = L;
  if (flag) x += drawFlag(ctx, flag, x, y - 21, 26) + 16;
  setFont(ctx, "Mono", 700, 19);
  ctx.letterSpacing = "3.8px";
  ctx.fillStyle = accent;
  const eyebrow = state.latest ? "LATEST RACE" : "RACE RESULT";
  ctx.fillText(eyebrow, x, y);
  x += ctx.measureText(eyebrow).width + 14;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(x, y - 7, 44, 2);
  ctx.globalAlpha = 1;
  x += 44 + 18;
  ctx.fillStyle = white(0.7);
  ctx.fillText(state.race.number != null ? `ROUND ${state.race.number}` : "SPECIAL EVENT", x, y);

  // The track, big, then the date in the site's mono line.
  y += 96;
  ctx.fillStyle = "#ffffff";
  ctx.letterSpacing = "-2.5px";
  const track = fitText(ctx, state.race.track.toUpperCase(), "Display", 900, 104, 56, R - L);
  ctx.fillText(track, L - 3, y);
  if (state.race.date) {
    y += 44;
    ctx.fillStyle = white(0.65);
    setFont(ctx, "Mono", 500, 20);
    ctx.letterSpacing = "1px";
    ctx.fillText(state.race.date.toUpperCase(), L, y);
  }

  // The podium cards: medal bar and tint, P1 in the medal colour, name and
  // flag over team logo and team, the round's points on the right.
  const gap = 14;
  const cw = (R - L - gap * 2) / 3;
  const ch = 92;
  const cy = C.y + C.h - 48 - ch;
  state.podium.forEach((p, i) => {
    const cx = L + i * (cw + gap);
    const medal = MEDAL[i] || MEDAL[2];
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cx, cy, cw, ch, 18);
    ctx.clip();
    ctx.fillStyle = white(0.07);
    ctx.fillRect(cx, cy, cw, ch);
    const tint = ctx.createLinearGradient(cx, 0, cx + cw * 0.55, 0);
    tint.addColorStop(0, `${medal}26`);
    tint.addColorStop(1, `${medal}00`);
    ctx.fillStyle = tint;
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = medal;
    ctx.fillRect(cx, cy, 6, ch);
    ctx.restore();
    ctx.strokeStyle = white(0.1);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx + 0.75, cy + 0.75, cw - 1.5, ch - 1.5, 17);
    ctx.stroke();

    const mid = cy + ch / 2;
    ctx.letterSpacing = "0px";
    ctx.fillStyle = medal;
    setFont(ctx, "Display", 900, 36);
    ctx.fillText(`P${p.position}`, cx + 24, mid + 13);
    const textX = cx + 24 + 62;

    // Points first, so the name knows how much room is left.
    let right = cx + cw - 22;
    if (state.race.scores && p.points != null) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffffff";
      setFont(ctx, "Display", 900, 30);
      ctx.fillText(String(p.points), right, mid + 4);
      const pw = Math.max(ctx.measureText(String(p.points)).width, 34);
      ctx.fillStyle = white(0.5);
      setFont(ctx, "Mono", 700, 11);
      ctx.letterSpacing = "2.2px";
      ctx.fillText("PTS", right + 2, mid + 24);
      ctx.letterSpacing = "0px";
      ctx.textAlign = "left";
      right -= pw + 24;
    }
    const room = right - textX;

    ctx.fillStyle = "#ffffff";
    const name = fitText(ctx, p.name, "Body", 700, 25, 17, room - (flags[i] ? 36 : 0));
    ctx.fillText(name, textX, mid - 5);
    if (flags[i]) drawFlag(ctx, flags[i], textX + ctx.measureText(name).width + 9, mid - 22, 16, 2);

    let teamX = textX;
    if (logos[i]) {
      const s = 22;
      const k = Math.min(s / logos[i].width, s / logos[i].height);
      const lw = logos[i].width * k;
      const lh = logos[i].height * k;
      ctx.drawImage(logos[i], teamX + (s - lw) / 2, mid + 8 + (s - lh) / 2, lw, lh);
      teamX += s + 8;
    } else if (p.team.color) {
      ctx.fillStyle = p.team.color;
      ctx.beginPath();
      ctx.arc(teamX + 6, mid + 19, 6, 0, Math.PI * 2);
      ctx.fill();
      teamX += 20;
    }
    ctx.fillStyle = white(0.6);
    ctx.fillText(fitText(ctx, p.team.name, "Body", 400, 18, 14, right - teamX), teamX, mid + 26);
  });

  const jpeg = await canvas.encode("jpeg", 90);
  renderCache.set(key, jpeg);
  if (renderCache.size > 30) renderCache.delete(renderCache.keys().next().value);
  return jpeg;
}
