import jwt from "jsonwebtoken";
import { JWT_SECRET, IS_PROD, ADMIN_DISCORD_IDS } from "./config.js";
import prisma from "./db.js";

// Two cookies, both httpOnly and SameSite=Lax (so another site cannot make a
// browser send them along with a form post):
//   rr_session  a member signed in with Discord   { uid }
//   rr_admin    the admin PIN was entered          { admin: true }
const SESSION = "rr_session";
const ADMIN = "rr_admin";
const DAY = 24 * 60 * 60 * 1000;

export function readCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAgeMs) {
  res.cookie(name, value, { httpOnly: true, sameSite: "lax", secure: IS_PROD, maxAge: maxAgeMs, path: "/" });
}

function verify(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function signIn(res, user) {
  setCookie(res, SESSION, jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: "60d" }), 60 * DAY);
}

export function signInAdmin(res) {
  setCookie(res, ADMIN, jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: "7d" }), 7 * DAY);
}

export function signOut(res) {
  res.clearCookie(SESSION, { path: "/" });
  res.clearCookie(ADMIN, { path: "/" });
}

// Puts req.user (or null) and req.isAdmin on every request.
export async function attachAuth(req, _res, next) {
  const cookies = readCookies(req);
  req.user = null;
  req.isAdmin = !!verify(cookies[ADMIN])?.admin;
  const session = verify(cookies[SESSION]);
  if (session?.uid) {
    req.user = await prisma.user.findUnique({ where: { id: session.uid }, include: { driver: true } });
    if (req.user && ADMIN_DISCORD_IDS.includes(req.user.discordId)) req.isAdmin = true;
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in with Discord first." });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(401).json({ error: "Admin only." });
  next();
}
