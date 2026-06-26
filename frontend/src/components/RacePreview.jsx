import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { fmtDuration, fmtGap } from "../utils/raceDuration.js";

// Position-change badge: ▲ up / ▼ down / – unchanged.
function Delta({ value }) {
  if (!value) return <span className="font-mono text-xs text-faint">–</span>;
  const up = value > 0;
  return (
    <span className={`font-mono text-xs font-bold ${up ? "text-emerald-600" : "text-rose-500"}`}>
      {up ? "▲" : "▼"}
      {Math.abs(value)}
    </span>
  );
}

// Which constructor table a car scores in: Tier 1 / Tier 2 / Reserve.
function TierTag({ tier }) {
  const map = {
    1: ["T1", "bg-sky-500/15 text-sky-600", "Scores in the Tier 1 constructors' table"],
    2: ["T2", "bg-violet-500/15 text-violet-600", "Scores in the Tier 2 table (re-ranked among Tier-2 cars)"],
  };
  const [label, cls, title] = map[tier] || ["Res", "bg-slate-400/20 text-slate-500", "Reserve — scores only for the team it subs for"];
  return <span className={`pill ${cls}`} title={title}>{label}</span>;
}

// Muted second line under a driver: race time / gap, the penalty added, and any
// position change — so the effect of a time penalty is spelled out.
function roundTimeLine(r) {
  const segs = [];
  if (r.adjustedMs != null) segs.push(r.gapMs > 0 ? fmtGap(r.gapMs) : `Leader · ${fmtDuration(r.adjustedMs)}`);
  if (r.penalty > 0 && r.totalTimeMs != null) segs.push(`+${r.penalty}s added`);
  if (r.finalPosition != null && r.rawPosition != null && r.finalPosition !== r.rawPosition) {
    const drop = r.finalPosition - r.rawPosition;
    segs.push(`was P${r.rawPosition} ${drop > 0 ? `▼${drop}` : `▲${-drop}`}`);
  }
  return segs.join("  ·  ");
}

