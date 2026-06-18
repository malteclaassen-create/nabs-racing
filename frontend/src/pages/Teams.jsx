import { useCallback } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, SectionHeading, CardsSkeleton } from "../components/ui.jsx";

export default function Teams() {
  const { data, loading, error } = useApi(useCallback(() => api.teams(), []));
  if (loading)
    return (
      <div className="space-y-12">
        <PageHeaderSkeleton />
        <CardsSkeleton count={8} />
      </div>
    );
  if (error) return <ErrorBox message={error} />;

  const t1 = data.filter((t) => t.tier === 1);
  const t2 = data.filter((t) => t.tier === 2);

  return (
    <div className="space-y-12">
      <PageHeader eyebrow="The Grid" title="Teams" subtitle="Every team and their drivers for Season 7." />
      <TeamSection eyebrow="Tier 1" teams={t1} />
      <TeamSection eyebrow="Tier 2" teams={t2} />
    </div>
  );
}

function TeamSection({ eyebrow, teams }) {
  return (
    <section>
      <SectionHeading eyebrow={eyebrow} title="Constructors" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {teams.map((team) => (
          <div key={team.id} className="card lift overflow-hidden">
            <div className="h-1.5 w-full" style={{ backgroundColor: team.color }} />
            <div className="p-5">
              <div className="flex items-center gap-2.5">
                <span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ backgroundColor: team.color }} />
                <h3 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">
                  {team.name}
                </h3>
              </div>
              <ul className="mt-4 space-y-2.5">
                {team.drivers.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-display font-bold uppercase tracking-tight text-dark">{d.name}</span>
                    <span className="truncate text-light">{d.discordName}</span>
                  </li>
                ))}
                {team.drivers.length === 0 && (
                  <li className="text-sm text-light">No drivers assigned.</li>
                )}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
