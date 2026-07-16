import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { CardHead, Notice } from "./ui.jsx";

// Admin Ratings tab: every knob of the rating formulas, editable live.
// EXP and PAC follow the league admin's formula sheet (career window over the
// last 7 finished seasons); RAC/AWA stay field-relative percentiles. The
// preview table recomputes on every change (debounced); nothing reaches the
// public site until Save. All text inputs parse leniently: junk characters are
// ignored, empty fields fall back to the defaults, and the backend clamps
// every number again on save.

const TIER = { 0: "Res", 1: "T1", 2: "T2" };

// --- lenient parsing of the list inputs (curves, recency weights) -----------

function parseList(s) {
  const tokens = String(s ?? "").split(/[,;\s]+/).filter(Boolean);
  const nums = tokens.map(Number).filter((n) => Number.isFinite(n));
  return { nums, hasInvalid: nums.length !== tokens.length };
}
const listToText = (arr) => (Array.isArray(arr) ? arr.join(", ") : "");
const numOr = (v, fallback) => {
  const n = Number(v);
  return v !== "" && v != null && Number.isFinite(n) ? n : fallback;
};

// --- UI state <-> API weights ------------------------------------------------

// Build the form state from the defaults + whatever the admin has saved.
// Curves become comma texts; weight groups whole numbers for the sliders.
function toState(defaults, saved) {
  const grp = (key) => {
    const base = Object.fromEntries(Object.entries(defaults[key]).map(([k, v]) => [k, Math.round(v * 100)]));
    return saved?.[key] ? { ...base, ...saved[key] } : base;
  };
  const bands = {};
  for (const k of ["exp", "pac", "rac", "aha"]) {
    bands[k] = { low: saved?.bands?.[k]?.low ?? "", high: saved?.bands?.[k]?.high ?? "" };
  }
  const dExp = defaults.exp;
  const sExp = saved?.exp || {};
  return {
    band: { ...defaults.band, ...(saved?.band || {}) },
    bands,
    rtg: grp("rtg"),
    pac: grp("pac"),
    rac: grp("rac"),
    aha: grp("aha"),
    window: {
      seasons: String(saved?.window?.seasons ?? defaults.window.seasons),
      recency: listToText(saved?.window?.recency ?? defaults.window.recency),
    },
    exp: {
      weights: { ...dExp.weights, ...(sExp.weights || {}) },
      split: { ...dExp.split, ...(sExp.split || {}) },
      fullStarts: String(sExp.fullStarts ?? dExp.fullStarts),
      finishThreshold: String(sExp.finishThreshold ?? dExp.finishThreshold),
      progression: String(sExp.progression ?? dExp.progression ?? 1),
      driverCurve: listToText(sExp.driverCurve ?? dExp.driverCurve),
      preTier: listToText(sExp.constructors?.preTier ?? dExp.constructors.preTier),
      tier1: (sExp.constructors?.tier1 ?? dExp.constructors.tier1).map((t) => ({
        teams: String(t.teams),
        values: listToText(t.values),
      })),
      tier2: (sExp.constructors?.tier2 ?? dExp.constructors.tier2).map((t) => ({
        teams: String(t.teams),
        values: listToText(t.values),
      })),
    },
  };
}

// Form state -> the weights object the API expects (and sanitises again).
function toWeights(f) {
  const tierTables = (rows) =>
    rows
      .map((t) => ({ teams: numOr(t.teams, null), values: parseList(t.values).nums }))
      .filter((t) => t.teams != null && t.values.length > 0);
  return {
    band: f.band,
    bands: f.bands,
    rtg: f.rtg,
    pac: f.pac,
    rac: f.rac,
    aha: f.aha,
    window: {
      seasons: numOr(f.window.seasons, undefined),
      recency: parseList(f.window.recency).nums,
    },
    exp: {
      weights: f.exp.weights,
      split: f.exp.split,
      fullStarts: numOr(f.exp.fullStarts, undefined),
      finishThreshold: numOr(f.exp.finishThreshold, undefined),
      progression: numOr(f.exp.progression, undefined),
      driverCurve: parseList(f.exp.driverCurve).nums,
      constructors: {
        preTier: parseList(f.exp.preTier).nums,
        tier1: tierTables(f.exp.tier1),
        tier2: tierTables(f.exp.tier2),
      },
    },
  };
}

// --- small building blocks ----------------------------------------------------

