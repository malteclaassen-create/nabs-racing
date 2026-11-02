import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { ErrorBox, DriverAvatar, Field, Notice } from "./ui.jsx";
import { FilterChip, SearchField } from "./AdminFilters.jsx";
import TeamLogo from "./TeamLogo.jsx";
import IdChip from "./IdChip.jsx";
import AdminPersons from "./AdminPersons.jsx";
import { useAsk } from "./overlay.jsx";
import { fmtStamp, NO_VALUE } from "../utils/format.js";
import { MEMBERS_CHANGED_EVENT } from "../data/adminEvents.js";

// Admin "Members" tab: every Discord account that has ever logged in on the
// site. Logins connect to a driver ONLY via a stored Discord user ID (the old
// name matcher was an impersonation hole and is gone), so this tab is where
// identities get managed:
//   * check the newcomers who signed themselves up (their first race answer
//     made them a reserve driver, backend lib/newcomers.js): keep them, turn
//     them away, or join them to the roster entry they already had,
//   * see who logged in but is NOT linked to any driver (and link them by hand),
//   * see which roster drivers never logged in at all,
//   * ban an account (no more logins, running sessions stop working),
//   * join a driver's two Discord accounts: the second one signs in as the
//     main one (backend lib/accountLinks.js).
const fmtDate = (v) => fmtStamp(v) || NO_VALUE;

// The admin navigation puts the "logins with no driver" count, plus the new
// drivers waiting for a check, on the Members tab. Linking somebody (or
// creating their driver, keeping or turning away a newcomer, banning them) has
// to take that number down straight away, so every finished action says so
// (MEMBERS_CHANGED_EVENT, data/adminEvents.js).

// One row of this tab, in two parts: WHO on the left, WHAT YOU CAN DO on the
// right. They used to be one long flex line, which meant the buttons ate the
// width and squeezed the name column down to a few characters while the chips
// under it wrapped into a tall stack — narrow and cut off on the left, four
// controls crammed onto one line on the right, with empty space above them.
//
// They only go side by side from 2xl. The action group alone is about 500px
// wide, and the admin panel sits beside the menu rail, so anything narrower
// leaves the identity too thin to hold its own chips on one line — under each
// other, both halves get the full width instead.
function MemberRow({ avatar, children, actions, className = "" }) {
  return (
    <div className={`flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between 2xl:gap-6 ${className}`}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="shrink-0">{avatar}</span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 2xl:shrink-0 2xl:justify-end">{actions}</div>
    </div>
  );
}

// Whether StatusPills has anything to say. A linked, unbanned, ordinary member
// has none of them, and the row must not keep an empty line's worth of margin
// for the pills that aren't there.
//
// A newcomer who signed themselves up and nobody has kept or turned away yet
// is isNewDriver: the same rule the server counts for the nav badge (GET
// /members/pending). A second account drives as its main one, and an account
// whose driver an admin already deleted by hand in the Drivers tab has had its
// answer.
const isNewDriver = (m) => !!(m.newDriverAt && !m.mainDiscordId && m.driver);
const hasPills = (m) =>
  !!(
    m.isAdmin || m.isSteward || m.isRaceControl || m.banned || m.mainDiscordId || m.seconds?.length ||
    isNewDriver(m) || m.turnedAwayAt || !m.driver || !m.driver.isActiveSeason
  );

// Their upcoming race answers, as the small pills on a New drivers row. The
// words are the ones the attendance history uses (In / Out / Maybe), so an
// admin reads the same thing in both places.
const ANSWER_PILL = {
  ACCEPTED: { label: "In", className: "bg-ok/10 text-ok" },
  TENTATIVE: { label: "Maybe", className: "bg-warn/10 text-warn" },
  DECLINED: { label: "Out", className: "bg-bad/10 text-bad" },
  WAITLIST: { label: "Waiting list", className: "bg-sky-500/15 text-sky-600" },
};
const answerPlace = (a) => (a.round != null ? `R${a.round} ${a.track}` : a.track || "A race");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// "Max 2", or "Max 2 and Max 2 (GT Season 1)" when a second series signed them
// up too. The season only gets named when there is more than one to tell apart.
function rowNames(rows) {
  const names = rows.map((r) => (rows.length > 1 && r.seasonName ? `${r.name} (${r.seasonName})` : r.name));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] || "";
}

// The chips over "All login accounts". Each is one of the questions this list
// gets asked ("who is banned?", "who are the stewards?"), answered from what
// the rows already carry. "Steam differs" is the case the Steam chip on a row
// turns amber for: the account and its driver row name two different Steam
// accounts, so race results may land on the wrong person.
const steamDiffers = (m) => !!(m.steamId && m.driver?.steamId && m.steamId !== m.driver.steamId);
const MEMBER_FILTERS = [
  { key: "banned", label: "Banned", test: (m) => !!m.banned },
  { key: "steward", label: "Stewards", test: (m) => !!m.isSteward && !m.isAdmin },
  { key: "racecontrol", label: "Race control", test: (m) => !!m.isRaceControl && !m.isAdmin },
  { key: "admin", label: "Admins", test: (m) => !!m.isAdmin },
  { key: "new", label: "New drivers", test: isNewDriver },
  { key: "nodriver", label: "Without driver", test: (m) => !m.driver },
  { key: "steam", label: "Steam differs", test: steamDiffers },
];

