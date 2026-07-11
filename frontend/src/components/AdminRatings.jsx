import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { CardHead, Notice } from "./ui.jsx";

const TIER = { 0: "Res", 1: "T1", 2: "T2" };

// Weight groups, with human labels and a one-line "what it measures".
const GROUPS = {
  rtg: {
    title: "Overall (RTG) blend",
    help: "How the four sub-ratings combine into the headline number.",
    parts: [["rac", "Racecraft"], ["pac", "Pace"], ["aha", "Awareness"], ["exp", "Experience"]],
  },
  pac: {
    title: "PAC · Pace",
    help: "Pure speed.",
    parts: [["lap", "Best-lap pace"], ["grid", "Qualifying (grid)"]],
  },
  rac: {
    title: "RAC · Racecraft",
    help: "Race result.",
    parts: [["finish", "Finishing position"], ["gained", "Places gained"], ["overtakes", "On-track overtakes"], ["podium", "Podium rate"]],
  },
  aha: {
    title: "AWA · Awareness",
    help: "Cleanliness, consistency & discipline.",
    parts: [
      ["finishRate", "Finish rate"], ["dnf", "Few DNFs"],
      ["consistency", "Consistency"], ["contacts", "Few contacts"],
      ["env", "Few off-track hits"], ["penalties", "Few penalties"], ["cuts", "Few cuts"],
    ],
  },
};

// Defaults (fractions) -> slider state (whole-number weights the backend then
// normalises; band/dominance stay as-is). `saved` overrides the defaults so the
// panel opens on the persisted curve.
function toState(defaults, saved) {
  const grp = (key) => {
    const base = Object.fromEntries(Object.entries(defaults[key]).map(([k, v]) => [k, Math.round(v * 100)]));
    return saved?.[key] ? { ...base, ...saved[key] } : base;
  };
  // Per-stat floor/ceiling overrides: blank = inherit the shared band, so the
  // state keeps "" for anything the admin hasn't set explicitly.
  const bands = {};
  for (const k of ["exp", "pac", "rac", "aha"]) {
    bands[k] = { low: saved?.bands?.[k]?.low ?? "", high: saved?.bands?.[k]?.high ?? "" };
  }
  return {
    band: { ...defaults.band, ...(saved?.band || {}) },
    bands,
    dominance: { ...defaults.dominance, ...(saved?.dominance || {}) },
    rtg: grp("rtg"),
    pac: grp("pac"),
    rac: grp("rac"),
    aha: grp("aha"),
  };
}

