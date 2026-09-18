import { useCallback, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useAsk } from "./overlay.jsx";
import { CardHead, ErrorBox, Notice, TableSkeleton } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";
import TeamHistoryGrid, { orderTeams, worthShowing } from "./TeamHistoryGrid.jsx";
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
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  // The dialog: which driver, and which team it opens on.
  const [transfer, setTransfer] = useState(null);
  const [pick, setPick] = useState("");

  const teams = useMemo(() => orderTeams(data?.teams), [data?.teams]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const driverById = useMemo(() => new Map((data?.drivers || []).map((d) => [d.id, d])), [data?.drivers]);
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
            data={data}
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
          }}
        />
      )}
    </div>
  );
}
