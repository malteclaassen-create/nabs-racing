import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";

// ---------------------------------------------------------------------------
// /tools — race-prep calculators for members. Deliberately NOT in the main
// nav: reachable from the upcoming-race panel (Races page) and from the
// private profile. Everything runs client-side; inputs persist in
// localStorage so a setup survives reloads and race weekends.
// ---------------------------------------------------------------------------

const STORE_KEY = "nabs_tools";

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

// Parse a lap time like "1:43.250", "1.43,250", "103.25" (plain seconds) into
// milliseconds; null when it doesn't look like a time at all.
export function parseLapMs(raw) {
  const s = String(raw || "").trim().replace(",", ".");
  if (!s) return null;
  let m = s.match(/^(\d+):([0-5]?\d(?:\.\d{1,3})?)$/);
  if (m) return Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000);
  m = s.match(/^(\d+(?:\.\d{1,3})?)$/);
  if (m) {
    const sec = Number(m[1]);
    // A bare number under 20 is almost certainly minutes ("1.43" meant 1:43).
    if (sec >= 20 && sec <= 1800) return Math.round(sec * 1000);
  }
  return null;
}

export function fmtLapMs(ms) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "-";
  const min = Math.floor(ms / 60000);
  const sec = (ms % 60000) / 1000;
  return `${min}:${sec.toFixed(3).padStart(6, "0")}`;
}

