import { useEffect } from "react";
import { Link, NavLink, useLocation, matchPath } from "react-router-dom";
import { useSite } from "../site.jsx";
import { Streaks, SocialIcon } from "./ui.jsx";
import { inkOn } from "../format.js";

// The menu on a phone: the whole screen, the pages in the logo's big leaning
// capitals.
//
// On top, the running series as their banners side by side; the one picked
// is framed. Under them, in two groups set apart:
//  * the picked series' own pages (Standings, Races, Live, and Teams and
//    Transfers for a series with teams), headed by its name in its colour:
//    they change with the series;
//  * the league's pages (Home, History, Race Info): the same whichever series.
// Between seasons there is no series to pick, and only the league's pages.

function Socials() {
  const { settings } = useSite();
  return (
    <div className="flex items-center gap-4 text-sm text-muted">
      {settings?.discordInvite && (
        <a href={settings.discordInvite} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-ink">
          <SocialIcon name="discord" /> Discord
        </a>
      )}
      {settings?.youtubeUrl && (
        <a href={settings.youtubeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-ink">
          <SocialIcon name="youtube" /> YouTube
        </a>
      )}
    </div>
  );
}

// A group of pages in the big capitals, the open one marked in `color`.
function BigLinks({ links, color }) {
  return (
    <nav className="flex flex-col">
      {links.map(({ to, label }) => (
        <NavLink key={label} to={to} end className={({ isActive }) => `display flex items-center gap-3 py-1.5 text-[2.5rem] leading-none ${isActive ? "text-ink" : "text-muted hover:text-ink"}`}>
          {({ isActive }) => (
            <>
              <span className="w-1.5 self-stretch rounded-full" style={{ background: isActive ? color : "transparent" }} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

// A series' banner to pick it by. Picking keeps the page you are on
// (standings stay standings).
function SeriesTile({ s, on, sub, wide }) {
  const color = s.color || "#ffffff";
  return (
    <Link
      to={`/series/${s.slug}${sub ? `/${sub}` : ""}`}
      aria-label={s.name}
      aria-current={on ? "true" : undefined}
      className={`relative block overflow-hidden rounded-xl transition ${wide ? "aspect-[16/7]" : "aspect-[4/3]"} ${on ? "ring-2 ring-ink" : "opacity-55 hover:opacity-90"}`}
      style={{ background: color }}
    >
      {s.imageUrl ? (
        <img src={s.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="display absolute inset-x-0 bottom-0 p-2.5 text-base leading-tight" style={{ color: inkOn(color) }}>
          {s.name}
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: color }} />
    </Link>
  );
}

export default function PhoneMenu({ seriesLinks, account }) {
  const { seriesList, series, settings } = useSite();
  const { pathname } = useLocation();
  // the page behind holds still while the menu is open
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  // the running series, and an archived one while it is being looked at
  const shown = seriesList.filter((s) => !s.archived || s.slug === series?.slug);
  const sub = matchPath("/series/:slug/:page/*", pathname)?.params.page;
  const color = series?.color || "rgb(var(--accent))";
  const live = settings?.liveEnabled ? [{ to: "/live", label: "Live" }] : [];
  const seriesPages = series ? [...seriesLinks, ...(series.live ? live : [])] : [];
  const leaguePages = [{ to: "/", label: "Home" }, ...(series?.live ? [] : live), { to: "/history", label: "History" }, { to: "/info", label: "Race Info" }];

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-30 overflow-y-auto bg-bg lg:hidden">
      <Streaks opacity={0.05} className="streaks-full" />
      <div className="page relative flex min-h-full flex-col py-5">
        {shown.length > 0 && (
          <div className={`grid gap-2 ${shown.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {shown.map((s) => (
              <SeriesTile key={s.slug} s={s} on={s.slug === series?.slug} sub={sub} wide={shown.length === 1} />
            ))}
          </div>
        )}

        {seriesPages.length > 0 && (
          <section className="mt-6">
            <div className="mb-1 flex items-center gap-2 text-sm font-bold" style={{ color }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
              {series.name}
            </div>
            <BigLinks links={seriesPages} color={color} />
          </section>
        )}

        <section className={seriesPages.length ? "mt-6 border-t border-line pt-5" : "mt-2"}>
          {seriesPages.length > 0 && <div className="mb-1 text-sm font-bold text-muted">League</div>}
          <BigLinks links={leaguePages} color={color} />
        </section>

        <div className="h-8 shrink-0" />
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          {account}
          <Socials />
        </div>
      </div>
    </div>
  );
}
