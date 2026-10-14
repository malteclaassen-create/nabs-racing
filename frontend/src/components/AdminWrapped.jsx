import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeriesPath } from "../context/SeriesContext.jsx";
import { ErrorBox, Notice, CardHead } from "./ui.jsx";
import SlidingTabs from "./SlidingTabs.jsx";

// ---------------------------------------------------------------------------
// Admin -> Content -> Season Wrapped: its switch, and the way to look at it.
//
// Season Wrapped tells one driver's whole season as cards, publicly, made to be
// shared (backend services/seasonWrappedService.js). Off is off; "admins only"
// opens every page to the league admins on the real site so a season can be
// checked first; "everyone" is the launch, and the bell tells everybody once.
// ---------------------------------------------------------------------------

const MODE_TEXT = {
  off: "Off. Nobody sees Season Wrapped, and nothing on the site points at it.",
  admins: "Admins only. League admins can open every driver's Wrapped and the season's page; members see nothing yet.",
  all: "Everyone. Every driver's Wrapped is a public page with its own link preview, and the Standings menu shows the way.",
};

export default function AdminWrapped() {
  const { data, error: loadError, reload } = useApi(useCallback(() => api.adminWrapped(), []));
  const { seriesPath } = useSeriesPath();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function setMode(mode) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.setAdminWrappedMode(mode);
      setDone(
        mode === "all"
          ? "Season Wrapped is open to everyone. Members got a note in their bell."
          : mode === "admins"
            ? "Season Wrapped is on for admins only."
            : "Season Wrapped is off."
      );
      // The menu asks once per sign-in; let it ask again.
      window.dispatchEvent(new Event("nabs-auth"));
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <ErrorBox message={loadError} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      {error && <ErrorBox message={error} />}
      {done && <Notice kind="success">{done}</Notice>}

      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <div className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">Season Wrapped</div>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-light">{MODE_TEXT[data.mode] || MODE_TEXT.off}</p>
        </div>
        <SlidingTabs
          items={[
            { key: "off", label: "Off" },
            { key: "admins", label: "Admins only" },
            { key: "all", label: "Everyone" },
          ]}
          value={data.mode || "off"}
          onChange={(m) => !busy && m !== data.mode && setMode(m)}
          wrapClassName="inline-flex rounded-xl border border-border bg-surface2/60 p-1"
          btnClassName="px-3 py-1.5 text-[13px]"
        />
      </div>

      <div className="card space-y-4 p-5">
        <CardHead eyebrow="What it is" title="How Season Wrapped works" />
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-light">
          <li>
            One page per driver and season: where they finished, the season in numbers, the best result, the biggest climb
            from the grid, the championship round by round, the team-mate battle, the rival, the wins and the honours, and
            a one-line label for the kind of season it was.
          </li>
          <li>
            It plays as a story first, Spotify Wrapped style: full screen, slide by slide, with the driver's car in 3D in
            their team colour, and a picture of the season at the end made to be posted as a story or status. It starts
            by itself the first time a Wrapped is opened in a visit; after that the cards are the page and the story is
            the Play button on top. Lite graphics mode gets it without the 3D.
          </li>
          <li>
            Only a finished season has a Wrapped: it appears when the last round is saved, and the season being raced
            has none until then. Every number is the one the driver's profile and the standings show.
          </li>
          <li>
            When a season's last round is saved, every driver with a login gets a note in their bell (and a push, if they
            switched that on) that their Wrapped is ready. Once per season, so editing the finale stays quiet.
          </li>
          <li>Shared in Discord or WhatsApp, a driver's link shows a picture of their season.</li>
        </ul>
        {data.mode !== "off" && (
          <Link to={seriesPath("/wrapped")} className="btn-secondary inline-flex">
            Open the season's Wrapped
          </Link>
        )}
      </div>
    </div>
  );
}
