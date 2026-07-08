import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Notice } from "./ui.jsx";
import { trackKey } from "../data/circuits.js";

// Admin "Tracks" tab: per-circuit fun facts and an optional custom map image,
// layered on top of the computed track history shown on the upcoming-race panel
// and the attendance page.
export default function AdminTracks() {
  const { data: races } = useApi(useCallback(() => api.races(), []));
  const [selected, setSelected] = useState(""); // track display name
  const [facts, setFacts] = useState([]);
  const [mapImageUrl, setMapImageUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

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
    if (!key) return;
    setError(null);
    setMsg(null);
    api
      .adminTrackInfo(key)
      .then((d) => {
        setFacts(d.facts?.length ? d.facts : [{ label: "", value: "" }]);
        setMapImageUrl(d.mapImageUrl || null);
      })
      .catch((e) => setError(e.message));
  }, [key]);

  function setFact(i, patch) {
    setFacts((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const content = { facts: facts.filter((f) => f.label.trim() || f.value.trim()), mapImageUrl };
      await api.saveTrackInfo(key, content);
      setMsg("Track info saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadMap(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api.uploadTrackMap(key, file);
      setMapImageUrl(d.mapImageUrl);
      setMsg("Map image uploaded.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearMap() {
    setBusy(true);
    try {
      await api.clearTrackMap(key);
      setMapImageUrl(null);
      setMsg("Map image removed.");
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
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-sm font-semibold text-medium">Track</label>
          <select className="input max-w-xs" value={selected} onChange={(e) => setSelected(e.target.value)}>
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
            <div className="mb-2 font-mono text-xs font-bold uppercase tracking-widest text-light">Custom facts</div>
            <div className="space-y-2">
              {facts.map((f, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input className="input min-w-40 flex-1 py-1.5 text-sm" placeholder="Label (e.g. Longest straight)"
                    value={f.label} onChange={(e) => setFact(i, { label: e.target.value })} />
                  <input className="input min-w-40 flex-[2] py-1.5 text-sm" placeholder="Value (e.g. 1.2 km, DRS heaven)"
                    value={f.value} onChange={(e) => setFact(i, { value: e.target.value })} />
                  <button className="text-light hover:text-red-600" onClick={() => setFacts((fs) => fs.filter((_, idx) => idx !== i))}>✕</button>
                </div>
              ))}
            </div>
            {facts.length < 8 && (
              <button className="mt-2 text-sm font-semibold text-primary hover:underline" onClick={() => setFacts((fs) => [...fs, { label: "", value: "" }])}>
                + Add fact
              </button>
            )}
          </div>

          <div>
            <div className="mb-2 font-mono text-xs font-bold uppercase tracking-widest text-light">Custom map image</div>
            {mapImageUrl ? (
              <div className="flex flex-wrap items-center gap-3">
                <img src={mapImageUrl} alt="Track map" className="h-24 rounded-lg border border-border" />
                <button className="btn-secondary py-1.5 text-sm" onClick={clearMap} disabled={busy}>Remove image</button>
              </div>
            ) : (
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={uploadMap} disabled={busy}
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-primary-dark" />
            )}
          </div>

          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save track info"}
          </button>
        </div>
      )}
    </div>
  );
}
