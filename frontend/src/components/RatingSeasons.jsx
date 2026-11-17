import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import SlidingTabs from "./SlidingTabs.jsx";
import RatingChart from "./RatingChart.jsx";

// The public "Rating over the seasons" panel on a driver's page: one point per
// FINISHED season of this league, the numbers the driver ended it on. Every
// value can be picked. Only drawn from two seasons on: a single dot is not a
// curve. The live numbers of the season being raced stay private (My Rating).
const STATS = [
  { key: "overall", label: "Overall" },
  { key: "rac", label: "Racecraft" },
  { key: "aha", label: "Awareness" },
  { key: "pac", label: "Pace" },
  { key: "exp", label: "Experience" },
];

export default function RatingSeasons({ driverId, color }) {
  const { data } = useApi(
    useCallback(() => api.driverRatingSeasons(driverId).catch(() => null), [driverId])
  );
  const [stat, setStat] = useState("overall");
  const points = data?.points || [];
  if (points.length < 2) return null;

  return (
    <div className="reveal card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">
            Rating over the seasons
          </h2>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
            {STATS.find((s) => s.key === stat)?.label} at the end of each season
          </span>
        </div>
        <SlidingTabs
          className="sm:ml-auto"
          items={STATS}
          value={stat}
          onChange={setStat}
          wrapClassName="scrollbar-slim flex min-w-0 max-w-full flex-nowrap overflow-x-auto rounded-xl border border-border bg-card p-1"
          btnClassName="whitespace-nowrap px-3 py-1.5 text-xs font-bold uppercase tracking-wider"
        />
      </div>
      <div className="p-5 sm:p-6">
        <RatingChart points={points} statKey={stat} color={color} career />
      </div>
    </div>
  );
}