function fmtRaceMs(ms) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "-";
  const h = Math.floor(ms / 3600000);
  const min = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${String(min).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s` : `${min}m ${String(sec).padStart(2, "0")}s`;
}

const num = (v) => {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null; // empty input is "unset", not zero
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Shared UI bits, matching the site's card/label language.
function ToolCard({ title, subtitle, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border bg-surface2/50 px-5 py-3">
        <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-light">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-light">{subtitle}</p>}
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block font-mono text-[11px] font-bold uppercase tracking-wider text-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-light">{hint}</span>}
    </label>
  );
}

// Small stat cell for the practice summary strip (hairline-ruled block, same
// language as the profile tiles).
function MiniStat({ label, value, sub }) {
  return (
    <div className="-ml-px -mt-px border-l border-t border-border bg-card p-3">
      <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{label}</div>
      <div className="mt-1 font-display text-xl font-black tabular-nums text-dark">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-light">{sub}</div>}
    </div>
  );
}

function Result({ label, value, strong = false, accent = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0">
      <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">{label}</span>
      <span
        className={`text-right font-display tabular-nums ${strong ? "text-2xl font-black" : "text-base font-bold"} ${
          accent ? "text-eyebrow" : "text-dark"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool 1: fuel calculator. Race length as laps, or as minutes + lap time.
// ---------------------------------------------------------------------------
function FuelCalculator({ store, update }) {
  const mode = store.fuelMode || "laps";
  const laps = num(store.fuelLaps);
  const minutes = num(store.fuelMinutes);
  const lapMs = parseLapMs(store.fuelLapTime);
  const perLap = num(store.fuelPerLap);
  const formation = store.fuelFormation !== false; // default on
  const marginPct = num(store.fuelMargin) ?? 5;

  const raceLaps =
    mode === "laps"
      ? laps && laps > 0
        ? Math.ceil(laps)
        : null
      : minutes && minutes > 0 && lapMs
      ? Math.ceil((minutes * 60000) / lapMs)
      : null;

  const exact = raceLaps && perLap ? raceLaps * perLap : null;
  const recommended =
    exact != null ? Math.ceil((raceLaps + (formation ? 1 : 0)) * perLap * (1 + Math.max(0, marginPct) / 100)) : null;

  return (
    <ToolCard title="Fuel calculator" subtitle="How many liters to put in for the race.">
      <SlidingTabs
        btnClassName="px-3.5 py-1.5 text-sm"
        items={[
          { key: "laps", label: "I know the laps" },
          { key: "time", label: "Timed race" },
        ]}
        value={mode}
        onChange={(m) => update({ fuelMode: m })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "laps" ? (
          <Field label="Race laps">
            <input className="input" type="number" min="1" inputMode="numeric" value={store.fuelLaps ?? ""} onChange={(e) => update({ fuelLaps: e.target.value })} placeholder="e.g. 30" />
          </Field>
        ) : (
          <>
            <Field label="Race length (minutes)">
              <input className="input" type="number" min="1" inputMode="numeric" value={store.fuelMinutes ?? ""} onChange={(e) => update({ fuelMinutes: e.target.value })} placeholder="e.g. 45" />
            </Field>
            <Field label="Your lap time" hint='Like "1:43.250".'>
              <input className="input" value={store.fuelLapTime ?? ""} onChange={(e) => update({ fuelLapTime: e.target.value })} placeholder="1:43.250" />
            </Field>
          </>
        )}
        <Field label="Fuel per lap (L)" hint="Assetto Corsa shows this in the fuel readout.">
          <input className="input" type="number" min="0" step="0.01" inputMode="decimal" value={store.fuelPerLap ?? ""} onChange={(e) => update({ fuelPerLap: e.target.value })} placeholder="e.g. 2.35" />
        </Field>
        <Field label="Safety margin (%)" hint="Extra on top for safety-car laps and traffic.">
          <input className="input" type="number" min="0" max="50" inputMode="numeric" value={store.fuelMargin ?? 5} onChange={(e) => update({ fuelMargin: e.target.value })} />
        </Field>
      </div>

      <label className="flex items-center gap-2.5 text-sm text-medium">
        <input type="checkbox" className="h-4 w-4 accent-[var(--c-primary)]" checked={formation} onChange={(e) => update({ fuelFormation: e.target.checked })} />
        Add a formation lap
      </label>

      <div className="rounded-xl bg-surface2/60 px-4 py-1">
        <Result label="Race laps" value={raceLaps ?? "-"} />
        <Result label="Exact race fuel" value={exact != null ? `${exact.toFixed(1)} L` : "-"} />
        <Result label="Put in" value={recommended != null ? `${recommended} L` : "-"} strong accent />
      </div>
    </ToolCard>
  );
}

// ---------------------------------------------------------------------------
// Tool 3: practice analysis + a simple strategy comparison.
//
// The easy path: drop the session-result JSON that the practice server (or
// Content Manager after a singleplayer session) writes. It is parsed right here
// in the browser — nothing is uploaded anywhere. Laps are grouped into stints
// (a tyre change or a long pit gap starts a new one) and each stint gets its
// own pace numbers plus a lap chart. Typing lap times by hand stays available
// as the fallback.
// ---------------------------------------------------------------------------
// Singleplayer sessions write Documents/Assetto Corsa/out/race_out.json in a
// different shape: players[] indexed by car, sessions[].laps[] with lowercase
// keys and no timestamps. Converted here into the same internal form; each
// session boundary force-starts a new stint (`newStint`).
function parseRaceOutJson(json, fileName) {
  const names = new Map();
  (json.players || []).forEach((p, i) => names.set(String(i), p?.name || `Car ${i + 1}`));
  const byDriver = new Map();
  for (const s of json.sessions || []) {
    const seen = new Set();
    for (const lp of s?.laps || []) {
      const ms = Number(lp.time);
      const key = String(lp.car ?? 0);
      if (!Number.isFinite(ms) || ms <= 0 || ms > 30 * 60000) continue;
      if (!byDriver.has(key)) byDriver.set(key, []);
      byDriver.get(key).push({
        ms,
        tyre: String(lp.tyre || "?"),
        cuts: Number(lp.cuts) || 0,
        ts: null,
        sectors: Array.isArray(lp.sectors) ? lp.sectors.map(Number) : null,
        newStint: !seen.has(key),
      });
      seen.add(key);
    }
  }
  return { file: fileName, type: "SINGLEPLAYER", track: String(json.track || ""), names, byDriver };
}

// --- CSV support ------------------------------------------------------------
// Lap-time apps and spreadsheets export all kinds of CSV. This parser is
// deliberately tolerant: it detects the delimiter, finds the column that looks
// most like lap times (1:43.250, 103.25 s or 103250 ms), and picks up optional
// tyre and driver columns by their header names.
function csvCellTime(v) {
  const direct = parseLapMs(v);
  if (direct != null) return direct;
  const n = Number(String(v ?? "").trim().replace(",", "."));
  if (Number.isFinite(n) && n >= 20000 && n <= 1800000) return Math.round(n); // raw milliseconds
  return null;
}

function parseCsvSession(text, fileName) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) throw new Error("empty");
  const delim = [";", ",", "\t"].reduce((a, b) => (lines[0].split(b).length > lines[0].split(a).length ? b : a));
  const rows = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));
  // Header = first row without a single readable lap time.
  const hasHeader = !rows[0].some((c) => csvCellTime(c) != null);
  const header = hasHeader ? rows[0].map((c) => c.toLowerCase()) : [];
  const data = hasHeader ? rows.slice(1) : rows;
  const cols = Math.max(...data.map((r) => r.length));

  // Score every column by how many of its cells parse as a lap time.
  let timeCol = -1;
  let bestHits = 0;
  for (let c = 0; c < cols; c++) {
    const hits = data.filter((r) => csvCellTime(r[c]) != null).length;
    const named = /lap.?time|^time$|zeit/.test(header[c] || "");
    const score = hits + (named ? data.length : 0); // a named column wins ties
    if (hits >= 2 && hits >= data.length / 2 && score > bestHits) {
      bestHits = score;
      timeCol = c;
    }
  }
  if (timeCol < 0) throw new Error("no lap-time column");
  const findCol = (re) => header.findIndex((h) => re.test(h || ""));
  const tyreCol = findCol(/tyre|tire|compound|reifen/);
  const driverCol = findCol(/driver|fahrer|pilot|player|^name$/);
  const cutsCol = findCol(/cuts?$/);
  // Optional sector columns (s1/sector 1/…), in order, for the theoretical best.
  const sectorCols = header
    .map((h, i) => (/^s(ec(tor)?)?[\s_-]?\d$/i.test(h || "") ? i : -1))
    .filter((i) => i >= 0);

  const byDriver = new Map();
  const names = new Map();
  for (const r of data) {
    const ms = csvCellTime(r[timeCol]);
    if (ms == null) continue;
    const who = driverCol >= 0 && r[driverCol] ? r[driverCol] : "csv";
    if (!byDriver.has(who)) {
      byDriver.set(who, []);
      names.set(who, driverCol >= 0 && r[driverCol] ? r[driverCol] : "CSV laps");
    }
    const sectors = sectorCols.length ? sectorCols.map((c) => csvCellTime(r[c])) : null;
    byDriver.get(who).push({
      ms,
      tyre: tyreCol >= 0 ? String(r[tyreCol] || "?") : "?",
      cuts: cutsCol >= 0 ? Number(r[cutsCol]) || 0 : 0,
      ts: null,
      sectors: sectors && sectors.every((s) => s != null) ? sectors : null,
    });
  }
  if (![...byDriver.values()].some((l) => l.length)) throw new Error("no laps");
  return { file: fileName, type: "CSV", track: "", names, byDriver };
}

