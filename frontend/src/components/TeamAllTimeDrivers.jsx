import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { DriverAvatar, MEDAL, readableAccent } from "./ui.jsx";
import Flag from "./Flag.jsx";
import SlidingTabs from "./SlidingTabs.jsx";
import { countryFor } from "../data/driverCountries.js";

// The team's all-time drivers: everyone who ever raced for it, with what they
// brought in FOR THIS TEAM over every season (backend teamAllTimeService.js:
// reserve drives and mid-season moves land with the team they were driven for,
// points before any drop rule, sprints counted, one line per person). Sorts by
// points, wins, podiums or starts; the top ten show, the rest behind a button.

const SORTS = [
  { key: "points", label: "Points", unit: "pts", order: ["points", "wins", "podiums", "starts"] },
  { key: "wins", label: "Wins", unit: "wins", order: ["wins", "podiums", "points", "starts"] },
  { key: "podiums", label: "Podiums", unit: "podiums", order: ["podiums", "wins", "points", "starts"] },
  { key: "starts", label: "Starts", unit: "starts", order: ["starts", "points", "wins", "podiums"] },
];
const COLS = [
  { key: "starts", label: "Starts" },
  { key: "wins", label: "Wins" },
  { key: "podiums", label: "Podiums" },
  { key: "points", label: "Points" },
];
const ONE = { points: "point", wins: "win", podiums: "podium", starts: "start" };
const TOP = 10;

// [3,4,5,7] -> "S3–S5, S7"
function seasonRanges(nums) {
  const parts = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(i === j ? `S${nums[i]}` : `S${nums[i]}–S${nums[j]}`);
    i = j;
  }
  return parts.join(", ");
}

export default function TeamAllTimeDrivers({ teamId, teamName, color, dark }) {
  const { data } = useApi(useCallback(() => api.teamDrivers(teamId), [teamId]));
  const [sortKey, setSortKey] = useState("points");
  const [all, setAll] = useState(false);
  const drivers = data?.drivers || [];
  // A team in its first season: the line-up above already is the whole story.
  if ((data?.seasons ?? 0) < 2 || drivers.length === 0) return null;

  const sort = SORTS.find((s) => s.key === sortKey) || SORTS[0];
  const rows = [...drivers]
    .filter((d) => sort.key === "points" || sort.key === "starts" || d[sort.key] > 0)
    .sort((a, b) => {
      for (const k of sort.order) if (b[k] !== a[k]) return b[k] - a[k];
      return a.name.localeCompare(b.name);
    });
  const shown = all ? rows : rows.slice(0, TOP);
  const max = rows[0]?.[sort.key] || 1;
  const accent = readableAccent(color, { dark });
  const totalWins = drivers.reduce((s, d) => s + d.wins, 0);

  return (
    <section className="reveal space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark sm:text-2xl">All-time drivers</h2>
          <p className="mt-0.5 font-mono text-[11px] text-light">
            {drivers.length} {drivers.length === 1 ? "driver" : "drivers"} over {data.seasons} seasons · {totalWins}{" "}
            {totalWins === 1 ? "win" : "wins"} · points before drops, sprints included
          </p>
        </div>
        <SlidingTabs
          items={SORTS.map((s) => ({ key: s.key, label: s.label, title: `Most ${s.label.toLowerCase()} for ${teamName}` }))}
          value={sort.key}
          onChange={(k) => {
            setSortKey(k);
            setAll(false);
          }}
          btnClassName="px-3 py-1.5 text-xs font-semibold"
        />
      </div>

      <div className="card overflow-hidden">
        {/* Column heads, wide screens only (phones show the picked figure). */}
        <div className="hidden grid-cols-[2rem_minmax(0,1fr)_repeat(4,4.5rem)] items-center gap-3 border-b border-border px-5 py-2.5 font-mono text-[10px] font-bold uppercase tracking-wider text-light sm:grid">
          <span>#</span>
          <span>Driver</span>
          {COLS.map((c) => (
            <span key={c.key} className={`text-right ${c.key === sort.key ? "text-dark" : ""}`}>
              {c.label}
            </span>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-4 text-sm text-light">No {sort.label.toLowerCase()} for {teamName} yet.</div>
        ) : (
          <ol className="divide-y divide-border">
            {shown.map((d, i) => {
              const rank = i + 1;
              const pct = Math.max(2, Math.round((d[sort.key] / max) * 100));
              return (
                <li key={d.driverId}>
                  <Link
                    to={`/drivers/${d.driverId}${d.seasonNumber != null ? `?season=${d.seasonNumber}` : ""}`}
                    className="group grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-surface2 sm:grid-cols-[2rem_minmax(0,1fr)_repeat(4,4.5rem)] sm:px-5"
                  >
                    <span
                      className={`font-display text-base font-black tabular-nums ${rank <= 3 ? "" : "text-faint"}`}
                      style={rank <= 3 ? { color: `var(--medal-${rank}, ${MEDAL[rank - 1]})` } : undefined}
                    >
                      {rank}
                    </span>
                    <span className="flex min-w-0 items-center gap-3">
                      <DriverAvatar name={d.name} photoUrl={d.photoUrl} fallbacks={d.photoFallbacks} color={color} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-display text-base font-black uppercase tracking-tight text-dark transition group-hover:text-brand">
                            {d.name}
                          </span>
                          <Flag code={countryFor(d.driverId, d.country)} w={16} h={11} />
                        </span>
                        <span className="block truncate font-mono text-[10px] text-light">
                          {seasonRanges(d.seasons)}
                          <span className="sm:hidden">
                            {" · "}
                            {/* The two figures next in line after the picked
                                one; all three cut off on a narrow phone. */}
                            {sort.order
                              .slice(1, 3)
                              .map((k) => `${d[k]} ${d[k] === 1 ? ONE[k] : k}`)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface2">
                          <span className="block h-1 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </span>
                      </span>
                    </span>
                    {/* Phones: the picked figure on its own. */}
                    <span className="text-right sm:hidden">
                      <span className="block font-display text-xl font-black tabular-nums" style={{ color: accent }}>
                        {d[sort.key]}
                      </span>
                      <span className="block font-mono text-[9px] uppercase text-light">{sort.unit}</span>
                    </span>
                    {COLS.map((c) => (
                      <span
                        key={c.key}
                        className={`hidden text-right tabular-nums sm:block ${
                          c.key === sort.key ? "font-display text-lg font-black" : "font-mono text-sm text-medium"
                        }`}
                        style={c.key === sort.key ? { color: accent } : undefined}
                      >
                        {d[c.key]}
                      </span>
                    ))}
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        {rows.length > TOP && (
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            className="block w-full border-t border-border px-5 py-2.5 text-center text-xs font-semibold text-link transition hover:bg-surface2"
          >
            {all ? "Show top 10" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
    </section>
  );
}
