import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar, ErrorBox } from "./ui.jsx";
import { PosterFlags, PosterTeamArt } from "./AdminPosterAssets.jsx";
import { countryFor } from "../data/driverCountries.js";
import { fmtDateShort } from "../utils/format.js";
import SlidingTabs from "./SlidingTabs.jsx";
import {
  LAYOUT, THEMES, THEME_KEYS, EXPORT_SCALE, renderPosterTo, savedTheme, saveTheme,
  DEFAULT_FRAMING, FRAMING_LIMITS, cleanFraming,
  RESULT_PER_PAGE, savedResultSetup, saveResultSetup, pageCount, classifiedResults,
} from "../utils/resultGraphic.js";

// Admin → Graphics: the result poster for a finished round, drawn from the
// round's own data and handed over as a PNG.
//
// Everything on the poster (order, names, flags, points, teams) is already in
// the database the moment a result is imported. The two things it does NOT hold
// are the cut-out car and the wide team wordmark, so those are uploaded per
// team, once, and keep coming back every round that team is on the podium.
//
// The page is deliberately almost wordless. What each slot wants is written in
// the empty slot itself, the state of the artwork is the artwork, and the
// preview is the file you get. A page that explains itself in paragraphs is a
// page whose controls did not.

const fmtDate = (d) => (d ? fmtDateShort(d) : "no date");

// How wide the preview is drawn, in screen pixels. Nothing to do with the
// exported file, which is always 1080x1350 — this is only how big the thing you
// are judging is on YOUR screen, so it belongs in this browser rather than in
// the database next to the framing.
//
// The default splits the card roughly down the middle on a normal desktop:
// picture on the left, controls on the right, both big enough to use.
const PREVIEW_STORE = "nabs_graphic_preview_w";
const PREVIEW_W = { min: 260, max: 820, step: 10, def: 460 };

function savedPreviewW() {
  try {
    const n = Number(localStorage.getItem(PREVIEW_STORE));
    return Number.isFinite(n) && n >= PREVIEW_W.min && n <= PREVIEW_W.max ? n : PREVIEW_W.def;
  } catch {
    return PREVIEW_W.def;
  }
}