// Parse one AC session-result JSON into laps per driver (chronological).
// Handles both the server result format (Type/Result/Laps) and the
// singleplayer race_out.json (players/sessions).
function parseSessionJson(json, fileName) {
  if (Array.isArray(json?.sessions) && Array.isArray(json?.players)) {
    return parseRaceOutJson(json, fileName);
  }
  const rawLaps = Array.isArray(json?.Laps) ? json.Laps : [];
  const names = new Map();
  for (const c of json?.Cars || []) if (c?.Driver?.Guid) names.set(c.Driver.Guid, c.Driver.Name);
  for (const r of json?.Result || []) if (r?.DriverGuid && !names.has(r.DriverGuid)) names.set(r.DriverGuid, r.DriverName);
  const byDriver = new Map();
  for (const lp of rawLaps) {
    const ms = Number(lp.LapTime);
    const guid = lp.DriverGuid || lp.CarId || "solo";
    if (!Number.isFinite(ms) || ms <= 0 || ms > 30 * 60000) continue;
    if (!byDriver.has(guid)) byDriver.set(guid, []);
    byDriver.get(guid).push({
      ms,
      tyre: String(lp.Tyre || "?"),
      cuts: Number(lp.Cuts) || 0,
      ts: Number(lp.Timestamp) || null,
      sectors: Array.isArray(lp.Sectors) ? lp.Sectors.map(Number) : null,
    });
  }
  return {
    file: fileName,
    type: String(json?.Type || "SESSION"),
    track: String(json?.TrackName || ""),
    names,
    byDriver,
  };
}

