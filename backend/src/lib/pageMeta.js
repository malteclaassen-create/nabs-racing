// ---------------------------------------------------------------------------
// Per-page link previews.
//
// The league lives on Discord, so most traffic arrives as a pasted link. Every
// one of those used to unfurl into the same generic card, because index.html
// carries one fixed set of og: tags and Discord's unfurler does not run the
// JavaScript that would fill in the real page.
//
// So the server fills them in instead: for the handful of routes worth sharing
// it looks up the entity and rewrites the tags in the HTML it is about to send.
// Everything else falls through to the static tags unchanged.
// ---------------------------------------------------------------------------
import { getDriverStandings } from "../services/standingsService.js";
import { resolveSeasonId } from "../services/seasonService.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { resolveSeries } from "../lib/series.js";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const ordinal = (n) => `P${n}`;

// /s/<series>/drivers/<id>
async function driverMeta(prisma, seriesSlug, driverId) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { team: true, season: { select: { id: true, number: true } } },
  });
  if (!driver) return null;
  // Never let a private (unpublished) season leak through a link preview.
  const priv = await getPrivateSeasonIds(prisma).catch(() => new Set());
  if (driver.seasonId && priv.has(driver.seasonId)) return null;

  let line = driver.team?.name || "";
  try {
    const standings = await getDriverStandings(prisma, driver.seasonId);
    const row = (standings?.standings || []).find((s) => s.driverId === driver.id);
    if (row) {
      const parts = [ordinal(row.position), `${row.total} pts`];
      if (driver.team?.name) parts.push(driver.team.name);
      line = parts.join(" · ");
    }
  } catch {
    /* standings unavailable -> fall back to the team name alone */
  }
  const season = driver.season?.number ? `Season ${driver.season.number}` : "NABS Racing League";
  return {
    title: `${driver.name} · ${season}`,
    description: line ? `${line}. Full record, form and head-to-head on the NABS Racing League site.` : undefined,
  };
}

// /s/<series>/constructors/<id> (also /teams/<id>)
async function teamMeta(prisma, teamId) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { season: { select: { number: true } }, drivers: { select: { name: true } } },
  });
  if (!team) return null;
  const priv = await getPrivateSeasonIds(prisma).catch(() => new Set());
  if (team.seasonId && priv.has(team.seasonId)) return null;
  const lineUp = team.drivers.map((d) => d.name).join(" and ");
  const season = team.season?.number ? `Season ${team.season.number}` : "NABS Racing League";
  return {
    title: `${team.name} · ${season}`,
    description: lineUp ? `Line-up: ${lineUp}. Standings, round-by-round points and team history.` : undefined,
  };
}

// /s/<series> — the season landing page.
async function seasonMeta(prisma, seriesSlug) {
  const series = await resolveSeries(prisma, seriesSlug, { includePrivate: false }).catch(() => null);
  if (!series) return null;
  const seasonId = await resolveSeasonId(prisma, undefined, { series: seriesSlug }).catch(() => null);
  if (!seasonId) return { title: `${series.name} · NABS Racing League` };
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { number: true, name: true, game: true },
  });
  let leader = null;
  try {
    const standings = await getDriverStandings(prisma, seasonId);
    leader = (standings?.standings || [])[0] || null;
  } catch {
    /* ignore */
  }
  const label = season?.name || (season?.number ? `Season ${season.number}` : series.name);
  return {
    title: `${label} · ${series.name}`,
    description: leader
      ? `${leader.name} leads on ${leader.total} points${season?.game ? ` · ${season.game}` : ""}. Standings, results and live timing.`
      : undefined,
  };
}

// Returns { title, description } for a shareable route, or null.
export async function buildPageMeta(prisma, pathname) {
  try {
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] !== "s" || !parts[1]) return null;
    const [, seriesSlug, section, id] = parts;
    if (!section) return await seasonMeta(prisma, seriesSlug);
    if (id && section === "drivers") return await driverMeta(prisma, seriesSlug, id);
    if (id && (section === "constructors" || section === "teams")) return await teamMeta(prisma, id);
    return null;
  } catch {
    // A preview is never worth failing a page load over.
    return null;
  }
}

// Rewrites the title and the og:/twitter: description+title tags in the shipped
// index.html. Replaces rather than appends, because an unfurler takes the first
// matching tag it sees.
export function applyPageMeta(html, meta) {
  if (!meta) return html;
  let out = html;
  if (meta.title) {
    const t = esc(meta.title);
    out = out
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
      .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`)
      .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`);
  }
  if (meta.description) {
    const d = esc(meta.description);
    out = out
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${d}$2`)
      .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`)
      .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${d}$2`);
  }
  return out;
}
