// Self-service endpoints for the logged-in (Discord) driver. Identity comes
// from the user JWT (optionalUser -> req.user), but the ACTING driver is
// re-resolved from the DB on every request (resolveDriverId) so an admin
// unlink/relink in the Members tab takes effect immediately — the driverId
// baked into the 30-day token is only a login-time snapshot.
import { Router } from "express";
import multer from "multer";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import prisma from "../lib/prisma.js";
import { optionalUser, resolveDriverId } from "../middleware/auth.js";
import { safeUploadPath } from "../lib/safeUpload.js";
import { getLinkedDriverIds, ownCurrentRowIds, ownLeagueRows, ownAllRowIds } from "../lib/persons.js";
import { dbListSeries, seasonSeriesMap } from "../lib/series.js";
import { parseSocials, serializeSocials } from "../lib/socials.js";
import { DEFAULT_PROFILE_TILES, PROFILE_TILE_KEYS, readProfileTiles } from "../lib/profileTiles.js";
import { parseCardPhotoPos, readCardPhotoPos } from "../lib/cardPhoto.js";
import { readDriverRoles } from "../lib/driverRoles.js";
import {
  unlockStateFor, isKnownEdition, readCardEdition, readCardAnim, DEFAULT_CARD_EDITION,
} from "../lib/cardEditions.js";
import { cardUnlockInputs } from "../services/driverProfileService.js";
import { ownedDesigns } from "../lib/cardShop.js";
import { notifyCardUnlocks, notifyAdminsRaceRequest } from "../lib/notifications.js";
import { dbGetMember, dbSetRaceRequest } from "../lib/members.js";
import { getDriverRatingHistory, getDriverCareerRatings } from "../services/ratingHistoryService.js";
import { getCardRating } from "../services/cardRatingService.js";
import { previewAccountDeletion, deleteMemberAccount } from "../services/accountDeletionService.js";
import { recapVisibleTo, pendingRecapRace, buildRaceRecap, markRecapSeen } from "../lib/raceRecap.js";
import { UPLOADS_DIR } from "../lib/dataDirs.js";

const router = Router();
router.use(optionalUser);

// Uploaded profile pictures are written under backend/uploads/avatars and served
// by Express at /api/uploads/... (see src/index.js). They go through the API
// path on purpose: the shared preview build (vite preview, port 4173) only
// serves dist/, so anything written into frontend/public at runtime wouldn't
// show until a rebuild — but /api/* is proxied to the backend in both dev and
// preview, so /api/uploads serves freshly uploaded avatars live over the tunnel.
const AVATAR_DIR = join(UPLOADS_DIR, "avatars");
// A separate folder for the optional card-only picture, so it never collides
// with the profile avatar of the same driver.
const CARD_DIR = join(UPLOADS_DIR, "cards");
const IMG_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// The card-only picture lives in a raw-SQL column (cardPhotoUrl), so read it
// straight from the DB — the generated client predates the column.
async function readCardPhotoUrl(prisma, driverId) {
  try {
    const rows = await prisma.$queryRaw`SELECT "cardPhotoUrl" FROM "Driver" WHERE "id" = ${driverId}`;
    return rows[0]?.cardPhotoUrl || null;
  } catch {
    return null;
  }
}

// Resolve the logged-in driver id (fresh from the DB) or send a 401.
// The member's own Steam link for GET /api/me. Reads the raw columns
// defensively: schema upkeep runs fire-and-forget at boot, so a brand-new
// database can answer a request before the columns exist.
async function steamStateFor(discordId) {
  if (!discordId) return { linked: false, id: null, verifiedAt: null };
  const acct = await dbGetMember(prisma, discordId).catch(() => null);
  return {
    linked: !!acct?.steamId,
    id: acct?.steamId || null,
    verifiedAt: acct?.steamVerifiedAt || null,
  };
}

// Run `write(ids)` over the OTHER rows a self-service edit applies to: the
// person's current-season rows in every series and their draft rows (see
// lib/persons.js ownCurrentRowIds). The acting row is written by the caller
// already; this never fails the request — the own-row write is the one that
// must land, the fan-out is best effort.
async function applyToOwnRows(actingId, discordId, write) {
  try {
    const ids = (await ownCurrentRowIds(prisma, actingId, discordId)).filter((id) => id !== actingId);
    if (ids.length) await write(ids);
  } catch (e) {
    console.error("profile fan-out skipped:", e.message);
  }
}

