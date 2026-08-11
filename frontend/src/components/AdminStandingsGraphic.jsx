import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar, ErrorBox } from "./ui.jsx";
import { PosterFlags, PosterTeamArt } from "./AdminPosterAssets.jsx";
import { countryFor } from "../data/driverCountries.js";
import SlidingTabs from "./SlidingTabs.jsx";
import {
  LAYOUT, THEMES, THEME_KEYS, renderStandingsTo, savedTheme, saveTheme,
  STANDINGS_PER_PAGE, savedStandingsSetup, saveStandingsSetup, standingsPageCount,
  standingsTitle, standingsSubtitle, upToRoundOf, filterStandings, standingsTiersPresent,
} from "../utils/resultGraphic.js";

// ---------------------------------------------------------------------------
// Admin → Content → Standings: the championship table as a poster.
//
// The second generator, and deliberately the same machine as the first: same
// page size, same two designs, the same row, and the same two lists underneath
// for the flags and the team pictures. What it does NOT have is the podium,
// because a table has no podium — it has a leader, and putting three tiles
// above the person who is fourth would say something untrue about the season.
//
// Which round it is FROM is the round picked at the top of the Content area, so
// the poster and the message beside it are always about the same week. The
// table is then recomputed as it stood after that round: not today's table with
// the later rounds quietly included, which is what makes a poster for round two
// possible in round nine.
//
// A table longer than a page becomes several. Ten a sheet gives a top ten and
// then eleven to twenty, which is how a league posts a long table: two pictures
// in one message, not one picture with twenty tiny lines on it.
// ---------------------------------------------------------------------------

