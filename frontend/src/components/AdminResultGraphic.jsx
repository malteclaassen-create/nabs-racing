import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardBar, ErrorBox } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { countryFor } from "../data/driverCountries.js";
import { fmtDateShort } from "../utils/format.js";
import SlidingTabs from "./SlidingTabs.jsx";
import { LAYOUT, THEMES, THEME_KEYS, drawResultGraphic, loadGraphicAssets } from "../utils/resultGraphic.js";

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

// Exported at twice the design size: it is a poster people open full screen,
// and 2x is the difference between crisp type and Discord's resampling.
const EXPORT_SCALE = 2;
// Which design was last used. Remembered because a league picks one and stays
// with it: having to re-choose every visit would be the tax for a choice made
// once.
const THEME_KEY = "nabs_graphic_theme";

const fmtDate = (d) => (d ? fmtDateShort(d) : "no date");

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
};

// One picture for one team. Empty, it is a labelled dashed box, which is both
// the button and the only place the word "car" needs to appear. Filled, it is
// the picture, and pressing it replaces.
function ArtSlot({ team, kind, url, busy, onUpload, onClear }) {
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
        title={`${team.name}: ${url ? "replace" : "upload"} ${hint}`}
        onClick={() => fileRef.current?.click()}
        className={`flex h-12 w-28 items-center justify-center overflow-hidden rounded-lg border transition disabled:opacity-50 ${
          url
            ? "border-border bg-black hover:border-link"
            : "border-dashed border-border bg-surface2 hover:border-link hover:text-dark"
        }`}
      >
        {url ? (
          <img src={url} alt="" className="h-full w-full object-contain" />
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

export default function AdminResultGraphic() {
  const { data: races, error: racesError, reload: reloadRaces } = useApi(useCallback(() => api.races(), []));
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  const [art, setArt] = useState(null);
  const [raceId, setRaceId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return THEME_KEYS.includes(saved) ? saved : THEME_KEYS[0];
  });
  const canvasRef = useRef(null);

  // Only rounds that HAVE a classification: a poster of an unraced round would
  // be an empty template.
  const finished = useMemo(
    () =>
      [...(races || [])]
        .filter((r) => r.isCompleted && !r.isSpecialEvent)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
    [races]
  );

  useEffect(() => {
    if (!raceId && finished.length) setRaceId(finished[0].id);
  }, [finished, raceId]);

  useEffect(() => {
    api.teamArt().then(setArt).catch((e) => setError(e.message));
  }, []);

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

  // Draw whenever the round or the artwork changes. Waiting on document.fonts
  // is what stops the first paint coming out in Times New Roman: the canvas
  // takes whatever the font stack resolves to AT THAT MOMENT, and Archivo is a
  // web font that may still be on its way.
  useEffect(() => {
    if (!result || !art || !canvasRef.current) return;
    let alive = true;
    (async () => {
      try {
        await document.fonts.ready;
        const data = await loadGraphicAssets({
          race: result.race,
          results: result.results,
          teamArt: art,
          countryOf: (r) => countryFor(r.driverId, r.country),
          logoSrc: "/logo-light.png",
        });
        if (!alive) return;
        const canvas = canvasRef.current;
        canvas.width = LAYOUT.width * EXPORT_SCALE;
        canvas.height = LAYOUT.height * EXPORT_SCALE;
        drawResultGraphic(canvas.getContext("2d"), data, EXPORT_SCALE, theme);
      } catch (e) {
        if (alive) setError(e.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [result, art, theme]);

  async function upload(teamId, kind, file) {
    setBusy(true);
    setError(null);
    try {
      setArt((await api.uploadTeamArt(teamId, kind, file)).art);
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
      {racesError && <ErrorBox message={racesError} onRetry={reloadRaces} />}
      {error && <ErrorBox message={error} />}

      <div className="card overflow-hidden">
        <CardBar
          title="Result graphic"
          right={
            finished.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Round"
                  className="input w-auto max-w-[16rem] py-1.5 text-sm"
                  value={raceId}
                  onChange={(e) => setRaceId(e.target.value)}
                >
                  {finished.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.number != null ? `R${r.number}` : "Session"} {r.track} · {fmtDate(r.date)}
                    </option>
                  ))}
                </select>
                <button className="btn-primary py-1.5 text-sm" onClick={download} disabled={!result || loading}>
                  Download PNG
                </button>
              </div>
            )
          }
        />
        {finished.length === 0 ? (
          <p className="p-5 text-sm text-light">No finished round in this season yet.</p>
        ) : (
          /* The preview IS the export: the same canvas, shown smaller. Nothing
             here is a mock-up of the file you get. */
          <div className="flex flex-col items-center gap-4 p-5">
            <SlidingTabs
              items={THEME_KEYS.map((k) => ({ key: k, label: THEMES[k].label }))}
              value={theme}
              onChange={(k) => {
                setTheme(k);
                localStorage.setItem(THEME_KEY, k);
              }}
              btnClassName="px-4 py-1.5 text-xs"
            />
            <canvas
              ref={canvasRef}
              className="h-auto w-full max-w-[400px] rounded-lg shadow-lg"
              style={{ aspectRatio: `${LAYOUT.width} / ${LAYOUT.height}` }}
            />
          </div>
        )}
      </div>

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
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
