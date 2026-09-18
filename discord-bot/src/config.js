import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// tiny .env reader, real env vars win over the file
function loadEnvFile() {
  let text = "";
  try {
    text = readFileSync(join(ROOT, ".env"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadEnvFile();

const list = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export const config = {
  discordToken: process.env.DISCORD_TOKEN || "",
  guildId: process.env.GUILD_ID || "",
  siteUrl: (process.env.SITE_URL || "http://localhost:4000").replace(/\/+$/, ""),
  tokenKey: process.env.TOKEN_KEY || "",
  countChannels: list(process.env.COUNT_CHANNELS),
  ignoreChannels: list(process.env.IGNORE_CHANNELS),
  countAfkChannel: String(process.env.COUNT_AFK_CHANNEL ?? "true") !== "false",
  pushEveryMs: Math.max(1, Number(process.env.PUSH_EVERY_MINUTES) || 5) * 60 * 1000,
  statePath: join(ROOT, "state.json"),
};

export function missingSettings({ needDiscord = true } = {}) {
  const missing = [];
  if (!config.siteUrl) missing.push("SITE_URL");
  if (!config.tokenKey) missing.push("TOKEN_KEY");
  if (needDiscord && !config.discordToken) missing.push("DISCORD_TOKEN");
  if (needDiscord && !config.guildId) missing.push("GUILD_ID");
  return missing;
}
