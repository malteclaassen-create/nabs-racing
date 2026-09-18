import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { Modal } from "./overlay.jsx";

// ---------------------------------------------------------------------------
// Transfer dialog: "<driver> drives for <team> from round <n>".
//
// Opened from the admin Drivers roster (the team dropdown) and from the admin
// Transfers tab (the row action), so it lives here rather than in either.
//
// The round is the whole point. Pick one still ahead and nothing happens today,
// the move simply waits for that round to be saved. Pick one already driven and
// the rounds since are re-attributed, which moves constructor points. So the
// dialog asks the server what it WOULD do and prints the answer before the
// button means anything. Nothing here writes until Confirm.
// ---------------------------------------------------------------------------
export default function TransferDialog({ driver, initialTeamId, teams, onClose, onDone }) {
  const { data: races } = useApi(useCallback(() => api.races(), []));
  const [teamId, setTeamId] = useState(initialTeamId);
  const [fromRound, setFromRound] = useState(null);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [recorded, setRecorded] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);

  // Only scored rounds can carry a transfer: a training night has no number and
  // nothing to attribute.
  const rounds = (races || []).filter((r) => r.number != null).sort((a, b) => a.number - b.number);
  const nextRound = rounds.find((r) => !r.isCompleted)?.number ?? rounds[rounds.length - 1]?.number ?? 1;

  useEffect(() => {
    if (fromRound == null && rounds.length) setFromRound(nextRound);
  }, [rounds.length]);

  const loadRecorded = useCallback(async () => {
    try {
      setRecorded(await api.driverTransfers(driver.id));
    } catch {
      /* nothing on record yet */
    }
  }, [driver.id]);
  useEffect(() => {
    loadRecorded();
  }, [loadRecorded]);

  // Ask the server what this combination would do. Re-runs on every change of
  // team or round, because both change the answer.
  useEffect(() => {
    let alive = true;
    if (!teamId || fromRound == null) return undefined;
    setLoading(true);
    setError(null);
    api
      .transferDriver(driver.id, teamId, fromRound, true)
      .then((p) => alive && setPlan(p))
      .catch((e) => {
        if (!alive) return;
        setPlan(null);
        setError(e.message);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [driver.id, teamId, fromRound, reloadKey]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const out = await api.transferDriver(driver.id, teamId, fromRound, false);
      const to = out.to?.name || "the new team";
      onDone(
        out.appliesLater
          ? `Recorded: ${driver.name} drives for ${to} from round ${out.fromRound}. Nothing has changed yet, the move applies when that round is saved.`
          : `${driver.name} drives for ${to} from round ${out.fromRound}.` +
              (out.rounds?.length ? ` ${out.rounds.length} round${out.rounds.length === 1 ? "" : "s"} re-attributed.` : "")
      );
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function undo(change) {
    setBusy(true);
    setError(null);
    try {
      await api.removeDriverTransfer(driver.id, change.id, false);
      await loadRecorded();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const moved = plan?.rounds || [];
  const teamName = teams.find((t) => t.id === teamId)?.name || (teamId === "reserve" ? "Reserve" : "");

  return (
    <Modal
      open
      onClose={onClose}
      title={`Transfer ${driver.name}`}
      size="lg"
      description="Pick the team and the round the change takes effect from."
    >
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-eyebrow">To team</span>
            <select className="input mt-1 w-full" value={teamId} disabled={busy} onChange={(e) => setTeamId(e.target.value)}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
              {!teams.some((t) => t.tier === 0) && <option value="reserve">Reserve</option>}
            </select>
          </label>
          <label className="block">
            <span className="text-eyebrow">From round</span>
            <select
              className="input mt-1 w-full"
              value={fromRound ?? ""}
              disabled={busy}
              onChange={(e) => setFromRound(Number(e.target.value))}
            >
              {rounds.map((r) => (
                <option key={r.id} value={r.number}>
                  {`R${r.number} ${r.track}${r.isCompleted ? " (driven)" : ""}${r.number === nextRound ? " · next" : ""}`}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* What this would do, in the league's own terms, before it happens. */}
        <div className="rounded-xl border border-border bg-surface2 p-3">
          {loading && <p className="text-light">Working out what that would change...</p>}
          {!loading && plan?.appliesLater && (
            <p className="text-medium">
              Round {plan.fromRound} has not been driven yet, so nothing changes today. {driver.name} stays with{" "}
              {plan.from?.name || "their team"} until then, and the move applies by itself when round {plan.fromRound} is
              saved.
            </p>
          )}
          {!loading && plan && !plan.appliesLater && moved.length === 0 && (
            <p className="text-medium">
              {driver.name} drives for {teamName} from round {plan.fromRound} on. No round already driven is affected.
            </p>
          )}
          {!loading && moved.length > 0 && (
            <div className="space-y-3">
              <p className="font-semibold text-dark">
                This corrects {moved.length} round{moved.length === 1 ? "" : "s"} {driver.name} has already driven, so the
                constructor points of those rounds move too:
              </p>
              {moved.map((r) => (
                <div key={r.raceId} className="border-t border-border pt-2 first:border-0 first:pt-0">
                  <p className="font-semibold text-dark">
                    R{r.number} {r.track}: {r.from} to {r.to}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-medium">
                    {r.delta.map((d) => (
                      <li key={`${d.teamId}-${d.tier}`}>
                        {d.name} (Tier {d.tier}): {d.from} to {d.to}
                        <span className={d.to > d.from ? "ml-1 font-semibold text-emerald-500" : "ml-1 font-semibold text-rose-500"}>
                          {d.to > d.from ? `+${d.to - d.from}` : d.to - d.from}
                        </span>
                      </li>
                    ))}
                    {r.delta.length === 0 && <li>No constructor points change.</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {recorded.length > 0 && (
          <div>
            <span className="text-eyebrow">Already on record</span>
            <ul className="mt-1 divide-y divide-border">
              {recorded.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-medium">
                    From round {c.fromRound}: {c.teamName}
                  </span>
                  <button
                    className="transition text-xs font-semibold text-rose-500 hover:underline"
                    disabled={busy}
                    onClick={() => undo(c)}
                  >
                    Take back
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-sm font-semibold text-rose-500">{error}</p>}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button className="btn-primary" disabled={busy || loading || !plan} onClick={confirm}>
            {moved.length > 0 ? `Move and correct ${moved.length} round${moved.length === 1 ? "" : "s"}` : "Record transfer"}
          </button>
          <button
            className="transition text-sm font-semibold text-light hover:text-medium"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
