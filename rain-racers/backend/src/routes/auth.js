import { Router } from "express";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import prisma from "../db.js";
import { ADMIN_PIN, DISCORD, DISCORD_ENABLED, IS_PROD } from "../config.js";
import { readCookies, signIn, signInAdmin, signOut } from "../auth.js";

const router = Router();

// Wrong PINs per address. Five tries, then a quarter of an hour's wait.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 5;

function sameText(a, b) {
  // Hashing first gives both sides the same length, which timingSafeEqual needs.
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

router.post("/auth/admin", (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const f = failures.get(ip);
  if (f && now - f.first < WINDOW_MS && f.count >= MAX_TRIES) {
    return res.status(429).json({ error: "Too many wrong PINs. Try again in 15 minutes." });
  }
  if (!ADMIN_PIN || !sameText(req.body?.pin ?? "", ADMIN_PIN)) {
    const entry = f && now - f.first < WINDOW_MS ? f : { first: now, count: 0 };
    entry.count++;
    failures.set(ip, entry);
    return res.status(401).json({ error: ADMIN_PIN ? "Wrong PIN." : "No ADMIN_PIN is set on the server." });
  }
  failures.delete(ip);
  signInAdmin(res);
  res.json({ ok: true });
});

router.post("/auth/logout", (_req, res) => {
  signOut(res);
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  const u = req.user;
  res.json({
    user: u
      ? { id: u.id, name: u.name, avatar: u.avatar, driver: u.driver ? { id: u.driver.id, name: u.driver.name } : null }
      : null,
    isAdmin: req.isAdmin,
    discordEnabled: DISCORD_ENABLED,
  });
});

// ---- Discord login ---------------------------------------------------------
// Standard OAuth code flow with the "identify" scope only: we learn the id,
// the name and the avatar, nothing else. A random state in a short-lived
// cookie ties the answer to the browser that asked.

router.get("/auth/discord", (_req, res) => {
  if (!DISCORD_ENABLED) return res.status(503).send("Discord login is not set up on this server.");
  const state = randomBytes(16).toString("hex");
  res.cookie("rr_oauth", state, { httpOnly: true, sameSite: "lax", secure: IS_PROD, maxAge: 10 * 60 * 1000, path: "/" });
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: DISCORD.clientId,
    redirect_uri: DISCORD.redirectUri,
    response_type: "code",
    scope: "identify",
    state,
    prompt: "none",
  }).toString();
  res.redirect(url.toString());
});

router.get("/auth/discord/callback", async (req, res) => {
  const { code, state } = req.query;
  const expected = readCookies(req).rr_oauth;
  res.clearCookie("rr_oauth", { path: "/" });
  if (!code || !state || !expected || state !== expected) return res.redirect("/?login=failed");

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD.clientId,
        client_secret: DISCORD.clientSecret,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: DISCORD.redirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
    const { access_token } = await tokenRes.json();

    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!meRes.ok) throw new Error(`users/@me ${meRes.status}`);
    const me = await meRes.json();

    const name = me.global_name || me.username || "Driver";
    const avatar = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128` : null;
    const user = await prisma.user.upsert({
      where: { discordId: me.id },
      create: { discordId: me.id, name, avatar },
      update: { name, avatar },
    });
    signIn(res, user);
    res.redirect("/");
  } catch (err) {
    console.error("Discord login failed:", err.message);
    res.redirect("/?login=failed");
  }
});

export default router;
