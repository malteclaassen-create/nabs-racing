import { Client, Events, GatewayIntentBits } from "discord.js";
import { config, missingSettings } from "./config.js";
import { leagueDay } from "./day.js";
import { inviteUsed, snapshotFrom } from "./invites.js";
import { fetchDay, sendActivity, sendNames, sendReferrals, ping } from "./site.js";
import { bootSnapshot, bumpMessages, bumpMinutes, forgetOldDays, load, markSent, pendingActivity, save, seedFromSite } from "./store.js";

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace("T", " "), ...a);

const missing = missingSettings();
if (missing.length) {
  console.error(`Cannot start: ${missing.join(", ")} not set. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}

const state = load();
let dirty = false;

// the day as this process found it, taken before anything is counted. the
// site's totals for today are laid under it once (seedToday), so a restart
// that lost state.json does not start the day again from zero.
const bootDay = leagueDay();
const boot = bootSnapshot(state, bootDay);
let seeded = false;

async function seedToday() {
  if (seeded) return;
  if (leagueDay() !== bootDay) {
    seeded = true; // a new day started from zero on its own, nothing to catch up
    return;
  }
  try {
    const rows = await fetchDay(bootDay);
    const changed = seedFromSite(state, bootDay, rows, boot);
    seeded = true;
    if (changed) dirty = true;
    log(`<- today's totals from the website (${rows.length} members, ${changed} caught up)`);
  } catch (e) {
    log(`! could not read today's totals (${e.message}), will try again`);
  }
}

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
  state.referrals.push({
    discordId: member.id,
    inviterDiscordId: inviterId,
    // Whoever just joined has no account on the website yet, so the site would
    // have nothing to call them but their id.
    name: memberName(member),
    inviterName: memberName(guildMember(inviterId)),
  });
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

// What to call somebody: their name on this server if they set one, else their
// Discord name. Not the tag, that is a handle with a number on it.
const memberName = (member) =>
  member?.displayName || member?.nickname || member?.user?.globalName || member?.user?.username || null;
const guildMember = (id) => client.guilds.cache.get(config.guildId)?.members?.cache?.get(id) || null;

// Everybody on the server, so the website can put a name on the rows it only
// has an id for. Cheap enough to repeat: the site keeps the ones it can use and
// drops the rest, and nothing is created from this.
async function pushRoster() {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;
  try {
    const members = await guild.members.fetch();
    const entries = [];
    for (const member of members.values()) {
      if (member.user?.bot) continue;
      const name = memberName(member);
      if (name) entries.push({ discordId: member.id, name });
    }
    if (!entries.length) return;
    const res = await sendNames(entries);
    log(`-> ${res.length} names sent`);
  } catch (e) {
    log(`! could not send the names (${e.message}), will try again later`);
  }
}

const MAX_REFERRALS = 2000;
let sending = false;
async function flush() {
  if (sending) return;
  sending = true;
  try {
    // until the site's totals are in, what we would send is too low
    await seedToday();
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

// Everything that only makes sense once we are actually on the server. Guarded,
// because it can be reached twice: on startup when the bot is already a member,
// and from GuildCreate when somebody adds it while it is running.
let counting = false;
async function startCounting(guild) {
  if (counting) return;
  counting = true;
  log(`Watching ${guild.name}, day ${leagueDay()}`);

  await rememberInvites();
  if (forgetOldDays(state)) dirty = true;
  persist();

  timers.push(setInterval(countVoiceMinute, 60 * 1000));
  timers.push(setInterval(flush, config.pushEveryMs));
  // People rename themselves, and somebody who joined while the bot was down
  // is not in any join we reported. Six hours is often enough for a label.
  timers.push(setInterval(pushRoster, 6 * 3600 * 1000));
  timers.push(
    setInterval(() => {
      if (forgetOldDays(state)) {
        dirty = true;
        persist();
      }
    }, 6 * 3600 * 1000)
  );
  await flush();
  await pushRoster();
}

client.once(Events.ClientReady, async (c) => {
  log(`Signed in as ${c.user.tag}`);

  // The website FIRST, before anything can send us home early. Getting the key
  // wrong and being on the wrong server are two separate mistakes, and one
  // start should tell you about both instead of hiding the second behind the
  // first.
  try {
    await ping();
    log(`Website ok: ${config.siteUrl}`);
  } catch (e) {
    log(`! website: ${e.message} (counting anyway)`);
  }

  const guild = client.guilds.cache.get(config.guildId);
  if (guild) {
    await startCounting(guild);
    return;
  }
  // Not invited yet. Wait for it rather than exiting: the bot is usually set up
  // before the person who can accept the invite gets round to it, and quitting
  // here means somebody has to come back and restart it afterwards.
  log(`Not on server ${config.guildId} yet. Waiting for the invite, nothing else to do.`);
  log(`  If it is already invited, GUILD_ID is pointing at the wrong server.`);
});

// Somebody accepted the invite while we were waiting.
client.on(Events.GuildCreate, async (guild) => {
  if (guild.id !== config.guildId) return;
  log(`Added to ${guild.name}.`);
  await startCounting(guild);
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
