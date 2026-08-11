import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar, ErrorBox } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";
import Flag from "./Flag.jsx";
import { countryFor } from "../data/driverCountries.js";
import { COUNTRIES } from "../data/countries.js";
import { fmtDateShort } from "../utils/format.js";
import SlidingTabs from "./SlidingTabs.jsx";
import {
  LAYOUT, THEMES, THEME_KEYS, EXPORT_SCALE, renderPosterTo, savedTheme, saveTheme,
  DEFAULT_FRAMING, FRAMING_LIMITS, cleanFraming,
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

// What each slot is called on screen, and what the hover says it is for. The
// long logo is a "wordmark" in design language, which is precise and means
// nothing to anybody filling this in; the label says what it looks like
// instead, and the tooltip says how it differs from the logo the site already
// has. `mark` stays as the stored key (see lib/teamArt.js) — renaming the wire
// format to improve a caption would only orphan the files already uploaded.
const SLOT = {
  car: {
    label: "Car",
    hint: "the car, cut out, side on. It fills a podium tile.",
  },
  mark: {
    label: "Wide logo",
    hint: "the long logo with the team name written out, for the rows under the podium.",
  },
  badge: {
    label: "Logo",
    hint: "the square logo in the corner of a podium tile. Only needed if the site's own logo reads badly on the poster.",
  },
};

// One picture for one team. Empty, it is a labelled dashed box, which is both
// the button and the only place the word "car" needs to appear. Filled, it is
// the picture, and pressing it replaces.
//
// `fallback` is for the slot that has something to fall back ON: the tile logo
// uses the site's own if nothing is uploaded, so the empty box shows THAT,
// dimmed. An empty dashed box would read as a hole in the poster, when in fact
// the poster is already fine and this is only an override.
function ArtSlot({ team, kind, url, busy, onUpload, onClear, fallback = null }) {
  const fileRef = useRef(null);
  const { label, hint } = SLOT[kind];
  return (
    <span className="relative shrink-0">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onUpload(team.id, kind, f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        // The hover carries the explanation the page deliberately doesn't
        // print: what this picture is, in words somebody can act on.
        title={`${team.name}: ${url ? "replace" : fallback ? "override" : "upload"} ${hint}`}
        onClick={() => fileRef.current?.click()}
        className={`flex h-12 w-28 items-center justify-center overflow-hidden rounded-lg border transition disabled:opacity-50 ${
          url
            ? "border-border bg-black hover:border-link"
            : "border-dashed border-border bg-surface2 hover:border-link hover:text-dark"
        }`}
      >
        {url ? (
          <img src={url} alt="" className="h-full w-full object-contain" />
        ) : fallback ? (
          <img src={fallback} alt="" className="h-full w-full object-contain opacity-40" />
        ) : (
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-faint">{label}</span>
        )}
      </button>
      {url && (
        <button
          type="button"
          disabled={busy}
          aria-label={`Remove the ${label.toLowerCase()} for ${team.name}`}
          title="Remove"
          onClick={() => onClear(team.id, kind)}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-light transition hover:text-bad"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </span>
  );
}

// The round is somebody else's decision: one picker at the top of the Content
// area drives both this and the Discord message, so the poster on screen and
// the poster that gets posted are always about the same round.
//
// `onArtChange` fires whenever the artwork or a driver's flag is edited here,
// because the message next door draws its own copy of this poster and would
// otherwise keep sending the version from before the fix.
export default function AdminResultGraphic({ raceId, onArtChange = null }) {
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
  const canvasRef = useRef(null);
  const saveTimer = useRef(null);

  useEffect(() => {
    api.teamArt().then(setArt).catch((e) => setError(e.message));
    // A framing that will not load is not a reason to show no poster: the
    // default draws every car whole, which is what it did before there was a
    // slider at all.
    api
      .posterFraming()
      .then((f) => {
        setFraming(cleanFraming(f));
        setPresets(Array.isArray(f?.presets) ? f.presets : []);
      })
      .catch(() => {});
    return () => clearTimeout(saveTimer.current);
  }, []);

  // Dragging a slider redraws on every step and saves once you stop. Saving on
  // each step would be a hundred writes for one decision; not saving until a
  // button is pressed would be a button nobody presses, and next week's poster
  // would be framed like the day the cars were uploaded.
  function nudge(patch) {
    const next = cleanFraming({ ...framing, ...patch });
    setFraming(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api
        .setPosterFraming(next)
        .then(() => onArtChange?.()) // the Discord half draws its own copy
        .catch((e) => setError(e.message));
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

  useEffect(() => {
    if (!raceId) return;
    setLoading(true);
    setError(null);
    api
      .raceResults(raceId)
      .then(setResult)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [raceId]);

  // Redraw whenever the round, the artwork or the design changes. Exactly the
  // same call the Discord post makes, so the preview cannot drift away from
  // what gets sent.
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
    }).catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [result, art, theme, framing]);

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
      // The design is in the file name: two versions of the same round in a
      // downloads folder are otherwise the same name twice.
      const name = `${round}-${track}-result-${theme}.png`;
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
  const onPoster = useMemo(() => {
    if (!result) return [];
    return result.results
      .slice(0, 10)
      .filter((r) => r.driverId)
      .map((r) => ({ driverId: r.driverId, name: r.name, country: countryFor(r.driverId, r.country) || "" }))
      .sort((a, b) => (a.country ? 1 : 0) - (b.country ? 1 : 0));
  }, [result]);
  const flagless = onPoster.filter((d) => !d.country).length;

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

  // The teams actually in this round's top ten — the only ones whose artwork
  // this poster can use. A full roster of upload slots would bury them.
  const teamsInGraphic = useMemo(() => {
    if (!result || !teams) return [];
    const byId = new Map(teams.map((t) => [t.id, t]));
    const seen = new Map();
    for (const r of result.results.slice(0, 10)) {
      const t = r.effectiveTeam || r.team;
      if (t && !seen.has(t.id)) seen.set(t.id, byId.get(t.id) || t);
    }
    return [...seen.values()];
  }, [result, teams]);

  // The only status worth stating in words, and it is a count, not a sentence.
  const withCar = teamsInGraphic.filter((t) => art?.[t.id]?.car).length;

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

      {onPoster.length > 0 && (
        <div className="card overflow-hidden">
          <CardBar
            title="Flags"
            right={
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                {flagless > 0 ? `${flagless} without` : "all set"}
              </span>
            }
          />
          <ul className="divide-y divide-border">
            {onPoster.map((d) => (
              <li key={d.driverId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
                {/* The flag they have, so the row shows the answer rather than
                    asking the question twice. */}
                <span className="flex h-[15px] w-5 shrink-0 items-center justify-center">
                  <Flag code={d.country} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-dark">{d.name}</span>
                <select
                  aria-label={`Country for ${d.name}`}
                  className="input w-auto max-w-[15rem] py-1.5 text-sm"
                  value={d.country}
                  disabled={busy}
                  onChange={(e) => setCountry(d.driverId, e.target.value)}
                >
                  <option value="">No country</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      {teamsInGraphic.length > 0 && (
        <div className="card overflow-hidden">
          <CardBar
            title="Team artwork"
            right={
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                {withCar}/{teamsInGraphic.length} cars
              </span>
            }
          />
          <ul className="divide-y divide-border">
            {teamsInGraphic.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3">
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  <TeamLogo id={t.id} name={t.name} color={t.color} logoUrl={t.logoUrl} size={22} />
                  <span className="truncate text-sm font-semibold text-dark">{t.name}</span>
                </span>
                <ArtSlot team={t} kind="car" url={art?.[t.id]?.car} busy={busy} onUpload={upload} onClear={clearArt} />
                <ArtSlot team={t} kind="mark" url={art?.[t.id]?.mark} busy={busy} onUpload={upload} onClear={clearArt} />
                <ArtSlot
                  team={t}
                  kind="badge"
                  url={art?.[t.id]?.badge}
                  fallback={t.logoUrl || null}
                  busy={busy}
                  onUpload={upload}
                  onClear={clearArt}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
