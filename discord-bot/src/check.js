// npm run check: is the .env ok and does the site accept the key? writes nothing.
import { config, missingSettings } from "./config.js";
import { ping } from "./site.js";

const ok = (s) => console.log(`  ok    ${s}`);
const bad = (s) => console.log(`  FIX   ${s}`);

console.log("");

const missing = missingSettings({ needDiscord: false });
if (missing.length) {
  bad(`${missing.join(", ")} missing in .env`);
  console.log("\nCopy .env.example to .env, fill it in, run this again.\n");
  process.exitCode = 1;
}
if (!missing.length) {
  ok(`site: ${config.siteUrl}`);
  ok(`key: ${config.tokenKey.slice(0, 6)}… (${config.tokenKey.length} chars)`);
  if (!config.discordToken) bad("DISCORD_TOKEN missing (not needed for this check, needed to run)");
  else ok("DISCORD_TOKEN set");
  if (!config.guildId) bad("GUILD_ID missing (not needed for this check, needed to run)");
  else ok(`server id: ${config.guildId}`);

  try {
    await ping();
    ok("site accepted the key");
    console.log("\nAll good, start with: npm start\n");
  } catch (e) {
    const why = String(e.message);
    bad(why);
    if (why.includes("Bad key")) console.log("\nWrong key. Copy it again from Admin -> NABS Points -> Discord bot.\n");
    else if (why.includes("fetch failed") || why.includes("ECONNREFUSED"))
      console.log(`\nNothing answered at ${config.siteUrl}. SITE_URL right? Site running?\n`);
    else console.log("");
    process.exitCode = 1;
  }
}