// Run `write(ids)` over EVERY other row of the person, archive ones included
// (lib/persons.js ownAllRowIds) — for a preference no season can own. Same
// best-effort contract as applyToOwnRows above.
async function applyToAllOwnRows(actingId, discordId, write) {
  try {
    const ids = (await ownAllRowIds(prisma, actingId, discordId)).filter((id) => id !== actingId);
    if (ids.length) await write(ids);
  } catch (e) {
    console.error("preference fan-out skipped:", e.message);
  }
}

// Which row(s) a self-service edit targets. By default the edit is the
// PERSON's: it lands on the acting row and fans out to their row in every
// other league (applyToOwnRows). A member who wants one league's profile to
// differ sends `driverId` (one of their own rows, checked by resolveOwnRow):
// then that row alone is written and nothing fans out. Returns
// { driverId, fanOut } or null after sending the 403.
async function editTarget(req, res, actingId, wantedId) {
  if (!wantedId) return { driverId: actingId, fanOut: true };
  const driverId = await resolveOwnRow(req, res, actingId, wantedId);
  if (!driverId) return null;
  return { driverId, fanOut: false };
}

// Returns null when not allowed.
async function requireDriver(req, res) {
  const driverId = await resolveDriverId(prisma, req.user);
  if (!driverId) {
    res.status(401).json({ error: "Sign in with Discord first" });
    return null;
  }
  return driverId;
}

// GET /api/me -> the logged-in driver's own profile (or an "unlinked" marker).
router.get("/", async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Sign in with Discord first" });
    // Logged in via Discord but not (or no longer) matched to a roster driver.
    const driverId = await resolveDriverId(prisma, req.user);
    // The member's own Steam link, so the profile can show it and offer to
    // change it. Their own id only; nobody else's ever leaves the server here.
    const steam = await steamStateFor(req.user.discordId);
    if (!driverId) {
      return res.json({ isLinked: false, discordName: req.user.discordName || null, steam });
    }
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { team: true, season: { select: { number: true } } },
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    res.json({
      isLinked: true,
      steam,
      driverId: driver.id,
      // The row's own season — the rating card must label itself with THIS
      // season, not whichever one the site's switcher happens to be on.
      seasonNumber: driver.season?.number ?? null,
      name: driver.name,
      discordName: driver.discordName,
      country: driver.country || "",
      bio: driver.bio || "",
      number: driver.number ?? null,
      socials: parseSocials(driver.socials),
      tier: driver.tier,
      // Special league role ('safety' = safety car driver) — drives the
      // SAFETY CAR rating card variant on the profile page.
      role: (await readDriverRoles(prisma, [driver.id])).get(driver.id) || null,
      // Custom upload wins over the Discord avatar; hasCustomPhoto drives the
      // "reset to Discord picture" button on the profile page.
      photoUrl: driver.photoUrl || driver.discordAvatar || null,
      hasCustomPhoto: !!driver.photoUrl,
      // Optional card-only picture (null = the card uses the profile photo).
      cardPhotoUrl: await readCardPhotoUrl(prisma, driver.id),
      // Which public-profile stat tiles are shown; null = all (the default).
      profileTiles: await readProfileTiles(prisma, driver.id),
      // How the picture sits on the rating card; null = default framing.
      photoPos: await readCardPhotoPos(prisma, driver.id),
      // The chosen unlockable card edition for this row; null = classic.
      cardStyle: await readCardEdition(prisma, driver.id),
      // Card animation switch; "off" = a still card, null = baseline motion.
      cardAnim: await readCardAnim(prisma, driver.id),
      team: {
        id: driver.team.id,
        name: driver.team.name,
        color: driver.team.color,
        logoUrl: driver.team.logoUrl,
        tier: driver.team.tier,
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/me/leagues -> the person's profile row in each league they race in
// (one per series, the login's own league first), with that row's editable
// fields, so the profile page can offer "edit this league on its own". A
// single entry means the person races in one league only.
router.get("/leagues", async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const [leagueRows, series] = await Promise.all([
      ownLeagueRows(prisma, actingId, req.user?.discordId),
      dbListSeries(prisma),
    ]);
    const seriesById = new Map(series.map((s) => [s.id, s]));
    const ids = leagueRows.map((r) => r.id);
    const drivers = await prisma.driver.findMany({
      where: { id: { in: ids } },
      include: { team: true, season: { select: { number: true, name: true } } },
    });
    const byId = new Map(drivers.map((d) => [d.id, d]));
    const leagues = [];
    for (const r of leagueRows) {
      const d = byId.get(r.id);
      const s = r.seriesId ? seriesById.get(r.seriesId) : null;
      // A private series is not a league the member can be shown editing.
      if (!d || (r.seriesId && !s)) continue;
      leagues.push({
        driverId: d.id,
        isActing: d.id === actingId,
        seriesId: r.seriesId,
        seriesName: s?.name || null,
        seriesSlug: s?.slug || null,
        seasonNumber: d.season?.number ?? null,
        seasonName: d.season?.name ?? null,
        name: d.name,
        country: d.country || "",
        bio: d.bio || "",
        number: d.number ?? null,
        socials: parseSocials(d.socials),
        photoUrl: d.photoUrl || d.discordAvatar || null,
        hasCustomPhoto: !!d.photoUrl,
        profileTiles: await readProfileTiles(prisma, d.id),
        team: d.team
          ? { id: d.team.id, name: d.team.name, color: d.team.color, logoUrl: d.team.logoUrl, tier: d.team.tier }
          : null,
      });
    }
    res.json({ leagues });
  } catch (e) {
    next(e);
  }
});

// PUT /api/me/profile { name?, bio?, number?, socials?, driverId? } -> edit own
// display fields. `name` is the driver's display name shown across the whole
// site; `socials` is a { platform: url } object (see lib/socials.js).
// `driverId` = edit that one league's row only (see editTarget).
router.put("/profile", async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const target = await editTarget(req, res, actingId, req.body?.driverId);
    if (!target) return;
    const { driverId, fanOut } = target;
    const data = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (name.length < 1 || name.length > 40) {
        return res.status(400).json({ error: "Name must be 1 to 40 characters" });
      }
      data.name = name;
    }
    if (req.body?.bio !== undefined) {
      const bio = String(req.body.bio || "").trim();
      if (bio.length > 300) return res.status(400).json({ error: "Bio must be 300 characters or fewer" });
      data.bio = bio || null;
    }
    if (req.body?.number !== undefined) {
      const raw = req.body.number;
      if (raw === "" || raw === null) {
        data.number = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 999) {
          return res.status(400).json({ error: "Number must be between 0 and 999" });
        }
        data.number = n;
      }
    }
    if (req.body?.socials !== undefined) {
      try {
        data.socials = serializeSocials(req.body.socials);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    const driver = await prisma.driver.update({
      where: { id: driverId },
      data,
      select: { id: true, name: true, bio: true, number: true, socials: true },
    });
    // The same edit lands on the person's row in every league they race in
    // (lib/persons.js ownCurrentRowIds): their current-season rows in the
    // other series and any pre-season draft rows. The login is tied to ONE
    // row, so without this a Friday-league member's Sunday profile kept the
    // old bio, number and socials — and a rename made on the active row was
    // undone by a cloned draft the moment that season went live.
    if (fanOut) {
      await applyToOwnRows(driverId, req.user?.discordId, (ids) =>
        prisma.driver.updateMany({ where: { id: { in: ids } }, data })
      );
    }
    res.json({ ok: true, ...driver, bio: driver.bio || "", socials: parseSocials(driver.socials) });
  } catch (e) {
    next(e);
  }
});