// Group one driver's chronological laps into stints: a tyre change always
// starts a new stint; a long gap between timestamps (a pit visit or a pause)
// does too, when the file carries usable timestamps.
function splitStints(laps) {
  // Normalise timestamps (some files use epoch seconds, some ms).
  const ts = laps.map((l) => l.ts).filter((t) => t != null && t > 0);
  const scale = ts.length && Math.max(...ts) > 1e12 ? 1 : ts.length && Math.max(...ts) > 1e9 ? 1000 : 1;
  const stints = [];
  let cur = null;
  laps.forEach((lap, i) => {
    const prev = laps[i - 1];
    let gap = false;
    if (prev && lap.ts && prev.ts) {
      const dt = (lap.ts - prev.ts) * scale;
      // The time between two lap records ≈ the lap itself; a pit stop or a
      // pause shows up as a much larger hole.
      if (dt > Math.max(lap.ms, prev.ms) * 2.2) gap = true;
    }
    if (!cur || lap.tyre !== cur.tyre || gap || lap.newStint) {
      cur = { tyre: lap.tyre, laps: [] };
      stints.push(cur);
    }
    cur.laps.push(lap);
  });
  return stints.map((s, i) => {
    const times = s.laps.map((l) => l.ms);
    const best = Math.min(...times);
    // Clean = within 103% of the stint best and without track cuts: out-laps,
    // spins and invalid laps drop out of the pace average by themselves.
    const clean = s.laps.filter((l) => l.ms <= best * 1.03 && l.cuts === 0).map((l) => l.ms);
    const avg = clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
    const sd = clean.length >= 2 ? Math.sqrt(clean.map((x) => (x - avg) ** 2).reduce((a, b) => a + b, 0) / clean.length) : null;
    return { index: i, tyre: s.tyre, laps: s.laps, best, cleanCount: clean.length, avgClean: avg, stdevMs: sd };
  });
}

const STINT_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#14b8a6", "#f43f5e", "#84cc16"];

// Theoretical best: the fastest sector times of the session combined into one
// perfect lap. Needs laps with matching sector counts; cut laps don't count.
function theoreticalBest(laps) {
  const clean = laps.filter(
    (l) => l.cuts === 0 && Array.isArray(l.sectors) && l.sectors.length >= 2 && l.sectors.every((s) => Number.isFinite(s) && s > 0)
  );
  if (clean.length < 2) return null;
  const n = Math.max(...clean.map((l) => l.sectors.length));
  const same = clean.filter((l) => l.sectors.length === n);
  if (same.length < 2) return null;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.min(...same.map((l) => l.sectors[i]));
  return sum;
}

