import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { THROTTLE_COLOR, BRAKE_COLOR } from "./TelemetryCharts.jsx";
import { Meter, gearLabel, useSteadySide } from "./TelemetryDashboard.jsx";
import { DivergingBar, fmt, sectionFacts, who } from "./TelemetrySections.jsx";
import { Menu, Panel } from "./TelemetryUI.jsx";
import { deltaTrend, formatLapTime } from "../utils/telemetryAnalysis.js";

// ---------------------------------------------------------------------------
// The 3D replay's heads-up display, for full screen, where "At cursor" and the
// overview are off screen. Built from the same parts as those two: the gap,
// the three sectors filling in as the cars pass them, a column per car, what
// the next corner holds and a small map. Where it sits is the viewer's pick
// (HUD menu in the 3D view): small cards in the corners of the view (the
// default), one bar along its bottom edge, or a panel beside it. On a phone
// the view has no room for cards, so it always sits under the view there.
// Choices are kept in the browser, like the trace channels.
// ---------------------------------------------------------------------------

const HUD_KEY = "nabs_tel_hud";
export const HUD_LAYOUTS = [
  { key: "cards", label: "Corner cards" },
  { key: "bar", label: "Bottom bar" },
  { key: "side", label: "Side panel" },
];
const HUD_PARTS = [
  { key: "gap", label: "Gap" },
  { key: "sectors", label: "Sectors" },
  { key: "cars", label: "Speed, gear and pedals" },
  { key: "corner", label: "Next corner" },
  { key: "map", label: "Mini-map" },
];
const HUD_DEFAULTS = { layout: "cards", gap: true, sectors: true, cars: true, corner: true, map: true };

export function useHudPrefs() {
  const [prefs, setPrefs] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(HUD_KEY) || "null");
      if (v && typeof v === "object") return { ...HUD_DEFAULTS, ...v, layout: HUD_LAYOUTS.some((l) => l.key === v.layout) ? v.layout : HUD_DEFAULTS.layout };
    } catch { /* per-browser nicety only */ }
    return HUD_DEFAULTS;
  });
  const update = (patch) => setPrefs((p) => {
    const next = { ...p, ...patch };
    try { localStorage.setItem(HUD_KEY, JSON.stringify(next)); } catch { /* per-browser nicety only */ }
    return next;
  });
  return [prefs, update];
}

// Whether the screen is wide enough for cards over the view.
export function useWide(query = "(min-width: 768px)") {
  const [wide, setWide] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const mq = matchMedia(query);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, [query]);
  return wide;
}

const rowClass = "flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 text-dark transition hover:bg-surface2";

export function HudMenu({ prefs, onChange, narrow = false }) {
  return (
    <Menu icon={SlidersHorizontal} label="HUD" summary={<span>HUD</span>} align="left" width="w-60">
      <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-light">Placement</p>
      {HUD_LAYOUTS.map((l) => (
        <label key={l.key} className={rowClass}>
          <span className="flex-1">{l.label}</span>
          {l.key === HUD_DEFAULTS.layout && <span className="text-[10px] text-light">default</span>}
          <input type="radio" name="tel-hud-layout" className="accent-accent" checked={prefs.layout === l.key} onChange={() => onChange({ layout: l.key })} />
        </label>
      ))}
      {narrow && <p className="px-2.5 pb-1 text-[11px] text-light">On a screen this narrow it sits under the view.</p>}
      <div className="my-1 border-t border-border" />
      <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold text-light">On screen</p>
      {HUD_PARTS.map((p) => (
        <label key={p.key} className={rowClass}>
          <span className="flex-1">{p.label}</span>
          <input type="checkbox" className="accent-accent" checked={!!prefs[p.key]} onChange={(e) => onChange({ [p.key]: e.target.checked })} />
        </label>
      ))}
      <div className="my-1 border-t border-border" />
      <button type="button" className="w-full rounded-md px-2.5 py-1.5 text-left text-light transition hover:bg-surface2 hover:text-dark" onClick={() => onChange(HUD_DEFAULTS)}>Back to default</button>
    </Menu>
  );
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const Dot = ({ color }) => <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />;

function PedalRow({ label, value, color }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-[3.6rem] shrink-0 text-light">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-2">
        <span className="w-9 shrink-0 font-mono tabular-nums text-dark">{Math.round(value ?? 0)}%</span>
        <Meter value={value} color={color} />
      </dd>
    </div>
  );
}

