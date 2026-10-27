import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

export const PORT = Number(process.env.PORT) || 4000;
export const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT;

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const JWT_SECRET = process.env.JWT_SECRET || "";
// "<...>" is a placeholder copied from the README, never a real secret.
const isPlaceholder = (v) => /[<>]/.test(v);
if (!JWT_SECRET || JWT_SECRET === "change-me" || isPlaceholder(JWT_SECRET) || (IS_PROD && JWT_SECRET.length < 32)) {
  // Every login cookie is signed with this. A guessable one hands out admin.
  console.error("JWT_SECRET is missing, still a placeholder or too short. Set a long random value (40+ letters and digits).");
  process.exit(1);
}

// A placeholder PIN counts as none: the admin login then says so.
export const ADMIN_PIN = isPlaceholder(process.env.ADMIN_PIN || "") ? "" : process.env.ADMIN_PIN || "";
// so the login can say why it refuses ("<1234>" instead of "1234")
export const ADMIN_PIN_IS_PLACEHOLDER = isPlaceholder(process.env.ADMIN_PIN || "");
export const ADMIN_DISCORD_IDS = (process.env.ADMIN_DISCORD_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const DISCORD = {
  clientId: process.env.DISCORD_CLIENT_ID || "",
  clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
  redirectUri: process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/api/auth/discord/callback`,
};
export const DISCORD_ENABLED = !!(DISCORD.clientId && DISCORD.clientSecret);
