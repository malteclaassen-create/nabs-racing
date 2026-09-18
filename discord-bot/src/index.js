import { Client, Events, GatewayIntentBits } from "discord.js";
import { config, missingSettings } from "./config.js";
import { leagueDay } from "./day.js";
import { inviteUsed, snapshotFrom } from "./invites.js";
import { sendActivity, sendReferrals, ping } from "./site.js";
import { bumpMessages, bumpMinutes, forgetOldDays, load, markSent, pendingActivity, save } from "./store.js";

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace("T", " "), ...a);

const missing = missingSettings();
if (missing.length) {
  console.error(`Cannot start: ${missing.join(", ")} not set. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}

const state = load();
let dirty = false;

// no MessageContent intent on purpose, counting doesn't need it
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
});

client.on(Events.MessageCreate, (message) => {
  if (message.guildId !== config.guildId) return;
  if (message.author?.bot) return;
  const channelId = message.channelId;
  if (config.ignoreChannels.includes(channelId)) return;
  if (config.countChannels.length && !config.countChannels.includes(channelId)) return;
  bumpMessages(state, message.author.id, 1);
  dirty = true;
});

// once a minute: everyone sitting in a voice channel gets a minute
function countVoiceMinute() {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;
  let counted = 0;
  for (const vs of guild.voiceStates.cache.values()) {
    if (!vs.channelId) continue;
    if (!config.countAfkChannel && vs.channelId === guild.afkChannelId) continue;
    const user = vs.member?.user || client.users.cache.get(vs.id);
    if (user?.bot) continue;
    bumpMinutes(state, vs.id, 1);
    counted++;
  }
  if (counted) dirty = true;
}

async function refreshInvites() {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return {};
  try {
    const invites = await guild.invites.fetch();
    const snapshot = snapshotFrom(invites.values());
    try {
      const vanity = await guild.fetchVanityData();
      if (vanity?.code) snapshot[vanity.code] = { uses: vanity.uses || 0, inviterId: null };
    } catch {
      /* no vanity url */
    }
    return snapshot;
  } catch (e) {
    log(`! could not read the invites: ${e.message}`);
    log("  Needs the Manage Server permission. Messages and voice still work.");
    return null;
  }
}

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== config.guildId) return;
  if (member.user?.bot) return;
  const before = state.invites;
  const after = await refreshInvites();
  if (!after) return;
  state.invites = after;
  dirty = true;
  const inviterId = inviteUsed(before, after);
  if (!inviterId) {
    log(`+ ${member.user.tag} joined, inviter unknown`);
    return;
  }
  if (inviterId === member.id) return;
  state.referrals.push({ discordId: member.id, inviterDiscordId: inviterId });
  log(`+ ${member.user.tag} joined through ${inviterId}`);
  await flush();
});

const rememberInvites = async () => {
  const snapshot = await refreshInvites();
  if (snapshot) {
    state.invites = snapshot;
    dirty = true;
  }
};
client.on(Events.InviteCreate, rememberInvites);
client.on(Events.InviteDelete, rememberInvites);

let sending = false;
async function flush() {
  if (sending) return;
  sending = true;
  try {
    const entries = pendingActivity(state);
    if (entries.length) {
      const done = await sendActivity(entries);
      markSent(state, done);
      dirty = true;
      log(`-> ${done.length} day rows sent`);
    }
    if (state.referrals.length) {
      const res = await sendReferrals([...state.referrals]);
      state.referrals = state.referrals.slice(res.length);
      dirty = true;
      log(`-> ${res.length} joins reported`);
    }
  } catch (e) {
    log(`! website not reachable (${e.message}), will retry`);
  } finally {
    sending = false;
    persist();
  }
}

function persist() {
  if (!dirty) return;
  try {
    save(state);
    dirty = false;
  } catch (e) {
    log(`! could not write state.json: ${e.message}`);
  }
}

const timers = [];
function shutdown(code = 0) {
  for (const t of timers.splice(0)) clearInterval(t);
  client.destroy();
  process.exitCode = code;
}

client.once(Events.ClientReady, async (c) => {
  log(`Signed in as ${c.user.tag}`);
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) {
    console.error(`Bot is not on the server ${config.guildId}. Invite it first.`);
    shutdown(1);
    return;
  }
  log(`Watching ${guild.name}, day ${leagueDay()}`);

  try {
    await ping();
    log(`Website ok: ${config.siteUrl}`);
  } catch (e) {
    log(`! website: ${e.message} (counting anyway)`);
  }

  await rememberInvites();
  if (forgetOldDays(state)) dirty = true;
  persist();

  timers.push(setInterval(countVoiceMinute, 60 * 1000));
  timers.push(setInterval(flush, config.pushEveryMs));
  timers.push(
    setInterval(() => {
      if (forgetOldDays(state)) {
        dirty = true;
        persist();
      }
    }, 6 * 3600 * 1000)
  );
  await flush();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    log("Stopping...");
    await flush();
    persist();
    shutdown(0);
  });
}

client.login(config.discordToken).catch((e) => {
  console.error(`Discord login failed: ${e.message}`);
  console.error("Check DISCORD_TOKEN and the intents in the developer portal.");
  shutdown(1);
});