// PUT /api/me/tiles { tiles: ["wins", ...] | null, driverId? } -> choose which
// stat tiles the public profile shows. null (or exactly the classic set) = the
// default. `driverId` = this one league's row only (see editTarget).
router.put("/tiles", async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const target = await editTarget(req, res, actingId, req.body?.driverId);
    if (!target) return;
    const { driverId, fanOut } = target;
    const raw = req.body?.tiles;
    let value = null;
    if (raw != null) {
      if (!Array.isArray(raw) || raw.some((k) => !PROFILE_TILE_KEYS.includes(k))) {
        return res.status(400).json({ error: "tiles must be an array of known tile keys" });
      }
      const picked = PROFILE_TILE_KEYS.filter((k) => raw.includes(k)); // canonical order, dedup
      // The public profile shows at most 9 tiles (mirrors the /profile editor).
      if (picked.length > 9) {
        return res.status(400).json({ error: "Choose at most 9 stat tiles" });
      }
      // Picking exactly the classic set IS the default — store null for it.
      const isDefault =
        picked.length === DEFAULT_PROFILE_TILES.length && DEFAULT_PROFILE_TILES.every((k) => picked.includes(k));
      value = isDefault ? null : JSON.stringify(picked);
    }
    await prisma.$executeRaw`UPDATE "Driver" SET "profileTiles" = ${value} WHERE "id" = ${driverId}`;
    // The choice is the person's, so it follows them into their other leagues.
    if (fanOut) {
      await applyToOwnRows(driverId, req.user?.discordId, async (ids) => {
        for (const id of ids) await prisma.$executeRaw`UPDATE "Driver" SET "profileTiles" = ${value} WHERE "id" = ${id}`;
      });
    }
    res.json({ ok: true, profileTiles: value ? JSON.parse(value) : null });
  } catch (e) {
    next(e);
  }
});