function WeightGroup({ groupKey, weights, onChange }) {
  const g = GROUPS[groupKey];
  const vals = weights[groupKey];
  const sum = g.parts.reduce((s, [k]) => s + (Number(vals[k]) || 0), 0) || 1;
  return (
    <div className="rounded-xl border border-border bg-surface2/40 p-4">
      <div className="mb-1 font-display text-sm font-bold uppercase tracking-tight text-dark">{g.title}</div>
      <p className="mb-3 text-xs text-light">{g.help}</p>
      <div className="space-y-2.5">
        {g.parts.map(([k, label]) => {
          const pct = Math.round(((Number(vals[k]) || 0) / sum) * 100);
          return (
            <div key={k} className="flex items-center gap-3">
              <span className="w-36 shrink-0 text-sm text-medium">{label}</span>
              <input
                type="range" min="0" max="100" value={vals[k]}
                onChange={(e) => onChange(groupKey, k, Number(e.target.value))}
                className="h-2 flex-1 cursor-pointer accent-primary"
              />
              <span className="w-10 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-dark">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminRatings() {
  const [defaults, setDefaults] = useState(null);
  const [weights, setWeights] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState(null);
  const [showProv, setShowProv] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(null);
  const [hasSaved, setHasSaved] = useState(false);

  // Initial load: pull defaults + any persisted weights + the baseline ratings.
  useEffect(() => {
    let alive = true;
    api
      .ratingsPreview(undefined)
      .then((d) => {
        if (!alive) return;
        setDefaults(d.defaults);
        setWeights(toState(d.defaults, d.saved));
        setHasSaved(!!d.saved);
        setRatings(d.ratings);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  // Recompute (debounced) whenever the weights change.
  useEffect(() => {
    if (!weights) return;
    setComputing(true);
    const t = setTimeout(() => {
      api
        .ratingsPreview(weights)
        .then((d) => setRatings(d.ratings))
        .catch((e) => setError(e.message))
        .finally(() => setComputing(false));
    }, 250);
    return () => clearTimeout(t);
  }, [weights]);

  const setWeight = useCallback((group, key, value) => {
    setWeights((w) => ({ ...w, [group]: { ...w[group], [key]: value } }));
  }, []);
  const setBand = useCallback((key, value) => {
    setWeights((w) => ({ ...w, band: { ...w.band, [key]: value } }));
  }, []);
  const setStatBand = useCallback((stat, key, value) => {
    setWeights((w) => ({ ...w, bands: { ...w.bands, [stat]: { ...w.bands?.[stat], [key]: value } } }));
  }, []);
  const setDominance = useCallback((key, value) => {
    setWeights((w) => ({ ...w, dominance: { ...w.dominance, [key]: value } }));
  }, []);
  const reset = useCallback(() => defaults && setWeights(toState(defaults)), [defaults]);

  async function saveWeights() {
    setSaving(true);
    setSavedNote(null);
    try {
      await api.saveRatingsWeights(weights);
      setHasSaved(true);
      setSavedNote({ ok: true, text: "Saved. The public ratings now use these weights." });
    } catch (e) {
      setSavedNote({ ok: false, text: e.message });
    } finally {
      setSaving(false);
    }
  }
  async function clearWeights() {
    setSaving(true);
    setSavedNote(null);
    try {
      await api.saveRatingsWeights(null);
      setHasSaved(false);
      if (defaults) setWeights(toState(defaults));
      setSavedNote({ ok: true, text: "Cleared. The public ratings are back on the defaults." });
    } catch (e) {
      setSavedNote({ ok: false, text: e.message });
    } finally {
      setSaving(false);
    }
  }

  const shown = useMemo(
    () => (showProv ? ratings : ratings.filter((r) => !r.provisional)),
    [ratings, showProv]
  );

  if (loading) return <div className="text-sm text-light">Loading ratings…</div>;
  if (error && !weights) return <Notice kind="error">{error}</Notice>;

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <CardHead eyebrow="Driver Ratings" title="Live rating-weight tuning" />
        <p className="text-sm text-light">
          Every driver gets four sub-ratings: <b>EXP</b> (experience), <b>PAC</b> (pace),
          <b> RAC</b> (racecraft) and <b>AWA</b> (awareness/cleanliness), blended into the overall <b>RTG</b>.
          Each value is ranked across the field and mapped onto the spread below. Drag the sliders to
          re-weight; the table updates live. Hit <b>Save</b> to make the public ratings use these weights,
          or leave it unsaved to just experiment. {hasSaved
            ? "The public site is currently using your saved weights."
            : "The public site is currently using the defaults."}
        </p>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {savedNote && <Notice kind={savedNote.ok ? "success" : "error"}>{savedNote.text}</Notice>}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Controls */}
        <div className="space-y-4">
          <WeightGroup groupKey="rtg" weights={weights} onChange={setWeight} />

          {/* Spread / band */}
          <div className="rounded-xl border border-border bg-surface2/40 p-4">
            <div className="mb-1 font-display text-sm font-bold uppercase tracking-tight text-dark">Spread (0–99 band)</div>
            <p className="mb-3 text-xs text-light">
              Where the worst and best in the field land. Widen it to make the top stand out more.
            </p>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-medium">
                Floor
                <input type="number" min="0" max="98" value={weights.band.low}
                  onChange={(e) => setBand("low", Number(e.target.value))}
                  className="input w-20 py-1 text-center" />
              </label>
              <label className="flex items-center gap-2 text-sm text-medium">
                Ceiling
                <input type="number" min="1" max="99" value={weights.band.high}
                  onChange={(e) => setBand("high", Number(e.target.value))}
                  className="input w-20 py-1 text-center" />
              </label>
            </div>

            {/* Per-stat overrides: blank = the shared band above. */}
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 text-xs text-light">
                Per-stat floor and ceiling. Leave a field blank to use the shared spread above; set values to give a
                single stat its own range (say, Experience from 40 up to 99).
              </div>
              <div className="space-y-1.5">
                {[["exp", "EXP · Experience"], ["pac", "PAC · Pace"], ["rac", "RAC · Racecraft"], ["aha", "AWA · Awareness"]].map(([stat, label]) => (
                  <div key={stat} className="flex items-center gap-3">
                    <span className="w-36 shrink-0 text-sm text-medium">{label}</span>
                    <input
                      type="number" min="0" max="98" placeholder={String(weights.band.low)}
                      value={weights.bands?.[stat]?.low ?? ""}
                      onChange={(e) => setStatBand(stat, "low", e.target.value)}
                      className="input w-20 py-1 text-center"
                      aria-label={`${label} floor`}
                    />
                    <span className="text-xs text-faint">to</span>
                    <input
                      type="number" min="1" max="99" placeholder={String(weights.band.high)}
                      value={weights.bands?.[stat]?.high ?? ""}
                      onChange={(e) => setStatBand(stat, "high", e.target.value)}
                      className="input w-20 py-1 text-center"
                      aria-label={`${label} ceiling`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Dominance boost */}
          <div className="rounded-xl border border-border bg-surface2/40 p-4">
            <div className="mb-1 font-display text-sm font-bold uppercase tracking-tight text-dark">Dominance boost</div>
            <p className="mb-3 text-xs text-light">
              Extra points on the overall for a runaway leader, so a driver who wins most rounds reads near 99.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-medium">
                Max boost
                <input type="number" min="0" max="20" value={weights.dominance.max}
                  onChange={(e) => setDominance("max", Number(e.target.value))}
                  className="input w-20 py-1 text-center" />
              </label>
              <label className="flex items-center gap-2 text-sm text-medium">
                Full at win share
                <input type="number" min="0.1" max="1" step="0.05" value={weights.dominance.fullAt}
                  onChange={(e) => setDominance("fullAt", Number(e.target.value))}
                  className="input w-20 py-1 text-center" />
              </label>
            </div>
          </div>

          <button
            className="text-sm font-semibold text-primary hover:underline"
            onClick={() => setAdvanced((a) => !a)}
          >
            {advanced ? "▾ Hide per-category breakdown" : "▸ Show per-category breakdown (PAC / RAC / AWA)"}
          </button>
          {advanced && (
            <div className="space-y-4">
              <WeightGroup groupKey="pac" weights={weights} onChange={setWeight} />
              <WeightGroup groupKey="rac" weights={weights} onChange={setWeight} />
              <WeightGroup groupKey="aha" weights={weights} onChange={setWeight} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary disabled:opacity-50" onClick={saveWeights} disabled={saving}>
              {saving ? "Saving…" : "Save weights"}
            </button>
            <button className="btn-secondary" onClick={reset} disabled={saving}>Reset sliders</button>
            {hasSaved && (
              <button className="text-sm font-semibold text-red-600 hover:underline" onClick={clearWeights} disabled={saving}>
                Clear saved (back to defaults)
              </button>
            )}
          </div>
        </div>

        {/* Live result table */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="font-display text-sm font-bold uppercase tracking-tight text-dark">
              Result {computing && <span className="ml-2 font-mono text-[10px] font-normal text-light">updating…</span>}
            </div>
            <label className="flex items-center gap-2 text-xs text-light">
              <input type="checkbox" checked={showProv} onChange={(e) => setShowProv(e.target.checked)} />
              show provisional (&lt;3 races)
            </label>
          </div>
          <div className="max-h-[640px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface2 text-left text-light">
                <tr>
                  <th className="px-2 py-2 text-center">#</th>
                  <th className="px-2 py-2">Driver</th>
                  <th className="px-1 py-2 text-center" title="Starts">St</th>
                  <th className="px-1 py-2 text-center" title="Overtakes (estimated)">Ov</th>
                  <th className="px-1 py-2 text-center" title="Car-to-car contacts">Ct</th>
                  <th className="px-1 py-2 text-center" title="Off-track / env hits">Env</th>
                  <th className="px-1 py-2 text-center" title="In-game penalties">Pen</th>
                  <th className="px-2 py-2 text-center font-bold text-dark">RTG</th>
                  <th className="px-1 py-2 text-center">EXP</th>
                  <th className="px-1 py-2 text-center">RAC</th>
                  <th className="px-1 py-2 text-center">AWA</th>
                  <th className="px-1 py-2 text-center">PAC</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.driverId} className="border-t border-border">
                    <td className="px-2 py-1.5 text-center font-mono text-xs text-light">{i + 1}</td>
                    <td className="px-2 py-1.5">
                      <span className="font-semibold text-dark">{r.name}</span>
                      <span className="ml-1.5 font-mono text-[10px] text-light">{TIER[r.tier]}</span>
                      {r.provisional && <span className="ml-1 text-[10px] text-amber-500">·prov</span>}
                    </td>
                    <td className="px-1 py-1.5 text-center font-mono text-xs text-light">{r.starts}</td>
                    <td className="px-1 py-1.5 text-center font-mono text-xs text-light">{r.overtakes ?? "–"}</td>
                    <td className="px-1 py-1.5 text-center font-mono text-xs text-light">{r.contacts ?? "–"}</td>
                    <td className="px-1 py-1.5 text-center font-mono text-xs text-light">{r.envContacts ?? "–"}</td>
                    <td className="px-1 py-1.5 text-center font-mono text-xs text-light">{r.gamePenalties ?? "–"}</td>
                    <td className="px-2 py-1.5 text-center font-display text-base font-black tabular-nums text-dark">{r.ratings.overall}</td>
                    <td className="px-1 py-1.5 text-center tabular-nums text-medium">{r.ratings.exp}</td>
                    <td className="px-1 py-1.5 text-center tabular-nums text-medium">{r.ratings.rac}</td>
                    <td className="px-1 py-1.5 text-center tabular-nums text-medium">{r.ratings.aha}</td>
                    <td className="px-1 py-1.5 text-center tabular-nums text-medium">{r.ratings.pac}</td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={12} className="px-3 py-6 text-center text-light">No drivers to show.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
