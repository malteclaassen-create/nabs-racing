import { useCallback, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useAsk } from "./overlay.jsx";
import { CardHead, ErrorBox, Notice, TableSkeleton } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";
import TeamHistoryGrid, { orderTeams, worthShowing, standingsMap } from "./TeamHistoryGrid.jsx";
import TransferDialog from "./TransferDialog.jsx";

// ---------------------------------------------------------------------------
// Admin "Transfers" tab: the season's transfer market in one place.
//
// Until now a team change was entered on the Drivers tab, one driver at a
// time, and there was nowhere to see the season's line-ups round by round or
// which moves were already booked for rounds still ahead. This tab is that
// overview: the grid (components/TeamHistoryGrid.jsx), the moves still
// waiting to apply with a way to take them back, and a Transfer button on
// every row that opens the same dialog the Drivers tab uses — so the rules
// (a move is entered against a ROUND, a backdated one re-attributes and
// rescores, a future one waits) are exactly the same wherever it is entered.
// ---------------------------------------------------------------------------

// A CSV of the grid, one row per driver: the team of every round by name,
// with the cell's status in brackets where it is not a plain drive.
function toCsv(data, teamById) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Driver", "Number", "Team now", ...data.rounds.map((r) => `R${r.number} ${r.track}`), "Teams", "Races"];
  const lines = [head.map(esc).join(",")];
  for (const d of data.drivers) {
    const cells = data.rounds.map((r) => {
      const c = d.cells?.[r.number];
      if (!c || c.status === "absent") return "";
      const name = teamById.get(c.teamId)?.name || c.teamId;
      return c.status === "driven" ? name : `${name} (${c.status})`;
    });
    const stints = d.stints.map((s) => teamById.get(s.teamId)?.name || s.teamId).join(" / ");
    lines.push([d.name, d.number ?? "", teamById.get(d.teamId)?.name || "", ...cells, stints, d.raced].map(esc).join(","));
  }
  return lines.join("\n");
}

// The roster problems this tab exists to clear up, read off the season:
//   * a Tier 1 / Tier 2 team with more than two active seats — a driver was
//     put into a team without the one they replaced being moved out, which is
//     what the old "change the dropdown" way of transferring did;
//   * one name on two rows of the same season — a driver created by hand and
//     again by the attendance sign-up, say.
// Neither is fixed here by itself (the code cannot know which of three
// drivers is the current one); the list says what to do about each.
export function rosterIssues(data) {
  if (!data) return { crowded: [], duplicates: [] };
  const teamById = new Map((data.teams || []).map((t) => [t.id, t]));
  const seats = new Map();
  for (const d of data.drivers || []) {
    if (!d.isActive) continue;
    const t = teamById.get(d.teamId);
    if (!t || (t.tier !== 1 && t.tier !== 2)) continue;
    if (!seats.has(t.id)) seats.set(t.id, []);
    seats.get(t.id).push(d);
  }
  const crowded = [...seats.entries()]
    .filter(([, list]) => list.length > 2)
    .map(([teamId, list]) => ({ team: teamById.get(teamId), drivers: list.sort((a, b) => b.raced - a.raced) }));

  const byName = new Map();
  for (const d of data.drivers || []) {
    const key = d.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(d);
  }
  const duplicates = [...byName.values()].filter((list) => list.length > 1).map((list) => list.sort((a, b) => b.raced - a.raced));
  return { crowded, duplicates };
}