// PUT /api/me/card-photo { pos: {x,y,z} | null, driverId? } -> how the picture
// sits on the driver rating card (focal point % + zoom). null = back to the
// default framing. Values are clamped server-side, so a broken client can
// never park the photo off the card.
//
// It is written to THIS ROW alone, and that is what makes it stick: a card
// the member has framed keeps that framing for good, while every card they
// never touched follows the person's newest one on read (lib/cardPhoto
// cardPictureFor). So framing the current card carries through to the seasons
// still on the default, and leaves a season somebody dressed on purpose
// alone. `pos: null` clears this row's own framing and hands it back to that
// inheritance.
router.put("/card-photo", async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const driverId = await resolveOwnRow(req, res, actingId, req.body?.driverId);
    if (!driverId) return;
    const raw = req.body?.pos;
    let value = null;
    if (raw != null) {
      const pos = parseCardPhotoPos(raw);
      if (!pos) return res.status(400).json({ error: "pos must be { x: 0-100, y: 0-100, z: 1-3 }" });
      value = JSON.stringify(pos);
    }
    await prisma.$executeRaw`UPDATE "Driver" SET "cardPhotoPos" = ${value} WHERE "id" = ${driverId}`;
    res.json({ ok: true, photoPos: value ? JSON.parse(value) : null });
  } catch (e) {
    next(e);
  }
});

// --- Rating card editions -----------------------------------------------------
// The driver picks an unlockable card design (lib/cardEditions.js) PER season
// row. `driverId` in the request must belong to the logged-in person (checked
// against getLinkedDriverIds) — never trust a foreign row id from the body.

// Resolve the row to act on: the given driverId when it belongs to the acting
// person, else the acting row itself. Returns null + sends 403 on a foreign id.
async function resolveOwnRow(req, res, actingId, wantedId) {
  if (!wantedId || wantedId === actingId) return actingId;
  const linked = await getLinkedDriverIds(prisma, actingId);
  if (!linked.includes(wantedId)) {
    res.status(403).json({ error: "That driver row isn't yours" });
    return null;
  }
  return wantedId;
}

// GET /api/me/card-editions?driverId= -> { seasonNumber, editions: [...] }
// The full catalogue with unlock state + progress for the picker. Without
// driverId = the acting row.
router.get("/card-editions", async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const driverId = await resolveOwnRow(req, res, actingId, req.query.driverId);
    if (!driverId) return;
    const inputs = await cardUnlockInputs(prisma, driverId);
    if (!inputs) return res.status(404).json({ error: "Driver not found" });
    // The designs this member BOUGHT ride along with the ones they earned, so
    // the picker draws one catalogue (see lib/cardShop.js).
    const owned = await ownedDesigns(prisma, req.user?.discordId);
    const editions = unlockStateFor(
      inputs.stats,
      inputs.badges,
      inputs.teamBadges,
      inputs.seasonNumber,
      owned
    );
    // Reconcile the bell while we have the fresh unlock state (seeds silently the
    // first time; best-effort, never blocks the response meaningfully).
    notifyCardUnlocks(prisma, driverId, editions);
    res.json({ seasonNumber: inputs.seasonNumber, editions });
  } catch (e) {
    next(e);
  }
});

