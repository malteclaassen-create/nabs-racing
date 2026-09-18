import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import TeamLogo from "./TeamLogo.jsx";
import Flag from "./Flag.jsx";
import { DriverAvatar, EmptyState } from "./ui.jsx";

// ---------------------------------------------------------------------------
// The transfer market grid: one row per driver, one column per round, each
// cell the team they drove for that night (or are booked to drive for).
//
// Shared by the public Transfers page and the admin Transfers tab, which is
// why the filters live in here and the two callers only differ in what a row
// links to and whether it carries a Transfer button. The data is
// GET /api/teams/history (backend services/teamHistoryService.js), whose cell
// statuses this file turns into pictures:
//
//   driven    the team's mark, full strength
//   sub       the mark of the team they filled in for, with an S in the corner
//   absent    a dash
//   planned   the mark inside a dashed accent ring: a recorded move ahead
//   expected  the mark, faded: nothing recorded, their team today
// ---------------------------------------------------------------------------

const TIER_RANK = { 1: 0, 2: 1, 0: 2 };
const tierRank = (t) => TIER_RANK[t] ?? 3;

// A translucent wash of the team colour behind its mark, when the colour is a
// plain six-digit hex (anything else gets no wash rather than a broken one).
function wash(color) {
  return /^#[0-9a-f]{6}$/i.test(color || "") ? `${color}1f` : "transparent";
}

// The team list in the order the roster shows it: Tier 1, Tier 2, Reserve.
export function orderTeams(teams) {
  return [...(teams || [])].sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name));
}

// Which drivers a reader wants to see by default: everyone with a seat, plus
// anyone who drove or has a move on record. A deactivated row with nothing to
// show is noise, and a long season has dozens of those.
export function worthShowing(d) {
  return d.isActive || d.raced > 0 || (d.changes || []).length > 0;
}

function Cell({ cell, team, round, driverName }) {
  const name = team?.name || cell?.teamId || "?";
  const base = "flex h-8 w-8 items-center justify-center rounded-md sm:h-9 sm:w-9";
  if (!cell) {
    return (
      <span className={`${base} bg-surface2 text-light`} title={`R${round.number} ${round.track}: no entry`} aria-label="no entry">
        <span className="font-mono text-xs">–</span>
      </span>
    );
  }
  const mark = <TeamLogo id={cell.teamId} name={name} color={team?.color} logoUrl={team?.logoUrl} size={20} />;
  if (cell.status === "absent") {
    // A driver is always in a team, whether or not they started that night:
    // the mark of the team they were with, dimmed, with a dash in the corner.
    return (
      <span
        className={`${base} relative bg-surface2`}
        title={`R${round.number} ${round.track}: ${driverName} did not race (with ${name})`}
      >
        <span className="opacity-40 grayscale">{mark}</span>
        <span className="absolute -right-1 -top-1 rounded-full bg-card px-1 font-mono text-[9px] font-bold leading-4 text-light ring-1 ring-border">
          –
        </span>
      </span>
    );
  }
  if (cell.status === "driven") {
    return (
      <span className={`${base}`} style={{ backgroundColor: wash(team?.color) }} title={`R${round.number} ${round.track}: ${name}`}>
        {mark}
      </span>
    );
  }
  if (cell.status === "sub") {
    return (
      <span
        className={`${base} relative`}
        style={{ backgroundColor: wash(team?.color) }}
        title={`R${round.number} ${round.track}: reserve drive for ${name}`}
      >
        {mark}
        <span className="absolute -right-1 -top-1 rounded-full bg-card px-1 font-mono text-[9px] font-bold leading-4 text-medium ring-1 ring-border">
          S
        </span>
      </span>
    );
  }
  if (cell.status === "planned") {
    return (
      <span
        className={`${base} border-2 border-dashed border-brand`}
        title={`R${round.number} ${round.track}: planned — ${driverName} drives for ${name} from this round`}
      >
        {mark}
      </span>
    );
  }
  // expected
  return (
    <span className={`${base} opacity-40`} title={`R${round.number} ${round.track}: not driven yet, expected with ${name}`}>
      {mark}
    </span>
  );
}

// The "Teams" summary of a row: "McLaren / Audi" over "5 / 7 races", and the
// booked move underneath when there is one still ahead.
function Stints({ driver, teamById }) {
  const names = driver.stints.map((s) => teamById.get(s.teamId)?.name || s.teamId);
  const races = driver.stints.map((s) => s.races);
  const pending = driver.changes.filter((c) => c.pending);
  return (
    <div className="min-w-[8rem] text-xs leading-snug">
      {names.length > 0 ? (
        <>
          <div className="font-semibold text-dark">{names.join(" / ")}</div>
          <div className="text-light">
            {races.join(" / ")} {driver.raced === 1 ? "race" : "races"}
          </div>
        </>
      ) : (
        <div className="text-light">No race yet</div>
      )}
      {pending.map((c) => (
        <div key={c.id} className="mt-0.5 font-semibold text-brand">
          → {teamById.get(c.teamId)?.name || c.teamId} from R{c.fromRound}
        </div>
      ))}
    </div>
  );
}