function Section({ title, help, children }) {
  return (
    <div className="rounded-xl border border-border bg-surface2/40 p-4">
      <div className="mb-1 font-display text-sm font-bold uppercase tracking-tight text-dark">{title}</div>
      {help && <p className="mb-3 text-xs leading-relaxed text-light">{help}</p>}
      {children}
    </div>
  );
}

// Slider group whose values are normalised percentages of each other.
function WeightSliders({ parts, values, onChange }) {
  const sum = parts.reduce((s, [k]) => s + (Number(values[k]) || 0), 0) || 1;
  return (
    <div className="space-y-2.5">
      {parts.map(([k, label]) => {
        const pct = Math.round(((Number(values[k]) || 0) / sum) * 100);
        return (
          <div key={k} className="flex items-center gap-3">
            <span className="w-40 shrink-0 text-sm text-medium">{label}</span>
            <input
              type="range" min="0" max="100" value={values[k]}
              onChange={(e) => onChange(k, Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer accent-primary"
            />
            <span className="w-10 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-dark">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function NumField({ label, value, onChange, min, max, step = 1, w = "w-20", suffix }) {
  return (
    <label className="flex items-center gap-2 text-sm text-medium">
      {label}
      <input
        type="number" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`input ${w} py-1 text-center`}
      />
      {suffix && <span className="text-xs text-light">{suffix}</span>}
    </label>
  );
}

// A comma-list input with a live "N positions" counter and a gentle warning
// when some tokens couldn't be read as numbers (they're simply ignored).
function ListField({ label, value, onChange, hint }) {
  const parsed = parseList(value);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-medium">{label}</span>
        <span className={`font-mono text-[11px] ${parsed.hasInvalid ? "text-amber-500" : "text-light"}`}>
          {parsed.nums.length} values{parsed.hasInvalid ? " · some entries ignored" : ""}
        </span>
      </div>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="input w-full py-1.5 font-mono text-xs" />
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-light">{hint}</p>}
    </div>
  );
}

// One tier's value tables: a row per field size (team count -> value ladder).
function TierTables({ label, rows, onChange, hint }) {
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-medium">{label}</div>
      {hint && <p className="mb-2 text-[11px] leading-relaxed text-light">{hint}</p>}
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const parsed = parseList(r.values);
          return (
            <div key={i} className="flex items-center gap-2">
              <input
                type="number" min="2" max="30" value={r.teams}
                onChange={(e) => set(i, "teams", e.target.value)}
                className="input w-16 py-1 text-center" aria-label="Team count"
              />
              <span className="shrink-0 text-xs text-light">teams:</span>
              <input
                value={r.values}
                onChange={(e) => set(i, "values", e.target.value)}
                className="input flex-1 py-1 font-mono text-xs" aria-label="Values per position"
              />
              <span className={`w-14 shrink-0 text-right font-mono text-[10px] ${parsed.hasInvalid ? "text-amber-500" : "text-faint"}`}>
                {parsed.nums.length} pos
              </span>
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-light transition hover:bg-red-500/10 hover:text-red-500"
                title="Remove this table"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onChange([...rows, { teams: "", values: "" }])}
        className="mt-2 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary transition hover:bg-primary/20"
      >
        Add field size
      </button>
    </div>
  );
}

export default function AdminRatings() {
  const [defaults, setDefaults] = useState(null);
  const [form, setForm] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState(null);
  const [showProv, setShowProv] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(null);
  const [hasSaved, setHasSaved] = useState(false);
  const lastSaved = useRef(null); // the saved blob, for "reset to saved"

  // Initial load: defaults + persisted weights + baseline ratings.
  useEffect(() => {
    let alive = true;
    api
      .ratingsPreview(undefined)
      .then((d) => {
        if (!alive) return;
        setDefaults(d.defaults);
        lastSaved.current = d.saved || null;
        setForm(toState(d.defaults, d.saved));
        setHasSaved(!!d.saved);
        setRatings(d.ratings);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  // Recompute the preview (debounced) whenever anything changes.
  useEffect(() => {
    if (!form) return;
    setComputing(true);
    const t = setTimeout(() => {
      api
        .ratingsPreview(toWeights(form))
        .then((d) => { setRatings(d.ratings); setError(null); })
        .catch((e) => setError(e.message))
        .finally(() => setComputing(false));
    }, 300);
    return () => clearTimeout(t);
  }, [form]);

  // Setters (all shallow-merge into the form).
  const patch = useCallback((fn) => setForm((f) => fn(structuredClone(f))), []);
  const setGroup = (group) => (k, v) => patch((f) => { f[group][k] = v; return f; });
  const setExpWeight = (k, v) => patch((f) => { f.exp.weights[k] = v; return f; });
  const setSplit = (k, v) => patch((f) => { f.exp.split[k] = v; return f; });
  const setExp = (k, v) => patch((f) => { f.exp[k] = v; return f; });
  const setWindow = (k, v) => patch((f) => { f.window[k] = v; return f; });
  const setBand = (k, v) => patch((f) => { f.band[k] = Number(v); return f; });
  const setStatBand = (stat, k, v) => patch((f) => { f.bands[stat][k] = v; return f; });

  async function saveWeights() {
    setSaving(true);
    setSavedNote(null);
    try {
      const res = await api.saveRatingsWeights(toWeights(form));
      lastSaved.current = res?.saved ?? toWeights(form);
      setHasSaved(true);
      setSavedNote({ ok: true, text: "Saved. The public rating cards now use this formula." });
    } catch (e) {
      setSavedNote({ ok: false, text: e.message });
    } finally {
      setSaving(false);
    }
  }
  async function clearWeights() {
    if (!window.confirm("Throw away the saved settings and put the public ratings back on the league defaults?")) return;
    setSaving(true);
    setSavedNote(null);
    try {
      await api.saveRatingsWeights(null);
      lastSaved.current = null;
      setHasSaved(false);
      if (defaults) setForm(toState(defaults, null));
      setSavedNote({ ok: true, text: "Cleared. The public ratings are back on the defaults." });
    } catch (e) {
      setSavedNote({ ok: false, text: e.message });
    } finally {
      setSaving(false);
    }
  }
  const resetToSaved = () => defaults && setForm(toState(defaults, lastSaved.current));
  const loadDefaults = () => defaults && setForm(toState(defaults, null));

  const shown = useMemo(
    () => (showProv ? ratings : ratings.filter((r) => !r.provisional)),
    [ratings, showProv]
  );

  if (loading) return <div className="text-sm text-light">Loading ratings…</div>;
  if (error && !form) return <Notice kind="error">{error}</Notice>;

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <CardHead eyebrow="Driver Ratings" title="Rating formula tuning" />
        <p className="text-sm leading-relaxed text-light">
          Every driver card carries <b>EXP</b> (experience), <b>PAC</b> (pace), <b>RAC</b> (racecraft) and{" "}
          <b>AWA</b> (awareness), blended into the overall <b>RTG</b>. EXP and PAC follow the league&rsquo;s
          career formula over a rolling window of the last finished seasons; RAC and AWA rank each driver
          against this season&rsquo;s field. Changes here preview live in the table and go public only when
          you press <b>Save</b>.{" "}
          {hasSaved ? (
            <span className="font-semibold text-emerald-600">The public site is using your saved settings.</span>
          ) : (
            <span className="font-semibold">The public site is using the league defaults.</span>
          )}
        </p>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {savedNote && <Notice kind={savedNote.ok ? "success" : "error"}>{savedNote.text}</Notice>}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ===== Controls ===== */}
        <div className="space-y-4">
          <Section
            title="Career window"
            help="EXP and PAC look at the last N finished seasons (the running season joins once its finale is in). Recency weights say how much each season counts, newest first — they're treated proportionally."
          >
            <div className="space-y-3">
              <NumField label="Seasons in the window" min="1" max="20" value={form.window.seasons} onChange={(v) => setWindow("seasons", v)} />
              <ListField
                label="Recency weights (newest season first)"
                value={form.window.recency}
                onChange={(v) => setWindow("recency", v)}
                hint="Example: 25, 20, 20, 15, 10, 5, 5 — the latest season counts 25%, the oldest 5%."
              />
            </div>
          </Section>

          <Section
            title="EXP · Experience formula"
            help="Absolute scale (not field-relative): the floor is the EXP spread's floor below, full marks need the lot. Four blocks, weighted against each other:"
          >
            <div className="space-y-4">
              <WeightSliders
                parts={[["starts", "Race starts"], ["championship", "Championship results"], ["finishing", "Finishing rate"], ["activity", "Seasons active"]]}
                values={form.exp.weights}
                onChange={setExpWeight}
              />
              <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
                <NumField label="Full marks at" min="1" max="500" value={form.exp.fullStarts} onChange={(v) => setExp("fullStarts", v)} suffix="starts" />
                <NumField label="Finishing block needs" min="0" max="100" value={form.exp.finishThreshold} onChange={(v) => setExp("finishThreshold", v)} suffix="% finished (all-or-nothing)" />
              </div>
              <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
                <NumField label="Progression curve" min="0.1" max="3" step="0.05" value={form.exp.progression} onChange={(v) => setExp("progression", v)} suffix="exponent" />
                <p className="max-w-md text-xs leading-relaxed text-light">
                  Below 1 the early points come fast and the last ones keep getting harder (0.6 = the default
                  curve); 1 = linear, above 1 flips it. The EXP floor and ceiling (
                  {form.bands.exp.low || defaults?.bands?.exp?.low || 35}–
                  {form.bands.exp.high || defaults?.bands?.exp?.high || 99}, set in the spreads below) never
                  move; only the path between them bends.
                </p>
              </div>
              <div className="border-t border-border pt-3">
                <div className="mb-2 text-sm font-semibold text-medium">Championship block: drivers vs constructors</div>
                <WeightSliders
                  parts={[["drivers", "Drivers' standings"], ["constructors", "Constructors' standings"]]}
                  values={form.exp.split}
                  onChange={setSplit}
                />
              </div>
              <div className="space-y-3 border-t border-border pt-3">
                <ListField
                  label="Drivers' standings value by position (%)"
                  value={form.exp.driverCurve}
                  onChange={(v) => setExp("driverCurve", v)}
                  hint="P1 first. A champion banks 100%, P2 75% and so on; positions past the end of the list score the last value."
                />
                <ListField
                  label="Constructors, seasons without tiers (%)"
                  value={form.exp.preTier}
                  onChange={(v) => setExp("preTier", v)}
                />
                <TierTables
                  label="Constructors, Tier 1 (%)"
                  rows={form.exp.tier1}
                  onChange={(rows) => setExp("tier1", rows)}
                  hint="One value ladder per field size — a 5-team tier pays differently than a 6-team tier. The closest matching row is used."
                />
                <TierTables
                  label="Constructors, Tier 2 (%)"
                  rows={form.exp.tier2}
                  onChange={(rows) => setExp("tier2", rows)}
                  hint="Deliberately lower than Tier 1: the sheet values a Tier 2 title at half a Tier 1 title."
                />
              </div>
            </div>
          </Section>

          <Section
            title="PAC · Pace"
            help="Career-window speed, ranked against this season's field: average qualifying (grid) position, average best-race-lap gap, and lap-time consistency."
          >
            <WeightSliders
              parts={[["quali", "Qualifying position"], ["bestLap", "Best race lap"], ["consistency", "Consistency"], ["poleGap", "Gap to pole"]]}
              values={form.pac}
              onChange={setGroup("pac")}
            />
            <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
              <b>Gap to pole</b> stays at 0% until qualifying times are imported (the current AC import reads
              race sessions only). Once the quali files are in, raise this weight to bring it into PAC.
            </p>
          </Section>

          <Section
            title="Overall (RTG) blend"
            help="How the four sub-ratings combine into the headline number."
          >
            <WeightSliders
              parts={[["rac", "Racecraft"], ["pac", "Pace"], ["aha", "Awareness"], ["exp", "Experience"]]}
              values={form.rtg}
              onChange={setGroup("rtg")}
            />
          </Section>

          <Section
            title="Spread"
            help="Where the worst and best land on the 0–99 scale. The shared band drives RAC and AWA; EXP (35–99) and PAC (50–99) have their own scales from the formula sheet — override any of them below, blank = default."
          >
            <div className="flex items-center gap-4">
              <NumField label="Shared floor" min="0" max="98" value={form.band.low} onChange={(v) => setBand("low", v)} />
              <NumField label="ceiling" min="1" max="99" value={form.band.high} onChange={(v) => setBand("high", v)} />
            </div>
            <div className="mt-4 space-y-1.5 border-t border-border pt-3">
              {[["exp", "EXP · Experience"], ["pac", "PAC · Pace"], ["rac", "RAC · Racecraft"], ["aha", "AWA · Awareness"]].map(([stat, label]) => (
                <div key={stat} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-sm text-medium">{label}</span>
                  <input
                    type="number" min="0" max="98"
                    placeholder={String(defaults?.bands?.[stat]?.low ?? form.band.low)}
                    value={form.bands?.[stat]?.low ?? ""}
                    onChange={(e) => setStatBand(stat, "low", e.target.value)}
                    className="input w-20 py-1 text-center"
                    aria-label={`${label} floor`}
                  />
                  <span className="text-xs text-faint">to</span>
                  <input
                    type="number" min="1" max="99"
                    placeholder={String(defaults?.bands?.[stat]?.high ?? form.band.high)}
                    value={form.bands?.[stat]?.high ?? ""}
                    onChange={(e) => setStatBand(stat, "high", e.target.value)}
                    className="input w-20 py-1 text-center"
                    aria-label={`${label} ceiling`}
                  />
                </div>
              ))}
            </div>
          </Section>

          <button
            className="text-sm font-semibold text-primary hover:underline"
            onClick={() => setAdvanced((a) => !a)}
          >
            {advanced ? "Hide racecraft & awareness weights" : "Show racecraft & awareness weights (RAC / AWA)"}
          </button>
          {advanced && (
            <div className="space-y-4">
              <Section title="RAC · Racecraft" help="Race result, ranked within this season.">
                <WeightSliders
                  parts={[["finish", "Finishing position"], ["gained", "Places gained"], ["overtakes", "On-track overtakes"], ["podium", "Podium rate"]]}
                  values={form.rac}
                  onChange={setGroup("rac")}
                />
              </Section>
              <Section title="AWA · Awareness" help="Cleanliness, consistency & discipline, ranked within this season.">
                <WeightSliders
                  parts={[
                    ["finishRate", "Finish rate"], ["dnf", "Few DNFs"],
                    ["consistency", "Consistency"], ["contacts", "Few contacts"],
                    ["env", "Few off-track hits"], ["penalties", "Few penalties"], ["cuts", "Few cuts"],
                  ]}
                  values={form.aha}
                  onChange={setGroup("aha")}
                />
              </Section>
            </div>
          )}

          <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-lg">
            <button className="btn-primary disabled:opacity-50" onClick={saveWeights} disabled={saving}>
              {saving ? "Saving…" : "Save formula"}
            </button>
            <button className="btn-secondary" onClick={resetToSaved} disabled={saving} title="Back to what's currently saved (or the defaults if nothing is)">
              Reset
            </button>
            <button className="btn-secondary" onClick={loadDefaults} disabled={saving} title="Fill the form with the league defaults (nothing is saved yet)">
              Load defaults
            </button>
            {hasSaved && (
              <button className="text-sm font-semibold text-red-600 hover:underline" onClick={clearWeights} disabled={saving}>
                Clear saved
              </button>
            )}
          </div>
        </div>

        {/* ===== Live result table ===== */}
        <div className="card self-start overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="font-display text-sm font-bold uppercase tracking-tight text-dark">
              Preview {computing && <span className="ml-2 font-mono text-[10px] font-normal text-light">updating…</span>}
            </div>
            <label className="flex items-center gap-2 text-xs text-light">
              <input type="checkbox" checked={showProv} onChange={(e) => setShowProv(e.target.checked)} />
              show provisional (&lt;3 races)
            </label>
          </div>
          <div className="max-h-[720px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface2 text-left text-light">
                <tr>
                  <th className="px-2 py-2 text-center">#</th>
                  <th className="px-2 py-2">Driver</th>
                  <th className="px-1 py-2 text-center" title="Starts this season">St</th>
                  <th className="px-1 py-2 text-center" title="Career starts inside the window">Car</th>
                  <th className="px-1 py-2 text-center" title="Seasons active / window size">Seas</th>
                  <th className="px-1 py-2 text-center" title="Championship block score (0-1, recency-weighted)">Champ</th>
                  <th className="px-2 py-2 text-center font-bold text-dark">RTG</th>
                  <th className="px-1 py-2 text-center">EXP</th>
                  <th className="px-1 py-2 text-center">PAC</th>
                  <th className="px-1 py-2 text-center">RAC</th>
                  <th className="px-1 py-2 text-center">AWA</th>
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
                    <td className="px-1 py-1.5 text-center font-mono text-xs text-light">{r.career?.starts ?? "–"}</td>
                    <td className="px-1 py-1.5 text-center font-mono text-xs text-light">
                      {r.career ? `${r.career.activeSeasons}/${r.career.windowSize}` : "–"}
                    </td>
                    <td className="px-1 py-1.5 text-center font-mono text-xs text-light">
                      {r.career ? Math.round(r.career.champPct * 100) + "%" : "–"}
                    </td>
                    <td className="px-2 py-1.5 text-center font-display text-base font-black tabular-nums text-dark">{r.ratings.overall}</td>
                    <td className="px-1 py-1.5 text-center tabular-nums text-medium">{r.ratings.exp}</td>
                    <td className="px-1 py-1.5 text-center tabular-nums text-medium">{r.ratings.pac}</td>
                    <td className="px-1 py-1.5 text-center tabular-nums text-medium">{r.ratings.rac}</td>
                    <td className="px-1 py-1.5 text-center tabular-nums text-medium">{r.ratings.aha}</td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-6 text-center text-light">No drivers to show.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