// GET /api/me/card-seasons -> the person's linked rows for the picker's season
// chips: [{ driverId, seasonNumber, seasonName, seriesId, seriesName,
// seriesSlug, cardStyle }], the acting row's league first and each league's
// seasons newest first. Private seasons are excluded (a hidden season
// has no public card).
//
// The league belongs on the chip: somebody racing in two of them has a row per
// league per season, and a strip reading "S8 S7 S6 S6 S5 S5" said nothing
// about WHICH S6 was about to be restyled.
router.get("/card-seasons", async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const linkedIds = await getLinkedDriverIds(prisma, actingId);
    const [rows, privateRows] = await Promise.all([
      prisma.driver.findMany({
        where: { id: { in: linkedIds } },
        include: { season: { select: { number: true, name: true } } },
      }),
      prisma.$queryRawUnsafe(`SELECT "id" FROM "Season" WHERE "isPublic" = 0`).catch(() => []),
    ]);
    const privateSeasonIds = new Set(privateRows.map((r) => r.id));
    // cardStyle lives in a raw-SQL column -> one raw read for all linked rows.
    const placeholders = linkedIds.map(() => "?").join(",");
    const styleRows = linkedIds.length
      ? await prisma.$queryRawUnsafe(`SELECT "id","cardStyle" FROM "Driver" WHERE "id" IN (${placeholders})`, ...linkedIds)
      : [];
    const styleById = new Map(
      styleRows.map((r) => [r.id, isKnownEdition(r.cardStyle) && r.cardStyle !== DEFAULT_CARD_EDITION ? r.cardStyle : null])
    );
    // Public series only, like GET /leagues: a row in a private series keeps
    // its chip (it did before) but is not named, so nothing unreleased is
    // spelled out on the page.
    const [series, seriesOfSeason] = await Promise.all([dbListSeries(prisma), seasonSeriesMap(prisma)]);
    const seriesById = new Map(series.map((x) => [x.id, x]));
    const actingSeriesId = seriesOfSeason.get(rows.find((r) => r.id === actingId)?.seasonId) || null;
    const seasons = rows
      .filter((r) => r.season?.number != null && !privateSeasonIds.has(r.seasonId))
      .map((r) => {
        const seriesId = seriesOfSeason.get(r.seasonId) || null;
        const s = seriesId ? seriesById.get(seriesId) : null;
        return {
          driverId: r.id,
          seasonNumber: r.season.number,
          seasonName: r.season.name,
          seriesId,
          seriesName: s?.name || null,
          seriesSlug: s?.slug || null,
          cardStyle: styleById.get(r.id) ?? null,
        };
      })
      // The member's own league first, then the others by name; newest season
      // first within each.
      .sort(
        (a, b) =>
          (a.seriesId === actingSeriesId ? 0 : 1) - (b.seriesId === actingSeriesId ? 0 : 1) ||
          (a.seriesName || "").localeCompare(b.seriesName || "") ||
          b.seasonNumber - a.seasonNumber
      );
    res.json({ seasons });
  } catch (e) {
    next(e);
  }
});

// PUT /api/me/card-style { driverId?, style } -> pick a card edition for a row.
// null / "classic" clears the column. Unknown key -> 400. A locked edition ->
// 403: the unlock is re-checked server-side, never trusting the client.
router.put("/card-style", async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const driverId = await resolveOwnRow(req, res, actingId, req.body?.driverId);
    if (!driverId) return;
    const style = req.body?.style;

    if (style == null || style === DEFAULT_CARD_EDITION) {
      await prisma.$executeRaw`UPDATE "Driver" SET "cardStyle" = ${null} WHERE "id" = ${driverId}`;
      return res.json({ ok: true, cardStyle: null });
    }
    if (!isKnownEdition(style)) return res.status(400).json({ error: "Unknown card edition" });

    const inputs = await cardUnlockInputs(prisma, driverId);
    if (!inputs) return res.status(404).json({ error: "Driver not found" });
    const owned = await ownedDesigns(prisma, req.user?.discordId);
    const state = unlockStateFor(
      inputs.stats,
      inputs.badges,
      inputs.teamBadges,
      inputs.seasonNumber,
      owned
    );
    const entry = state.find((e) => e.key === style);
    if (!entry?.unlocked) {
      return res.status(403).json({ error: "This edition isn't unlocked yet" });
    }
    await prisma.$executeRaw`UPDATE "Driver" SET "cardStyle" = ${style} WHERE "id" = ${driverId}`;
    res.json({ ok: true, cardStyle: style });
  } catch (e) {
    next(e);
  }
});

// PUT /api/me/card-anim { driverId?, anim } -> the card animation switch.
// "off" = a still card; anything else (or null) = the edition's baseline
// motion. Self-save like card-style; ownership re-checked via resolveOwnRow.
//
// Unlike everything else on the card page this is NOT per row. "Show me a
// still card" is a preference about the person, with nothing seasonal or
// league-specific about it, so setting it once sets it on every card of
// theirs — archive seasons included (lib/persons.js ownAllRowIds).
router.put("/card-anim", async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const driverId = await resolveOwnRow(req, res, actingId, req.body?.driverId);
    if (!driverId) return;
    const anim = req.body?.anim === "off" ? "off" : null;
    await prisma.$executeRaw`UPDATE "Driver" SET "cardAnim" = ${anim} WHERE "id" = ${driverId}`;
    await applyToAllOwnRows(driverId, req.user?.discordId, async (ids) => {
      for (const id of ids) await prisma.$executeRaw`UPDATE "Driver" SET "cardAnim" = ${anim} WHERE "id" = ${id}`;
    });
    res.json({ ok: true, cardAnim: anim, appliesToEveryCard: true });
  } catch (e) {
    next(e);
  }
});

