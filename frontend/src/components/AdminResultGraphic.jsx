import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardHead, ErrorBox, Notice } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { countryFor } from "../data/driverCountries.js";
import { fmtDateShort } from "../utils/format.js";
import { LAYOUT, drawResultGraphic, loadGraphicAssets } from "../utils/resultGraphic.js";

// Admin → Graphics: the result poster for a finished round, drawn from the
// round's own data and handed over as a PNG.
//
// The design is Steve's; the point of building it here is that everything on it
// (order, names, flags, points, teams) is already in the database the moment a
// result is imported, so making the post stops being an evening in Photoshop
// and becomes a button. The two things the database does NOT hold are the cut-
// out car and the wide team wordmark, so those are uploaded per team, once, and
// then keep coming back every round that team is on the podium.
//
// It degrades on purpose: with no car the tile is just black, with no wordmark
// the site's own square logo stands in. A round can be posted before the art is
// finished.

// Exported at twice the design size: it is a poster people open full screen,
// and 2x is the difference between crisp type and Discord's resampling.
const EXPORT_SCALE = 2;

const fmtDate = (d) => (d ? fmtDateShort(d) : "no date");

// One team's two pictures, with upload and remove.
function ArtSlot({ team, kind, url, busy, onUpload, onClear }) {
  const fileRef = useRef(null);
  const label = kind === "car" ? "Car" : "Wordmark";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="w-20 shrink-0 font-mono text-[10px] font-bold uppercase tracking-wider text-light">{label}</span>
      <div
        className={`flex h-11 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border ${
          url ? "border-border bg-black" : "border-dashed border-border bg-surface2"
        }`}
      >
        {url ? (
          <img src={url} alt={`${team.name} ${label}`} className="h-full w-full object-contain" />
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-wider text-faint">none</span>
        )}
      </div>
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
      <button className="transition text-xs font-semibold text-link hover:underline disabled:opacity-50"
        disabled={busy} onClick={() => fileRef.current?.click()}>
        {url ? "Replace" : "Upload"}
      </button>
      {url && (
        <button className="transition text-xs font-semibold text-light hover:text-bad disabled:opacity-50"
          disabled={busy} onClick={() => onClear(team.id, kind)}>
          Remove
        </button>
      )}
    </div>
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
  const [msg, setMsg] = useState(null);
  const [missing, setMissing] = useState([]);
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

  // Draw whenever the round, the art or the fonts change. Waiting on
  // document.fonts is what stops the first paint coming out in Times New Roman:
  // the canvas takes whatever the font stack resolves to AT THAT MOMENT, and
  // Archivo is a web font that may still be on its way.
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
        const ctx = canvas.getContext("2d");
        drawResultGraphic(ctx, data, EXPORT_SCALE);
        setMissing(data.missingCars);
      } catch (e) {
        if (alive) setError(e.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [result, art]);

  async function upload(teamId, kind, file) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await api.uploadTeamArt(teamId, kind, file);
      setArt(res.art);
      setMsg("Saved. The graphic below has redrawn itself.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearArt(teamId, kind) {
    setBusy(true);
    setError(null);
    setMsg(null);
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
      const name = `${round}-${String(race.track || "race").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-result.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  // The teams actually in this round's top ten — the only ones whose art the
  // poster can use. A full roster of upload rows would bury them.
  const teamsInGraphic = useMemo(() => {
    if (!result || !teams) return [];
    const byId = new Map();
    for (const t of teams) byId.set(t.id, t);
    const seen = new Map();
    for (const r of result.results.slice(0, 10)) {
      const t = r.effectiveTeam || r.team;
      if (t && !seen.has(t.id)) seen.set(t.id, byId.get(t.id) || t);
    }
    return [...seen.values()];
  }, [result, teams]);

  return (
    <div className="space-y-5">
      <div className="card space-y-4 p-5">
        <CardHead eyebrow="Race weekend" title="Result graphic" />
        <p className="text-sm leading-relaxed text-light">
          The poster for a finished round, built from that round&rsquo;s own result: the order, the names, the flags,
          the teams and the points all come out of the import. Pick a round, check it, download the PNG.
        </p>

        {racesError && <ErrorBox message={racesError} onRetry={reloadRaces} />}

        {finished.length === 0 ? (
          <p className="text-sm text-light">No finished round in this season yet.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="graphic-race" className="text-sm font-semibold text-medium">
              Round
            </label>
            <select
              id="graphic-race"
              className="input max-w-sm"
              value={raceId}
              onChange={(e) => setRaceId(e.target.value)}
            >
              {finished.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number != null ? `R${r.number}` : "Session"} {r.track} · {fmtDate(r.date)}
                </option>
              ))}
            </select>
            <button className="btn-primary" onClick={download} disabled={!result || loading}>
              Download PNG
            </button>
          </div>
        )}

        {error && <ErrorBox message={error} />}
        {msg && <Notice kind="success">{msg}</Notice>}
        {missing.length > 0 && (
          <Notice kind="info">
            No car uploaded yet for {missing.join(", ")}, so {missing.length === 1 ? "that tile is" : "those tiles are"}{" "}
            plain black. Add the picture below and this redraws itself.
          </Notice>
        )}
      </div>

      {/* The preview IS the export: same canvas, shown at a third of its size.
          Nothing here is a mock-up of the file you get. */}
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">Preview</span>
          <span className="font-mono text-[11px] uppercase tracking-wider text-faint">
            {LAYOUT.width * EXPORT_SCALE} × {LAYOUT.height * EXPORT_SCALE} px
          </span>
        </div>
        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            className="h-auto w-full max-w-[420px] rounded-lg shadow-lg"
            style={{ aspectRatio: `${LAYOUT.width} / ${LAYOUT.height}` }}
          />
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <CardHead eyebrow="Race weekend" title="Team artwork" />
        <p className="text-sm leading-relaxed text-light">
          The two pictures the poster needs that the site has no other use for. The{" "}
          <span className="font-semibold text-medium">car</span> fills a podium tile, so a side-on cut-out on a
          transparent or black background works best. The{" "}
          <span className="font-semibold text-medium">wordmark</span> is the wide logo for the rows underneath; without
          one the site&rsquo;s square team logo is used instead. Both belong to the team, so they come back every round
          and every season that team races.
        </p>

        {teamsInGraphic.length === 0 ? (
          <p className="text-sm text-light">Pick a round above and its teams appear here.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {teamsInGraphic.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3">
                <span className="flex w-44 shrink-0 items-center gap-2">
                  <TeamLogo id={t.id} name={t.name} color={t.color} logoUrl={t.logoUrl} size={22} />
                  <span className="truncate text-sm font-semibold text-dark">{t.name}</span>
                </span>
                <ArtSlot team={t} kind="car" url={art?.[t.id]?.car} busy={busy} onUpload={upload} onClear={clearArt} />
                <ArtSlot team={t} kind="mark" url={art?.[t.id]?.mark} busy={busy} onUpload={upload} onClear={clearArt} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
