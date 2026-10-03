import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { isBanned, mainAccountId } from "../lib/members.js";
import { isDiscordAdmin } from "../lib/adminUsers.js";
import { getActiveSeason } from "../services/seasonService.js";
import { getLinkedDriverIds } from "../lib/persons.js";
import { IS_DEPLOYED } from "../lib/deployment.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Every token on the site is signed with JWT_SECRET, so anyone who knows it
// can forge an admin session. The dev fallback above and the placeholder
// values from .env.example / DEPLOYMENT.md are public knowledge (the source
// has been shared). On a real deployment that is fatal, so refuse to start
// until a real secret is configured. Local development is unaffected.
//
// What counts as "a real deployment" now comes from lib/deployment.js. It used
// to be decided here, and it missed Railway: `start:prod` never sets NODE_ENV,
// so unless the operator had also put an https CORS origin in place, the live
// server looked like a laptop and the guard stayed quiet on the one host it
// was written for.
//
// Every placeholder the project's own documentation hands out has to be in
// here, or the guard waves through the exact value it was written to catch.
// DEPLOYMENT.md:55 says "<put a long, random string here>" and HANDOVER.md:85
// says "REPLACE-ME" — the second one used to pass, and HANDOVER.md is the
// document the incoming league admin actually follows. It also promises, at
// line 97, that the server refuses to start on it. Now it does.
const secretIsPlaceholder =
  !process.env.JWT_SECRET || /change-me|replace-me|<hier|<put/i.test(process.env.JWT_SECRET);
if (secretIsPlaceholder && IS_DEPLOYED) {
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
      if (payload.role === "user") {
        const member = await memberSession(payload);
        if (!member.banned) req.user = member.user;
      }
    } catch {
      /* ignore invalid token */
    }
  }
  next();
}

// The Discord account that actually signed in. A token issued through a
// second account carries the main account as `discordId` and the account
// itself as `loginDiscordId` (routes/discordAuth.js); older tokens only the
// one id.
export function loginDiscordId(payload) {
  return payload?.loginDiscordId || payload?.discordId || null;
}

// Who a member token acts as, decided per request: a second account acts as
// its main account (lib/accountLinks.js), so a link set or undone by an admin
// takes hold on the next request, with no new login needed. Banned when
// either account is. Admin rights are NOT looked up through this: those stay
// on the login account (resolveAdminContext / requireAdmin below).
export async function memberSession(payload) {
  const login = loginDiscordId(payload);
  if (!login) return { banned: false, user: payload };
  const main = await mainAccountId(prisma, login);
  const banned =
    (await isBanned(prisma, login)) || (main !== String(login) && (await isBanned(prisma, main)));
  const user = { ...payload, discordId: main };
  if (main !== String(login)) user.loginDiscordId = String(login);
  else delete user.loginDiscordId;
  return { banned, user };
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
  let user = payload;
  try {
    const member = await memberSession(payload);
    if (member.banned) {
      return res.status(403).json({ error: "This account has been suspended by the league admins." });
    }
    user = member.user;
  } catch {
    /* ban check must never take the site down */
  }
  req.user = user;
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
      // Heal within the SERIES the linked row belongs to: a GT-linked login
      // moves along the GT seasons, never sideways into another series.
      let seriesId = null;
      if (d.seasonId) {
        const rows = await prismaClient
          .$queryRawUnsafe(`SELECT "seriesId" FROM "Season" WHERE "id" = ?`, d.seasonId)
          .catch(() => []);
        seriesId = rows[0]?.seriesId || null;
      }
      const active = await getActiveSeason(prismaClient, seriesId);
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

// A single-purpose ticket that authorises ONE file download. A plain browser
// download (link/window.location) can't send an Authorization header, so a
// logged-in member first exchanges their session for this ticket, which then
// rides in the download URL and gates the actual file stream.
//
// Valid for 12 HOURS on purpose: pausing/resuming a multi-gigabyte AC mod
// re-requests the SAME ticketed URL, so a short expiry (it used to be 10
// minutes) made every resume beyond that window fail mid-download. The ticket
// still names exactly one file and expires within the day, which is plenty of
// protection for a member-only catalogue.
// The ticket names the MEMBER it was handed to (`sub`), not just the file, so a
// link pasted into a public channel is no longer a working download for
// everyone who reads it — and a member banned after collecting their ticket
// stops downloading immediately (checked in routes/downloads.js).
export function signDownloadTicket(id, discordId) {
  return jwt.sign({ role: "dl", id, sub: discordId || null }, JWT_SECRET, { expiresIn: "12h" });
}

// Returns the ticket payload when it is valid for this file, else null.
// Tickets issued before the `sub` claim existed stay valid until they expire,
// so an in-progress multi-gigabyte download survives a server update.
export function verifyDownloadTicket(token, id) {
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (p.role !== "dl" || p.id !== id) return null;
    return p;
  } catch {
    return null;
  }
}

// Resolves ONCE per request whether the caller currently counts as an admin,
// and parks the answer on req. Mounted globally in index.js, ahead of every
// router.
//
// Why a middleware and not a plain helper: the check has to hit the database
// (an admin can be demoted or banned at any moment, while their login token
// stays valid for 30 days), and the ~16 read routes that ask this question do
// so from synchronous helpers. Turning those into async calls would mean a
// forgotten `await` yields a Promise — which is truthy, and would hand private
// seasons to EVERYONE. Resolving it up front keeps every call site synchronous
// and makes the failure direction safe: no middleware, no admin rights.
export async function resolveAdminContext(req, res, next) {
  req.isAdminRequest = false;
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (p.role === "admin") {
      // The PIN token is short-lived (12h) and issued by the admin login itself.
      req.isAdminRequest = true;
    } else if (p.role === "user" && p.isAdmin && p.discordId) {
      // The isAdmin flag was baked in at login. Re-check it live, exactly like
      // requireAdmin does, so revoking admin or banning an account takes hold
      // immediately instead of after the token's 30 days. Both lookups are
      // cached, so this costs nothing on repeat requests. Asked of the account
      // that signed in: admin never travels along a second-account link.
      const [member, stillAdmin] = await Promise.all([
        memberSession(p).catch(() => ({ banned: false })),
        isDiscordAdmin(prisma, loginDiscordId(p)).catch(() => false),
      ]);
      req.isAdminRequest = !member.banned && stillAdmin;
    }
  } catch {
    /* invalid or expired token -> not an admin */
  }
  next();
}

// Non-blocking admin check for otherwise-public routes. Lets a public endpoint
// reveal private seasons (or their deep links) to a signed-in admin without
// gating the endpoint itself. Reads the answer resolved by the middleware
// above; if that never ran, the caller is simply treated as the public.
export function isAdminRequest(req) {
  return req?.isAdminRequest === true;
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
      // Admin is asked of the account that signed in, never of a main account
      // reached through a second-account link (lib/accountLinks.js).
      const member = await memberSession(payload);
      if (!member.banned && (await isDiscordAdmin(prisma, loginDiscordId(payload)))) {
        req.admin = payload;
        req.user = member.user;
        return next();
      }
    } catch {
      /* fall through to 401 */
    }
  }
  return res.status(401).json({ error: "Invalid or expired token" });
}