// PUT /api/me/country { country, driverId? } -> set/clear the driver's own
// nationality. `country` is an ISO 3166-1 alpha-2 code (e.g. "de"); "" clears
// it. `driverId` = this one league's row only (see editTarget).
const CODE = /^[a-z]{2}$/;
router.put("/country", async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const target = await editTarget(req, res, actingId, req.body?.driverId);
    if (!target) return;
    const { driverId, fanOut } = target;
    const country = String(req.body?.country || "").trim().toLowerCase();
    if (country && !CODE.test(country)) {
      return res.status(400).json({ error: "country must be a 2-letter code or empty" });
    }
    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: { country: country || null },
      select: { id: true, country: true },
    });
    // A flag is the person's: their row in every league gets it, so the Sunday
    // standings do not keep showing a flag changed on the Friday profile.
    if (fanOut) {
      await applyToOwnRows(driverId, req.user?.discordId, (ids) =>
        prisma.driver.updateMany({ where: { id: { in: ids } }, data: { country: country || null } })
      );
    }
    res.json({ ok: true, country: driver.country || "" });
  } catch (e) {
    next(e);
  }
});

// POST /api/me/photo  (multipart: file=<image>, driverId?) -> set a custom
// profile picture. `driverId` (a form field) = this one league's row only.
router.post("/photo", upload.single("file"), async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const target = await editTarget(req, res, actingId, req.body?.driverId);
    if (!target) return;
    const { driverId, fanOut } = target;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = IMG_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Use a PNG, JPG, WEBP or GIF image" });

    mkdirSync(AVATAR_DIR, { recursive: true });
    const filename = `${driverId}${ext}`;
    const dest = safeUploadPath(AVATAR_DIR, filename);
    if (!dest) return res.status(400).json({ error: "Your driver id can't be used as a file name" });
    writeFileSync(dest, req.file.buffer);
    // Cache-bust so the new picture shows immediately even if the URL is reused.
    const photoUrl = `/api/uploads/avatars/${filename}?v=${Date.now()}`;
    await prisma.driver.update({ where: { id: driverId }, data: { photoUrl } });
    // One face for the person: the same picture on their row in every league.
    if (fanOut) {
      await applyToOwnRows(driverId, req.user?.discordId, (ids) =>
        prisma.driver.updateMany({ where: { id: { in: ids } }, data: { photoUrl } })
      );
    }
    res.json({ ok: true, photoUrl });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/me/photo?driverId= -> drop the custom picture, falling back to
// the Discord avatar (captured on login). Returns the URL that now applies, if
// any. `driverId` = this one league's row only.
router.delete("/photo", async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const target = await editTarget(req, res, actingId, req.query?.driverId);
    if (!target) return;
    const { driverId, fanOut } = target;
    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: { photoUrl: null },
      select: { discordAvatar: true },
    });
    if (fanOut) {
      await applyToOwnRows(driverId, req.user?.discordId, (ids) =>
        prisma.driver.updateMany({ where: { id: { in: ids } }, data: { photoUrl: null } })
      );
    }
    res.json({ ok: true, photoUrl: driver.discordAvatar || null });
  } catch (e) {
    next(e);
  }
});

// Write one uploaded card picture to ONE row: its own file, named after that
// row, and the row's column pointing at it. A file per row is what lets an
// account deletion remove them, which it does by row id
// (accountDeletionService). Returns the stored URL, or null when the id can't
// be a file name.
function writeCardPicture(driverId, buffer, ext) {
  mkdirSync(CARD_DIR, { recursive: true });
  const filename = `${driverId}${ext}`;
  const dest = safeUploadPath(CARD_DIR, filename);
  if (!dest) return null;
  writeFileSync(dest, buffer);
  // Cache-bust: the file name is reused, so the URL has to say it changed.
  return `/api/uploads/cards/${filename}?v=${Date.now()}`;
}

