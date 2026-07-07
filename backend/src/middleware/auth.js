import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { isBanned } from "../lib/members.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Every token on the site is signed with JWT_SECRET, so anyone who knows it
// can forge an admin session. The dev fallback above and the placeholder
// values from .env.example / DEPLOYMENT.md are public knowledge (the source
// has been shared). On a real deployment that is fatal — so if the server is
// evidently NOT running as a local dev setup (production mode, or CORS opened
// for an https domain as DEPLOYMENT.md step 2 does), refuse to start until a
// real secret is configured. Local development is unaffected.
const secretIsPlaceholder = !process.env.JWT_SECRET || /change-me|<hier/i.test(process.env.JWT_SECRET);
const looksDeployed =
  process.env.NODE_ENV === "production" || /https:\/\//i.test(process.env.CORS_ORIGIN || "");
if (secretIsPlaceholder && looksDeployed) {
  throw new Error(
    "JWT_SECRET in backend/.env ist noch der Platzhalter. Ohne eigenen, zufälligen " +
      "Schlüssel könnte jeder Admin-Zugriffe fälschen. Einen erzeugen mit: " +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
      "— dann in backend/.env als JWT_SECRET eintragen und neu starten. (Siehe DEPLOYMENT.md, Schritt 2.)"
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
export async function resolveDriverId(prismaClient, user) {
  if (!user) return null;
  if (user.discordId) {
    const d = await prismaClient.driver.findUnique({
      where: { discordUserId: user.discordId },
      select: { id: true },
    });
    return d?.id || null;
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

// Express middleware: requires a valid admin JWT in the Authorization header.
export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") throw new Error("not admin");
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