// Compact tick label for the chart's time axis (1:43.2).
function fmtTick(ms) {
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

// Lap chart: labelled time axis on the left, lap numbers below, one colour per
// stint with its tyre tag on top, the session best ringed. Fast laps sit high;
// out-laps and other slow laps clamp to the bottom edge as hollow markers. The
// chart stretches its lap spacing to fill the available width (measured live),
// and only grows beyond it (with horizontal scrolling) for very long sessions.
function LapChart({ stints }) {
  const wrapRef = useRef(null);
  const [availW, setAvailW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setAvailW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = stints.flatMap((s) => s.laps.map((l) => ({ ...l, stint: s.index })));
  if (all.length < 2) return null;
  const n = all.length;
  const best = Math.min(...all.map((l) => l.ms));

  // Y domain: from the best lap down to the slowest "reasonable" lap (capped
  // at +8%), with a minimum span so a super-consistent run doesn't zoom in on
  // sub-tenth noise.
  const inRange = all.map((l) => l.ms).filter((ms) => ms <= best * 1.08);
  let span = Math.max(Math.max(...inRange) - best, 800);
  span *= 1.15; // headroom below
  const yMin = best - span * 0.12;
  const yMax = best + span;

  const PAD = { l: 82, r: 20, t: 32, b: 40 };
  const innerH = 200;
  const H = innerH + PAD.t + PAD.b;
  // Spread the laps across the full container width; below 34px per lap the
  // chart keeps that minimum and scrolls instead.
  const spacing = Math.max(34, availW > 0 ? Math.floor((availW - PAD.l - PAD.r) / Math.max(1, n - 1)) : 48);
  const W = Math.max(availW || 0, PAD.l + (n - 1) * spacing + PAD.r);
  const x = (i) => PAD.l + i * spacing;
  const y = (ms) => PAD.t + ((ms - yMin) / (yMax - yMin)) * innerH;

  // Time gridlines on a tidy step (0.2 / 0.5 / 1 / 2 s depending on the span).
  const step = [200, 500, 1000, 2000, 5000].find((s) => span / s <= 4) || 10000;
  const ticks = [];
  for (let t = Math.ceil(yMin / step) * step; t <= yMax; t += step) ticks.push(t);
  const xEvery = n <= 14 ? 1 : n <= 30 ? 5 : 10;

  let gi = 0;
  const stintNodes = stints.map((s) => {
    const color = STINT_COLORS[s.index % STINT_COLORS.length];
    const startX = x(gi);
    const coords = s.laps.map((l, k) => {
      const cx = x(gi);
      gi += 1;
      return { cx, cy: y(Math.min(l.ms, yMax)), out: l.ms > yMax, cuts: l.cuts > 0, ms: l.ms, lap: k + 1 };
    });
    const line = coords.filter((c) => !c.out).map((c, k) => `${k ? "L" : "M"}${c.cx.toFixed(1)},${c.cy.toFixed(1)}`).join(" ");
    return (
      <g key={s.index}>
        {/* tyre tag above the stint's first lap */}
        <text x={startX} y={PAD.t - 12} fontSize="14" fontFamily="monospace" fontWeight="700" fill={color}>
          {s.tyre !== "?" ? s.tyre.toUpperCase() : `S${s.index + 1}`}
        </text>
        {line.includes("L") && <path d={line} fill="none" stroke={color} strokeWidth="2" opacity="0.5" />}
        {coords.map((c, k) => (
          <g key={k}>
            {c.ms === best && <circle cx={c.cx} cy={c.cy} r="8.5" fill="none" stroke="#16a34a" strokeWidth="2" />}
            <circle
              cx={c.cx}
              cy={c.out ? PAD.t + innerH - 5 : c.cy}
              r="4.5"
              fill={c.out ? "transparent" : color}
              stroke={color}
              strokeWidth={c.out ? 1.8 : 0}
              opacity={c.cuts ? 0.45 : 1}
            >
              <title>{`Stint ${s.index + 1}, lap ${c.lap} · ${fmtLapMs(c.ms)}${c.cuts ? " · cut" : ""}${c.ms === best ? " · session best" : ""}`}</title>
            </circle>
          </g>
        ))}
      </g>
    );
  });

  return (
    <div>
      <div ref={wrapRef} className="scrollbar-slim overflow-x-auto rounded-xl border border-border bg-surface2/30">
        <svg width={W} height={H} className="block" role="img" aria-label="Lap times by lap">
          {/* time axis + gridlines */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l - 4} x2={W - PAD.r + 10} y1={y(t)} y2={y(t)} stroke="var(--c-border)" strokeDasharray="3 4" strokeWidth="1" />
              <text x={PAD.l - 10} y={y(t) + 5} fontSize="13.5" fontFamily="monospace" textAnchor="end" fill="var(--c-text2)">
                {fmtTick(t)}
              </text>
            </g>
          ))}
          {/* lap numbers */}
          {all.map((l, i) =>
            (i + 1) % xEvery === 0 || i === 0 ? (
              <text key={i} x={x(i)} y={H - 12} fontSize="13.5" fontFamily="monospace" textAnchor="middle" fill="var(--c-text2)">
                {i + 1}
              </text>
            ) : null
          )}
          {stintNodes}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-light">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-emerald-600" /> session best
        </span>
        <span>hollow at the bottom = out-laps and slow laps · faded = laps with cuts</span>
      </div>
    </div>
  );
}