// Whether an account matches the search: its names, its Discord and Steam
// ids, and the driver it is linked to.
function memberMatches(m, q) {
  return [m.displayName, m.username, m.discordId, m.steamId, m.driver?.name, m.driver?.steamId, m.driver?.team?.name]
    .some((v) => v && String(v).toLowerCase().includes(q));
}

function StatusPills({ m }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {m.isAdmin && (
        <span className="rounded-full bg-link/15 px-2 py-0.5 text-[11px] font-semibold text-link" title="Has full admin access on Discord login">
          admin
        </span>
      )}
      {/* Admins get every report anyway; the badge is for the people who were
          given the reports and nothing else. */}
      {m.isSteward && !m.isAdmin && (
        <span
          className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand"
          title="Can read and answer every incident report. No other admin access."
        >
          steward
        </span>
      )}
      {m.isRaceControl && !m.isAdmin && (
        <span
          className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-warn"
          title="Watches races live: race control on the TV board and a pairing code for the game app. No other admin access."
        >
          race control
        </span>
      )}
      {m.mainDiscordId && (
        <span
          className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-600"
          title="Signs in as its main account: same driver, sign-ups and tokens. The admin area stays with the account it was given to."
        >
          second account of {m.mainName || m.mainDiscordId}
        </span>
      )}
      {m.seconds?.length > 0 && (
        <span
          className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-600"
          title="These Discord accounts sign in as this one."
        >
          also signs in as {m.seconds.join(", ")}
        </span>
      )}
      {m.banned && (
        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-bad" title={m.banReason || undefined}>
          banned{m.banReason ? ` · ${m.banReason}` : ""}
        </span>
      )}
      {isNewDriver(m) && (
        <span
          className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-600"
          title={`Signed themselves up on ${fmtDate(m.newDriverAt)}. Keep them or turn them away under New drivers.`}
        >
          new
        </span>
      )}
      {/* Quiet on purpose: it is history, not work. It only matters when they
          ask to race again, and then the row says so on its own. */}
      {m.turnedAwayAt && (
        <span
          className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-semibold text-light"
          title={`Turned away on ${fmtDate(m.turnedAwayAt)}. The site won't sign them up by itself again. They can still ask with "I want to race".`}
        >
          turned away
        </span>
      )}
      {m.driver ? (
        !m.driver.isActiveSeason && (
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-600">
            linked in {m.driver.seasonName || "older season"}
          </span>
        )
      ) : (
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-warn">
          not linked to a driver
        </span>
      )}
    </span>
  );
}

