// The recap's contact map: the circuit as the cars drove it (its AI line, the
// shape the game's own map is drawn around), the driver's contacts and wall
// hits numbered on it, and the rest of the field's contacts as plain dots.
//
// The list beside the map is the one the recap always had (lap, the other car,
// how hard), with the number that finds the spot on the map and the corner it
// happened at. Hovering either side lights up the other.
//
// The field is drawn without names, and so is what it is: where cars came
// together tonight. Who touched whom is a matter for the stewards, and the
// car that was hit records the same contact as the one that did the hitting
// (backend lib/contactMap.js).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, Card, Label } from "./parts.jsx";

// km/h from which a contact reads as a proper hit rather than a touch. The
// same bands the recap's contact list has always coloured by.
const hardText = (kph) => (kph >= 60 ? "text-bad" : kph >= 25 ? "text-warn" : "text-light");

// The circuit's bounding box with room round the edge for the markers, in the
// line's own world metres. x runs right, z runs down: the way the game draws
// its own track map, so the circuit is the right way round.
function frame(line) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of line) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 1);
  const pad = span * 0.11;
  return { x: minX - pad, y: minZ - pad, w: maxX - minX + pad * 2, h: maxZ - minZ + pad * 2, span };
}

// How far a point is from the line (to its nearest point; the line has one
// every few metres, which is close enough for placing a word).
function distToLine(line, p) {
  let best = Infinity;
  for (const q of line) {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < best) best = d;
  }
  return best;
}

