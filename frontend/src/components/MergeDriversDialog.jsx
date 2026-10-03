import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { Modal } from "./overlay.jsx";
import TeamLogo from "./TeamLogo.jsx";

// ---------------------------------------------------------------------------
// "These two rows are one driver": pick the row that stays, see what moves
// over from the other, confirm. Nothing is written until Confirm; the server
// runs the same plan for real (services/driverMerge.js).
//
// The row that stays is the one the driver has been looking after — photo,
// bio, links, the login — so that is preselected. Results, answers, the Steam
// id and every empty profile field come over from the other row; it is then
// deleted. Two results in the same race cannot be merged: the dialog names
// the rounds and the Confirm button stays off.
// ---------------------------------------------------------------------------

// Which of two rows a person would want kept: the one with a face and words
// on it, else the login, else the one that raced more.
function preferred(k, d) {
  const score = (f) => (f.photo ? 8 : 0) + (f.bio ? 4 : 0) + (f.socials.length ? 2 : 0) + (f.discordUserId ? 1 : 0);
  if (score(k) !== score(d)) return score(k) > score(d) ? k.id : d.id;
  return k.results >= d.results ? k.id : d.id;
}

function Fact({ label, value, on = true }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1 text-xs">
      <span className="text-light">{label}</span>
      <span className={`text-right font-mono ${on ? "font-semibold text-dark" : "text-faint"}`}>{value}</span>
    </li>
  );
}