export default function AdminMembers() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.adminMembers(), []));
  // Teams of the ACTIVE season (new drivers always join the running season).
  const { active } = useSeason();
  const teamsApi = useApi(
    useCallback(() => (active ? api.teamsForSeason(active.number) : Promise.resolve([])), [active?.number])
  );
  const [busy, setBusy] = useState(null); // discordId of the row being changed
  const [msg, setMsg] = useState(null);
  const [linkChoice, setLinkChoice] = useState({}); // discordId -> driverId
  // "Same person as…": which account's picker is open, and what it picked.
  const [pairing, setPairing] = useState(null); // discordId | null
  const [pairChoice, setPairChoice] = useState("");
  // "Create new driver" inline form: which account it's open for + its fields.
  const [creating, setCreating] = useState(null); // discordId | null
  const [createForm, setCreateForm] = useState({ name: "", teamId: "" });
  // Search and chips over "All login accounts". Chips combine (banned AND
  // without driver), because each one narrows rather than picks a view.
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState(() => new Set());
  const ask = useAsk();

  if (error) return <ErrorBox message={error} />;

  // Each main account learns which second accounts sign in as it.
  const secondsByMain = new Map();
  for (const m of data?.members || []) {
    if (!m.mainDiscordId) continue;
    if (!secondsByMain.has(m.mainDiscordId)) secondsByMain.set(m.mainDiscordId, []);
    secondsByMain.get(m.mainDiscordId).push(m.displayName || m.username);
  }
  const members = (data?.members || []).map((m) => ({ ...m, seconds: secondsByMain.get(m.discordId) || [] }));
  // Accounts another one can be joined to as its second account: ordinary
  // accounts (a second account's own main is the one to pick).
  const mainCandidates = members
    .filter((m) => !m.mainDiscordId)
    .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username));
  const unclaimed = data?.unclaimed || [];
  // Accounts with a pending "I want to race" hand-raise float to the top —
  // that's the most actionable item in the whole tab. A second account has
  // nothing waiting: it drives as its main account.
  const unlinked = members
    .filter((m) => !m.driver && !m.mainDiscordId)
    .sort((a, b) => (b.raceRequestAt ? 1 : 0) - (a.raceRequestAt ? 1 : 0));
  const requests = unlinked.filter((m) => m.raceRequestAt).length;
  // Newcomers who signed themselves up, newest first like the To do card.
  const newDrivers = members
    .filter(isNewDriver)
    .sort((a, b) => (Date.parse(b.newDriverAt) || 0) - (Date.parse(a.newDriverAt) || 0));
  const q = query.trim().toLowerCase();
  const shownMembers = members.filter(
    (m) => (!q || memberMatches(m, q)) && MEMBER_FILTERS.every((f) => !chips.has(f.key) || f.test(m))
  );
  const filtering = !!q || chips.size > 0;
  function toggleChip(key) {
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  // Reserve first — that's where newcomers usually start.
  const teams = [...(teamsApi.data || [])].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

  async function act(id, fn) {
    setBusy(id);
    setMsg(null);
    try {
      await fn();
      await reload();
      window.dispatchEvent(new Event(MEMBERS_CHANGED_EVENT)); // nav badge
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  // Still a native prompt: this one both CONFIRMS the ban and collects an
  // optional free-text reason (null = cancelled, "" = ban without a reason),
  // and our ask() dialog cannot take free text. Needs a real input dialog.
  function ban(m) {
    const reason = window.prompt(
      `Ban "${m.displayName || m.username}"?\n\nThey can no longer log in and their current session stops working.\nOptional: enter a reason (visible only to admins).`,
      ""
    );
    if (reason === null) return; // cancelled
    act(m.discordId, () => api.banMember(m.discordId, true, reason.trim() || null));
  }

  async function unban(m) {
    if (!(await ask({ title: `Lift the ban for "${m.displayName || m.username}"?`, confirmLabel: "Unban" }))) return;
    act(m.discordId, () => api.banMember(m.discordId, false));
  }

  // What happened to a Steam account the member had connected while waiting for
  // a driver row. Silence when there was nothing to carry over; anything that
  // did NOT land needs the admin to know, because from then on race results
  // match by name again.
  function steamNote(steam, who) {
    if (!steam || steam.reason === "no-claim") return null;
    if (steam.written) return { ok: true, text: `${who} is set up. Their Steam account was carried over.` };
    if (steam.reason === "already-set") return null;
    if (steam.reason === "held-by-other")
      return {
        ok: false,
        text: `${who} is set up, but their Steam account is already on ${steam.byName} this season. Clear it there, then re-enter it under Drivers.`,
      };
    if (steam.reason === "would-change")
      return {
        ok: false,
        text: `${who} is set up. Their driver entry already carries a different Steam account, so it was left alone. Check it under Drivers.`,
      };
    return { ok: false, text: `${who} is set up, but their Steam account could not be carried over. Enter it under Drivers.` };
  }

  // Also the New drivers card's "Same driver as…": a newcomer who turns out to
  // be a roster driver who had never logged in. The server folds the row it
  // made for them in that season into the picked driver, answers included, and
  // says which row went (`merged`), so the admin is not left wondering where
  // the new entry they were looking at disappeared to.
  function link(m, driverId) {
    if (!driverId) return;
    const who = m.displayName || m.username;
    const target = unclaimed.find((d) => d.id === driverId)?.name || "that driver";
    act(m.discordId, async () => {
      const res = await api.linkMember(m.discordId, driverId);
      const note = steamNote(res?.steam, who);
      if (res?.merged) {
        const text = `${who} is linked to ${target}. Their new entry ${res.merged.name} and its race answers moved over to ${target}.`;
        setMsg({ ok: !note || note.ok, text: note ? `${text} ${note.text}` : text });
      } else if (note) setMsg(note);
    });
  }

  // A newcomer stays: off the New drivers list, and nothing else changes.
  function keep(m) {
    const who = m.displayName || m.username;
    act(m.discordId, async () => {
      await api.keepMember(m.discordId);
      setMsg({ ok: true, text: `Kept ${who}. They stay on as ${m.driver?.name || "a reserve"}.` });
    });
  }

  // A newcomer goes. The question spells out what the server is about to
  // remove (lib/newcomers.js turnAwayNewcomer): the rows it made for them and
  // their answers to races still to come, read off the list the card already
  // shows, so the admin is never surprised by what went.
  async function turnAway(m) {
    const who = m.displayName || m.username;
    const nc = m.newcomer || {};
    const rows = nc.rows?.length ? nc.rows : [{ name: m.driver?.name || who }];
    const n = nc.answers?.length || 0;
    const ok = await ask({
      title: `Turn "${who}" away?`,
      body:
        `Their ${rows.length === 1 ? "driver" : "drivers"} ${rowNames(rows)} ${rows.length === 1 ? "goes" : "go"}` +
        (n ? `, and so ${n === 1 ? "does their 1 race answer" : `do their ${n} race answers`}. The waiting list moves up into any seat they held.` : ". They have no answers for races still to come.") +
        ` They get a message saying so, and they can't sign themselves up again. They can still ask with "I want to race".`,
      danger: true,
      confirmLabel: "Turn away",
    });
    if (!ok) return;
    act(m.discordId, async () => {
      const res = await api.turnAwayMember(m.discordId);
      const gone = res?.removed?.length ? rowNames(res.removed) : null;
      const answers = Number(res?.answers) || 0;
      setMsg({
        ok: true,
        text:
          `Turned ${who} away.` +
          (gone ? ` Removed ${gone}` : "") +
          (gone && answers ? ` and ${plural(answers, "race answer", "race answers")}.` : gone ? "." : ""),
      });
    });
  }

  // Safe name-based SUGGESTION for an unlinked account: pre-selects the
  // linkable driver whose name/handle matches the account. Unlike the old
  // login-time matcher this never links by itself — the admin still reads the
  // name and clicks Link, so nobody can claim a profile just by renaming.
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  function suggestionFor(m) {
    const keys = [norm(m.username), norm(m.displayName)].filter(Boolean);
    return unclaimed.find((d) => keys.includes(norm(d.name)) || keys.includes(norm(d.discordName))) || null;
  }

  async function unlink(m) {
    const ok = await ask({
      title: `Unlink "${m.displayName || m.username}" from ${m.driver?.name}?`,
      body: "They stay logged in but lose their driver identity (RSVP, profile editing).",
      danger: true,
      confirmLabel: "Unlink",
    });
    if (!ok) return;
    act(m.discordId, () => api.unlinkMember(m.discordId));
  }

  function openPairing(m) {
    setPairing(pairing === m.discordId ? null : m.discordId);
    setPairChoice("");
  }

  // One driver, two Discord accounts: `m` becomes a second account of the
  // picked one and signs in as it from now on.
  async function pair(m, mainId) {
    const main = members.find((x) => x.discordId === mainId);
    if (!main) return;
    const name = m.displayName || m.username;
    const mainName = main.displayName || main.username;
    const ok = await ask({
      title: `Make "${name}" a second account of "${mainName}"?`,
      body:
        `Logging in as ${name} then counts as ${mainName}: same driver, same attendance sign-ups, driver market, tokens and notifications. ` +
        (m.driver && !m.mainDiscordId
          ? `${name}'s driver entry (${m.driver.name}) ${main.driver ? `is joined to ${mainName}'s as one person` : `moves to ${mainName}`}. `
          : "") +
        `Admin access is not shared. ${name}'s own token balance stays on that account. You can undo this here.`,
      confirmLabel: "Join accounts",
    });
    if (!ok) return;
    act(m.discordId, async () => {
      await api.setSecondAccount(m.discordId, mainId);
      setPairing(null);
      setMsg({ ok: true, text: `${name} now signs in as ${mainName}.` });
    });
  }

  async function unpair(m) {
    const name = m.displayName || m.username;
    const ok = await ask({
      title: `Make "${name}" its own account again?`,
      body: `It stops signing in as ${m.mainName || "its main account"} and has no driver of its own. Link it to a driver afterwards if it should have one.`,
      danger: true,
      confirmLabel: "Make independent",
    });
    if (!ok) return;
    act(m.discordId, () => api.clearSecondAccount(m.discordId));
  }

  // The inline "Same person as…" picker under a row.
  function pairingPanel(m) {
    if (pairing !== m.discordId) return null;
    const options = mainCandidates.filter((x) => x.discordId !== m.discordId);
    return (
      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-surface2/60 p-3">
        <div className="min-w-[14rem] flex-1">
          <Field label="Main account (this one will sign in as it)">
            <select className="input w-full py-1.5 text-sm" value={pairChoice} onChange={(e) => setPairChoice(e.target.value)}>
              <option value="">Pick the main account…</option>
              {options.map((x) => (
                <option key={x.discordId} value={x.discordId}>
                  {x.displayName || x.username} (@{x.username}){x.driver ? ` · ${x.driver.name}` : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <span className="flex items-center gap-2">
          <button className="btn-primary py-1.5 text-sm disabled:opacity-50" disabled={!pairChoice || busy === m.discordId} onClick={() => pair(m, pairChoice)}>
            Join
          </button>
          <button className="btn-secondary py-1.5 text-sm" onClick={() => setPairing(null)}>
            Cancel
          </button>
        </span>
      </div>
    );
  }

  async function toggleSteward(m) {
    const next = !m.isSteward;
    const name = m.displayName || m.username;
    const ok = next
      ? await ask({
          title: `Make "${name}" a steward?`,
          body: "They can read and answer EVERY incident report, from their own My reports page. Nothing else changes: no results, no settings, no admin area.",
          confirmLabel: "Make steward",
        })
      : await ask({
          title: `Take stewarding away from "${name}"?`,
          body: "They keep the reports they are personally part of, and lose the rest. Takes effect immediately.",
          danger: true,
          confirmLabel: "Remove steward",
        });
    if (!ok) return;
    act(m.discordId, () => api.setMemberSteward(m.discordId, next));
  }

  async function toggleRaceControl(m) {
    const next = !m.isRaceControl;
    const name = m.displayName || m.username;
    const ok = next
      ? await ask({
          title: `Make "${name}" race control?`,
          body: "They get race control on the TV board (contacts, off track, stopped cars) and an admin area with only their pairing code for the game app in it. Nothing else: no results, no settings, no reports.",
          confirmLabel: "Make race control",
        })
      : await ask({
          title: `Take race control away from "${name}"?`,
          body: "Their pairing code stops working and the game app gets nothing more. Takes effect immediately.",
          danger: true,
          confirmLabel: "Remove race control",
        });
    if (!ok) return;
    act(m.discordId, () => api.setMemberRaceControl(m.discordId, next));
  }

  async function toggleAdmin(m) {
    const next = !m.isAdmin;
    const name = m.displayName || m.username;
    const ok = next
      ? await ask({
          title: `Give "${name}" full admin access?`,
          body: "They reach the whole admin area straight after logging in with Discord, no PIN needed. Only do this for people you fully trust.",
          confirmLabel: "Make admin",
        })
      : await ask({
          title: `Remove admin access from "${name}"?`,
          body: "This takes effect immediately.",
          danger: true,
          confirmLabel: "Remove admin",
        });
    if (!ok) return;
    act(m.discordId, () => api.setMemberAdmin(m.discordId, next));
  }

  function openCreate(m) {
    setCreating(m.discordId);
    const reserve = teams.find((t) => t.tier === 0);
    setCreateForm({ name: m.displayName || m.username, teamId: reserve?.id || teams[0]?.id || "" });
  }

  function createDriver(m) {
    if (!createForm.name.trim() || !createForm.teamId) return;
    const who = createForm.name.trim();
    act(m.discordId, async () => {
      const res = await api.createDriverFromMember(m.discordId, { name: who, teamId: createForm.teamId });
      setCreating(null);
      const note = steamNote(res?.steam, who);
      if (note) setMsg(note);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-surface2/60 px-4 py-3 text-sm text-medium">
        Everyone who has logged in with Discord shows up here automatically. An account connects to its driver via
        the stored Discord user ID (set in the Drivers tab, or by linking below). Someone new gets a reserve driver
        by themselves the first time they answer a race, and shows up under <b>New drivers</b> for you to keep or
        turn away. <b>Needs attention</b> lists the logins that still have no driver. Banning an account blocks
        logins <i>and</i> cuts off its current session.
      </div>

      {msg && !msg.ok && <ErrorBox message={msg.text} />}
      {msg?.ok && <Notice kind="success">{msg.text}</Notice>}
      {loading && <p className="text-sm text-light">Loading accounts…</p>}

      {/* --- unlinked accounts first: this is the actual to-do list ---------- */}
      {unlinked.length > 0 && (
        <div className="card overflow-hidden border-amber-500/50 p-0">
          {/* A banded header rather than a bare heading: this card is a to-do
              list, and it has to read as one from across the tab. */}
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-5 py-4">
            <h3 className="flex flex-wrap items-center gap-2 font-display text-base font-extrabold uppercase tracking-tight text-dark">
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-warn" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
              Needs attention: logged in, but no driver
              <span className="rounded-full bg-amber-500/25 px-2 py-0.5 font-mono text-xs text-warn">
                {unlinked.length} waiting
              </span>
              {requests > 0 && (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-xs text-ok">
                  {requests} asked for a seat
                </span>
              )}
            </h3>
            <p className="mt-1.5 max-w-3xl text-sm text-medium">
              These people signed in but have no driver yet: someone who hasn&rsquo;t answered a race, a returning
              driver to link to their old entry, or someone you turned away who asked again. (Logins only connect by
              themselves via a stored Discord user ID; there is no name guessing, so nobody can claim someone
              else&rsquo;s profile.) Pick their driver entry to link them, or make a fresh one in one step with{" "}
              <b>New driver</b>.
            </p>
          </div>
          <ul className="divide-y divide-border px-5 pb-2">
            {unlinked.map((m) => {
              const suggested = suggestionFor(m);
              const sel = linkChoice[m.discordId] ?? suggested?.id ?? "";
              return (
              <li key={m.discordId} className="py-4">
                <MemberRow
                  avatar={
                    <DriverAvatar name={m.displayName || m.username} photoUrl={m.avatarUrl} color="#64748b" size={40} />
                  }
                  actions={
                    <>
                      <select
                        aria-label={`Link ${m.displayName || m.username} to driver`}
                        className="input w-full py-1.5 text-sm sm:w-64"
                        value={sel}
                        onChange={(e) => setLinkChoice((c) => ({ ...c, [m.discordId]: e.target.value }))}
                      >
                        <option value="">Link to driver…</option>
                        {unclaimed.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.team?.name || NO_VALUE}){d.preEnteredId ? " · replaces typed ID" : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn-primary py-1.5 text-sm disabled:opacity-50"
                        disabled={!sel || busy === m.discordId}
                        onClick={() => link(m, sel)}
                      >
                        Link
                      </button>
                      <button
                        className="btn-secondary py-1.5 text-sm"
                        disabled={busy === m.discordId}
                        onClick={() => (creating === m.discordId ? setCreating(null) : openCreate(m))}
                      >
                        New driver
                      </button>
                      <button
                        className="py-1.5 text-sm font-semibold text-link hover:underline"
                        disabled={busy === m.discordId}
                        onClick={() => openPairing(m)}
                        title="A second Discord account of somebody who already has one here"
                      >
                        Same person as…
                      </button>
                      {/* Pushed away from the two useful buttons: nobody should
                          hit Ban while reaching for New driver. */}
                      {m.banned ? (
                        <button className="btn-secondary ml-auto py-1.5 text-sm 2xl:ml-1" disabled={busy === m.discordId} onClick={() => unban(m)}>
                          Unban
                        </button>
                      ) : (
                        <button
                          className="ml-auto rounded-lg border border-red-500/40 px-3 py-1.5 text-sm font-semibold text-bad transition hover:bg-red-500/10 2xl:ml-1"
                          disabled={busy === m.discordId}
                          onClick={() => ban(m)}
                        >
                          Ban
                        </button>
                      )}
                    </>
                  }
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-dark">{m.displayName || m.username}</span>
                    <span className="font-mono text-xs text-light">@{m.username}</span>
                  </div>
                  {/* Badges on their own line, so a long "wants to race" note
                      can't push the name column narrow. */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {m.raceRequestAt && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-ok"
                        title={`Asked to race${m.raceRequestText ? `: ${m.raceRequestText}` : ""} (${fmtDate(m.raceRequestAt)}). Link them or create a driver, and that answers the request.`}
                      >
                        <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M7 11V7a5 5 0 0110 0v4M5 11h14l-1 9H6z" />
                        </svg>
                        Wants to race{m.raceRequestText ? ` · ${m.raceRequestText}` : ""}
                      </span>
                    )}
                    <StatusPills m={m} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-light">
                    <IdChip platform="discord" value={m.discordId} />
                    <IdChip
                      platform="steam"
                      value={m.steamId}
                      state={m.steamId ? "connected" : "not set"}
                      title={
                        m.steamId
                          ? `Connected their Steam account themselves${m.steamVerifiedAt ? ` on ${fmtDate(m.steamVerifiedAt)}` : ""}. It moves onto the driver row when you link or create one.`
                          : "No Steam account connected yet. Race results still match by name until one is on file."
                      }
                    />
                    <span className="whitespace-nowrap">last login {fmtDate(m.lastLoginAt)}</span>
                  </div>
                  {suggested && sel === suggested.id && (
                    <p className="mt-1.5 font-mono text-[11px] text-ok">
                      name matches {suggested.name} · check, then hit Link
                    </p>
                  )}
                </MemberRow>
                {/* one-step "create + link" for people not on the roster at all */}
                {creating === m.discordId && (
                  <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-surface2/60 p-3">
                    <div className="min-w-[12rem] flex-1">
                      <Field label="Driver name">
                        <input
                          className="input w-full py-1.5 text-sm"
                          value={createForm.name}
                          onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                        />
                      </Field>
                    </div>
                    <div className="min-w-[12rem] flex-1">
                      <Field label={`Team (${active?.name || "active season"})`}>
                        <select
                          className="input w-full py-1.5 text-sm"
                          value={createForm.teamId}
                          onChange={(e) => setCreateForm((f) => ({ ...f, teamId: e.target.value }))}
                        >
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {t.tier === 0 ? " (Reserve)" : ` (Tier ${t.tier})`}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <span className="flex items-center gap-2">
                      <button
                        className="btn-primary py-1.5 text-sm disabled:opacity-50"
                        disabled={!createForm.name.trim() || !createForm.teamId || busy === m.discordId}
                        onClick={() => createDriver(m)}
                      >
                        Create &amp; link
                      </button>
                      <button className="btn-secondary py-1.5 text-sm" onClick={() => setCreating(null)}>
                        Cancel
                      </button>
                    </span>
                  </div>
                )}
                {pairingPanel(m)}
              </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* --- newcomers who signed themselves up ------------------------------
          The second to-do list, and a gentler one: doing nothing here is
          keeping them, so it is tinted blue rather than amber. What the admin
          needs to decide is all on the row: who it is, the driver the site made,
          and which races they have put their name down for, because those are
          what a turn-away takes with it. */}
      {newDrivers.length > 0 && (
        <div className="card overflow-hidden border-sky-500/40 p-0">
          <div className="border-b border-sky-500/30 bg-sky-500/10 px-5 py-4">
            <h3 className="flex flex-wrap items-center gap-2 font-display text-base font-extrabold uppercase tracking-tight text-dark">
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-sky-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="10" cy="8" r="4" />
                <path d="M2 21a8 8 0 0113.3-6M19 16v6M16 19h6" />
              </svg>
              New drivers: signed themselves up
              <span className="rounded-full bg-sky-500/20 px-2 py-0.5 font-mono text-xs text-sky-600">
                {newDrivers.length} to check
              </span>
            </h3>
            <p className="mt-1.5 max-w-3xl text-sm text-medium">
              These people answered a race (or pressed Join on their profile) and got a reserve driver straight away.
              Keep them, or turn them away if they shouldn&rsquo;t be here. Doing nothing keeps them. If one of them
              already has an entry on the roster, pick it under <b>Same driver as…</b> and the two become one, race
              answers included.
            </p>
          </div>
          <ul className="divide-y divide-border px-5 pb-2">
            {newDrivers.map((m) => {
              const who = m.displayName || m.username;
              const nc = m.newcomer || {};
              const answers = nc.answers || [];
              const otherRows = (nc.rows || []).filter((r) => r.id !== m.driver.id);
              const raced = (nc.results || 0) > 0;
              const suggested = suggestionFor(m);
              const sel = linkChoice[m.discordId] ?? suggested?.id ?? "";
              return (
                <li key={m.discordId} className="py-4">
                  <MemberRow
                    avatar={
                      <DriverAvatar name={who} photoUrl={m.avatarUrl} color={m.driver.team?.color || "#64748b"} size={40} />
                    }
                    actions={
                      <>
                        <button
                          className="btn-primary py-1.5 text-sm disabled:opacity-50"
                          disabled={busy === m.discordId}
                          onClick={() => keep(m)}
                          title="They stay in the league. Nothing else changes."
                        >
                          Keep
                        </button>
                        <select
                          aria-label={`${who} is the same driver as`}
                          className="input w-full py-1.5 text-sm sm:w-64"
                          value={sel}
                          onChange={(e) => setLinkChoice((c) => ({ ...c, [m.discordId]: e.target.value }))}
                        >
                          <option value="">Same driver as…</option>
                          {unclaimed.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} ({d.team?.name || NO_VALUE}){d.preEnteredId ? " · replaces typed ID" : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn-secondary py-1.5 text-sm disabled:opacity-50"
                          disabled={!sel || busy === m.discordId}
                          onClick={() => link(m, sel)}
                          title="Their account moves to that driver. The entry the site made for them in that season is merged into it, race answers included."
                        >
                          Link
                        </button>
                        {/* Pushed away from Keep, like Ban is on the other
                            rows. Gone once they have race results: the server
                            refuses then, and keeping or banning is what is
                            left. */}
                        {!raced && (
                          <button
                            className="ml-auto rounded-lg border border-red-500/40 px-3 py-1.5 text-sm font-semibold text-bad transition hover:bg-red-500/10 2xl:ml-1"
                            disabled={busy === m.discordId}
                            onClick={() => turnAway(m)}
                          >
                            Turn away
                          </button>
                        )}
                      </>
                    }
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-semibold text-dark">{who}</span>
                      <span className="font-mono text-xs text-light">@{m.username}</span>
                      <span className="inline-flex items-center gap-1.5 text-sm text-medium">
                        <TeamLogo
                          id={m.driver.team?.id}
                          name={m.driver.team?.name || ""}
                          color={m.driver.team?.color || "#64748b"}
                          size={18}
                        />
                        <span className="font-semibold text-dark">{m.driver.name}</span>
                        {m.driver.team?.name && <span className="text-light">· {m.driver.team.name}</span>}
                      </span>
                    </div>
                    {otherRows.length > 0 && (
                      <p className="mt-1 text-xs text-light">
                        Also signed up as{" "}
                        {otherRows.map((r) => `${r.name}${r.seasonName ? ` in ${r.seasonName}` : ""}`).join(", ")}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {answers.length ? (
                        answers.map((a) => {
                          const pill = ANSWER_PILL[a.status] || { label: a.status, className: "bg-surface2 text-light" };
                          return (
                            <span key={a.raceId} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${pill.className}`}>
                              {answerPlace(a)} · {pill.label}
                            </span>
                          );
                        })
                      ) : (
                        <span className="text-xs text-light">No answers for races still to come</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-light">
                      <IdChip platform="discord" value={m.discordId} />
                      <span className="whitespace-nowrap">signed up {fmtDate(m.newDriverAt)}</span>
                    </div>
                    {raced && (
                      <p className="mt-1.5 text-xs text-warn">
                        They have race results now, so they can&rsquo;t be turned away. Keep them, or ban the account in
                        the list below.
                      </p>
                    )}
                    {suggested && sel === suggested.id && (
                      <p className="mt-1.5 font-mono text-[11px] text-ok">
                        name matches {suggested.name} on the roster · if it&rsquo;s them, hit Link
                      </p>
                    )}
                  </MemberRow>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* --- all accounts ----------------------------------------------------- */}
      <div className="card p-5">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
          All login accounts
          <span className="ml-2 rounded-full bg-surface2 px-2 py-0.5 font-mono text-xs text-light">
            {filtering ? `${shownMembers.length} of ${members.length}` : members.length}
          </span>
        </h3>
        {members.length > 0 && (
          <div className="mt-3 space-y-2">
            <SearchField
              value={query}
              onChange={setQuery}
              label="Search the login accounts"
              placeholder="Search by name, @handle, Discord or Steam id, or driver…"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {MEMBER_FILTERS.map((f) => (
                <FilterChip
                  key={f.key}
                  on={chips.has(f.key)}
                  count={members.filter(f.test).length}
                  onClick={() => toggleChip(f.key)}
                >
                  {f.label}
                </FilterChip>
              ))}
              {filtering && (
                <button
                  type="button"
                  className="ml-1 text-xs font-semibold text-link hover:underline"
                  onClick={() => { setQuery(""); setChips(new Set()); }}
                >
                  Show everyone
                </button>
              )}
            </div>
          </div>
        )}
        {members.length === 0 && !loading ? (
          <p className="mt-2 text-sm text-light">
            Nobody has logged in with Discord yet. Accounts appear here automatically after the first login.
          </p>
        ) : filtering && shownMembers.length === 0 ? (
          <p className="mt-3 text-sm text-light">No login account fits this search and these filters.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {shownMembers.map((m) => (
              <li key={m.discordId} className={`py-4 ${m.banned ? "opacity-70" : ""}`}>
                <MemberRow
                  avatar={
                    <DriverAvatar
                      name={m.displayName || m.username}
                      photoUrl={m.avatarUrl}
                      color={m.driver?.team?.color || "#64748b"}
                      size={40}
                    />
                  }
                  actions={
                    <>
                      <button
                        className={`py-1.5 text-sm font-semibold ${m.isAdmin ? "text-light hover:text-link" : "text-link hover:underline"}`}
                        disabled={busy === m.discordId}
                        onClick={() => toggleAdmin(m)}
                        title={m.isAdmin ? "Revoke admin access" : "Grant full admin access on Discord login"}
                      >
                        {m.isAdmin ? "Remove admin" : "Make admin"}
                      </button>
                      {/* Pointless on an admin: they already read everything. */}
                      {!m.isAdmin && (
                        <button
                          className={`py-1.5 text-sm font-semibold ${m.isSteward ? "text-light hover:text-link" : "text-link hover:underline"}`}
                          disabled={busy === m.discordId}
                          onClick={() => toggleSteward(m)}
                          title={
                            m.isSteward
                              ? "Stop them reading every incident report"
                              : "Let them read and answer every incident report, and nothing else"
                          }
                        >
                          {m.isSteward ? "Remove steward" : "Make steward"}
                        </button>
                      )}
                      {/* Admins are race control already. */}
                      {!m.isAdmin && (
                        <button
                          className={`py-1.5 text-sm font-semibold ${m.isRaceControl ? "text-light hover:text-link" : "text-link hover:underline"}`}
                          disabled={busy === m.discordId}
                          onClick={() => toggleRaceControl(m)}
                          title={
                            m.isRaceControl
                              ? "Stop them watching races as race control"
                              : "Race control on the TV board and a pairing code for the game app, nothing else"
                          }
                        >
                          {m.isRaceControl ? "Remove race control" : "Make race control"}
                        </button>
                      )}
                      {m.mainDiscordId ? (
                        <button className="btn-secondary py-1.5 text-sm" disabled={busy === m.discordId} onClick={() => unpair(m)}>
                          Make independent
                        </button>
                      ) : (
                        <>
                          {m.driver && (
                            <button className="btn-secondary py-1.5 text-sm" disabled={busy === m.discordId} onClick={() => unlink(m)}>
                              Unlink
                            </button>
                          )}
                          <button
                            className="py-1.5 text-sm font-semibold text-link hover:underline"
                            disabled={busy === m.discordId}
                            onClick={() => openPairing(m)}
                            title="This is a second Discord account of somebody else here: it then signs in as them"
                          >
                            Same person as…
                          </button>
                        </>
                      )}
                      {m.banned ? (
                        <button className="btn-secondary ml-auto py-1.5 text-sm 2xl:ml-1" disabled={busy === m.discordId} onClick={() => unban(m)}>
                          Unban
                        </button>
                      ) : (
                        <button
                          className="ml-auto rounded-lg border border-red-500/40 px-3 py-1.5 text-sm font-semibold text-bad transition hover:bg-red-500/10 2xl:ml-1"
                          disabled={busy === m.discordId}
                          onClick={() => ban(m)}
                        >
                          Ban
                        </button>
                      )}
                    </>
                  }
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-dark">{m.displayName || m.username}</span>
                    <span className="font-mono text-xs text-light">@{m.username}</span>
                    {m.driver && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-medium">
                        <TeamLogo
                          id={m.driver.team?.id}
                          name={m.driver.team?.name || ""}
                          color={m.driver.team?.color || "#64748b"}
                          size={18}
                        />
                        <span className="font-semibold text-dark">{m.driver.name}</span>
                      </span>
                    )}
                  </div>
                  {hasPills(m) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusPills m={m} />
                    </div>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-light">
                    <IdChip platform="discord" value={m.discordId} />
                    {/* Four situations, and the difference has to be readable
                        without hovering (this tab gets used on a phone):
                        connected by the member, captured from a race import,
                        the two disagreeing, or nothing on file. */}
                    <IdChip
                      platform="steam"
                      value={m.steamId || m.driver?.steamId || null}
                      tone={m.steamId && m.driver?.steamId && m.steamId !== m.driver.steamId ? "warn" : "muted"}
                      state={
                        m.steamId && m.driver?.steamId && m.steamId !== m.driver.steamId
                          ? "differs from driver row"
                          : m.steamId && m.driver && !m.driver.steamId
                            ? "not on driver row"
                            : m.steamId
                              ? "connected"
                              : m.driver?.steamId
                                ? "from import"
                                : "not set"
                      }
                      title={
                        m.steamId && m.driver?.steamId && m.steamId !== m.driver.steamId
                          ? `The account is connected to ${m.steamId}, but the driver row carries ${m.driver.steamId}. Fix the driver row in the Drivers tab.`
                          : m.driver && m.steamId && !m.driver.steamId
                            ? "Connected on the account, but not on the driver row yet. Unlink and link again to carry it over, or type it into the Drivers tab."
                            : m.driver?.steamId && !m.steamId
                              ? "Captured from a race import on the driver row (the member did not connect Steam themselves)."
                              : m.steamId
                                ? `Connected through Steam${m.steamVerifiedAt ? ` on ${fmtDate(m.steamVerifiedAt)}` : ""}.`
                                : "No Steam account on file. Race results match by name for this person."
                      }
                    />
                    <span className="whitespace-nowrap">
                      first {fmtDate(m.firstLoginAt)} · last {fmtDate(m.lastLoginAt)} · {m.loginCount}×
                    </span>
                  </div>
                </MemberRow>
                {pairingPanel(m)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- roster drivers who never logged in ------------------------------- */}
      <div className="card p-5">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
          Never logged in
          <span className="ml-2 rounded-full bg-surface2 px-2 py-0.5 font-mono text-xs text-light">{unclaimed.length}</span>
        </h3>
        <p className="mt-1 text-sm text-light">
          Drivers on the active season&rsquo;s roster without a Discord login yet. Worth a nudge on Discord so they get
          their profile, RSVP and market access. Tip: enter their Discord user ID in the <b>Drivers</b> tab now and
          their first login connects by itself, and the results post can @mention them right away.
        </p>
        {unclaimed.length > 0 && (
          <ul className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {unclaimed.map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-1 text-sm">
                <TeamLogo id={d.team?.id} name={d.team?.name || ""} color={d.team?.color || "#64748b"} size={16} />
                <span className="font-semibold text-dark">{d.name}</span>
                <span className="truncate font-mono text-xs text-light">{d.discordName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- cross-season person links --------------------------------------- */}
      <AdminPersons />
    </div>
  );
}