export default function AdminStandingsGraphic({ race, artVersion = 0, onArtChange = null }) {
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  const [art, setArt] = useState(null);
  const [table, setTable] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(savedTheme);
  const [setup, setSetup] = useState(savedStandingsSetup);
  const [page, setPage] = useState(1);
  const canvasRef = useRef(null);
  const { perPage, tier, withoutStarts } = setup;

  // "Round 4" for a championship round; a training or a special event has no
  // round number to freeze the table at, so those show the season as it stands.
  const upTo = upToRoundOf(race);

  const loadArt = useCallback(() => {
    api.teamArt().then(setArt).catch((e) => setError(e.message));
  }, []);
  useEffect(loadArt, [loadArt, artVersion]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .driverStandings(undefined, upTo)
      .then(setTable)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [upTo]);

  useEffect(load, [load, artVersion]);

  const all = useMemo(() => table?.standings || [], [table]);
  const tiers = useMemo(() => standingsTiersPresent(all), [all]);
  // A group this season does not have cannot stay selected.
  const activeTier = tiers.some((t) => t.key === tier) ? tier : "all";
  const standings = useMemo(
    () => filterStandings(all, activeTier, { withoutStarts }),
    [all, activeTier, withoutStarts]
  );
  const pages = standingsPageCount(standings.length, perPage);
  // How many the start rule is holding back, for the line that offers them.
  const idle = useMemo(() => filterStandings(all, activeTier, { withoutStarts: true }).length, [all, activeTier]);

  // A shorter table (or more drivers a page) can leave you standing on a page
  // that no longer exists.
  useEffect(() => {
    setPage((p) => Math.min(p, pages));
  }, [pages]);

  useEffect(() => {
    if (!standings.length || !art || !canvasRef.current) return;
    let alive = true;
    renderStandingsTo(canvasRef.current, {
      standings,
      teamArt: art,
      countryOf: (r) => countryFor(r.driverId, r.country),
      logoSrc: "/logo-light.png",
      title: standingsTitle(activeTier),
      subtitle: standingsSubtitle(upTo),
      rows: perPage,
      offset: (page - 1) * perPage,
      theme,
    }).catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [standings, art, theme, perPage, page, upTo, activeTier]);

  const hidden = idle - standings.length;

  function change(patch) {
    const next = { ...setup, ...patch };
    setSetup(next);
    saveStandingsSetup(next);
    onArtChange?.(); // the Discord half renders its own copies from these
  }

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const when = upTo ? `r${upTo}` : "latest";
      const group = activeTier === "all" ? "" : `-t${activeTier}`;
      // The sheet is in the name, because two of them in a downloads folder are
      // otherwise the same name twice.
      const name = `standings-${when}${group}${pages > 1 ? `-p${page}` : ""}-${theme}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  // Everyone on the poster, so their flags can be fixed from here. The whole
  // filtered table, not just the sheet on screen: the other sheets are the same
  // poster and go out in the same message.
  const onPoster = useMemo(
    () =>
      standings
        .filter((r) => r.driverId)
        .map((r) => ({ driverId: r.driverId, name: r.name, country: countryFor(r.driverId, r.country) || "" }))
        .sort((a, b) => (a.country ? 1 : 0) - (b.country ? 1 : 0)),
    [standings]
  );

  // And the teams they drive for. Only the WIDE logo matters here: the car and
  // the square badge belong to the podium tiles, which this poster has none of.
  const teamsOnPoster = useMemo(() => {
    if (!teams) return [];
    const byId = new Map(teams.map((t) => [t.id, t]));
    const seen = new Map();
    for (const r of standings) {
      const t = r.team;
      if (t && !seen.has(t.id)) seen.set(t.id, byId.get(t.id) || t);
    }
    return [...seen.values()];
  }, [standings, teams]);

  async function setCountry(driverId, code) {
    setBusy(true);
    setError(null);
    try {
      await api.updateDriver(driverId, { country: code });
      load(); // redraws with the flag in place
      onArtChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(teamId, kind, file) {
    setBusy(true);
    setError(null);
    try {
      setArt((await api.uploadTeamArt(teamId, kind, file)).art);
      onArtChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearArt(teamId, kind) {
    setBusy(true);
    setError(null);
    try {
      setArt(await api.clearTeamArt(teamId, kind));
      onArtChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const first = (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, standings.length);

  return (
    <div className="space-y-5">
      {error && <ErrorBox message={error} />}

      <div className="card overflow-hidden">
        <CardBar
          title="Standings graphic"
          right={
            <button className="btn-primary py-1.5 text-sm" onClick={download} disabled={!standings.length || loading}>
              Download PNG
            </button>
          }
        />
        <div className="flex flex-col gap-6 p-5 lg:flex-row lg:items-start">
          <canvas
            ref={canvasRef}
            className="mx-auto h-auto min-w-0 max-w-full rounded-lg shadow-lg lg:mx-0"
            style={{ width: 460, aspectRatio: `${LAYOUT.width} / ${LAYOUT.height}` }}
          />

          <div className="min-w-0 flex-1 space-y-4 border-t border-border pt-5 lg:min-w-[19rem] lg:shrink-0 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <SlidingTabs
              items={THEME_KEYS.map((k) => ({ key: k, label: THEMES[k].label }))}
              value={theme}
              onChange={(k) => {
                setTheme(k);
                saveTheme(k);
              }}
              btnClassName="px-4 py-1.5 text-xs"
            />

            {/* Which group. Only shown where the season HAS more than one, so a
                single-class season is not offered three buttons that empty the
                poster. Picking one re-ranks it 1..n and retitles the poster,
                the same way the standings page does. */}
            {tiers.length > 1 && (
              <label className="block">
                <span className="mb-1.5 block font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
                  Who is on it
                </span>
                <SlidingTabs
                  items={tiers.map((t) => ({ key: t.key, label: t.label }))}
                  value={activeTier}
                  onChange={(k) => {
                    setPage(1);
                    change({ tier: k });
                  }}
                  btnClassName="px-3.5 py-1.5 text-xs"
                />
              </label>
            )}

            {/* Seat holders are always on it, driven or not. The reserve pool
                is the whole sign-up list and most of it has never got in a car,
                so those are off unless this is ticked. The count says how many
                are being held back, so nobody vanishes without the page saying
                so. */}
            {(hidden > 0 || withoutStarts) && (
              <label className="flex items-start gap-2.5 text-xs text-medium">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={withoutStarts}
                  onChange={(e) => {
                    setPage(1);
                    change({ withoutStarts: e.target.checked });
                  }}
                />
                <span>
                  Include reserves without a start
                  {hidden > 0 && !withoutStarts ? ` (${hidden} hidden)` : ""}
                </span>
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
                Drivers per sheet
                <span className="tabular-nums text-light">{perPage}</span>
              </span>
              <input
                type="range"
                min={STANDINGS_PER_PAGE.min}
                max={STANDINGS_PER_PAGE.max}
                step={STANDINGS_PER_PAGE.step}
                value={perPage}
                aria-label="Drivers per sheet"
                className="w-full"
                onChange={(e) => change({ perPage: Number(e.target.value) })}
              />
            </label>

            {/* The sheets. Only shown when there is more than one, because a
                single button labelled "1" is a control that decides nothing. */}
            {pages > 1 && (
              <div className="space-y-1.5">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Sheet</span>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: pages }, (_, i) => i + 1).map((n) => {
                    const a = (n - 1) * perPage + 1;
                    const b = Math.min(n * perPage, standings.length);
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPage(n)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          n === page ? "border-link text-dark" : "border-border text-medium hover:border-link"
                        }`}
                      >
                        {a}&ndash;{b}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* The one thing worth saying in words: WHICH table this is. It is
                set by the round picker above rather than here, and without this
                line there is nothing on the page that says so. */}
            <p className="text-xs text-light">
              {upTo
                ? `The table as it stood after round ${upTo}. Change the round at the top to move it.`
                : "The season as it stands. Pick a championship round at the top to freeze the table after that round."}
              {standings.length > 0 && ` Showing ${first} to ${last} of ${standings.length}.`}
            </p>
            <p className="text-xs text-light">
              Which sheets actually go out is chosen under Discord post.
            </p>
          </div>
        </div>
      </div>

      <PosterFlags drivers={onPoster} busy={busy} onSet={setCountry} />

      <PosterTeamArt
        teams={teamsOnPoster}
        art={art}
        busy={busy}
        onUpload={upload}
        onClear={clearArt}
        kinds={["mark"]}
      />
    </div>
  );
}