function RowCard({ f, keep, onKeep, teamById }) {
  const team = f.team;
  return (
    <button
      type="button"
      onClick={onKeep}
      className={`w-full rounded-xl border p-3 text-left transition ${keep ? "border-brand bg-brand/5 ring-2 ring-brand/30" : "border-border bg-surface2/40 hover:border-brand/40"}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {team && <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={teamById?.get(team.id)?.logoUrl} size={18} />}
          <span className="truncate font-mono text-[11px] text-light">{f.id}</span>
        </span>
        <span className={`pill ${keep ? "bg-brand text-onbrand" : "bg-surface2 text-light"}`}>{keep ? "Keep" : "Fold in"}</span>
      </div>
      <ul className="divide-y divide-border">
        <Fact label="Team" value={team?.name || "—"} />
        <Fact label="Races" value={f.results ? `${f.results} · R${f.rounds.join(", R")}` : "none"} on={f.results > 0} />
        <Fact label="Discord login" value={f.discordUserId ? `@${f.discordHandle || f.discordUserId}` : f.inheritedDiscordUserId ? "inherited (linked person)" : "not set"} on={!!f.discordUserId} />
        <Fact label="Steam id" value={f.steamId || "not set"} on={!!f.steamId} />
        <Fact label="Profile photo" value={f.photo ? "yes" : "no"} on={f.photo} />
        <Fact label="Bio" value={f.bio ? "yes" : "no"} on={f.bio} />
        <Fact label="Socials" value={f.socials.length ? f.socials.join(", ") : "none"} on={f.socials.length > 0} />
        <Fact label="Number" value={f.number ?? "—"} on={f.number != null} />
        <Fact label="Attendance answers" value={f.rsvps} on={f.rsvps > 0} />
        {!f.isActive && <Fact label="Status" value="inactive" on={false} />}
      </ul>
    </button>
  );
}

export default function MergeDriversDialog({ rows, teamById, onClose, onDone }) {
  // Two rows at a time. A group of three is merged twice.
  const [keepId, setKeepId] = useState(rows[0].id);
  const dropId = useMemo(() => rows.find((r) => r.id !== keepId)?.id, [rows, keepId]);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [chosen, setChosen] = useState(false); // the admin clicked a card
  // Two Discord accounts behind the rows: join them too (on by default), and
  // which one is the main account (null = the older one, see mainDefault).
  const [joinAccounts, setJoinAccounts] = useState(true);
  const [mainAcc, setMainAcc] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!dropId) return undefined;
    setLoading(true);
    setError(null);
    api
      .mergeDrivers(keepId, dropId, true)
      .then((p) => {
        if (!alive) return;
        setPlan(p);
        // First answer: put the preselection on the row the driver looks after.
        if (!chosen) {
          const want = preferred(p.keep, p.drop);
          if (want !== keepId) {
            setChosen(true);
            setKeepId(want);
          }
        }
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [keepId, dropId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The account that has been around longest is usually the one the driver's
  // history hangs off, so it is the main account unless the admin says not.
  const accounts = plan?.accounts || null;
  const mainDefault = accounts
    ? [...accounts].sort((a, b) => String(a.firstLoginAt).localeCompare(String(b.firstLoginAt)))[0].discordId
    : null;
  const mainId = accounts ? (accounts.some((a) => a.discordId === mainAcc) ? mainAcc : mainDefault) : null;
  const mainName = accounts?.find((a) => a.discordId === mainId)?.name;
  const secondName = accounts?.find((a) => a.discordId !== mainId)?.name;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const out = await api.mergeDrivers(keepId, dropId, false, accounts && joinAccounts ? mainId : null);
      const joined = out.joined ? ` ${secondName} now signs in as ${mainName}.` : "";
      onDone(`Merged: ${out.drop.name} is one row again (${out.keep.id}). ${out.moves.results} result(s) moved over.${joined}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const name = rows[0].name;
  const m = plan?.moves;
  const lines = m
    ? [
        m.results > 0 && `${m.results} race result${m.results === 1 ? "" : "s"} (R${plan.drop.rounds.join(", R")})`,
        m.rsvps > 0 && `${m.rsvps} attendance answer${m.rsvps === 1 ? "" : "s"}${m.rsvpsDropped ? ` (${m.rsvpsDropped} duplicate answer${m.rsvpsDropped === 1 ? "" : "s"} dropped)` : ""}`,
        m.marketEntries > 0 && `${m.marketEntries} driver-market entr${m.marketEntries === 1 ? "y" : "ies"}`,
        m.transfers > 0 && `${m.transfers} recorded transfer${m.transfers === 1 ? "" : "s"}`,
        m.driverOfTheDay > 0 && `${m.driverOfTheDay} driver-of-the-day pick${m.driverOfTheDay === 1 ? "" : "s"}`,
        m.reports > 0 && `${m.reports} incident report${m.reports === 1 ? "" : "s"}`,
        m.discord && "the Discord login",
        m.steam && "the Steam id",
        m.profile.length > 0 && `profile fields the kept row had empty: ${m.profile.join(", ")}`,
      ].filter(Boolean)
    : [];

  return (
    <Modal open onClose={onClose} title={`Merge ${name}`} size="lg" description="Two rows, one driver. Pick the row that stays; everything the other row holds moves onto it, and the other row is deleted.">
      <div className="space-y-4 text-sm">
        {plan && (
          <div className="grid gap-3 sm:grid-cols-2">
            {[plan.keep, plan.drop]
              .sort((a, b) => rows.findIndex((r) => r.id === a.id) - rows.findIndex((r) => r.id === b.id))
              .map((f) => (
                <RowCard key={f.id} f={f} keep={f.id === keepId} teamById={teamById} onKeep={() => { setChosen(true); setKeepId(f.id); }} />
              ))}
          </div>
        )}

        <div className="rounded-xl border border-border bg-surface2 p-3">
          {loading && <p className="text-light">Working out what would move...</p>}
          {!loading && plan && !plan.ok && (
            <div className="space-y-1">
              <p className="font-semibold text-rose-500">These two cannot be merged yet.</p>
              <p className="text-medium">
                Both rows have a result in {plan.clashes.map((c) => `R${c.round ?? "?"} ${c.track}`).join(", ")}. Open those rounds in Edit Results and remove the wrong one of the two, then come back.
              </p>
            </div>
          )}
          {!loading && plan?.ok && (
            <div className="space-y-2">
              <p className="font-semibold text-dark">
                <span className="font-mono">{plan.keep.id}</span> stays, with everything it has now. From <span className="font-mono">{plan.drop.id}</span> it takes over:
              </p>
              {lines.length ? (
                <ul className="list-disc space-y-0.5 pl-5 text-medium">
                  {lines.map((l) => <li key={l}>{l}</li>)}
                </ul>
              ) : (
                <p className="text-medium">Nothing: the other row is empty and is simply deleted.</p>
              )}
              <p className="text-xs text-light">
                Results keep their team, so no constructor points move. The two rows' careers are linked as one person. The driver stays logged in.
              </p>
            </div>
          )}
        </div>

        {/* The rows sit on two Discord accounts. Merging the rows alone does
            not hold: a sign-up from the account that lost its row puts the
            driver into the Reserve pool again. Joining the accounts makes the
            second one sign in as the main one (lib/accountLinks.js). */}
        {!loading && plan?.ok && accounts && (
          <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="font-semibold text-dark">Two Discord accounts</p>
            <p className="text-medium">
              These rows belong to two different Discord logins. If they stay apart, the next attendance sign-up from the
              account without the row adds {name} to the Reserve pool again.
            </p>
            <label className="flex items-center gap-2 font-semibold text-dark">
              <input type="checkbox" checked={joinAccounts} onChange={(e) => setJoinAccounts(e.target.checked)} />
              Join the accounts: one driver, two logins
            </label>
            {joinAccounts && (
              <div className="space-y-1 pl-6">
                <p className="text-xs text-light">Main account (the other one signs in as it):</p>
                {accounts.map((a) => (
                  <label key={a.discordId} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="merge-main-account" checked={a.discordId === mainId} onChange={() => setMainAcc(a.discordId)} />
                    <span className="font-semibold text-dark">{a.name}</span>
                    <span className="font-mono text-xs text-light">@{a.username} · since {String(a.firstLoginAt || "").slice(0, 10) || "?"}</span>
                  </label>
                ))}
                <p className="text-xs text-light">
                  Admin access stays with the account it was given to. Undo any time on the Members tab.
                </p>
              </div>
            )}
          </div>
        )}

        {error && <p className="font-semibold text-rose-500">{error}</p>}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button className="btn-primary" disabled={busy || loading || !plan?.ok} onClick={confirm}>
            {busy ? "Merging…" : `Merge into ${keepId}`}
          </button>
          <button className="transition text-sm font-semibold text-light hover:text-medium" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
