// ---------------------------------------------------------------------------
// /s/<series>/wrapped: every driver's Season Wrapped for one season, in
// championship order, and the signed-in driver's own one first.
//
// Opens on the newest finished season: a Wrapped is about a season that is
// over, so the season being raced has none until its last round. The picker
// reaches the other finished ones. Each entry opens that driver's story and
// cards (pages/SeasonWrapped.jsx).
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { api } from "../api/client.js";
import { useSeriesPath } from "../context/SeriesContext.jsx";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { DriverAvatar, EmptyState, ErrorBox, PageHeader, PageHeaderSkeleton, CardsSkeleton, MEDAL_TEXT } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import { countryFor } from "../data/driverCountries.js";

export default function WrappedHub() {
  const [params, setParams] = useSearchParams();
  const season = params.get("season");
  const { seriesPath } = useSeriesPath();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [closed, setClosed] = useState(false);
  const [notFinished, setNotFinished] = useState(null);

  useEffect(() => {
    let gone = false;
    setError(null);
    setClosed(false);
    setNotFinished(null);
    api
      .wrappedHub(season)
      .then((d) => !gone && setData(d))
      .catch((e) => {
        if (gone) return;
        if (e.data?.closed) setClosed(true);
        else if (e.data?.notFinished) setNotFinished(true);
        else setError(e.message);
      });
    return () => {
      gone = true;
    };
  }, [season]);

  useSpecificTitle(data?.season ? `${data.season.label} Wrapped` : "Season Wrapped");

  if (closed) {
    return <EmptyState title="Season Wrapped isn't open yet" hint="The league switches it on once it has been checked. Have a look again soon." />;
  }
  if (notFinished) {
    return (
      <EmptyState title="That season isn't over yet" hint="Its Wrapped comes when the last round has been raced.">
        <Link to={seriesPath("/wrapped")} className="btn-secondary mt-4">
          The finished seasons
        </Link>
      </EmptyState>
    );
  }
  if (error) return <ErrorBox message={error} />;
  if (!data) {
    return (
      <div className="space-y-5">
        <PageHeaderSkeleton />
        <CardsSkeleton count={9} />
      </div>
    );
  }

  if (!data.season) {
    return (
      <EmptyState
        title="Season Wrapped comes at the end of the season"
        hint={`When ${data.waitingFor || "the season"} is over, every driver gets their season told as a story, with their car in 3D and a picture to share.`}
      />
    );
  }

  const link = (driverId) => seriesPath(`/wrapped/${encodeURIComponent(driverId)}`);
  const mine = data.mine ? data.drivers.find((d) => d.driverId === data.mine) : null;
  const pick = (n) => {
    const next = new URLSearchParams(params);
    next.set("season", String(n));
    setParams(next);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${data.season.label} · final`}
        title="Season Wrapped"
        subtitle="Every driver's season, told in cards: the best night, the biggest climb, the team-mate battle, the rival and the awards. Pick a driver."
        right={
          data.seasons.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Season</span>
              <select
                className="input py-1.5 text-sm"
                value={data.season.number}
                onChange={(e) => pick(e.target.value)}
                aria-label="Season"
              >
                {data.seasons.map((s) => (
                  <option key={s.number} value={s.number}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )
        }
      />


      {mine && (
        <Link
          to={link(mine.driverId)}
          className="card relative flex items-center gap-4 overflow-hidden p-5 transition hover:bg-surface2 sm:p-6"
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.16]"
            style={{ background: `radial-gradient(120% 160% at 100% 0%, ${mine.team?.color || "rgb(var(--c-brand))"}, transparent 60%)` }}
          />
          <Sparkles className="relative h-7 w-7 shrink-0 text-brand" aria-hidden="true" />
          <div className="relative min-w-0 flex-1">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">Yours</div>
            <div className="font-display text-2xl font-black uppercase tracking-tight text-dark sm:text-3xl">
              Your {data.season.label} Wrapped
            </div>
          </div>
          <span className="relative font-mono text-sm font-bold text-dark">
            P{mine.position} · {mine.points} pts
          </span>
        </Link>
      )}

      {data.drivers.length === 0 ? (
        <EmptyState title="Nobody has raced yet" hint="The first round of the season writes the first chapter." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.drivers.map((d) => {
            const code = countryFor(d.driverId, d.country);
            const medal = d.position <= 3 ? MEDAL_TEXT[d.position - 1] : null;
            return (
              <li key={d.driverId}>
                <Link
                  to={link(d.driverId)}
                  className="card flex h-full items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:bg-surface2"
                >
                  <span
                    className="w-9 shrink-0 text-right font-display text-xl font-black tabular-nums text-light"
                    style={medal ? { color: medal } : undefined}
                  >
                    {d.position}
                  </span>
                  <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={d.team?.color || "#888"} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-dark">{d.name}</span>
                      {code && <Flag code={code} w={18} h={13} />}
                    </span>
                    {d.team && (
                      <TeamLogo
                        id={d.team.id}
                        name={d.team.name}
                        color={d.team.color}
                        logoUrl={d.team.logoUrl}
                        size={14}
                        showName
                        nameClassName="truncate text-xs text-light"
                      />
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-sm font-bold tabular-nums text-dark">{d.points}</span>
                    <span className="block font-mono text-[10px] uppercase tracking-wider text-light">
                      {d.wins ? `${d.wins} W · ` : ""}
                      {d.podiums ? `${d.podiums} pod` : "pts"}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
