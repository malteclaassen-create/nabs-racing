import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { isBanned } from "../lib/members.js";
import { isDiscordAdmin } from "../lib/adminUsers.js";
import { getActiveSeason } from "../services/seasonService.js";
import { getLinkedDriverIds } from "../lib/persons.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Every token on the site is signed with JWT_SECRET, so anyone who knows it
// can forge an admin session. The dev fallback above and the placeholder
// values from .env.example / DEPLOYMENT.md are public knowledge (the source
// has been shared). On a real deployment that is fatal — so if the server is
// evidently NOT running as a local dev setup (production mode, or CORS opened
// for an https domain as DEPLOYMENT.md step 2 does), refuse to start until a
// real secret is configured. Local development is unaffected.
const secretIsPlaceholder = !process.env.JWT_SECRET || /change-me|<hier|<put/i.test(process.env.JWT_SECRET);
const looksDeployed =
  process.env.NODE_ENV === "production" || /https:\/\//i.test(process.env.CORS_ORIGIN || "");
if (secretIsPlaceholder && looksDeployed) {
  throw new Error(
    "JWT_SECRET in backend/.env is still the placeholder. Without your own random " +
      "key, anyone could forge admin access. Generate one with: " +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
      "then put it into backend/.env as JWT_SECRET and restart. (See DEPLOYMENT.md, step 2.)"
  );
}

// Sign a short admin token.
export function signAdminToken() {
  return jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
}

// Sign a token for a logged-in driver (via Discord).
export function signUserToken(payload) {
  return jwt.sign({ role: "user", ...payload }, JWT_SECRET, { expiresIn: "30d" });
}

// Reads & verifies a user token if present; sets req.user. Never blocks.
// Sessions are stateless JWTs, so a ban must be checked here too — a banned
// account's still-valid token is simply treated as logged out.
export async function optionalUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.role === "user" && !(await isBanned(prisma, payload.discordId))) {
        req.user = payload;
      }
    } catch {
      /* ignore invalid token */
    }
  }
  next();
}

// Express middleware: requires a logged-in (Discord) member. Blocks otherwise.
// Used to gate member-only areas such as the downloads catalogue. Banned
// accounts are rejected even while their JWT is still technically valid.
export async function requireUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in with Discord first" });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "user") throw new Error("not a member");
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
  try {
    if (await isBanned(prisma, payload.discordId)) {
      return res.status(403).json({ error: "This account has been suspended by the league admins." });
    }
  } catch {
    /* ban check must never take the site down */
  }
  req.user = payload;
  next();
}

// The driverId inside a user JWT is a SNAPSHOT from login time. The admin can
// unlink/relink accounts at any moment (Members tab), so anything that acts as
// a driver must re-read the CURRENT link from the DB by Discord id — otherwise
// an unlinked session could keep editing "its" old driver for up to 30 days.
// Falls back to the token's driverId only for tokens without a discordId.
//
// STALE-SEASON self-heal: the stored link can point at a PREVIOUS season's row
// (e.g. the login name-matcher grabbed an archive row, or a new season started
// mid-session). When the person has a row on the ACTIVE roster, act as THAT
// row right away — the member sees their current card/profile without logging
// out and back in. Read-only here: the stored link itself only moves on the
// next login (discordAuth's season handover).
export async function resolveDriverId(prismaClient, user) {
  if (!user) return null;
  if (user.discordId) {
    const d = await prismaClient.driver.findUnique({
      where: { discordUserId: user.discordId },
      select: { id: true, seasonId: true },
    });
    if (!d) return null;
    try {
      const active = await getActiveSeason(prismaClient);
      if (active && d.seasonId && d.seasonId !== active.id) {
        const linkedIds = await getLinkedDriverIds(prismaClient, d.id);
        if (linkedIds.length > 1) {
          const rows = await prismaClient.driver.findMany({
            where: { id: { in: linkedIds }, seasonId: active.id },
            select: { id: true, discordUserId: true },
          });
          // Never hijack a row that belongs to a DIFFERENT Discord account.
          const own = rows.find((r) => !r.discordUserId || r.discordUserId === user.discordId);
          if (own) return own.id;
        }
      }
    } catch {
      /* person tables missing etc. — fall back to the stored link */
    }
    return d.id;
  }
  return user.driverId || null;
}

// A short-lived, single-purpose ticket that authorises ONE file download. A
// plain browser download (link/window.location) can't send an Authorization
// header, so a logged-in member first exchanges their session for this ticket,
// which then rides in the download URL and gates the actual file stream.
export function signDownloadTicket(id) {
  return jwt.sign({ role: "dl", id }, JWT_SECRET, { expiresIn: "10m" });
}
export function verifyDownloadTicket(token, id) {
  try {
    const p = jwt.verify(token, JWT_SECRET);
    return p.role === "dl" && p.id === id;
  } catch {
    return false;
  }
}

// Non-blocking admin check for otherwise-public routes: true when the request
// carries a valid admin JWT (PIN login) OR a Discord user token flagged isAdmin
// at login. Lets a public endpoint reveal private seasons (or their deep links)
// to a signed-in admin without gating the endpoint itself. (The flag is baked at
// login; the actual admin WRITE gate — requireAdmin — re-checks live.)
export function isAdminRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return false;
  try {
    const p = jwt.verify(token, JWT_SECRET);
    return p.role === "admin" || (p.role === "user" && !!p.isAdmin);
  } catch {
    return false;
  }
}

// Express middleware: requires admin access. Two ways in:
//   * the PIN admin token (role "admin"), or
//   * a Discord user token whose account is a currently-designated admin
//     (lib/adminUsers.js) — re-checked live so granting/revoking is immediate.
export async function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  if (payload.role === "admin") {
    req.admin = payload;
    return next();
  }
  if (payload.role === "user" && payload.discordId) {
    try {
      if (!(await isBanned(prisma, payload.discordId)) && (await isDiscordAdmin(prisma, payload.discordId))) {
        req.admin = payload;
        req.user = payload;
        return next();
      }
    } catch {
      /* fall through to 401 */
    }
  }
  return res.status(401).json({ error: "Invalid or expired token" });
}
