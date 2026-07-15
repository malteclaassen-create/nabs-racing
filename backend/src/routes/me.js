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
import { getLinkedDriverIds } from "../lib/persons.js";
import { parseSocials, serializeSocials } from "../lib/socials.js";
import { DEFAULT_PROFILE_TILES, PROFILE_TILE_KEYS, readProfileTiles } from "../lib/profileTiles.js";
import { parseCardPhotoPos, readCardPhotoPos } from "../lib/cardPhoto.js";
import { readDriverRoles } from "../lib/driverRoles.js";
import {
  unlockStateFor, isKnownEdition, readCardEdition, readCardAnim, DEFAULT_CARD_EDITION,
} from "../lib/cardEditions.js";
import { cardUnlockInputs } from "../services/driverProfileService.js";
import { notifyCardUnlocks } from "../lib/notifications.js";
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
    if (!driverId) {
      return res.json({ isLinked: false, discordName: req.user.discordName || null });
    }
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { team: true, season: { select: { number: true } } },
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    res.json({
      isLinked: true,
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

// PUT /api/me/profile { name?, bio?, number?, socials? } -> edit own display
// fields. `name` is the driver's display name shown across the whole site;
// `socials` is a { platform: url } object (see lib/socials.js).
router.put("/profile", async (req, res, next) => {
  try {
    const driverId = await requireDriver(req, res);
    if (!driverId) return;
    const data = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (name.length < 1 || name.length > 40) {
        return res.status(400).json({ error: "Name must be 1–40 characters" });
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
    // A rename follows the person into UPCOMING seasons: their rows there are
    // pre-season drafts (cloned rosters) still carrying the old name, and the
    // site shows the newest row's name — without this, the draft would undo the
    // rename the moment that season goes live. Never touches a row claimed by a
    // different Discord account.
    if (data.name !== undefined) {
      try {
        const acting = await prisma.driver.findUnique({
          where: { id: driverId },
          select: { discordUserId: true, season: { select: { number: true } } },
        });
        const linkedIds = (await getLinkedDriverIds(prisma, driverId)).filter((id) => id !== driverId);
        if (acting?.season?.number != null && linkedIds.length) {
          await prisma.driver.updateMany({
            where: {
              id: { in: linkedIds },
              season: { number: { gt: acting.season.number } },
              OR: acting.discordUserId
                ? [{ discordUserId: null }, { discordUserId: acting.discordUserId }]
                : [{ discordUserId: null }],
            },
            data: { name: data.name },
          });
        }
      } catch {
        /* person tables missing etc. — the own-row rename above still counts */
      }
    }
    res.json({ ok: true, ...driver, bio: driver.bio || "", socials: parseSocials(driver.socials) });
  } catch (e) {
    next(e);
  }
});

// PUT /api/me/tiles { tiles: ["wins", ...] | null } -> choose which stat tiles
// the public profile shows. null (or exactly the classic set) = the default.
router.put("/tiles", async (req, res, next) => {
  try {
    const driverId = await requireDriver(req, res);
    if (!driverId) return;
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
    res.json({ ok: true, profileTiles: value ? JSON.parse(value) : null });
  } catch (e) {
    next(e);
  }
});

// PUT /api/me/card-photo { pos: {x,y,z} | null } -> how the profile picture
// sits on the driver rating card (focal point % + zoom). null = back to the
// default framing. Values are clamped server-side, so a broken client can
// never park the photo off the card.
router.put("/card-photo", async (req, res, next) => {
  try {
    const driverId = await requireDriver(req, res);
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
    const editions = unlockStateFor(inputs.stats, inputs.badges, inputs.teamBadges, inputs.seasonNumber);
    // Reconcile the bell while we have the fresh unlock state (seeds silently the
    // first time; best-effort, never blocks the response meaningfully).
    notifyCardUnlocks(prisma, driverId, editions);
    res.json({ seasonNumber: inputs.seasonNumber, editions });
  } catch (e) {
    next(e);
  }
});

// GET /api/me/card-seasons -> the person's linked rows for the picker's season
// chips: [{ driverId, seasonNumber, seasonName, cardStyle }], newest first.
// Private seasons are excluded (a hidden season has no public card).
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
    const seasons = rows
      .filter((r) => r.season?.number != null && !privateSeasonIds.has(r.seasonId))
      .map((r) => ({
        driverId: r.id,
        seasonNumber: r.season.number,
        seasonName: r.season.name,
        cardStyle: styleById.get(r.id) ?? null,
      }))
      .sort((a, b) => b.seasonNumber - a.seasonNumber);
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
    const state = unlockStateFor(inputs.stats, inputs.badges, inputs.teamBadges, inputs.seasonNumber);
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

// PUT /api/me/card-anim { driverId?, anim } -> the card animation switch for a
// row. "off" = a still card; anything else (or null) = the edition's baseline
// motion. Self-save like card-style; ownership re-checked via resolveOwnRow.
router.put("/card-anim", async (req, res, next) => {
  try {
    const actingId = await requireDriver(req, res);
    if (!actingId) return;
    const driverId = await resolveOwnRow(req, res, actingId, req.body?.driverId);
    if (!driverId) return;
    const anim = req.body?.anim === "off" ? "off" : null;
    await prisma.$executeRaw`UPDATE "Driver" SET "cardAnim" = ${anim} WHERE "id" = ${driverId}`;
    res.json({ ok: true, cardAnim: anim });
  } catch (e) {
    next(e);
  }
});

// PUT /api/me/country { country }  -> set/clear the driver's own nationality.
// `country` is an ISO 3166-1 alpha-2 code (e.g. "de"); "" clears it.
const CODE = /^[a-z]{2}$/;
router.put("/country", async (req, res, next) => {
  try {
    const driverId = await requireDriver(req, res);
    if (!driverId) return;
    const country = String(req.body?.country || "").trim().toLowerCase();
    if (country && !CODE.test(country)) {
      return res.status(400).json({ error: "country must be a 2-letter code or empty" });
    }
    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: { country: country || null },
      select: { id: true, country: true },
    });
    res.json({ ok: true, country: driver.country || "" });
  } catch (e) {
    next(e);
  }
});

// POST /api/me/photo  (multipart: file=<image>) -> set a custom profile picture.
router.post("/photo", upload.single("file"), async (req, res, next) => {
  try {
    const driverId = await requireDriver(req, res);
    if (!driverId) return;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = IMG_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Use a PNG, JPG, WEBP or GIF image" });

    mkdirSync(AVATAR_DIR, { recursive: true });
    const filename = `${driverId}${ext}`;
    writeFileSync(join(AVATAR_DIR, filename), req.file.buffer);
    // Cache-bust so the new picture shows immediately even if the URL is reused.
    const photoUrl = `/api/uploads/avatars/${filename}?v=${Date.now()}`;
    await prisma.driver.update({ where: { id: driverId }, data: { photoUrl } });
    res.json({ ok: true, photoUrl });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/me/photo -> drop the custom picture, falling back to the Discord
// avatar (captured on login). Returns the URL that now applies, if any.
router.delete("/photo", async (req, res, next) => {
  try {
    const driverId = await requireDriver(req, res);
    if (!driverId) return;
    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: { photoUrl: null },
      select: { discordAvatar: true },
    });
    res.json({ ok: true, photoUrl: driver.discordAvatar || null });
  } catch (e) {
    next(e);
  }
});

// POST /api/me/card-photo-image (multipart: file=<image>) -> a card-ONLY
// picture, separate from the profile avatar. null column = the card uses the
// profile photo. Written via raw SQL (cardPhotoUrl is a raw column).
router.post("/card-photo-image", upload.single("file"), async (req, res, next) => {
  try {
    const driverId = await requireDriver(req, res);
    if (!driverId) return;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = IMG_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: "Use a PNG, JPG, WEBP or GIF image" });

    mkdirSync(CARD_DIR, { recursive: true });
    const filename = `${driverId}${ext}`;
    writeFileSync(join(CARD_DIR, filename), req.file.buffer);
    const cardPhotoUrl = `/api/uploads/cards/${filename}?v=${Date.now()}`;
    await prisma.$executeRaw`UPDATE "Driver" SET "cardPhotoUrl" = ${cardPhotoUrl} WHERE "id" = ${driverId}`;
    res.json({ ok: true, cardPhotoUrl });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/me/card-photo-image -> drop the card-only picture, so the card
// falls back to the profile photo again.
router.delete("/card-photo-image", async (req, res, next) => {
  try {
    const driverId = await requireDriver(req, res);
    if (!driverId) return;
    await prisma.$executeRaw`UPDATE "Driver" SET "cardPhotoUrl" = ${null} WHERE "id" = ${driverId}`;
    res.json({ ok: true, cardPhotoUrl: null });
  } catch (e) {
    next(e);
  }
});

export default router;