// Which way is "outside" at a point of the line: away from the middle of the
// circuit's box. A corner's name is written there, clear of the track.
function outward(line, pos, box) {
  let k = 0;
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const d = Math.hypot(line[i][0] - pos[0], line[i][1] - pos[1]);
    if (d < best) {
      best = d;
      k = i;
    }
  }
  const a = line[(k - 1 + line.length) % line.length];
  const b = line[(k + 1) % line.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let nx = -(b[1] - a[1]) / len;
  let nz = (b[0] - a[0]) / len;
  const cx = box.x + box.w / 2;
  const cz = box.y + box.h / 2;
  if ((pos[0] - cx) * nx + (pos[1] - cz) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  return [nx, nz];
}

// Where each numbered marker is drawn: beside the track rather than on it, on
// the outside, with a short line back to the spot it happened at. On the spot
// itself it would cover the rest of the field's contacts there, and a corner
// where several cars came together is exactly the one worth seeing. Two
// numbers that would overlap step round their spot to the first free place.
function layout(mine, r, line, box) {
  const placed = [];
  const gap = r * 2.2;
  const reach = r * 2.3;
  for (const m of mine) {
    if (!m.pos) continue;
    const [x, z] = m.pos;
    const [nx, nz] = outward(line, m.pos, box);
    const base = Math.atan2(nz, nx);
    const clear = (p) => placed.every((q) => Math.hypot(q.at[0] - p[0], q.at[1] - p[1]) >= gap);
    let at = [x + nx * reach, z + nz * reach];
    if (!clear(at)) {
      outer: for (const dist of [reach, reach * 1.7, reach * 2.4]) {
        for (const turn of [0.5, -0.5, 1, -1, 1.5, -1.5]) {
          const a = base + turn;
          const p = [x + Math.cos(a) * dist, z + Math.sin(a) * dist];
          if (clear(p)) {
            at = p;
            break outer;
          }
        }
      }
    }
    placed.push({ m, at });
  }
  return placed;
}

// One marker: a filled circle for a car, a filled square for the scenery,
// the number on it in the colour that reads on the team colour.
function Marker({ kind, x, y, r, n, active, dim }) {
  const s = active ? 1.28 : 1;
  const common = {
    fill: "var(--recap-team)",
    stroke: "var(--c-card)",
    strokeWidth: r * 0.28,
    paintOrder: "stroke",
  };
  return (
    <g
      className="rr-cm-marker"
      style={{ transform: `translate(${x}px, ${y}px) scale(${s})`, opacity: dim ? 0.45 : 1 }}
    >
      {active && <circle r={r * 1.55} fill="none" stroke="var(--recap-team)" strokeWidth={r * 0.16} opacity="0.55" />}
      {kind === "wall" ? <rect x={-r * 0.92} y={-r * 0.92} width={r * 1.84} height={r * 1.84} rx={r * 0.32} {...common} /> : <circle r={r} {...common} />}
      {/* A hairline round the shape, so a white or very pale team colour
          still stands off a light card. */}
      {kind === "wall" ? (
        <rect x={-r * 0.92} y={-r * 0.92} width={r * 1.84} height={r * 1.84} rx={r * 0.32} fill="none" stroke="var(--c-text)" strokeOpacity="0.28" strokeWidth={r * 0.07} />
      ) : (
        <circle r={r} fill="none" stroke="var(--c-text)" strokeOpacity="0.28" strokeWidth={r * 0.07} />
      )}
      <text
        y={r * 0.36}
        textAnchor="middle"
        fontSize={r * (n > 9 ? 0.9 : 1.05)}
        fontWeight="800"
        fill="var(--recap-ink)"
        className="font-mono"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {n}
      </text>
    </g>
  );
}

function TrackSvg({ map, active, onActive }) {
  const { line, field, mine, labels = [] } = map;
  const box = useMemo(() => frame(line), [line]);
  const d = useMemo(() => `M${line.map(([x, z]) => `${x} ${z}`).join("L")}Z`, [line]);
  // Sizes in the drawing's own units, set against the circuit's size, so a
  // 3 km street circuit and a 7 km one look the same on the page.
  const road = box.span * 0.022;
  const r = box.span * 0.028;
  const dot = box.span * 0.0105;
  const font = box.span * 0.03;
  const placed = useMemo(() => layout(mine, r, line, box), [mine, r, line, box]);
  const names = useMemo(
    () =>
      labels.map((l) => {
        // On the inside of the track first (the outside is where the numbers
        // go), unless that lands on another part of the road, as it does in
        // a hairpin; then further in, then the outside.
        const [ox, oz] = outward(line, l.pos, box);
        const base = road * 1.1 + font * 0.9;
        const clearOf = road * 0.6 + font * 0.6;
        const tries = [
          [-ox, -oz, base],
          [-ox, -oz, base * 1.7],
          [ox, oz, base],
          [ox, oz, base * 1.7],
        ];
        let at = null;
        for (const [nx, nz, off] of tries) {
          const p = [l.pos[0] + nx * off, l.pos[1] + nz * off];
          if (distToLine(line, p) >= clearOf) {
            at = p;
            break;
          }
        }
        if (!at) at = [l.pos[0] - ox * base, l.pos[1] - oz * base];
        return { ...l, x: at[0], y: at[1] + font * 0.35 };
      }),
    [labels, line, box, road, font]
  );

  // The start line: a short bar across the track at its first point.
  const [x0, z0] = line[0];
  const [x1, z1] = line[1];
  const len = Math.hypot(x1 - x0, z1 - z0) || 1;
  const nx = -(z1 - z0) / len;
  const nz = (x1 - x0) / len;
  const bar = road * 0.95;

  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      className="block h-auto max-h-[460px] w-full"
      role="img"
      aria-label={`Circuit map with ${mine.length} of your incidents and ${field.length} other contacts`}
    >
      {/* The road: a band in the text colour, faint, so it reads on the dark
          card and the light one alike; the line itself drawn over it from the
          start line round the lap. */}
      <path d={d} fill="none" stroke="var(--c-text)" strokeOpacity="0.13" strokeWidth={road} strokeLinejoin="round" strokeLinecap="round" />
      <path
        d={d}
        pathLength="1"
        className="chart-line"
        fill="none"
        stroke="var(--c-text)"
        strokeOpacity="0.4"
        strokeWidth={road * 0.14}
        strokeLinejoin="round"
      />
      <line
        x1={x0 + nx * bar}
        y1={z0 + nz * bar}
        x2={x0 - nx * bar}
        y2={z0 - nz * bar}
        stroke="var(--c-text)"
        strokeWidth={road * 0.3}
        strokeLinecap="round"
      />

      {/* The corners that matter tonight, by number. */}
      <g className="rr-cm-field">
        {names.map((l) => (
          <text
            key={l.text}
            x={l.x}
            y={l.y}
            textAnchor="middle"
            fontSize={font}
            fontWeight="700"
            fill="var(--c-text3)"
            className="font-mono"
            style={{ letterSpacing: "0.04em" }}
          >
            {l.text}
          </text>
        ))}
      </g>

      {/* Everybody else: where cars touched tonight, a touch bigger the
          harder they hit. */}
      <g className="rr-cm-field">
        {field.map(([x, z, kph], i) => (
          <circle
            key={i}
            cx={x}
            cy={z}
            r={dot * (kph >= 60 ? 1.6 : kph >= 25 ? 1.3 : 1)}
            fill="var(--c-text2)"
            fillOpacity="0.75"
            stroke="var(--c-card)"
            strokeWidth={dot * 0.35}
          />
        ))}
      </g>

      {/* The driver's own, numbered as in the list. */}
      <g className="rr-cm-mine">
        {placed.map(({ m, at }) => (
          <g key={`l${m.n}`} style={{ opacity: active != null && active !== m.n ? 0.45 : 1 }}>
            <line x1={m.pos[0]} y1={m.pos[1]} x2={at[0]} y2={at[1]} stroke="var(--recap-team)" strokeWidth={r * 0.09} />
            <circle cx={m.pos[0]} cy={m.pos[1]} r={r * 0.27} fill="var(--recap-team)" stroke="var(--c-card)" strokeWidth={r * 0.1} />
          </g>
        ))}
        {placed.map(({ m, at }) => (
          <g
            key={m.n}
            onMouseEnter={() => onActive(m.n)}
            onMouseLeave={() => onActive(null)}
            onClick={() => onActive(active === m.n ? null : m.n)}
            style={{ cursor: "pointer" }}
          >
            <Marker kind={m.kind} x={at[0]} y={at[1]} r={r} n={m.n} active={active === m.n} dim={active != null && active !== m.n} />
          </g>
        ))}
      </g>
    </svg>
  );
}