// One slider, with what it is currently set to written next to its name. The
// number matters here: "a bit more zoom" is not something you can tell a
// colleague over Discord, and "1.6x, 40 left" is.
function Slider({ label, value, format, limits, disabled, onChange }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
        {label}
        <span className="tabular-nums text-light">{format(value)}</span>
      </span>
      <input
        type="range"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        disabled={disabled}
        aria-label={label}
        className="w-full"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

// The round is somebody else's decision: one picker at the top of the Content
// area drives both this and the Discord message, so the poster on screen and
// the poster that gets posted are always about the same round.
//
// `onArtChange` fires whenever the artwork or a driver's flag is edited here,
// because the message next door draws its own copy of this poster and would
// otherwise keep sending the version from before the fix.
export default function AdminResultGraphic({ raceId, artVersion = 0, onArtChange = null }) {
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  const [art, setArt] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(savedTheme);
  const [framing, setFraming] = useState(DEFAULT_FRAMING);
  const [presets, setPresets] = useState([]);
  // The name box for a new preset, or null when the button has not been pressed.
  // A field that is only there while you are naming something keeps the panel a
  // list of framings rather than a form.
  const [naming, setNaming] = useState(null);
  const [previewW, setPreviewW] = useState(savedPreviewW);
  // How long the poster is, and which sheet of it is on screen. The length is
  // stored (the Discord post next door draws its own copies and has to cut them
  // the same way); the sheet you happen to be looking at is not, because it is
  // not a decision about the poster.
  const [setup, setSetup] = useState(savedResultSetup);
  const [page, setPage] = useState(1);
  const canvasRef = useRef(null);
  const saveTimer = useRef(null);
  // Whether a framing of ours is still on its way to the server; see loadArt.
  const pendingFraming = useRef(false);
  const { perPage } = setup;

  // The artwork and the framing, re-read whenever anything about the poster
  // changes anywhere in the Content area.
  //
  // Both halves of this tab stay mounted, so the standings poster next door is
  // not a page you come back from — it is a panel beside this one with the SAME
  // team pictures under it. Loading these once on mount meant a wide logo
  // uploaded over there never reached the poster over here: the file was in the
  // database, the other preview showed it, and this one kept drawing the
  // picture from before until the round was changed. `artVersion` is the Content
  // area's own count of those edits, and this is what makes them arrive.
  const loadArt = useCallback(() => {
    api.teamArt().then(setArt).catch((e) => setError(e.message));
    // A framing that will not load is not a reason to show no poster: the
    // default draws every car whole, which is what it did before there was a
    // slider at all.
    api
      .posterFraming()
      .then((f) => {
        setPresets(Array.isArray(f?.presets) ? f.presets : []);
        // Never over a drag of your own. Our save is what bumps the count that
        // brings us back here, and answering it with the value the server had a
        // moment ago would snap the slider back under the hand holding it.
        if (!pendingFraming.current) setFraming(cleanFraming(f));
      })
      .catch(() => {});
  }, []);
  useEffect(loadArt, [loadArt, artVersion]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Dragging a slider redraws on every step and saves once you stop. Saving on
  // each step would be a hundred writes for one decision; not saving until a
  // button is pressed would be a button nobody presses, and next week's poster
  // would be framed like the day the cars were uploaded.
  function nudge(patch) {
    const next = cleanFraming({ ...framing, ...patch });
    setFraming(next);
    pendingFraming.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api
        .setPosterFraming(next)
        .then(() => {
          pendingFraming.current = false;
          onArtChange?.(); // the Discord half draws its own copy
        })
        .catch((e) => {
          pendingFraming.current = false;
          setError(e.message);
        });
    }, 400);
  }

  // Presets save straight away rather than on the debounce: pressing a button
  // is a decision, and a decision that might still be in flight when you close
  // the tab is not saved.
  function savePresets(next) {
    setPresets(next);
    api
      .setPosterFraming({ presets: next })
      .catch((e) => setError(e.message));
  }

  function addPreset(name) {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    // Same name means replace, so saving twice under one name leaves one entry
    // rather than a list of near-identical ones.
    const rest = presets.filter((p) => p.name.toLowerCase() !== clean.toLowerCase());
    savePresets([...rest, { name: clean, ...framing }]);
    setNaming(null);
  }

  // The round itself, re-read on the same signal: a driver's flag fixed on the
  // standings side is written to the DRIVER, and this poster carries it too.
  useEffect(() => {
    if (!raceId) return;
    setLoading(true);
    setError(null);
    api
      .raceResults(raceId)
      .then(setResult)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [raceId, artVersion]);

  // Everybody classified, by the poster's own rule. How many sheets the round
  // makes is this list cut into lengths, and it is also who the flag and
  // artwork panels underneath are about.
  const classified = useMemo(() => classifiedResults(result?.results || []), [result]);
  const pages = pageCount(classified.length, perPage);

  // A longer sheet (or a round with fewer finishers) can leave you standing on
  // a sheet that no longer exists.
  useEffect(() => {
    setPage((p) => Math.min(p, pages));
  }, [pages]);

  // Redraw whenever the round, the artwork, the design or the sheet changes.
  // Exactly the same call the Discord post makes, so the preview cannot drift
  // away from what gets sent.
  useEffect(() => {
    if (!result || !art || !canvasRef.current) return;
    let alive = true;
    renderPosterTo(canvasRef.current, {
      race: result.race,
      results: result.results,
      teamArt: art,
      countryOf: (r) => countryFor(r.driverId, r.country),
      logoSrc: "/logo-light.png",
      theme,
      framing,
      perPage,
      offset: (page - 1) * perPage,
    }).catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [result, art, theme, framing, perPage, page]);

  // The length is saved the moment it changes, and the Discord half is told:
  // it renders its own sheets from this and would otherwise attach the old cut.
  function changeSetup(patch) {
    const next = { ...setup, ...patch };
    setSetup(next);
    saveResultSetup(next);
    onArtChange?.();
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

  function download() {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const race = result.race;
      const round = race.number != null ? `r${race.number}` : "session";
      const track = String(race.track || "race").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      // The design and the sheet are in the file name: two versions of the same
      // round in a downloads folder are otherwise the same name twice.
      const sheet = pages > 1 ? `-p${page}` : "";
      const name = `${round}-${track}-result${sheet}-${theme}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  // Every driver ON the poster, with the flag they have now. Nationality is
  // normally the driver's own to set, on their profile after a Discord login,
  // so anyone who has never logged in has none — but the ones who HAVE logged in
  // can also have picked the wrong country, or a country they no longer race
  // under, and until now the only way to fix that was to be them. The ones
  // without a flag are listed first, because they are the ones the poster shows
  // a hole for.
  //
  // This writes the same field their profile would, so a correction here turns
  // up across the whole site rather than only on the poster.
  const onPoster = useMemo(
    () =>
      classified
        .filter((r) => r.driverId)
        .map((r) => ({ driverId: r.driverId, name: r.name, country: countryFor(r.driverId, r.country) || "" }))
        .sort((a, b) => (a.country ? 1 : 0) - (b.country ? 1 : 0)),
    [classified]
  );

  async function setCountry(driverId, code) {
    setBusy(true);
    setError(null);
    try {
      await api.updateDriver(driverId, { country: code });
      setResult(await api.raceResults(raceId)); // redraws with the flag in place
      onArtChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // The teams actually on the poster — the only ones whose artwork it can use.
  // A full roster of upload slots would bury them. Every SHEET of the round,
  // not just the one on screen: the others are the same poster and go out in
  // the same message.
  const teamsInGraphic = useMemo(() => {
    if (!teams) return [];
    const byId = new Map(teams.map((t) => [t.id, t]));
    const seen = new Map();
    for (const r of classified) {
      const t = r.effectiveTeam || r.team;
      if (t && !seen.has(t.id)) seen.set(t.id, byId.get(t.id) || t);
    }
    return [...seen.values()];
  }, [classified, teams]);

  // What the sheet on screen is showing, for the line that says so.
  const first = classified.length ? (page - 1) * perPage + 1 : 0;
  const last = Math.min(page * perPage, classified.length);

  // Which sheet everybody is on, for the two lists underneath. They cover the
  // WHOLE round now — every sheet of it — so a picture uploaded for somebody
  // fifteenth is a picture that changes nothing on a poster showing the top ten,
  // which looks exactly like an upload that failed. Only said where it can
  // surprise: one sheet, and everyone on the list is on it.
  const sheetNotes = useMemo(() => {
    if (pages < 2) return null;
    const drivers = new Map();
    const teams = new Map();
    classified.forEach((r, i) => {
      const sheet = Math.floor(i / perPage) + 1;
      if (r.driverId && !drivers.has(r.driverId)) drivers.set(r.driverId, sheet);
      const t = r.effectiveTeam || r.team;
      if (t && !teams.has(t.id)) teams.set(t.id, sheet);
    });
    return { drivers, teams };
  }, [classified, perPage, pages]);

  // "Sheet 2", and nothing at all for the sheet you are already looking at.
  const noteFor = (map, id) => {
    const sheet = map?.get(id);
    return sheet && sheet !== page ? `Sheet ${sheet}` : null;
  };

  return (
    <div className="space-y-5">
      {error && <ErrorBox message={error} />}

      <div className="card overflow-hidden">
        <CardBar
          title="Result graphic"
          right={
            <button className="btn-primary py-1.5 text-sm" onClick={download} disabled={!result || loading}>
              Download PNG
            </button>
          }
        />
        {/* Picture on the left, everything you can change to it on the right.
            Stacked they made a card you had to scroll past; side by side the
            poster and the slider that is moving it are on screen at once, which
            is the only way to set a crop.

            The preview IS the export: the same canvas, shown smaller. Nothing
            here is a mock-up of the file you get. */}
        <div className="flex flex-col gap-6 p-5 lg:flex-row lg:items-start">
          {/* Its width is yours to set (the slider at the bottom of the
              controls), but it SHRINKS rather than wins: `max-w-full` keeps it
              inside a narrow window, and letting it give way to the controls'
              minimum below is what stops a wide preview squeezing the sliders
              into a 130px strip you cannot use. Ask for more than the card can
              hold and you get as much of it as fits. */}
          <canvas
            ref={canvasRef}
            className="mx-auto h-auto min-w-0 max-w-full rounded-lg shadow-lg lg:mx-0"
            style={{ width: previewW, aspectRatio: `${LAYOUT.width} / ${LAYOUT.height}` }}
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

            {/* How the cars sit in the podium tiles. */}
            <Slider
              label="Car zoom"
              value={framing.zoom}
              limits={FRAMING_LIMITS.zoom}
              disabled={!result}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(zoom) => nudge({ zoom })}
            />
            <Slider
              label="Left / right"
              value={framing.x}
              limits={FRAMING_LIMITS.x}
              disabled={!result}
              format={(v) => `${v > 0 ? "+" : ""}${Math.round(v)} px`}
              onChange={(x) => nudge({ x })}
            />
            <Slider
              label="Up / down"
              value={framing.y}
              limits={FRAMING_LIMITS.y}
              disabled={!result}
              format={(v) => `${v > 0 ? "+" : ""}${Math.round(v)} px`}
              onChange={(y) => nudge({ y })}
            />
            {/* The pink line round every tile and every row. Not part of the
                car framing above, but it lives with it because it is the same
                kind of decision: how the poster is drawn rather than what is on
                it. It applies to the standings posters too, which is why it is
                saved alongside rather than in this browser. */}
            <Slider
              label="Outline width"
              value={framing.frameWidth}
              limits={FRAMING_LIMITS.frameWidth}
              disabled={!result}
              format={(v) => `${Math.round(v)} px`}
              onChange={(frameWidth) => nudge({ frameWidth })}
            />

            {/* The same two switches the standings half has, on the same
                stored setting: they are about the poster, not about which
                poster you happen to be looking at. The box shows what the
                design in front of you is currently doing. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-medium">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={framing.pts === "on" || (framing.pts === "design" && (THEMES[theme] || THEMES.black).points === "pts")}
                  onChange={(e) => nudge({ pts: e.target.checked ? "on" : "off" })}
                />
                <span>&ldquo;PTS&rdquo; after the points</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={framing.flags === "on" || (framing.flags === "design" && (THEMES[theme] || THEMES.black).row.flags)}
                  onChange={(e) => nudge({ flags: e.target.checked ? "on" : "off" })}
                />
                <span>Flags</span>
              </label>
            </div>

            {/* How much of the classification is on a sheet, and which sheet
                you are looking at.

                Ten was the whole poster until now: a podium and seven rows,
                with everybody from eleventh down simply not on it. Longer packs
                more in and shorter gives fatter bars, and past the length the
                round carries on onto a second sheet — places eleven to twenty,
                drawn as a table, because a race has one podium and it belongs
                on the sheet the winner is on. */}
            <div className="space-y-3 border-t border-border pt-4">
              <Slider
                label="Drivers per sheet"
                value={perPage}
                limits={RESULT_PER_PAGE}
                disabled={!result}
                format={(v) => `${Math.round(v)}`}
                onChange={(n) => {
                  setPage(1);
                  changeSetup({ perPage: n });
                }}
              />

              {/* The sheets. Only where there is more than one, because a
                  single button labelled "1" is a control that decides
                  nothing. */}
              {pages > 1 && (
                <div className="space-y-1.5">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Sheet</span>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: pages }, (_, i) => i + 1).map((n) => {
                      const a = (n - 1) * perPage + 1;
                      const b = Math.min(n * perPage, classified.length);
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

              <p className="text-xs text-light">
                {classified.length > 0 && `Showing ${first} to ${last} of ${classified.length}. `}
                Which sheets actually go out is chosen under Discord post.
              </p>
            </div>

            <div className="flex items-start justify-between gap-3 text-xs">
              <span className="text-light">
                One framing for all three tiles. Whatever hangs over an edge is cut off there.
              </span>
              <button
                type="button"
                className="shrink-0 font-semibold text-light transition hover:text-dark"
                onClick={() => nudge(DEFAULT_FRAMING)}
              >
                Reset
              </button>
            </div>

            {/* Saved framings. A crop that works for this season's cars is a
                minute of dragging, and next season's cars will want a different
                one — this is what makes going back to it a click. */}
            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Presets</span>
                {naming === null ? (
                  <button
                    type="button"
                    disabled={!result}
                    className="shrink-0 text-xs font-semibold text-link transition hover:text-dark disabled:opacity-40"
                    onClick={() => setNaming("")}
                  >
                    Save this framing
                  </button>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 text-xs font-semibold text-light transition hover:text-dark"
                    onClick={() => setNaming(null)}
                  >
                    Cancel
                  </button>
                )}
              </div>

              {naming !== null && (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    className="input py-1.5 text-sm"
                    placeholder="Name it, e.g. S8 cars"
                    maxLength={40}
                    value={naming}
                    onChange={(e) => setNaming(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addPreset(naming);
                      if (e.key === "Escape") setNaming(null);
                    }}
                  />
                  <button
                    type="button"
                    className="btn-primary shrink-0 px-3 py-1.5 text-sm disabled:opacity-40"
                    disabled={!naming.trim()}
                    onClick={() => addPreset(naming)}
                  >
                    Save
                  </button>
                </div>
              )}

              {presets.length === 0 ? (
                <p className="text-xs text-light">Nothing saved yet.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {presets.map((p) => {
                    // The one you are looking at, marked. Without it, a panel of
                    // saved names cannot tell you which of them is on screen.
                    const on =
                      Math.abs(p.zoom - framing.zoom) < 0.005 &&
                      Math.round(p.x) === Math.round(framing.x) &&
                      Math.round(p.y) === Math.round(framing.y);
                    return (
                      <li key={p.name}>
                        <span
                          className={`flex items-center gap-1 rounded-full border py-1 pl-3 pr-1.5 text-xs font-semibold transition ${
                            on ? "border-link text-dark" : "border-border text-medium hover:border-link"
                          }`}
                        >
                          <button
                            type="button"
                            title={`${p.zoom.toFixed(2)}× · ${Math.round(p.x)} px · ${Math.round(p.y)} px`}
                            onClick={() => nudge({ zoom: p.zoom, x: p.x, y: p.y })}
                          >
                            {p.name}
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete the preset ${p.name}`}
                            title="Delete"
                            className="flex h-4 w-4 items-center justify-center rounded-full text-faint transition hover:text-bad"
                            onClick={() => savePresets(presets.filter((q) => q.name !== p.name))}
                          >
                            <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
                              <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* How big the picture on the left is. Last, and on its own, because
                it is the only control here that changes nothing about the file:
                the export is 1080x1350 whatever this says. */}
            <div className="border-t border-border pt-4">
              <Slider
                label="Preview size"
                value={previewW}
                limits={PREVIEW_W}
                format={(v) => `${Math.round(v)} px`}
                onChange={(w) => {
                  setPreviewW(w);
                  try {
                    localStorage.setItem(PREVIEW_STORE, String(w));
                  } catch {
                    /* private mode: the size just does not survive the tab */
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <PosterFlags
        drivers={onPoster}
        busy={busy}
        onSet={setCountry}
        noteOf={(d) => noteFor(sheetNotes?.drivers, d.driverId)}
      />

      <PosterTeamArt
        teams={teamsInGraphic}
        art={art}
        busy={busy}
        onUpload={upload}
        onClear={clearArt}
        noteOf={(t) => noteFor(sheetNotes?.teams, t.id)}
      />
    </div>
  );
}