// "At cursor"'s column, cut down to what reads at a glance while it moves.
function CarColumn({ lap, i, side, name, color, aside, size }) {
  return (
    <div className="min-w-0 border-l-2 pl-3" style={{ borderColor: color }}>
      <div className="flex items-center gap-2 text-xs font-semibold">
        <span className="font-mono" style={{ color }}>{side}</span>
        <span className="truncate text-dark">{name}</span>
        <span className="ml-auto shrink-0 font-mono font-normal tabular-nums text-light">{aside}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`font-display ${size} font-bold tabular-nums text-dark`}>{Math.round(lap.speed[i] ?? 0)}</span>
        <span className="text-xs text-light">km/h</span>
        <span className="ml-auto whitespace-nowrap font-mono text-sm tabular-nums text-dark">gear {gearLabel(lap.gear[i] ?? 0)}</span>
      </div>
      <dl className="mt-2 space-y-1.5 text-xs">
        <PedalRow label="Throttle" value={lap.gas[i]} color={THROTTLE_COLOR} />
        <PedalRow label="Brake" value={lap.brake[i]} color={BRAKE_COLOR} />
      </dl>
    </div>
  );
}

// Lap A's line, both cars on it and a ring on the next corner. North is the
// same as the 2D map's untilted frame: x to the right, z down.
function MiniMap({ lapA, lapB, n, iA, iB, ring, colorA, colorB }) {
  const geo = useMemo(() => {
    if (!lapA?.x || !lapA?.z) return null;
    const len = Math.min(n, lapA.x.length, lapA.z.length);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < len; i++) {
      minX = Math.min(minX, lapA.x[i]); maxX = Math.max(maxX, lapA.x[i]);
      minZ = Math.min(minZ, lapA.z[i]); maxZ = Math.max(maxZ, lapA.z[i]);
    }
    const pad = 8, sc = 100 / Math.max(1, maxX - minX, maxZ - minZ);
    const at = (x, z) => [(x - minX) * sc + pad, (z - minZ) * sc + pad];
    let d = "";
    for (let i = 0; i < len; i += 2) { const [x, y] = at(lapA.x[i], lapA.z[i]); d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }
    return { d, at, w: (maxX - minX) * sc + 2 * pad, h: (maxZ - minZ) * sc + 2 * pad };
  }, [lapA, n]);
  if (!geo) return null;
  const spot = (lap, i) => (lap?.x && lap?.z ? geo.at(lap.x[i], lap.z[i]) : geo.at(lapA.x[i], lapA.z[i]));
  const a = spot(lapA, iA);
  const b = iB != null ? spot(lapB, iB) : null;
  const r = ring != null ? spot(lapA, ring) : null;
  return (
    <svg viewBox={`0 0 ${geo.w.toFixed(1)} ${geo.h.toFixed(1)}`} className="block h-full w-full" role="img" aria-label="Mini-map with both cars">
      <path d={geo.d} fill="none" stroke="var(--c-border)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
      <path d={geo.d} fill="none" stroke="var(--c-text3)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {r && <circle cx={r[0]} cy={r[1]} r="6" fill="none" stroke="var(--c-text)" strokeWidth="1.6" />}
      {b && <circle cx={b[0]} cy={b[1]} r="4.2" fill={colorB} stroke="var(--c-card)" strokeWidth="1.8" />}
      <circle cx={a[0]} cy={a[1]} r="4.5" fill={colorA} stroke="var(--c-card)" strokeWidth="1.8" />
    </svg>
  );
}