function Legend() {
  const box = "inline-flex h-5 w-5 items-center justify-center rounded";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-light">
      <span className="flex items-center gap-1.5"><span className={`${box} bg-surface2 text-[9px] font-bold text-light`}>–</span> did not race (their team at the time)</span>
      <span className="flex items-center gap-1.5"><span className={`${box} bg-surface2 text-[9px] font-bold text-medium`}>S</span> reserve drive for that team</span>
      <span className="flex items-center gap-1.5"><span className={`${box} border-2 border-dashed border-brand`} /> planned move</span>
      <span className="flex items-center gap-1.5"><span className={`${box} bg-surface2 opacity-40`} /> not driven yet</span>
    </div>
  );
}

/**
 * Props:
 *   data          the /api/teams/history payload
 *   driverHref    (driver) => path, or null for plain text
 *   teamHref      (team) => path, or null
 *   renderActions (driver) => node, rendered in a trailing column (admin)
 */
export default function TeamHistoryGrid({ data, driverHref = null, teamHref = null, renderActions = null }) {
  const [teamFilter, setTeamFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("team"); // team | name
  const [everyone, setEveryone] = useState(false);

  const teams = useMemo(() => orderTeams(data?.teams), [data?.teams]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const rounds = data?.rounds || [];

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = (data?.drivers || []).filter((d) => everyone || worthShowing(d));
    if (teamFilter !== "all") {
      // "Drove for" rather than "is in": a reserve who filled in for Ferrari
      // belongs in Ferrari's list of the season.
      list = list.filter(
        (d) =>
          d.teamId === teamFilter ||
          d.stints.some((s) => s.teamId === teamFilter) ||
          d.changes.some((c) => c.teamId === teamFilter)
      );
    }
    if (q) list = list.filter((d) => d.name.toLowerCase().includes(q) || (d.formerName || "").toLowerCase().includes(q));
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (sort === "name") return list.sort(byName);
    return list.sort((a, b) => {
      const ta = teamById.get(a.teamId);
      const tb = teamById.get(b.teamId);
      return (
        tierRank(ta?.tier) - tierRank(tb?.tier) ||
        (ta?.name || "").localeCompare(tb?.name || "") ||
        byName(a, b)
      );
    });
  }, [data?.drivers, everyone, teamFilter, query, sort, teamById]);

  const total = (data?.drivers || []).length;
  const nameCell = (d) => {
    const inner = (
      <>
        <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={teamById.get(d.teamId)?.color} size={28} />
        <span className="min-w-0">
          <span className="block truncate font-display text-sm font-bold uppercase tracking-tight text-dark">
            {d.number != null && <span className="mr-1.5 font-mono text-[10px] font-bold text-light">{d.number}</span>}
            {d.name}
          </span>
          {d.formerName && <span className="block truncate font-mono text-[10px] text-light">raced as {d.formerName}</span>}
        </span>
        <Flag code={d.country} className="ml-auto" />
      </>
    );
    const cls = "flex w-[9.5rem] items-center gap-2 sm:w-[12rem]";
    return driverHref ? (
      <Link to={driverHref(d)} className={`${cls} rounded-lg transition hover:text-brand`}>
        {inner}
      </Link>
    ) : (
      <span className={cls}>{inner}</span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Team" className="input w-auto py-1.5" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="all">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Search drivers"
          className="input w-auto min-w-[10rem] flex-1 py-1.5 sm:flex-none"
          placeholder="Search drivers…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="Sort" className="input w-auto py-1.5" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="team">By team</option>
          <option value="name">By name</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-light">
          <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
          Show everyone
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nobody to show" hint={total ? "No driver matches these filters." : "This season has no drivers yet."} />
      ) : (
        <div className="overflow-x-auto scrollbar-slim rounded-xl border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface2/60 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
                <th className="sticky left-0 z-10 bg-surface2 px-2 py-2 text-left shadow-[1px_0_0_var(--c-border)]">Driver</th>
                {rounds.map((r) => (
                  <th
                    key={r.id}
                    className={`px-1 py-2 text-center ${r.isCompleted ? "" : "text-faint"} ${r.number === data.nextRound ? "text-brand" : ""}`}
                    title={`R${r.number} ${r.track}${r.number === data.nextRound ? " (next)" : r.isCompleted ? "" : " (upcoming)"}`}
                  >
                    R{r.number}
                  </th>
                ))}
                <th className="px-2 py-2 text-left">Teams</th>
                {renderActions && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((d) => (
                <tr key={d.id} className={`transition hover:bg-surface2/40 ${d.isActive ? "" : "opacity-60"}`}>
                  {/* Stays put while the rounds scroll sideways on a phone, so a
                      row never loses its name. */}
                  <td className="sticky left-0 z-10 bg-card px-2 py-1.5 shadow-[1px_0_0_var(--c-border)]">{nameCell(d)}</td>
                  {rounds.map((r) => {
                    const cell = d.cells?.[r.number];
                    const team = cell ? teamById.get(cell.teamId) : null;
                    const inner = <Cell cell={cell} team={team} round={r} driverName={d.name} />;
                    const linkable = teamHref && team && cell && cell.status !== "absent";
                    return (
                      <td key={r.id} className="px-1 py-1.5">
                        <div className="flex justify-center">
                          {linkable ? <Link to={teamHref(team)}>{inner}</Link> : inner}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5">
                    <Stints driver={d} teamById={teamById} />
                  </td>
                  {renderActions && <td className="px-2 py-1.5 text-right">{renderActions(d)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Legend />
        <span className="font-mono text-[11px] text-light">
          Showing {rows.length} of {total} drivers
        </span>
      </div>
    </div>
  );
}
