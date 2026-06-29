// ---------------------------------------------------------------------------
// Discord OAuth2 login (scope: identify).
// Flow: frontend redirects user to Discord -> Discord redirects back with a
// ?code -> frontend POSTs the code here -> we exchange it, fetch the user's
// Discord identity, link/match it to a Driver, and issue our own user JWT.
//
// Entirely OPTIONAL: if DISCORD_CLIENT_ID/SECRET are not set, /config reports
// disabled and the site keeps using the dropdown fallback.
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { signUserToken } from "../middleware/auth.js";

const router = Router();

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "http://localhost:5173/auth/discord/callback";
const SCOPE = "identify";

function enabled() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

// The OAuth redirect must come back to whatever host the user is actually on
// (localhost during dev, the tunnel URL when sharing) so login works in both
// without editing .env. The frontend sends its own callback URL; we only accept
// a well-formed .../auth/discord/callback and otherwise fall back to the env
// value. Discord still enforces its own redirect whitelist on top of this, so an
// attacker can't point the code anywhere that isn't registered in the app.
function pickRedirect(explicit) {
  const val = String(explicit || "").trim();
  if (/^https?:\/\/[^\s?#]+\/auth\/discord\/callback$/.test(val)) return val;
  return REDIRECT_URI;
}

// normalize a name for matching (lowercase, strip accents/punctuation)
function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// GET /api/auth/discord/config?redirect=<origin>/auth/discord/callback -> { enabled, url? }
router.get("/config", (req, res) => {
  if (!enabled()) return res.json({ enabled: false });
  const redirectUri = pickRedirect(req.query.redirect);
  const url =
    `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code&scope=${encodeURIComponent(SCOPE)}`;
  res.json({ enabled: true, url });
});

// POST /api/auth/discord/callback { code } -> { token, user }
router.post("/callback", async (req, res, next) => {
  try {
    if (!enabled()) return res.status(400).json({ error: "Discord login is not configured" });
    const { code, redirectUri } = req.body || {};
    if (!code) return res.status(400).json({ error: "Missing code" });

    // 1. Exchange the code for an access token. The redirect_uri MUST match the
    //    one used to start the flow (sent by the frontend, same as in /config).
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: pickRedirect(redirectUri),
      }),
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      return res.status(401).json({ error: "Discord token exchange failed", detail: t.slice(0, 200) });
    }
    const { access_token } = await tokenRes.json();

    // 2. Fetch the Discord identity.
    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!meRes.ok) return res.status(401).json({ error: "Could not read Discord profile" });
    const me = await meRes.json(); // { id, username, global_name, avatar, ... }
    const displayName = me.global_name || me.username;
    const avatarUrl = me.avatar
      ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.${me.avatar.startsWith("a_") ? "gif" : "png"}?size=256`
      : null;

    // 3. Find / link a driver.
    let driver = await prisma.driver.findUnique({ where: { discordUserId: me.id } });

    if (!driver) {
      // Try to match by Discord name against existing drivers.
      const candidates = [norm(me.username), norm(me.global_name)].filter(Boolean);
      const all = await prisma.driver.findMany();
      const match = all.find((d) => {
        const opts = [norm(d.discordName), norm(d.name)];
        return candidates.some((c) => opts.includes(c)) && !d.discordUserId;
      });
      if (match) {
        driver = await prisma.driver.update({
          where: { id: match.id },
          data: { discordUserId: me.id },
        });
      }
    }

    // Keep the driver's Discord avatar fresh on each login (used as the profile
    // picture unless an admin has set an explicit photoUrl).
    if (driver && avatarUrl && driver.discordAvatar !== avatarUrl) {
      await prisma.driver.update({ where: { id: driver.id }, data: { discordAvatar: avatarUrl } });
    }

    const profile = {
      discordId: me.id,
      discordName: displayName,
      driverId: driver?.id || null,
      driverName: driver?.name || null,
      // Resolved avatar for the nav chip: custom upload wins, else Discord avatar.
      avatarUrl: (driver && driver.photoUrl) || avatarUrl || null,
    };
    const token = signUserToken(profile);
    res.json({ token, user: profile, linked: !!driver });
  } catch (e) {
    next(e);
  }
});

export default router;