// The whole field's contacts by corner, most first: where the race went
// wrong for people, which the map shows as clusters and this says in numbers.
function ByCorner({ rows: cornerRows, total, elsewhere = 0 }) {
  if (!cornerRows?.length) return null;
  // Contacts away from any named corner close the table, so it adds up.
  const rows = elsewhere > 0 ? [...cornerRows, { corner: "Away from a corner", count: elsewhere }] : cornerRows;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <Label tone="text-light">The whole field, by corner</Label>
        <span className="font-mono text-[11px] tabular-nums text-light">{total} in all</span>
      </div>
      <ol className="recap-cascade mt-3 space-y-2">
        {rows.map((r, i) => (
          <li key={r.corner} className="grid grid-cols-[minmax(0,7.5rem),1fr,2rem] items-center gap-3" style={{ "--i": i }}>
            <span className="truncate font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-medium">{r.corner}</span>
            <Bar pct={(r.count / max) * 100} h="h-1.5" fill="bg-light" cursor={false} delay={200 + i * 90} />
            <span className="text-right font-mono text-sm font-bold tabular-nums text-dark">{r.count}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// The small key under the map, in the same shapes the map uses.
function Key({ mineCars, mineWalls, field }) {
  const sw = "inline-block shrink-0";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-light">
      {mineCars > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className={`${sw} h-2.5 w-2.5 rounded-full`} style={{ background: "var(--recap-team)", boxShadow: "0 0 0 1px rgb(15 23 42 / 0.2)" }} />
          You, with a car
        </span>
      )}
      {mineWalls > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className={`${sw} h-2.5 w-2.5 rounded-[3px]`} style={{ background: "var(--recap-team)", boxShadow: "0 0 0 1px rgb(15 23 42 / 0.2)" }} />
          You, with the scenery
        </span>
      )}
      {field > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className={`${sw} h-1.5 w-1.5 rounded-full bg-medium opacity-60`} />
          The rest of the field
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className={`${sw} h-2.5 w-[3px] rounded-full bg-dark`} />
        Start line
      </span>
    </div>
  );
}

// One line of the list: the number that finds it on the map, the lap and the
// corner, the other car (or the scenery), how hard.
function Line({ m, active, onActive, index }) {
  // Only a line with a spot on the map lights one up.
  const on = m.pos ? () => onActive(m.n) : undefined;
  const off = m.pos ? () => onActive(null) : undefined;
  return (
    <li
      className={`flex items-stretch overflow-hidden rounded-lg border bg-surface2/60 transition-colors ${active ? "border-[color:var(--recap-team)]" : "border-border"}`}
      style={{ "--i": index }}
      onMouseEnter={on}
      onMouseLeave={off}
      onFocus={on}
      onBlur={off}
      tabIndex={m.pos ? 0 : -1}
    >
      <span className="flex w-11 shrink-0 items-center justify-center">
        <span
          className={`flex h-6 w-6 items-center justify-center font-mono text-[11px] font-extrabold tabular-nums ${m.kind === "wall" ? "rounded-[5px]" : "rounded-full"} ${m.pos ? "" : "opacity-50"}`}
          style={{ background: "var(--recap-team)", color: "var(--recap-ink)", boxShadow: "0 0 0 1px rgb(15 23 42 / 0.18)" }}
          title={m.pos ? undefined : "Not on the map: the file has no position for this one"}
        >
          {m.n}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center py-2 pr-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-light">
          Lap {m.lap ?? "?"}
          {m.corner ? ` · ${m.corner}` : ""}
          {m.counted === false && <span className="ml-1.5 normal-case tracking-normal text-faint">light tap, not counted</span>}
        </span>
        <span className="truncate font-display text-base font-extrabold uppercase leading-tight tracking-tight text-dark">
          {m.kind === "wall" ? (
            "The scenery"
          ) : m.driverId ? (
            <Link to={`/drivers/${m.driverId}`} className="transition hover:text-brand">
              {m.name}
            </Link>
          ) : (
            m.name
          )}
        </span>
      </span>
      {m.kph != null && <span className={`flex items-center pr-3 font-mono text-sm font-bold tabular-nums ${hardText(m.kph)}`}>{m.kph} km/h</span>}
    </li>
  );
}

// What the stewards made of it, said the way the recap always said it.
function stewardLine(you, cars) {
  if (you.penaltySeconds > 0) return `The stewards gave you +${you.penaltySeconds}s.`;
  if (cars > 0) return "No penalty from the stewards.";
  if (you.gamePenalties > 0) return `${you.gamePenalties} in-game penalt${you.gamePenalties === 1 ? "y" : "ies"} for track limits.`;
  return "Nothing for the stewards to look at.";
}

// The whole race in one line: how many contacts, and where most of them were.
function fieldLine(map) {
  const n = map.fieldCount || 0;
  if (n === 0) return "No other contact in the whole race.";
  if (map.byCorner?.length) return null; // the table under the list says it
  return `${n} contact${n === 1 ? "" : "s"} in the whole race.`;
}

export default function ContactMapCard({ incidents, you }) {
  const map = incidents.map;
  const [active, setActive] = useState(null);
  // The count the season's figures use: from 10 km/h. Lighter taps are in
  // the list, marked, and said apart here.
  const cars = map.mine.filter((m) => m.kind === "car" && m.counted !== false).length;
  const taps = map.mine.filter((m) => m.kind === "car" && m.counted === false).length;
  const walls = map.mine.filter((m) => m.kind === "wall").length;

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>Your incidents</Label>
        <span className="font-mono text-[11px] text-light">
          {cars} car contact{cars === 1 ? "" : "s"}
          {walls > 0 ? ` · ${walls} with the scenery` : ""}
          {taps > 0 ? ` · ${taps} light tap${taps === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[1.35fr,1fr] lg:items-start">
        <figure className="min-w-0">
          <TrackSvg map={map} active={active} onActive={setActive} />
          <figcaption className="mt-2.5">
            <Key mineCars={cars} mineWalls={walls} field={map.field.length} />
          </figcaption>
        </figure>
        <div className="min-w-0">
          {map.mine.length === 0 ? (
            <p className="recap-pop font-display text-xl font-extrabold uppercase tracking-tight text-ok">A clean race. No contact with another car.</p>
          ) : (
            <ol className="recap-cascade space-y-2">
              {map.mine.map((m, i) => (
                <Line key={m.n} m={m} index={i} active={active === m.n} onActive={setActive} />
              ))}
            </ol>
          )}
          <div className="recap-tag mt-3 space-y-1 text-xs text-light">
            <p>{stewardLine(you, cars)}</p>
            {fieldLine(map) && <p>{fieldLine(map)}</p>}
          </div>
          <ByCorner rows={map.byCorner} total={map.fieldCount} elsewhere={map.elsewhere || 0} />
        </div>
      </div>
    </Card>
  );
}