function PracticeStrategy({ store, update }) {
  const fileRef = useRef(null);
  const [sessions, setSessions] = useState([]); // parsed files (session-only, not persisted)
  const [fileError, setFileError] = useState(null);
  const [driverKey, setDriverKey] = useState(null); // guid of the analysed driver
  // Manual entry opens by itself when there are saved hand-typed laps.
  const [manual, setManual] = useState(() =>
    Array.isArray(store.manualStints)
      ? store.manualStints.some((e) => (e.laps || "").trim())
      : !!store.practiceLaps
  );

  async function onPickFiles(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setFileError(null);
    const parsed = [];
    for (const f of files) {
      try {
        const text = await f.text();
        let s;
        try {
          s = parseSessionJson(JSON.parse(text), f.name);
        } catch {
          s = parseCsvSession(text, f.name); // not JSON (or broken JSON): try CSV
        }
        if (![...s.byDriver.values()].some((laps) => laps.length)) throw new Error("no laps");
        parsed.push(s);
      } catch {
        setFileError(`${f.name} has no readable lap times (expected an AC session JSON or a lap-time CSV).`);
      }
    }
    if (!parsed.length) return;
    setSessions(parsed);
    // Preselect the driver with the most laps across the loaded files.
    const counts = new Map();
    for (const s of parsed) for (const [guid, laps] of s.byDriver) counts.set(guid, (counts.get(guid) || 0) + laps.length);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    setDriverKey(top ? top[0] : null);
  }

  // Everyone who set a lap in the loaded files, for the driver picker.
  const driverOptions = useMemo(() => {
    const opts = new Map();
    for (const s of sessions) {
      for (const [guid, laps] of s.byDriver) {
        const cur = opts.get(guid) || { name: s.names.get(guid) || "Unknown driver", laps: 0 };
        cur.laps += laps.length;
        opts.set(guid, cur);
      }
    }
    return [...opts.entries()].map(([guid, v]) => ({ guid, ...v })).sort((a, b) => b.laps - a.laps);
  }, [sessions]);

  // Manual entry: one block per tyre (times typed line by line). Kept in the
  // persisted store; the old single-textarea value migrates into block one.
  const manualEntries = useMemo(() => {
    if (Array.isArray(store.manualStints)) return store.manualStints;
    if (store.practiceLaps) return [{ tyre: "", laps: String(store.practiceLaps) }];
    return [];
  }, [store.manualStints, store.practiceLaps]);
  const setManualEntries = (list) => update({ manualStints: list, practiceLaps: undefined });

  // The analysed stints: from the loaded files (per selected driver) when
  // present, otherwise from the manual blocks — both feed the same summary,
  // chart, table and projection.
  const stints = useMemo(() => {
    let out = [];
    if (sessions.length) {
      if (driverKey) {
        for (const s of sessions) {
          const laps = s.byDriver.get(driverKey);
          if (laps?.length) out.push(...splitStints(laps));
        }
      }
    } else {
      const laps = [];
      for (const e of manualEntries) {
        const tyre = String(e.tyre || "").trim().toUpperCase() || "?";
        let first = true;
        for (const raw of String(e.laps || "").split(/[\n;]+/)) {
          const ms = parseLapMs(raw);
          if (ms == null) continue;
          laps.push({ ms, tyre, cuts: 0, ts: null, sectors: null, newStint: first });
          first = false;
        }
      }
      out = splitStints(laps);
    }
    return out.map((s, i) => ({ ...s, index: i }));
  }, [sessions, driverKey, manualEntries]);

  // Session summary numbers for the strip above the chart.
  const allLaps = stints.flatMap((s) => s.laps);
  const bestLapMs = allLaps.length ? Math.min(...allLaps.map((l) => l.ms)) : null;
  const theoMs = theoreticalBest(allLaps);

  // Race projection: one line per tyre/stint pace over the full distance —
  // no strategy knobs to configure, the numbers speak for themselves.
  const raceLaps = num(store.stratLaps);
  const pitLoss = num(store.stratPitLoss) ?? 25;
  const usableStints = stints.filter((s) => s.avgClean != null);
  const paces = usableStints.map((s) => ({
    key: `s${s.index}`,
    label: `Stint ${s.index + 1}`,
    tyre: s.tyre,
    pace: s.avgClean,
    color: STINT_COLORS[s.index % STINT_COLORS.length],
  }));
  const projections =
    raceLaps > 0 ? paces.map((p) => ({ ...p, total: raceLaps * p.pace })).sort((x, y) => x.total - y.total) : [];
  const breakEven = raceLaps > 0 && pitLoss > 0 ? pitLoss / raceLaps : null;

  return (
    <ToolCard
      title="Practice analysis and strategy"
      subtitle="Drop in the session JSON from your practice server or singleplayer, or a CSV of lap times. Stints and pace are worked out for you; the file never leaves your device."
    >
      {/* ---- 1. get laps in ------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".json,.csv,application/json,text/csv" multiple hidden onChange={onPickFiles} />
        <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()}>
          Load session file
        </button>
        {sessions.length > 0 && (
          <span className="flex items-center gap-2 text-xs text-light">
            {sessions.map((s) => s.file).join(", ")}
            {sessions[0].track ? ` · ${sessions[0].track}` : ""}
            <button
              type="button"
              className="font-semibold text-red-600 hover:underline"
              onClick={() => {
                setSessions([]);
                setDriverKey(null);
              }}
            >
              Clear
            </button>
          </span>
        )}
        {sessions.length === 0 && (
          <button
            type="button"
            className="ml-auto text-sm font-semibold text-primary hover:underline"
            onClick={() => setManual((m) => !m)}
          >
            {manual ? "Hide manual entry" : "Type lap times by hand"}
          </button>
        )}
      </div>
      {fileError && <p className="text-sm font-semibold text-red-600">{fileError}</p>}

      {manual && sessions.length === 0 && (
        <div className="space-y-4 rounded-xl border border-border bg-surface2/30 p-4">
          <p className="text-xs text-light">
            One lap time per line, like 1:43.250. Give every tyre its own block, then the blocks are compared as
            stints just like a loaded file.
          </p>
          {(manualEntries.length ? manualEntries : [{ tyre: "", laps: "" }]).map((e, i, list) => (
            <div key={i} className="flex flex-wrap items-start gap-4">
              <Field label="Tyre">
                <input
                  className="input w-24"
                  value={e.tyre || ""}
                  maxLength={12}
                  placeholder="M"
                  onChange={(ev) => {
                    const next = [...list];
                    next[i] = { ...e, tyre: ev.target.value };
                    setManualEntries(next);
                  }}
                />
              </Field>
              <div className="min-w-[240px] flex-1">
                <Field label="Lap times">
                  <textarea
                    className="input min-h-[96px] w-full resize-y font-mono text-sm"
                    value={e.laps || ""}
                    placeholder={"1:43.250\n1:42.981"}
                    onChange={(ev) => {
                      const next = [...list];
                      next[i] = { ...e, laps: ev.target.value };
                      setManualEntries(next);
                    }}
                  />
                </Field>
              </div>
              {list.length > 1 && (
                <button
                  type="button"
                  className="mt-6 text-xs font-semibold text-red-600 hover:underline"
                  onClick={() => setManualEntries(list.filter((_, k) => k !== i))}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setManualEntries([...(manualEntries.length ? manualEntries : [{ tyre: "", laps: "" }]), { tyre: "", laps: "" }])}
          >
            Add another tyre
          </button>
        </div>
      )}

      {/* ---- 2. what the laps say ------------------------------------------ */}
      {(sessions.length > 0 || stints.length > 0) && (
        <div className="space-y-4">
          {sessions.length > 0 && driverOptions.length > 1 && (
            <Field label="Driver">
              <select className="input max-w-xs" value={driverKey || ""} onChange={(e) => setDriverKey(e.target.value)}>
                {driverOptions.map((d) => (
                  <option key={d.guid} value={d.guid}>
                    {d.name} ({d.laps} laps)
                  </option>
                ))}
              </select>
            </Field>
          )}

          {stints.length > 0 ? (
            <>
              {/* headline numbers of the session */}
              <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4">
                <MiniStat label="Laps" value={allLaps.length} sub={`${stints.length} ${stints.length === 1 ? "stint" : "stints"}`} />
                <MiniStat label="Best lap" value={fmtLapMs(bestLapMs)} />
                <MiniStat
                  label="Race pace"
                  value={usableStints.length ? fmtLapMs(Math.min(...usableStints.map((s) => s.avgClean))) : "-"}
                  sub="fastest stint, clean laps"
                />
                {theoMs != null ? (
                  <MiniStat label="Theoretical best" value={fmtLapMs(theoMs)} sub="your best sectors combined" />
                ) : (
                  <MiniStat
                    label="Consistency"
                    value={
                      usableStints.length && usableStints.some((s) => s.stdevMs != null)
                        ? `±${(Math.min(...usableStints.filter((s) => s.stdevMs != null).map((s) => s.stdevMs)) / 1000).toFixed(2)}s`
                        : "-"
                    }
                    sub="clean-lap spread"
                  />
                )}
              </div>

              <LapChart stints={stints} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left font-mono text-[10px] font-bold uppercase tracking-wider text-light">
                      <th className="py-2 pr-2">Stint</th>
                      <th className="px-2 py-2">Tyre</th>
                      <th className="px-2 py-2 text-center">Laps</th>
                      <th className="px-2 py-2 text-right">Best</th>
                      <th className="px-2 py-2 text-right">Race pace</th>
                      <th className="py-2 pl-2 text-right">Spread</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stints.map((s) => {
                      const color = STINT_COLORS[s.index % STINT_COLORS.length];
                      return (
                        <tr key={s.index} className="transition hover:bg-surface2">
                          <td className="py-2 pr-2">
                            <span className="flex items-center gap-2 font-semibold text-dark">
                              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                              {s.index + 1}
                            </span>
                          </td>
                          <td className="px-2 py-2 font-mono text-xs uppercase text-medium">{s.tyre}</td>
                          <td className="px-2 py-2 text-center tabular-nums text-medium">{s.laps.length}</td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-dark">{fmtLapMs(s.best)}</td>
                          <td className="px-2 py-2 text-right font-mono font-bold tabular-nums text-dark">{fmtLapMs(s.avgClean)}</td>
                          <td className="py-2 pl-2 text-right font-mono tabular-nums text-medium">
                            {s.stdevMs != null ? `±${(s.stdevMs / 1000).toFixed(2)}s` : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-light">No laps for this driver in the loaded file.</p>
          )}
        </div>
      )}

      {/* ---- 3. race projection --------------------------------------------- */}
      <div className="border-t border-border pt-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Race projection</span>
          <span className="text-xs text-light">Your time over the full race distance, one line per tyre.</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Race laps">
            <input className="input" type="number" min="1" inputMode="numeric" value={store.stratLaps ?? ""} onChange={(e) => update({ stratLaps: e.target.value })} placeholder="e.g. 30" />
          </Field>
          <Field label="Pit stop time loss (s)" hint="Full pit lane pass plus standing time.">
            <input className="input" type="number" min="0" inputMode="numeric" value={store.stratPitLoss ?? 25} onChange={(e) => update({ stratPitLoss: e.target.value })} />
          </Field>
        </div>
        {projections.length > 0 ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-surface2/60 px-4 py-1">
              {projections.map((p, i) => (
                <div key={p.key} className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0">
                  <span className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.label}
                    {p.tyre ? ` · ${p.tyre}` : ""} · {fmtLapMs(p.pace)}
                  </span>
                  <span className="text-right font-display text-base font-bold tabular-nums text-dark">
                    {fmtRaceMs(p.total)}
                    {i > 0 && (
                      <span className="ml-2 font-mono text-xs font-semibold text-light">
                        +{((p.total - projections[0].total) / 1000).toFixed(1)}s
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {breakEven != null && (
              <p className="text-xs text-light">
                A pit stop costs about {pitLoss}s here. Over {raceLaps} laps that is {breakEven.toFixed(2)}s per lap:
                switching tyres only pays off when the new set is at least that much faster.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-light">
            {paces.length
              ? "Enter the race laps above to project your race time."
              : "Load a session file (or type lap times) first."}
          </p>
        )}
      </div>
    </ToolCard>
  );
}

export default function Tools() {
  const [store, setStore] = useState(loadStore);
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      /* storage full/blocked: calculators still work, they just won't persist */
    }
  }, [store]);
  const update = (patch) => setStore((s) => ({ ...s, ...patch }));

  return (
    <div className="content-in space-y-6">
      <PageHeader
        eyebrow="Race prep"
        title="Tools"
        subtitle="Fuel and strategy helpers for the next race. Everything stays on your device."
      />
      <FuelCalculator store={store} update={update} />
      <PracticeStrategy store={store} update={update} />
      <div>
        <Link to="/races" className="text-sm font-semibold text-primary hover:underline">Race calendar</Link>
      </div>
    </div>
  );
}