// POST /api/me/card-photo-image (multipart: file=<image>, driverId?) -> a
// card-ONLY picture, separate from the profile avatar. null column = the card
// uses the profile photo. Written via raw SQL (cardPhotoUrl is a raw column).
//
// Written to THIS ROW alone: the card the member set keeps its picture, and
// every card they never touched follows the person's newest one on read
// (lib/cardPhoto cardPictureFor). `driverId` (a form field) says which row
// the editor had open.
router.post("/card-photo-image", upload.single("file"), async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const driverId = await resolveOwnRow(req, res, actingId, req.body?.driverId);
    if (!driverId) return;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = IMG_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Use a PNG, JPG, WEBP or GIF image" });

    const cardPhotoUrl = writeCardPicture(driverId, req.file.buffer, ext);
    if (!cardPhotoUrl) return res.status(400).json({ error: "Your driver id can't be used as a file name" });
    await prisma.$executeRaw`UPDATE "Driver" SET "cardPhotoUrl" = ${cardPhotoUrl} WHERE "id" = ${driverId}`;
    res.json({ ok: true, cardPhotoUrl });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/me/card-photo-image?driverId= -> drop this row's own card
// picture, which hands the card back to the inheritance: it follows the
// person's newest picture again, or their profile photo when there is none.
router.delete("/card-photo-image", async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const driverId = await resolveOwnRow(req, res, actingId, req.query?.driverId);
    if (!driverId) return;
    await prisma.$executeRaw`UPDATE "Driver" SET "cardPhotoUrl" = ${null} WHERE "id" = ${driverId}`;
    res.json({ ok: true, cardPhotoUrl: null });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// THE RACE RECAP (lib/raceRecap.js): the round told from the member's seat,
// shown once after the league office saves a result.
// ---------------------------------------------------------------------------

// GET /api/me/race-recap -> { enabled, recap } — the recap waiting for this
// member, or recap:null when there is none (nothing new, already seen, or the
// feature is not on for them). Any visitor may ask; a logged-out one is
// simply told there is nothing.
router.get("/race-recap", async (req, res, next) => {
  try {
    if (!req.user || !(await recapVisibleTo(prisma, req))) return res.json({ enabled: false, recap: null });
    const driverId = await resolveDriverId(prisma, req.user);
    if (!driverId) return res.json({ enabled: true, recap: null });
    const raceId = await pendingRecapRace(prisma, driverId, req.user.discordId);
    if (!raceId) return res.json({ enabled: true, recap: null });
    const recap = await buildRaceRecap(prisma, { raceId, driverId, discordId: req.user.discordId, req });
    res.json({ enabled: true, recap });
  } catch (e) {
    next(e);
  }
});

// GET /api/me/race-recap/:raceId -> the recap of one round, for reading it
// again from the race page. Own seasons only: the round has to be in a season
// the person has a row in, or it is not their recap to read.
router.get("/race-recap/:raceId", async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Sign in with Discord first" });
    if (!(await recapVisibleTo(prisma, req))) return res.status(404).json({ error: "Not available" });
    const driverId = await requireDriver(req, res);
    if (!driverId) return;
    const race = await prisma.race.findUnique({ where: { id: req.params.raceId }, select: { id: true, seasonId: true } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    const linked = await getLinkedDriverIds(prisma, driverId);
    const own = await prisma.driver.count({ where: { id: { in: linked.length ? linked : [driverId] }, seasonId: race.seasonId } });
    if (!own) return res.status(404).json({ error: "Not your season" });
    const recap = await buildRaceRecap(prisma, { raceId: race.id, driverId, discordId: req.user.discordId, req });
    if (!recap) return res.status(404).json({ error: "No result yet" });
    res.json({ recap });
  } catch (e) {
    next(e);
  }
});

// POST /api/me/race-recap/seen { raceId } -> this member has seen that
// round's recap (or closed it), so it is not offered again.
router.post("/race-recap/seen", async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Sign in with Discord first" });
    const raceId = String(req.body?.raceId || "");
    if (!raceId) return res.status(400).json({ error: "raceId required" });
    await markRecapSeen(prisma, req.user.discordId, raceId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/me/rating/history -> the logged-in driver's own rating, replayed
// round by round (curve points + per-race facts + component breakdown). Own
// eyes only on purpose — the full what-goes-into-it view is private, the
// public profile card just shows the four numbers.
router.get("/rating/history", async (req, res, next) => {
  try {
    const driverId = await requireDriver(req, res);
    if (!driverId) return;
    const history = await getDriverRatingHistory(prisma, driverId);
    if (!history) return res.status(404).json({ error: "No rating yet" });
    // Plus the CHEAP all-time curve (one point per season), so the chart can
    // zoom out right away. The per-race career curve is a separate call below,
    // fetched only when the reader actually asks for that detail.
    const career = await getDriverCareerRatings(prisma, driverId);
    // …and the frozen card the driver actually carries this season, so the page
    // can put "what's on my card" next to "what I'm doing right now".
    const card = history.driver?.seasonId
      ? await getCardRating(prisma, history.driver.seasonId, driverId)
      : null;
    res.json({
      ...history,
      careerSeasons: career?.points || [],
      card: card
        ? { ratings: card.ratings, provisional: card.provisional, starts: card.starts, ...card.card }
        : null,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/me/rating/career -> every RACE of every season, replayed. The
// expensive view, so it is its own request: the page only asks for it when the
// reader switches the all-time chart to per-race detail.
router.get("/rating/career", async (req, res, next) => {
  try {
    const driverId = await requireDriver(req, res);
    if (!driverId) return;
    const career = await getDriverCareerRatings(prisma, driverId, { perRace: true });
    res.json({ points: career?.points || [] });
  } catch (e) {
    next(e);
  }
});

// --- "I want to race" hand-raise -------------------------------------------
// A logged-in Discord account that has NO driver profile anywhere (never raced
// with us, nothing to link) can ask for a seat from the Attendance page. The
// request lands on the account row and shows up in the admin Members tab
// ("Needs attention"), where one click creates their driver. Accounts that DO
// resolve to a driver don't need this — their sign-up buttons work directly.

// GET /api/me/race-request -> { linked, pending, text }
router.get("/race-request", async (req, res, next) => {
  try {
    if (!req.user?.discordId) return res.status(401).json({ error: "Sign in with Discord first" });
    const linked = !!(await resolveDriverId(prisma, req.user));
    const acct = await dbGetMember(prisma, req.user.discordId);
    res.json({ linked, pending: !!acct?.raceRequestAt, text: acct?.raceRequestText || null });
  } catch (e) {
    next(e);
  }
});

// POST /api/me/race-request { raceId? } -> raise the hand (idempotent).
router.post("/race-request", async (req, res, next) => {
  try {
    if (!req.user?.discordId) return res.status(401).json({ error: "Sign in with Discord first" });
    if (await resolveDriverId(prisma, req.user)) {
      return res.status(409).json({ error: "Your account is already connected to a driver. Use the sign-up buttons directly." });
    }
    const acct = await dbGetMember(prisma, req.user.discordId);
    if (!acct) return res.status(404).json({ error: "Account not found" });
    // Remember WHICH race they raised their hand for (nice context for the admin).
    let text = null;
    if (req.body?.raceId) {
      const race = await prisma.race.findUnique({
        where: { id: String(req.body.raceId) },
        select: { track: true, number: true, season: { select: { name: true } } },
      });
      if (race) {
        text = [race.number != null ? `Round ${race.number}` : null, race.track, race.season?.name]
          .filter(Boolean)
          .join(" · ");
      }
    }
    const updated = await dbSetRaceRequest(prisma, req.user.discordId, text);
    // Straight to the admins' bell: a raised hand that nobody sees is the whole
    // point of the button lost.
    notifyAdminsRaceRequest(prisma, updated || acct, text).catch(() => {});
    res.json({ ok: true, pending: true, text });
  } catch (e) {
    next(e);
  }
});

// --- Deleting your own account ------------------------------------------------
// Both endpoints work for a login that was never linked to a driver, which is
// most of the accounts here, so they check for the LOGIN rather than going
// through requireDriver.

// GET /api/me/delete-account -> what a deletion would touch, in countable
// numbers, for the confirmation screen.
router.get("/delete-account", async (req, res, next) => {
  try {
    if (!req.user?.discordId) return res.status(401).json({ error: "Sign in with Discord first" });
    res.json(await previewAccountDeletion(prisma, req.user.discordId));
  } catch (e) {
    next(e);
  }
});

// POST /api/me/delete-account { confirm: true } -> do it.
//
// The flag is not security (the session already is), it is a guard against a
// stray POST from a retried request or an over-eager client deleting somebody's
// league history by accident.
router.post("/delete-account", async (req, res, next) => {
  try {
    if (!req.user?.discordId) return res.status(401).json({ error: "Sign in with Discord first" });
    if (req.body?.confirm !== true) return res.status(400).json({ error: "Not confirmed" });
    res.json({ ok: true, ...(await deleteMemberAccount(prisma, req.user.discordId)) });
  } catch (e) {
    next(e);
  }
});

export default router;
