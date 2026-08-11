import { Router } from "express";
import prisma from "../lib/prisma.js";
import { signUserToken } from "../middleware/auth.js";
import { isDiscordAdmin } from "../lib/adminUsers.js";
import { discordIdsForDrivers } from "../lib/persons.js";
import { IS_DEPLOYED } from "../lib/deployment.js";

// ---------------------------------------------------------------------------
// Signing in as somebody else, on your own machine only.
//
// Anything with two sides needs two people to try it, and both sides of an
// incident report are behind a Discord login. Testing "driver A reports driver
// B, B answers, the stewards decide, both are told" otherwise means owning two
// Discord accounts and two browsers.
//
// This is an AUTHENTICATION BYPASS and it is written like one. It hands out a
// real member session for any driver, with no password, so if it ever answered
// on the live site anyone could be anyone. Two independent locks, both of which
// must hold:
//
//   1. Not a deployment. lib/deployment.js's probe, the same one the JWT
//      placeholder guard and the Steam return check use — NODE_ENV, Railway's
//      own variables, or an https CORS origin. Any of those and this router
//      does not even mount.
//   2. The request came from the loopback address. Express is behind
//      `trust proxy`, so req.ip is the real client — a browser on another
//      machine can never satisfy this, tunnel or no tunnel.
//
// Belt and braces on purpose: lock 1 is a deployment question and can be got
// wrong by a misconfigured environment; lock 2 is a physical one and cannot.
//
// It also refuses to exist in the built frontend's world: nothing in the site
// calls it. It is for a person with a terminal, and for /dev/login in a browser
// on the same machine.
// ---------------------------------------------------------------------------

const router = Router();

// Loopback in both families, plus the IPv4-mapped form Node reports on Windows.
const LOOPBACK = /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/;

function localOnly(req, res, next) {
  if (IS_DEPLOYED) return res.status(404).json({ error: "Not found" });
  const ip = String(req.ip || req.socket?.remoteAddress || "");
  if (!LOOPBACK.test(ip)) return res.status(404).json({ error: "Not found" });
  next();
}

router.use(localOnly);

// GET /api/dev/whoami -> proof the hatch is open, and why it is safe
router.get("/whoami", (req, res) => {
  res.json({ devLogin: true, ip: req.ip, deployed: IS_DEPLOYED });
});

// GET /api/dev/drivers -> who you can be, this season, with whether they are
// already tied to a real Discord account.
router.get("/drivers", async (req, res, next) => {
  try {
    const season = await prisma.season.findFirst({ where: { isActive: true }, select: { id: true } });
    const drivers = await prisma.driver.findMany({
      where: season ? { seasonId: season.id } : {},
      select: { id: true, name: true, discordUserId: true, teamId: true },
      orderBy: { name: "asc" },
    });
    res.json({ drivers });
  } catch (e) {
    next(e);
  }
});

// POST /api/dev/login { driverId }  ->  { token, user }
//
// The session is built exactly the way the Discord callback builds it, so what
// comes back is indistinguishable from a real login and nothing downstream
// needs a special case for it.
//
// The Discord id to sign in as, in the order that does the least damage:
//
//   1. The one on this row.
//   2. The one the PERSON already has on another season's row, through the
//      person links — the same resolution the report readers and the results
//      post use. Writing a new id in this case would split one person into two
//      identities, so it signs in as who they already are and writes nothing.
//   3. Only if the person has no id anywhere: a made-up one, written onto the
//      row so the readers and the notifications have something to resolve. That
//      is a real edit to a real row — dev databases only. It is marked
//      "900000" so it can be found and undone.
async function identityFor(driver) {
  if (driver.discordUserId) return { id: driver.discordUserId, minted: false };
  const linked = await discordIdsForDrivers(prisma, [driver.id]).catch(() => new Map());
  const existing = linked.get(driver.id);
  if (existing) return { id: existing, minted: false };
  return { id: `900000${String(Math.abs(hash(driver.id))).padStart(12, "0").slice(0, 12)}`, minted: true };
}

router.post("/login", async (req, res, next) => {
  try {
    const id = String(req.body?.driverId || "").trim();
    if (!id) return res.status(400).json({ error: "driverId required" });
    let driver = await prisma.driver.findUnique({ where: { id } });
    if (!driver) return res.status(404).json({ error: "No such driver" });

    const identity = await identityFor(driver);
    if (identity.minted) {
      driver = await prisma.driver.update({ where: { id: driver.id }, data: { discordUserId: identity.id } });
    }

    const profile = {
      discordId: identity.id,
      discordName: driver.discordName || driver.name,
      driverId: driver.id,
      driverName: driver.name,
      avatarUrl: driver.photoUrl || driver.discordAvatar || null,
      isAdmin: await isDiscordAdmin(prisma, identity.id).catch(() => false),
    };
    res.json({ token: signUserToken(profile), user: profile, linked: true, minted: identity.minted });
  } catch (e) {
    next(e);
  }
});

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export default router;
