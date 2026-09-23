import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar, ErrorBox } from "./ui.jsx";

// ---------------------------------------------------------------------------
// Admin → Reports → Licence points: who has been penalised this season, how
// many points that adds up to, and who has reached the threshold and is due a
// race ban.
//
// Added up per PERSON across the season of each report's round (backend
// lib/reports.js licenceTable), so a driver who changed teams mid-season and
// raced on two rows still has one total. Only decisions that stand as
// penalties count; a reversed one keeps its points on the report and adds
// nothing here.
//
// The ban itself is not carried out by anything. The flag says it is due; the
// league decides which round it is served at and takes the seat, the same way
// a grid drop or a disqualification is done by hand.
// ---------------------------------------------------------------------------

export default function AdminLicencePoints() {
  // null = the edited series' active season, which is what the stewards want
  // nearly every time; the dropdown only appears once there is another to pick.
  const [season, setSeason] = useState(null);
  const { data, loading, error, reload } = useApi(useCallback(() => api.licencePoints(season), [season]));
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  useEffect(() => {
    if (data?.threshold != null) setThreshold(String(data.threshold));
  }, [data?.threshold]);

  const drivers = data?.drivers || [];
  const limit = data?.threshold || 12;
  const flagged = drivers.filter((d) => d.flagged).length;
  const seasons = data?.seasons || [];
  const dirty = data?.threshold != null && threshold !== String(data.threshold);

  async function saveThreshold() {
    setBusy(true);
    setSaveError(null);
    try {
      await api.setLicenceThreshold(Number(threshold));
      reload();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <CardBar
        title="Licence points"
        right={
          <span className="flex flex-wrap items-center gap-2">
            {flagged > 0 && (
              <span className="pill bg-red-500/15 text-bad">
                {flagged} race ban{flagged === 1 ? "" : "s"} due
              </span>
            )}
            {seasons.length > 1 ? (
              <select
                aria-label="Season"
                className="input w-auto py-1 text-sm"
                value={season ?? data?.season?.number ?? ""}
                onChange={(e) => setSeason(Number(e.target.value))}
              >
                {[...seasons]
                  .sort((a, b) => b.number - a.number)
                  .map((s) => (
                    <option key={s.id} value={s.number}>
                      Season {s.number}
                    </option>
                  ))}
              </select>
            ) : (
              data?.season && (
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                  Season {data.season.number}
                </span>
              )
            )}
          </span>
        }
      />
      <div className="space-y-4 p-5">
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data && <p className="text-sm text-light">Loading…</p>}

        {data && !data.season && <p className="text-sm text-light">This series has no season to count in yet.</p>}

        {data?.season && drivers.length === 0 && (
          <p className="text-sm text-light">
            Nobody has been given a penalty in season {data.season.number} yet.
          </p>
        )}

        {drivers.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {drivers.map((d, i) => (
              // Two lines on a phone — who and how many points, then the bar
              // with the decisions and the flag — and one on a wide screen.
              // Squeezed into one line at 390px, the name was the part that
              // gave way, which left a list of totals belonging to nobody.
              <li
                key={d.key}
                className={`grid grid-cols-[1.5rem,minmax(0,1fr),auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:grid-cols-[1.5rem,minmax(0,12rem),minmax(0,1fr),13rem,4rem] ${
                  d.flagged ? "bg-red-500/10" : ""
                }`}
              >
                <span className="font-mono text-xs text-faint">{i + 1}</span>
                <span className="min-w-0 truncate text-sm font-semibold text-dark">{d.name || "Unknown driver"}</span>
                <span
                  className={`text-right font-mono text-sm font-bold sm:order-last ${d.flagged ? "text-bad" : "text-dark"}`}
                >
                  {d.points} pt{d.points === 1 ? "" : "s"}
                </span>
                <span className="col-span-3 flex items-center gap-3 sm:contents">
                  {/* How far along the way to a ban, as a bar against the
                      threshold. Past it the bar is simply full and red: how
                      far past is in the number. */}
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface2" aria-hidden="true">
                    <span
                      className={`block h-full rounded-full ${d.flagged ? "bg-red-500" : d.points >= limit * 0.75 ? "bg-amber-500" : "bg-brand"}`}
                      style={{ width: `${Math.min(100, (d.points / limit) * 100)}%` }}
                    />
                  </span>
                  <span className="flex items-center justify-end gap-2 whitespace-nowrap">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-light">
                      {d.decisions} decision{d.decisions === 1 ? "" : "s"}
                    </span>
                    {d.flagged && <span className="pill bg-red-500/15 text-bad">race ban due</span>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {data?.season && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-light">
            <label htmlFor="licence-threshold">A race ban is due at</label>
            <input
              id="licence-threshold"
              type="number"
              min="1"
              max="99"
              step="1"
              className="input w-20 py-1.5 text-sm"
              value={threshold}
              disabled={busy}
              onChange={(e) => setThreshold(e.target.value)}
            />
            <span>points in a season.</span>
            {dirty && (
              <button className="btn-secondary py-1.5 text-sm" disabled={busy || !threshold} onClick={saveThreshold}>
                {busy ? "Saving…" : "Save"}
              </button>
            )}
            {saveError && <span className="text-sm text-bad">{saveError}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
