import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar, ErrorBox } from "./ui.jsx";
import { PosterFlags, PosterTeamArt } from "./AdminPosterAssets.jsx";
import { countryFor } from "../data/driverCountries.js";
import SlidingTabs from "./SlidingTabs.jsx";
import {
  LAYOUT, THEMES, THEME_KEYS, renderStandingsTo, renderConstructorsTo, savedTheme, saveTheme,
  STANDINGS_PER_PAGE, savedStandingsSetup, saveStandingsSetup, standingsPageCount,
  standingsTitle, standingsSubtitle, constructorsTitle, upToRoundOf, filterStandings,
  standingsTiersPresent, CONSTRUCTOR_SPOTS, DEFAULT_FRAMING, FRAMING_LIMITS, cleanFraming,
} from "../utils/resultGraphic.js";

// Which championship the poster is of. Same machine, two tables.
const KINDS = [
  { key: "drivers", label: "Drivers" },
  { key: "constructors", label: "Constructors" },
];

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
  const [teamTables, setTeamTables] = useState(null); // { t1, t2 }, the constructors
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(savedTheme);
  const [setup, setSetup] = useState(savedStandingsSetup);
  const [page, setPage] = useState(1);
  const canvasRef = useRef(null);
  const { kind, perPage, tier, withoutStarts, t1Rows, t2Rows } = setup;
  const isTeams = kind === "constructors";

  // "Round 4" for a championship round; a training or a special event has no
  // round number to freeze the table at, so those show the season as it stands.
  const upTo = upToRoundOf(race);

  // The team pictures, and the outline weight the posters are drawn with. That
  // one is shared with the result poster rather than a second setting: it is
  // the same pink line round the same kind of box, and two of them would drift.
  const [framing, setFraming] = useState(DEFAULT_FRAMING);
  const frameTimer = useRef(null);
  const loadArt = useCallback(() => {
    api.teamArt().then(setArt).catch((e) => setError(e.message));
    api.posterFraming().then((f) => setFraming(cleanFraming(f))).catch(() => {});
  }, []);
  useEffect(loadArt, [loadArt, artVersion]);
  useEffect(() => () => clearTimeout(frameTimer.current), []);

  // Redraws on every step of the drag and saves once it stops, the same way the
  // car framing next door does.
  function setFrameWidth(frameWidth) {
    const next = { ...framing, frameWidth };
    setFraming(next);
    clearTimeout(frameTimer.current);
    frameTimer.current = setTimeout(() => {
      api
        .setPosterFraming({ frameWidth })
        .then(() => onArtChange?.())
        .catch((e) => setError(e.message));
    }, 400);
  }

  // Both championships are fetched for the round in view. Two small reads, and
  // having them both in hand means the Drivers/Constructors switch redraws
  // instead of showing an empty poster while the network catches up.
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.driverStandings(undefined, upTo),
      api.t1Standings(undefined, upTo).catch(() => null),
      api.t2Standings(undefined, upTo).catch(() => null),
    ])
      .then(([drivers, t1, t2]) => {
        setTable(drivers);
        setTeamTables({ t1: t1?.standings || [], t2: t2?.standings || [] });
      })
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
    if (!art || !canvasRef.current) return;
    let alive = true;
    const fail = (e) => alive && setError(e.message);
    if (isTeams) {
      if (!teamTables) return;
      renderConstructorsTo(canvasRef.current, {
        t1: teamTables.t1,
        t2: teamTables.t2,
        teamArt: art,
        logoSrc: "/logo-light.png",
        title: constructorsTitle(),
        subtitle: standingsSubtitle(upTo),
        t1Rows,
        t2Rows,
        framing,
        theme,
      }).catch(fail);
    } else {
      if (!standings.length) return;
      renderStandingsTo(canvasRef.current, {
        standings,
        teamArt: art,
        countryOf: (r) => countryFor(r.driverId, r.country),
        logoSrc: "/logo-light.png",
        title: standingsTitle(activeTier),
        subtitle: standingsSubtitle(upTo),
        rows: perPage,
        offset: (page - 1) * perPage,
        framing,
        theme,
      }).catch(fail);
    }
    return () => {
      alive = false;
    };
  }, [isTeams, teamTables, standings, art, framing, theme, perPage, page, upTo, activeTier, t1Rows, t2Rows]);

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
      const name = isTeams
        ? `constructors-${when}-${theme}.png`
        : `standings-${when}${group}${pages > 1 ? `-p${page}` : ""}-${theme}.png`;
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
    const add = (id) => {
      if (id && !seen.has(id)) seen.set(id, byId.get(id) || { id, name: id });
    };
    if (isTeams) {
      for (const r of (teamTables?.t1 || []).slice(0, t1Rows)) add(r.teamId);
      for (const r of (teamTables?.t2 || []).slice(0, t2Rows)) add(r.teamId);
    } else {
      for (const r of standings) add(r.team?.id);
    }
    return [...seen.values()];
  }, [isTeams, teamTables, t1Rows, t2Rows, standings, teams]);

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

  async function upload(teamId, slot, file) {
    setBusy(true);
    setError(null);
    try {
      setArt((await api.uploadTeamArt(teamId, slot, file)).art);
      onArtChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearArt(teamId, slot) {
    setBusy(true);
    setError(null);
    try {
      setArt(await api.clearTeamArt(teamId, slot));
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
            <button
              className="btn-primary py-1.5 text-sm"
              onClick={download}
              disabled={loading || (isTeams ? !teamTables : !standings.length)}
            >
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
            {/* Which championship. First, because it decides what every
                control under it means. */}
            <SlidingTabs
              items={KINDS}
              value={kind}
              onChange={(k) => {
                setPage(1);
                change({ kind: k });
              }}
              btnClassName="px-4 py-1.5 text-xs"
            />

            <SlidingTabs
              items={THEME_KEYS.map((k) => ({ key: k, label: THEMES[k].label }))}
              value={theme}
              onChange={(k) => {
                setTheme(k);
                saveTheme(k);
              }}
              btnClassName="px-4 py-1.5 text-xs"
            />

            {/* The pink line round every row. Shared with the result poster,
                which is where the car framing is set; here because a table
                poster is often the one being looked at when the weight is
                decided. */}
            <label className="block">
              <span className="mb-1.5 flex items-center justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
                Outline width
                <span className="tabular-nums text-light">{framing.frameWidth} px</span>
              </span>
              <input
                type="range"
                min={FRAMING_LIMITS.frameWidth.min}
                max={FRAMING_LIMITS.frameWidth.max}
                step={FRAMING_LIMITS.frameWidth.step}
                value={framing.frameWidth}
                aria-label="Outline width"
                className="w-full"
                onChange={(e) => setFrameWidth(Number(e.target.value))}
              />
            </label>

            {/* How many teams of each tier. Steve's split: Tier 1 is a short
                grid whose top five is the story, Tier 2 has more teams in it.
                Both on one poster, one table above the other. */}
            {isTeams && (
              <>
                <label className="block">
                  <span className="mb-1.5 flex items-center justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
                    Tier 1 teams
                    <span className="tabular-nums text-light">{t1Rows}</span>
                  </span>
                  <input
                    type="range"
                    min={CONSTRUCTOR_SPOTS.min}
                    max={CONSTRUCTOR_SPOTS.max}
                    step={CONSTRUCTOR_SPOTS.step}
                    value={t1Rows}
                    aria-label="Tier 1 teams"
                    className="w-full"
                    onChange={(e) => change({ t1Rows: Number(e.target.value) })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 flex items-center justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
                    Tier 2 teams
                    <span className="tabular-nums text-light">{t2Rows}</span>
                  </span>
                  <input
                    type="range"
                    min={CONSTRUCTOR_SPOTS.min}
                    max={CONSTRUCTOR_SPOTS.max}
                    step={CONSTRUCTOR_SPOTS.step}
                    value={t2Rows}
                    aria-label="Tier 2 teams"
                    className="w-full"
                    onChange={(e) => change({ t2Rows: Number(e.target.value) })}
                  />
                </label>
              </>
            )}

            {/* Which group. Only shown where the season HAS more than one, so a
                single-class season is not offered three buttons that empty the
                poster. Picking one re-ranks it 1..n and retitles the poster,
                the same way the standings page does. */}
            {!isTeams && tiers.length > 1 && (
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
            {!isTeams && (hidden > 0 || withoutStarts) && (
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

            {!isTeams && (
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
            )}

            {/* The sheets. Only shown when there is more than one, because a
                single button labelled "1" is a control that decides nothing. */}
            {!isTeams && pages > 1 && (
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
              {!isTeams && standings.length > 0 && ` Showing ${first} to ${last} of ${standings.length}.`}
            </p>
            <p className="text-xs text-light">
              {isTeams
                ? "Both tiers on one sheet. The rows use each team's wide logo, uploaded below."
                : "Which sheets actually go out is chosen under Discord post."}
            </p>
          </div>
        </div>
      </div>

      {!isTeams && <PosterFlags drivers={onPoster} busy={busy} onSet={setCountry} />}

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