function download(name, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AdminTransfers() {
  const ask = useAsk();
  const { current: season } = useSeason();
  const { data, loading, error, reload } = useApi(useCallback(() => api.transferMarket(), []));
  const standings = useApi(useCallback(() => api.driverStandings(), []));
  const points = useMemo(() => standingsMap(standings.data), [standings.data]);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  // The dialog: which driver, and which team it opens on.
  const [transfer, setTransfer] = useState(null);
  const [pick, setPick] = useState("");

  const teams = useMemo(() => orderTeams(data?.teams), [data?.teams]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const driverById = useMemo(() => new Map((data?.drivers || []).map((d) => [d.id, d])), [data?.drivers]);
  const issues = useMemo(() => rosterIssues(data), [data]);
  const pending = (data?.moves || []).filter((m) => m.pending);
  const done = (data?.moves || []).filter((m) => !m.pending);

  function open(driver, teamId) {
    setMsg(null);
    setErr(null);
    setTransfer({ driver: { id: driver.id, name: driver.name }, teamId: teamId || driver.teamId });
  }

  // Taking a planned move back changes nothing on the board (its round has not
  // been driven), so one confirm is all it needs. Moves already applied are
  // taken back from the dialog, which spells out the rounds it would rescore.
  async function takeBack(m) {
    const d = driverById.get(m.driverId);
    const to = teamById.get(m.toTeamId)?.name || m.toTeamId;
    if (!d) return;
    const ok = await ask({
      title: "Take this move back?",
      body: `${d.name} will no longer be booked to drive for ${to} from round ${m.round}. Nothing already driven changes.`,
      confirmLabel: "Take back",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      await api.removeDriverTransfer(m.driverId, m.changeId, false);
      setMsg(`Taken back: ${d.name} stays where they are.`);
      reload();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const teamName = (id) => teamById.get(id)?.name || id || "—";
  const mark = (id) => {
    const t = teamById.get(id);
    return <TeamLogo id={id} name={t?.name || id} color={t?.color} logoUrl={t?.logoUrl} size={18} />;
  };

  if (error) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <div className="space-y-6">
      <div className="card space-y-4 p-5">
        <CardHead eyebrow="Transfers" title={`Transfer market · ${season?.name || "this season"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Driver to transfer" className="input w-auto py-1.5" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!data}>
              <option value="">Record a transfer for…</option>
              {(data?.drivers || [])
                .filter(worthShowing)
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({teamName(d.teamId)})
                  </option>
                ))}
            </select>
            <button
              className="btn-primary py-1.5"
              disabled={!pick}
              onClick={() => {
                const d = driverById.get(pick);
                if (d) open(d);
              }}
            >
              Transfer…
            </button>
            <button className="btn-secondary py-1.5" disabled={!data} onClick={() => download(`transfers-${season?.name || "season"}.csv`.replace(/\s+/g, "-").toLowerCase(), toCsv(data, teamById))}>
              Export CSV
            </button>
          </div>
        </CardHead>
        <p className="text-xs leading-relaxed text-light">
          Every driver's team, round by round, as the results have it — and the moves already booked for rounds
          still ahead. A transfer is entered against a <span className="font-semibold text-medium">round</span>: pick
          one still to come and nothing changes today, the move applies itself when that round is saved. Pick a
          round already driven and the rounds since are re-attributed and their constructor points move, which the
          dialog spells out before you confirm. The public Transfers page shows this same grid, planned moves
          included.
        </p>
        {err && <Notice kind="error">{err}</Notice>}
        {msg && <Notice kind="success">{msg}</Notice>}
      </div>

      {(issues.crowded.length > 0 || issues.duplicates.length > 0) && (
        <div className="card space-y-5 border-amber-500/40 p-5">
          <CardHead eyebrow="Needs attention" title="Roster to tidy up" />
          {issues.crowded.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-medium">
                <span className="font-semibold text-dark">More than two seats.</span> Somebody was put into the team
                without the driver they replaced being moved out. For the one who left, record a transfer to the team
                they went to, or to <span className="font-semibold">Reserve</span>, from the round after their last race
                for this team. Their results stay where they are.
              </p>
              <ul className="divide-y divide-border">
                {issues.crowded.map(({ team, drivers }) => (
                  <li key={team.id} className="flex flex-wrap items-start gap-3 py-2.5">
                    <span className="flex w-40 shrink-0 items-center gap-2">
                      {mark(team.id)}
                      <span className="font-display text-sm font-bold uppercase tracking-tight text-dark">{team.name}</span>
                      <span className="pill bg-amber-500/15 text-warn">{drivers.length}</span>
                    </span>
                    <ul className="flex min-w-0 flex-1 flex-wrap gap-2">
                      {drivers.map((d) => {
                        const last = d.stints.length ? d.stints[d.stints.length - 1] : null;
                        const forTeam = d.stints.filter((st) => st.teamId === team.id).reduce((n, st) => n + st.races, 0);
                        return (
                          <li key={d.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface2/60 py-1 pl-2.5 pr-1 text-sm">
                            <span className="font-semibold text-dark">{d.name}</span>
                            <span className="font-mono text-[10px] text-light" title="Races for this team · last round driven">
                              {forTeam} {forTeam === 1 ? "race" : "races"}
                              {last
                                ? ` · last R${last.to}${last.teamId !== team.id ? ` for ${teamName(last.teamId)}` : ""}`
                                : " · none yet"}
                            </span>
                            <button className="btn-secondary px-2 py-0.5 text-xs" disabled={busy} onClick={() => open(d)}>
                              Transfer
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {issues.duplicates.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-medium">
                <span className="font-semibold text-dark">One name, two entries.</span> The same driver exists twice in
                this season. Delete the entry without race results on the Drivers tab (an entry with results cannot be
                deleted); if both have results, link them as one person on the Members tab instead.
              </p>
              <ul className="divide-y divide-border">
                {issues.duplicates.map((list) => (
                  <li key={list[0].id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="w-40 shrink-0 font-display font-bold uppercase tracking-tight text-dark">{list[0].name}</span>
                    {list.map((d) => (
                      <span key={d.id} className="rounded-lg border border-border bg-surface2/60 px-2.5 py-1 text-xs text-medium">
                        <span className="font-mono text-light">{d.id}</span> · {teamName(d.teamId)} · {d.raced} {d.raced === 1 ? "race" : "races"}
                        {!d.isActive && " · inactive"}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <CardHead eyebrow="Booked" title={`Planned moves (${pending.length})`} />
          {pending.length === 0 ? (
            <p className="text-sm text-light">No move is waiting to apply. Use Transfer… on a driver to book one.</p>
          ) : (
            <ul className="divide-y divide-border">
              {pending.map((m) => {
                const d = driverById.get(m.driverId);
                return (
                  <li key={`${m.driverId}-${m.round}`} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="font-mono text-xs font-bold text-brand">R{m.round}</span>
                    <span className="font-display font-bold uppercase tracking-tight text-dark">{d?.name || m.driverId}</span>
                    <span className="flex items-center gap-1.5 text-medium">
                      {m.fromTeamId && (
                        <>
                          {mark(m.fromTeamId)} {teamName(m.fromTeamId)} <span className="text-light">→</span>
                        </>
                      )}
                      {mark(m.toTeamId)} {teamName(m.toTeamId)}
                    </span>
                    <span className="ml-auto flex items-center gap-3">
                      {d && (
                        <button className="text-xs font-semibold text-link hover:underline" disabled={busy} onClick={() => open(d, m.toTeamId)}>
                          Change
                        </button>
                      )}
                      {m.changeId && (
                        <button className="text-xs font-semibold text-rose-500 hover:underline" disabled={busy} onClick={() => takeBack(m)}>
                          Take back
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="card p-5">
          <CardHead eyebrow="Season so far" title={`Moves driven (${done.length})`} />
          {done.length === 0 ? (
            <p className="text-sm text-light">No driver has changed team in a round already driven.</p>
          ) : (
            <ul className="max-h-64 divide-y divide-border overflow-y-auto">
              {done.map((m) => {
                const d = driverById.get(m.driverId);
                return (
                  <li key={`${m.driverId}-${m.round}`} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="font-mono text-xs font-bold text-light">R{m.round}</span>
                    <span className="font-display font-bold uppercase tracking-tight text-dark">{d?.name || m.driverId}</span>
                    <span className="flex items-center gap-1.5 text-medium">
                      {mark(m.fromTeamId)} {teamName(m.fromTeamId)} <span className="text-light">→</span> {mark(m.toTeamId)} {teamName(m.toTeamId)}
                    </span>
                    {!m.changeId && (
                      <span className="pill bg-amber-500/15 text-warn" title="Read off the results: the move was never entered as a transfer">
                        from results
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="card p-5">
        <CardHead eyebrow="Round by round" title="Driver team history" />
        {loading || !data ? (
          <TableSkeleton rows={10} />
        ) : (
          <TeamHistoryGrid
            key={points ? "pts" : "plain"}
            data={data}
            standings={points}
            renderActions={(d) => (
              <button className="btn-secondary px-3 py-1 text-xs" disabled={busy} onClick={() => open(d)}>
                Transfer
              </button>
            )}
          />
        )}
      </div>

      {transfer && (
        <TransferDialog
          driver={transfer.driver}
          initialTeamId={transfer.teamId}
          teams={teams}
          onClose={() => setTransfer(null)}
          onDone={(text) => {
            setTransfer(null);
            setMsg(text);
            setErr(null);
            setPick("");
            reload();
            standings.reload();
          }}
        />
      )}
    </div>
  );
}