function StandingsList({ title, rows, idKey }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-medium">{title}</div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li
            key={r[idKey]}
            className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
              r.delta ? "bg-surface2" : ""
            }`}
          >
            <span className="w-5 text-right font-mono text-xs tabular-nums text-light">{r.position}</span>
            {r.color && (
              <span className="h-3 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
            )}
            <span className="min-w-0 flex-1 truncate font-semibold text-dark">{r.name}</span>
            <span className="font-mono text-xs tabular-nums text-medium">{r.total}</span>
            <span className="w-8 text-right">
              <Delta value={r.delta} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Per-round constructor haul: team + points it earns this round.
function RoundTeamList({ title, rows }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-medium">{title}</div>
      {rows.length === 0 ? (
        <div className="text-sm text-light">No points this round.</div>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((t) => (
            <li key={t.teamId} className="flex items-center gap-2 rounded px-2 py-1 text-sm">
              <span className="h-3 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
              <span className="min-w-0 flex-1 truncate font-semibold text-dark">{t.name}</span>
              <span className="font-mono text-sm font-bold tabular-nums text-dark">+{t.points}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// `request` = { raceId?, number?, results }. Debounced live preview of how the
// (unsaved) results would classify and how the championship would move.
export default function RacePreview({ request }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const key = JSON.stringify(request);
  const timer = useRef(null);

  const mapped = (request.results || []).filter((r) => r.driverId);
  const canPreview = mapped.length > 0 && (request.raceId || request.number);

  useEffect(() => {
    if (!canPreview) {
      setData(null);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const body = {
          raceId: request.raceId || undefined,
          number: request.number || undefined,
          results: mapped.map((r) => ({
            driverId: r.driverId,
            position: r.position === "" || r.position == null ? null : Number(r.position),
            status: r.status,
            subForTeamId: r.subForTeamId || null,
            penaltySeconds: Number(r.penaltySeconds) || 0,
            totalTimeMs: r.totalTimeMs ?? null,
            // Preserve explicit points for unchanged rows (null = derive).
            points: r.points === undefined ? null : r.points,
          })),
        };
        setData(await api.previewRace(body));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!canPreview) {
    return (
      <div className="card p-4 text-sm text-light">
        Map drivers (and a round number) to see a live preview of the result and the standings.
      </div>
    );
  }

  const anyPenalty = data?.round?.some((r) => r.penalty > 0);

  return (
    <div className="card space-y-5 p-4">
      <div className="flex items-center gap-2">
        <span className="font-display text-sm font-bold uppercase tracking-tight text-dark">Live preview</span>
        {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-brand" />}
        <span className="text-xs text-light">not saved yet</span>
      </div>

      {error && <div className="text-sm text-rose-500">Preview failed: {error}</div>}

      {data && (
        <>
          {/* This round's classification */}
          <div>
            <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
              This round — final result {anyPenalty && <span className="text-brand">· time penalties applied</span>}
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <tbody>
                  {data.round.map((r) => {
                    const dnf = r.status && r.status !== "FINISHED";
                    const timeLine = roundTimeLine(r);
                    return (
                      <tr key={r.driverId} className="border-b border-border last:border-0">
                        <td className="w-10 py-1.5 pl-3 align-top text-center font-mono font-bold tabular-nums text-dark">
                          {dnf ? "—" : r.finalPosition}
                        </td>
                        <td className="py-1.5 pl-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            {r.team?.color && (
                              <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: r.team.color }} />
                            )}
                            <span className="font-semibold text-dark">{r.name}</span>
                            <TierTag tier={r.tier} />
                            {r.isSub && r.team && (
                              <span className="pill bg-amber-100 text-amber-700" title={`Reserve driving for ${r.team.name}`}>
                                sub · {r.team.name}
                              </span>
                            )}
                            {dnf && <span className="pill bg-surface2 text-light">{r.status}</span>}
                            {r.penalty > 0 && (
                              <span className="pill bg-rose-500/15 text-rose-500" title={`Finished P${r.rawPosition}, +${r.penalty}s time penalty`}>
                                +{r.penalty}s pen
                              </span>
                            )}
                          </span>
                          {timeLine && (
                            <span className="mt-0.5 block font-mono text-[11px] text-light">{timeLine}</span>
                          )}
                        </td>
                        <td className="w-14 py-1.5 pr-3 align-top text-right">
                          <span className="font-mono font-bold tabular-nums text-dark">{r.points}</span>
                          <span className="ml-1 text-[10px] text-light">pts</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-light">
              Final positions already include your time penalties — the field is re-sorted by race time + penalty
              seconds, so a penalised car drops behind everyone now ahead of it on time. Drivers score by final
              position. <span className="font-semibold text-medium">T1 / T2</span> = which constructors&rsquo; table the
              car scores in (Tier-2 cars are re-ranked among themselves). <span className="font-semibold text-medium">Res</span>{" "}
              = reserve: scores for the team it subs for, or not at all without one.
            </p>
          </div>

          {/* Constructor points earned this round */}
          {(data.roundTeams?.t1?.length > 0 || data.roundTeams?.t2?.length > 0) && (
            <div>
              <div className="mb-1 font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
                Constructor points this round
              </div>
              <p className="mb-2 text-[11px] leading-relaxed text-light">
                Tier 1 = sum of both drivers&rsquo; real points. Tier 2 = the Tier-2 cars re-ranked among themselves
                (P1 of that group gets 35, etc.), so their points differ from the overall finishing order.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <RoundTeamList title="Tier 1" rows={data.roundTeams.t1} />
                <RoundTeamList title="Tier 2 (re-ranked)" rows={data.roundTeams.t2} />
              </div>
            </div>
          )}

          {/* Championship impact */}
          <div>
            <div className="mb-1 font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
              Championship after this round <span className="text-light">(▲▼ = change vs now)</span>
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-light">
              Provisional season totals if you save this round, with each competitor&rsquo;s 3 worst rounds dropped.
            </p>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <StandingsList title="Drivers" rows={data.drivers} idKey="driverId" />
              </div>
              <StandingsList title="Constructors · Tier 1" rows={data.t1} idKey="teamId" />
              <StandingsList title="Constructors · Tier 2" rows={data.t2} idKey="teamId" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
