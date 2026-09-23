import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Notice } from "./ui.jsx";
import { trackKey, circuitFor } from "../data/circuits.js";
import { COUNTRIES } from "../data/countries.js";
import CircuitMap from "./CircuitMap.jsx";
import Flag from "./Flag.jsx";
import { useSeries } from "../context/SeriesContext.jsx";

// One stored map image: the picture, whose it is, and its Remove button.
function MapRow({ label, url, onRemove, busy }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <img src={url} alt={label ? `${label} track map` : "Track map"} className="h-24 rounded-lg border border-border" />
      {label && <span className="text-sm font-semibold text-medium">{label}</span>}
      <button className="btn-secondary py-1.5 text-sm" onClick={onRemove} disabled={busy}>Remove image</button>
    </div>
  );
}

// A stored corner as the editor's row (every field a string while typed).
const toRows = (list) => (list || []).map((c) => ({ turn: c.turn ?? "", name: c.name || "", at: String(c.at) }));

// Admin "Tracks" tab: per-circuit fun facts and an optional custom map image,
// layered on top of the computed track history shown on the upcoming-race panel
// and the attendance page. The map image has two layers: the shared one every
// series shows, and one per series for a league that wants its own picture of
// the circuit on its own pages (backend lib/trackInfo.js).
export default function AdminTracks() {
  const { data: races } = useApi(useCallback(() => api.races(), []));
  const { seriesList } = useSeries();
  // The per-series choice only exists once there is a second series to choose.
  const multiSeries = (seriesList || []).length > 1;
  const nameOf = (slug) => (seriesList || []).find((s) => s.slug === slug)?.name || slug;
  const [selected, setSelected] = useState(""); // track display name
  const [facts, setFacts] = useState([]);
  // The hotlap videos are edited in the Attendance tab, not here — but they
  // live in the same stored record, so they are carried through a save from
  // this page untouched. Without this, saving a fun fact would wipe the laps.
  const [keepVideos, setKeepVideos] = useState([]);
  const [mapImageUrl, setMapImageUrl] = useState(null);
  // Each series' own map image, by slug (empty = every series shows the shared
  // one), and which of the two an upload is for: "all" or a series slug.
  const [mapImages, setMapImages] = useState({});
  const [mapScope, setMapScope] = useState("all");
  const [country, setCountry] = useState(""); // effective flag code ("" = none)
  const [mapRotation, setMapRotation] = useState(0);
  // What kind of circuit it is (backend lib/trackProfile.js): the admin's
  // pick, or null while the circuit still runs on its default reading. Only
  // a pick someone actually made is saved, so the default can still improve.
  const [types, setTypes] = useState(null);
  const [typeInfo, setTypeInfo] = useState({ defs: [], defaults: [] });
  // Named corners, each at a percent of the lap. `cornersOwn` is whether the
  // list on screen is the admin's own (saved as it is) or the circuit's
  // default names (saved as "not set", so the defaults can still improve).
  const [corners, setCorners] = useState([]);
  const [cornersOwn, setCornersOwn] = useState(false);
  const [defaultCorners, setDefaultCorners] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  // The circuit the fields above were loaded for. Save writes them all (and
  // the flag onto every race of the circuit), so until the picked circuit's
  // own answer is in they belong to another track and must not be saved.
  const [loadedKey, setLoadedKey] = useState("");

  // Distinct tracks of the selected season (championship rounds).
  const tracks = useMemo(() => {
    const seen = new Map();
    for (const r of races || []) {
      if (r.isSpecialEvent || !r.track) continue;
      const k = trackKey(r.track);
      if (!seen.has(k)) seen.set(k, r.track);
    }
    return [...seen.entries()].map(([key, name]) => ({ key, name }));
  }, [races]);

  const key = selected ? trackKey(selected) : "";

  useEffect(() => {
    setLoadedKey("");
    if (!key) return;
    let alive = true;
    setError(null);
    setMsg(null);
    api
      .adminTrackInfo(key)
      .then((d) => {
        if (!alive) return;
        setFacts(d.facts?.length ? d.facts : [{ label: "", value: "" }]);
        setKeepVideos(d.videos || []);
        setMapImageUrl(d.mapImageUrl || null);
        setMapImages(d.mapImages || {});
        setMapRotation(d.mapRotation || 0);
        setTypes(Array.isArray(d.types) ? d.types : null);
        setTypeInfo({ defs: d.typeDefs || [], defaults: d.defaultTypes || [] });
        setDefaultCorners(d.defaultCorners || []);
        setCornersOwn(Array.isArray(d.corners));
        setCorners(toRows(Array.isArray(d.corners) ? d.corners : d.defaultCorners || []));
        setCountry(d.country || "");
        setLoadedKey(key);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [key]);

  // Any edit makes the list the admin's own.
  function editCorners(fn) {
    setCornersOwn(true);
    setCorners(fn);
  }

  function setFact(i, patch) {
    setFacts((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  async function save() {
    if (!key || loadedKey !== key) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const content = {
        facts: facts.filter((f) => f.label.trim() || f.value.trim()),
        videos: keepVideos,
        mapImageUrl,
        // Uploaded through the map endpoint, carried through this save
        // untouched — the backend keeps them anyway when they are missing.
        mapImages,
        mapRotation,
        types,
        corners: cornersOwn
          ? corners
              .filter((c) => String(c.at).trim() !== "" && (String(c.name).trim() || String(c.turn).trim()))
              .map((c) => ({ at: Number(String(c.at).replace(",", ".")), turn: c.turn === "" ? null : Number(c.turn), name: c.name }))
          : null,
      };
      const res = await api.saveTrackInfo(key, content);
      setKeepVideos(res?.content?.videos || []);
      if (Array.isArray(res?.content?.corners)) setCorners(toRows(res.content.corners));
      // Flag country lives on the races themselves (all seasons of this
      // circuit), not in the info blob.
      await api.saveTrackCountry(key, country || null);
      setMsg("Track info saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadMap(e) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    // "all" is the shared image; a slug is that series' own.
    const series = multiSeries && mapScope !== "all" ? mapScope : null;
    setBusy(true);
    setError(null);
    try {
      const d = await api.uploadTrackMap(key, file, series);
      if (series) setMapImages((m) => ({ ...m, [series]: d.mapImageUrl }));
      else setMapImageUrl(d.mapImageUrl);
      setMsg(series ? `Map image uploaded for ${nameOf(series)}.` : "Map image uploaded.");
    } catch (err) {
      setError(err.message);
    } finally {
      // Same file again (a re-export after a tweak) must fire the change event.
      input.value = "";
      setBusy(false);
    }
  }

  // `series` = null clears the shared image, a slug that series' own.
  async function clearMap(series = null) {
    setBusy(true);
    try {
      await api.clearTrackMap(key, series);
      if (series) {
        setMapImages((m) => {
          const next = { ...m };
          delete next[series];
          return next;
        });
      } else {
        setMapImageUrl(null);
      }
      setMsg(series ? `Map image for ${nameOf(series)} removed.` : "Map image removed.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Track info</h3>
        <p className="mt-1 text-sm text-light">
          Add fun facts and a custom map image for a circuit. They show on the upcoming-race panel and the attendance
          page, on top of the automatic track record (wins, fastest lap, poles, crashes) computed from every season.
          The track type feeds the Track Strengths on the driver profiles, and the corner names the driving tips in the
          lap comparison.
          Everything here is per circuit, so it comes back every time the track is raced. The hotlap videos moved to
          their own tab: Race weekend &rarr; Attendance.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-sm font-semibold text-medium">Track</label>
          <select aria-label="Track" className="input max-w-xs" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Select a track…</option>
            {tracks.map((t) => (
              <option key={t.key} value={t.name}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {msg && <Notice kind="success">{msg}</Notice>}

      {key && (
        <div className="card space-y-4 p-5">
          <div>
            <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">Country flag</div>
            <p className="mb-2 text-sm text-light">
              Which country's flag shows next to this circuit, on every page and in every season it was raced.
            </p>
            <div className="flex items-center gap-3">
              {country ? <Flag code={country} w={26} h={19} /> : <span className="font-mono text-xs text-faint">no flag</span>}
              <select aria-label="Country flag" className="input max-w-xs" value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">No flag</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">Track type</span>
              {types == null && typeInfo.defaults.length > 0 && <span className="pill bg-surface2 text-light">default</span>}
            </div>
            <p className="mb-2 text-sm text-light">
              What kind of circuit this is, up to three. The driver profiles group every driver&rsquo;s results by these
              (Track Strengths). A circuit the site knows starts on a default reading; pick to replace it.
            </p>
            <div className="flex flex-wrap gap-2">
              {typeInfo.defs.map((t) => {
                const current = types ?? typeInfo.defaults;
                const on = current.includes(t.key);
                const full = !on && current.length >= 3;
                return (
                  <button key={t.key} type="button" disabled={full} title={t.hint} aria-pressed={on}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 ${
                      on ? "border-brand bg-brand/10 text-dark" : "border-border text-light hover:text-dark"
                    }`}
                    onClick={() => setTypes(on ? current.filter((k) => k !== t.key) : [...current, t.key])}>
                    {t.label}
                  </button>
                );
              })}
              {types != null && typeInfo.defaults.length > 0 && (
                <button type="button" className="px-1 text-xs font-semibold text-link hover:underline" onClick={() => setTypes(null)}>
                  Back to default
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">Corner names</span>
              {!cornersOwn && defaultCorners.length > 0 && <span className="pill bg-surface2 text-light">default</span>}
            </div>
            <p className="mb-2 text-sm text-light">
              Names the driving tips use instead of &ldquo;section 3&rdquo;. The position is how far into the lap the corner&rsquo;s
              slowest point is, in percent &mdash; the lap comparison on the Tools page shows it for every slow section.
              {defaultCorners.length > 0
                ? " The site ships names for this circuit's Grand Prix layout; edit them to replace them. Other layouts get none."
                : ""}
            </p>
            <div className="space-y-2">
              {corners.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input aria-label={`Corner ${i + 1} turn number`} className="input w-20 py-1.5 text-sm" placeholder="Turn" inputMode="numeric"
                    value={c.turn} onChange={(e) => editCorners((cs) => cs.map((x, idx) => (idx === i ? { ...x, turn: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) } : x)))} />
                  <input aria-label={`Corner ${i + 1} name`} className="input min-w-40 flex-1 py-1.5 text-sm" placeholder="Name (e.g. Parabolica)" maxLength={40}
                    value={c.name} onChange={(e) => editCorners((cs) => cs.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))} />
                  <label className="flex items-center gap-1.5 text-xs text-light">
                    at
                    <input aria-label={`Corner ${i + 1} position in percent of the lap`} className="input w-20 py-1.5 text-center text-sm" placeholder="31.5" inputMode="decimal"
                      value={c.at} onChange={(e) => editCorners((cs) => cs.map((x, idx) => (idx === i ? { ...x, at: e.target.value } : x)))} />
                    % of lap
                  </label>
                  <button type="button" aria-label="Remove this corner" title="Remove this corner" className="transition text-light hover:text-bad"
                    onClick={() => editCorners((cs) => cs.filter((_, idx) => idx !== i))}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              {corners.length < 30 && (
                <button className="transition text-sm font-semibold text-link hover:underline"
                  onClick={() => editCorners((cs) => [...cs, { turn: "", name: "", at: "" }])}>
                  + Add corner
                </button>
              )}
              {cornersOwn && defaultCorners.length > 0 && (
                <button type="button" className="text-sm font-semibold text-link hover:underline"
                  onClick={() => { setCornersOwn(false); setCorners(toRows(defaultCorners)); }}>
                  Back to default
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">Custom facts</div>
            <div className="space-y-2">
              {facts.map((f, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input aria-label={`Fact ${i + 1} label`} className="input min-w-40 flex-1 py-1.5 text-sm" placeholder="Label (e.g. Longest straight)"
                    value={f.label} onChange={(e) => setFact(i, { label: e.target.value })} />
                  <input aria-label={`Fact ${i + 1} value`} className="input min-w-40 flex-[2] py-1.5 text-sm" placeholder="Value (e.g. 1.2 km, DRS heaven)"
                    value={f.value} onChange={(e) => setFact(i, { value: e.target.value })} />
                  <button
                    type="button"
                    aria-label="Remove this fact"
                    title="Remove this fact"
                    className="transition text-light hover:text-bad"
                    onClick={() => setFacts((fs) => fs.filter((_, idx) => idx !== i))}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            {facts.length < 8 && (
              <button className="transition mt-2 text-sm font-semibold text-link hover:underline" onClick={() => setFacts((fs) => [...fs, { label: "", value: "" }])}>
                + Add fact
              </button>
            )}
          </div>

          {circuitFor(selected) && !mapImageUrl && (
            <div>
              <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">Outline rotation</div>
              <p className="mb-2 text-sm text-light">
                Turn the built-in outline so it fills the upcoming-race panel better. The preview below shows exactly
                what visitors will see. Remember to hit &ldquo;Save track info&rdquo;.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {[0, 90, 180, 270].map((d) => (
                  <button key={d} type="button"
                    className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-bold transition ${
                      mapRotation === d ? "border-brand bg-brand/10 text-dark" : "border-border text-light hover:text-dark"
                    }`}
                    onClick={() => setMapRotation(d)}>
                    {d}°
                  </button>
                ))}
                <label className="flex items-center gap-1.5 text-xs text-light">
                  fine tune
                  <input className="input w-20 py-1 text-center text-xs" type="number" min="0" max="359" step="5"
                    value={mapRotation}
                    onChange={(e) => setMapRotation(((Math.round(Number(e.target.value) || 0) % 360) + 360) % 360)} />
                  °
                </label>
              </div>
              <div className="mt-3 flex items-center justify-center rounded-lg border border-border bg-surface2/40 p-4">
                <CircuitMap track={selected} rotate={mapRotation} stroke="var(--c-text)" strokeWidth={2} className="h-48 w-full text-dark" />
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">Custom map image</div>
            <p className="mb-2 text-sm text-light">
              Replaces the plain outline on the upcoming-race panel, e.g. the downloaded PNG with the corners labelled.
              Remove it to go back to the built-in outline.
              {multiSeries &&
                " A series can have a picture of its own; a series without one shows the image for all series."}
            </p>
            {/* What is stored: the shared image, then each series' own. */}
            {(mapImageUrl || Object.keys(mapImages).length > 0) && (
              <div className="mb-3 space-y-2">
                {mapImageUrl && (
                  <MapRow label={multiSeries ? "All series" : null} url={mapImageUrl} onRemove={() => clearMap(null)} busy={busy} />
                )}
                {Object.entries(mapImages).map(([slug, url]) => (
                  <MapRow key={slug} label={nameOf(slug)} url={url} onRemove={() => clearMap(slug)} busy={busy} />
                ))}
              </div>
            )}
            {/* Uploading replaces whatever is stored for the chosen scope. */}
            <div className="flex flex-wrap items-center gap-3">
              {multiSeries && (
                <select
                  aria-label="Which series the image is for"
                  className="input w-auto max-w-xs"
                  value={mapScope}
                  onChange={(e) => setMapScope(e.target.value)}
                  disabled={busy}
                >
                  <option value="all">For all series</option>
                  {seriesList.map((s) => (
                    <option key={s.slug} value={s.slug}>
                      Only {s.name}
                    </option>
                  ))}
                </select>
              )}
              <input aria-label="Custom map image" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={uploadMap} disabled={busy}
                className="transition block min-w-[16rem] flex-1 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-onbrand hover:file:bg-primary-dark" />
            </div>
          </div>

          <button className="btn-primary" onClick={save} disabled={busy || loadedKey !== key}>
            {busy ? "Saving…" : "Save track info"}
          </button>
        </div>
      )}
    </div>
  );
}
