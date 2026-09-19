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

// once a minute: everyone actually sitting in voice with somebody gets a minute.
// muted, deafened, alone or parked in the AFK channel is not being there, it is
// a client left running, and that would buy the whole multiplier overnight.
function countVoiceMinute() {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;
  const heads = new Map(); // channel -> how many humans are in it
  const people = [];
  for (const vs of guild.voiceStates.cache.values()) {
    if (!vs.channelId) continue;
    const user = vs.member?.user || client.users.cache.get(vs.id);
    if (user?.bot !== false) continue; // unknown counts as a bot: no credit on a guess
    heads.set(vs.channelId, (heads.get(vs.channelId) || 0) + 1);
    people.push(vs);
  }
  let counted = 0;
  for (const vs of people) {
    if (!config.countAfkChannel && vs.channelId === guild.afkChannelId) continue;
    if (!config.countMuted && (vs.selfMute || vs.selfDeaf || vs.mute || vs.deaf || vs.suppress)) continue;
    if (!config.countAlone && (heads.get(vs.channelId) || 0) < 2) continue;
    bumpMinutes(state, vs.id, 1);
    counted++;
  }
  if (counted) dirty = true;
}

// true once this process has read the invites itself. the snapshot restored
// from state.json is from the last run and everything moved since then would
// look like one join, so nothing is credited until we have our own.
let invitesAreOurs = false;
// codes discord removed in the last few seconds, with who made them. a
// single-use invite is deleted AND used at the same moment, and the two events
// arrive in either order.
let recentlyDeleted = [];
let fetching = null;

async function refreshInvites() {
  if (fetching) return fetching; // a burst of joins is one fetch, not twenty
  fetching = readInvites().finally(() => {
    fetching = null;
  });
  return fetching;
}

async function readInvites() {
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
    invitesAreOurs = true;
    return snapshot;
  } catch (e) {
    invitesAreOurs = false;
    log(`! could not read the invites: ${e.message}`);
    log("  Needs the Manage Server permission. Messages and voice still work.");
    return null;
  }
}

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== config.guildId) return;
  if (member.user?.bot) return;
  const trustBefore = invitesAreOurs;
  const before = state.invites;
  const after = await refreshInvites();
  if (!after) return;
  state.invites = after;
  dirty = true;
  // a stale snapshot would pin every invite used while the bot was down on
  // whoever happens to be the single riser. say nothing instead.
  if (!trustBefore) {
    log(`+ ${member.user.tag} joined, inviter unknown (first look at the invites)`);
    return;
  }
  const inviterId = inviteUsed(before, after) || usedUpInvite();
  if (!inviterId) {
    log(`+ ${member.user.tag} joined, inviter unknown`);
    return;
  }
  if (inviterId === member.id) return;
  state.referrals.push({ discordId: member.id, inviterDiscordId: inviterId });
  log(`+ ${member.user.tag} joined through ${inviterId}`);
  await flush();
});

// an invite that just vanished, if it looks like it vanished by being used up
function usedUpInvite() {
  const cutoff = Date.now() - 15_000;
  const fresh = recentlyDeleted.filter((d) => d.at >= cutoff);
  recentlyDeleted = fresh;
  return fresh.length === 1 ? fresh[0].inviterId || null : null;
}

const rememberInvites = async () => {
  const snapshot = await refreshInvites();
  if (snapshot) {
    state.invites = snapshot;
    dirty = true;
  }
};
client.on(Events.InviteCreate, rememberInvites);
client.on(Events.InviteDelete, async (invite) => {
  // a max_uses=1 invite is deleted and used in the same breath, and this event
  // can beat the join. keep who made it so the join can still be credited.
  const inviterId = invite?.inviterId || invite?.inviter?.id || state.invites?.[invite?.code]?.inviterId || null;
  if (invite?.code) recentlyDeleted.push({ code: invite.code, inviterId, at: Date.now() });
  await rememberInvites();
});

const MAX_REFERRALS = 2000;
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
    if (state.referrals.length > MAX_REFERRALS) {
      // the site has been refusing these for a long time (wrong key, usually).
      // keep the newest and say so, rather than growing the file forever.
      const lost = state.referrals.length - MAX_REFERRALS;
      state.referrals = state.referrals.slice(-MAX_REFERRALS);
      dirty = true;
      log(`! ${lost} older joins dropped, the site has not taken them. Check the key.`);
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

// whatever goes wrong, write down what has been counted before going away
for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, (err) => {
    log(`! ${event}: ${err?.message || err}`);
    persist();
    shutdown(1);
  });
}

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