export default function TelemetryHud({ placement, prefs, lapA, lapB, at, atB, n, colorA, colorB, nameA, nameB, sectors, sections, dist, className = "" }) {
  const iA = clamp(Math.round(at), 0, n - 1);
  const iB = lapB ? clamp(Math.round(atB ?? at), 0, n - 1) : null;
  const gapMs = (i) => lapB.t[i] - lapA.t[i]; // + = A ahead
  const gap = lapB ? gapMs(iA) / 1000 : 0;
  const leader = useSteadySide(gap * 1000, 10, 4, 300);
  const gaining = useSteadySide(lapB ? deltaTrend(lapA, lapB, iA, 40) : 0, 12, 5, 500);
  const nm = (s) => (s === "A" ? nameA : nameB);
  const col = (s) => (s === "A" ? colorA : colorB);

  const next = sections?.find((s) => s.end >= iA) || sections?.[0] || null;
  const inside = !!next && iA >= next.start && iA <= next.end;
  const toGo = next && !inside && dist ? Math.round(dist[next.start] - dist[iA]) : null;
  const where = `${((iA / Math.max(1, n - 1)) * 100).toFixed(1)}% of lap${inside ? ` · ${next.named ? next.tag : next.label}` : ""}`;
  const side = placement === "side";

  const gapBlock = lapB && prefs.gap ? (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold text-dark">Gap</span>
        {!side && <span className="font-mono tabular-nums text-light">{where}</span>}
      </div>
      <div className={`mt-0.5 font-display ${placement === "bar" ? "text-2xl" : "text-3xl"} font-bold leading-tight tabular-nums`} style={{ color: leader ? col(leader) : "var(--c-text)" }}>{Math.abs(gap).toFixed(3)} s</div>
      <div className="text-xs text-light">{leader ? `${nm(leader)} ahead` : "level"}{gaining ? ` · ${nm(gaining)} gaining` : ""}</div>
    </div>
  ) : null;

  // Each sector fills in once lap A has passed its end; the one it is in runs
  // live, quietly; the ones ahead wait.
  const sectorMax = sectors ? Math.max(50, ...sectors.map((s) => Math.abs(s.deltaMs))) : 50;
  const sectorTiles = lapB && prefs.sectors && sectors?.length ? (
    <div className="grid min-w-0 grid-cols-3 gap-1.5">
      {sectors.map((s) => {
        const done = iA >= s.to;
        const ms = done ? s.deltaMs : iA >= s.from ? gapMs(iA) - gapMs(s.from) : null;
        const c = done && Math.abs(ms) >= 5 ? col(who(ms)) : null;
        return (
          <div key={s.n} className="min-w-0 rounded-lg border border-border px-2 py-1.5">
            <div className="flex items-center justify-between gap-1 text-[11px]">
              <span className="font-semibold text-dark">S{s.n}</span>
              <span className="flex min-w-0 items-center gap-1">
                {c && <Dot color={c} />}
                <span className={`font-mono tabular-nums ${done ? "font-bold text-dark" : "text-light"}`} style={c ? { color: c } : undefined}>{ms == null ? "—" : fmt(ms)}</span>
              </span>
            </div>
            <DivergingBar value={done ? s.deltaMs : 0} max={sectorMax} colorA={colorA} colorB={colorB} className="mt-1.5 h-1" />
          </div>
        );
      })}
    </div>
  ) : null;

  // The car behind shows how far behind; the one in front its lap clock.
  const behind = (s) => (lapB && leader && leader !== s ? `+${Math.abs(gap).toFixed(3)}` : null);
  // Side by side over the view; one above the other in the narrow side panel.
  const cars = prefs.cars ? (
    <div className={`grid min-w-0 gap-x-4 gap-y-3 ${lapB && !side ? "grid-cols-2" : "grid-cols-1"}`}>
      <CarColumn lap={lapA} i={iA} side="A" name={nameA} color={colorA} aside={behind("A") ?? formatLapTime(lapA.t[iA])} size="text-2xl" />
      {lapB && <CarColumn lap={lapB} i={iB} side="B" name={nameB} color={colorB} aside={behind("B") ?? formatLapTime(lapB.t[iB])} size="text-2xl" />}
    </div>
  ) : null;

  const even = next?.gainMs == null || Math.abs(next.gainMs) < 10;
  const facts = next && lapB ? sectionFacts(next, { a: nameA, b: nameB }).slice(0, 2).join(" · ") : "";
  const corner = prefs.corner && next ? (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold text-dark">{inside ? "This corner" : "Next corner"}</span>
        {toGo != null && toGo >= 0 && <span className="font-mono tabular-nums text-light">{toGo.toLocaleString("en-GB")} m</span>}
      </div>
      <p className="mt-1 truncate text-sm text-dark" title={next.label}>
        {next.named && <span className="mr-1.5 rounded bg-surface2 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-medium">{next.tag}</span>}
        {next.named ? next.label.replace(/^\S+\s*/, "") || next.label : next.label}
      </p>
      {lapB && next.gainMs != null && (
        <p className="mt-1 text-sm text-dark">
          {even ? "Even through here" : <><span className="font-semibold" style={{ color: col(who(next.gainMs)) }}>{nm(who(next.gainMs))}</span> gains {fmt(next.gainMs)} s here</>}
        </p>
      )}
      {facts && <p className="mt-0.5 text-xs leading-snug text-light">{facts}</p>}
    </div>
  ) : null;

  const map = prefs.map && lapA?.x ? (
    <MiniMap lapA={lapA} lapB={lapB} n={n} iA={iA} iB={iB} ring={prefs.corner && next ? next.apex : null} colorA={colorA} colorB={colorB} />
  ) : null;

  if (!gapBlock && !sectorTiles && !cars && !corner && !map) return null;

  if (side) {
    return (
      <Panel title="At cursor" note={where} className={className} bodyClassName="grid gap-4">
        {gapBlock}
        {sectorTiles}
        {cars}
        {(corner || map) && (
          <div className={`grid items-start gap-3 ${gapBlock || sectorTiles || cars ? "border-t border-border pt-3" : ""} ${corner && map ? "grid-cols-[minmax(0,1fr)_6rem]" : ""}`}>
            {corner}
            {map && <div className="ml-auto h-24 w-24">{map}</div>}
          </div>
        )}
      </Panel>
    );
  }

  if (placement === "bar") {
    return (
      <div className="pointer-events-none absolute inset-0">
        {map && <div className="card absolute right-2 top-2 h-32 w-32 p-1.5">{map}</div>}
        {(gapBlock || sectorTiles || cars || corner) && (
          <div className="card absolute inset-x-2 bottom-2 flex flex-wrap items-stretch divide-x divide-border">
            {gapBlock && <div className="min-w-[9.5rem] flex-none p-3">{gapBlock}</div>}
            {sectorTiles && <div className="min-w-[13rem] flex-1 p-3"><div className="mb-1.5 text-xs font-semibold text-dark">Sectors</div>{sectorTiles}</div>}
            {cars && <div className="min-w-[20rem] flex-[1.4] p-3">{cars}</div>}
            {corner && <div className="min-w-[13rem] flex-1 p-3">{corner}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {(gapBlock || sectorTiles || map) && (
        <div className="absolute right-2 top-2 flex w-[16.5rem] flex-col items-end gap-2">
          {(gapBlock || sectorTiles) && (
            <div className="card w-full p-3">
              {gapBlock}
              {sectorTiles && <div className={gapBlock ? "mt-3 border-t border-border pt-3" : ""}>{sectorTiles}</div>}
            </div>
          )}
          {map && <div className="card h-36 w-36 p-1.5">{map}</div>}
        </div>
      )}
      {cars && <div className="card absolute bottom-2 left-2 w-[25rem] max-w-[calc(100%-18.5rem)] p-3">{cars}</div>}
      {corner && <div className="card absolute bottom-2 right-2 w-[16.5rem] p-3">{corner}</div>}
    </div>
  );
}
