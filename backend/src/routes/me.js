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
import { parseSocials, serializeSocials } from "../lib/socials.js";
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
const IMG_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

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
      include: { team: true },
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    res.json({
      isLinked: true,
      driverId: driver.id,
      name: driver.name,
      discordName: driver.discordName,
      country: driver.country || "",
      bio: driver.bio || "",
      number: driver.number ?? null,
      socials: parseSocials(driver.socials),
      tier: driver.tier,
      // Custom upload wins over the Discord avatar; hasCustomPhoto drives the
      // "reset to Discord picture" button on the profile page.
      photoUrl: driver.photoUrl || driver.discordAvatar || null,
      hasCustomPhoto: !!driver.photoUrl,
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
    res.json({ ok: true, ...driver, bio: driver.bio || "", socials: parseSocials(driver.socials) });
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

export default router;
