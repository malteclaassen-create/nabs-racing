/**
 * Scratch tool: a plan view of what the roadside barrier carries -- the access
 * gates and the marshalling panels -- drawn from the REAL triangles the mesh
 * builder emits rather than from the numbers it was meant to use.
 * Writes tmp/barrier.svg.
 *
 *   node --import ./tools/ts-resolve.mjs tools/plot-barrier.mjs [demo|medium]
 *
 * Seen from above, a gate should read as a break in the barrier with a second
 * length of it standing further out, overlapping the break at both ends. If
 * the two runs meet end to end with no overlap, or the break is not there at
 * all, this is where it shows.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

import { defaultProject, generatedProject } from '../src/store/store.ts';
import { computeFrames } from '../src/core/spline.ts';
import { buildRoadMeshes } from '../src/core/road.ts';

/** What each part looks like from above. Anything unlisted is skipped. */
const PAINT = {
  asphalt: '#3a3d42',
  concrete: '#8d8f94',
  line_white: '#f5f5f5',
  grass: '#2f5d2f',
  sand: '#9c8a68',
};

/** The parts this plot is actually about, picked out by mesh name. */
const HILITE = [
  [/_gate(_|$)/, '#e08a2c', 'barrier behind the opening'],
  [/^1WALL_/, '#dfe4e8', 'barrier'],
  [/^1OBJ_flagpanel_\w+_case$/, '#2a2d31', 'panel casing'],
  [/^1OBJ_flagpanel/, '#2fe264', 'panel screen'],
];

const which = process.argv[2] ?? 'demo';
const project = which === 'demo' ? defaultProject() : generatedProject(which);
for (const n of project.track.nodes) {
  n.wallL = true;
  n.wallR = true;
}
const frames = computeFrames(project.track, project.road.samplesPerSegment);
const defs = buildRoadMeshes(frames, project.track.closed, project.road, []);

function triangles() {
  const out = [];
  for (const d of defs) {
    const hit = HILITE.find(([re]) => re.test(d.name));
    const fill = hit ? hit[1] : PAINT[d.material];
    if (!fill) continue;
    const pos = d.geometry.getAttribute('position');
    const idx = d.geometry.getIndex();
    const range = d.geometry.drawRange;
    const total = idx ? idx.count : pos.count;
    const count = range.count === Infinity ? total : Math.min(range.count, total - range.start);
    for (let k = 0; k + 2 < count; k += 3) {
      const p = [];
      const y = [];
      for (let o = 0; o < 3; o++) {
        const i = idx ? idx.getX(range.start + k + o) : range.start + k + o;
        p.push([pos.getX(i), pos.getZ(i)]);
        y.push(pos.getY(i));
      }
      out.push({ p, y: (y[0] + y[1] + y[2]) / 3, fill });
    }
  }
  // Painter's algorithm: seen from above, whatever is higher wins.
  out.sort((u, v) => u.y - v.y);
  return out;
}

/** The frame nearest a given distance into the lap. */
const frameAt = (s) => frames.reduce((b, f) => (Math.abs(f.dist - s) < Math.abs(b.dist - s) ? f : b), frames[0]);

const tris = triangles();

function panel(title, centre, halfSpan, ox, oy, size, arrow) {
  const scale = size / (halfSpan * 2);
  const id = title.replace(/[^a-z]/gi, '');
  const parts = [
    `<g transform="translate(${ox},${oy})">`,
    `<clipPath id="c${id}"><rect width="${size}" height="${size}" rx="4"/></clipPath>`,
    `<g clip-path="url(#c${id})">`,
    `<rect width="${size}" height="${size}" fill="${PAINT.grass}"/>`,
    `<g transform="translate(${size / 2},${size / 2}) scale(${scale},${scale}) translate(${-centre[0]},${-centre[1]})">`,
  ];
  const r = halfSpan * 1.6;
  for (const t of tris) {
    if (!t.p.some(([x, z]) => Math.abs(x - centre[0]) < r && Math.abs(z - centre[1]) < r)) continue;
    const pts = t.p.map(([x, z]) => `${x.toFixed(2)},${z.toFixed(2)}`).join(' ');
    parts.push(`<polygon points="${pts}" fill="${t.fill}" stroke="${t.fill}" stroke-width="0.04"/>`);
  }
  parts.push('</g>');
  /* Which way the cars go. Without it a plan view says nothing about whether
     the slot faces forwards or backwards, which is the whole question here. */
  if (arrow) {
    const px = (wx, wz) => [size / 2 + (wx - centre[0]) * scale, size / 2 + (wz - centre[1]) * scale];
    const [x0, y0] = px(arrow.x - arrow.dx * 9, arrow.z - arrow.dz * 9);
    const [x1, y1] = px(arrow.x + arrow.dx * 9, arrow.z + arrow.dz * 9);
    parts.push(`<defs><marker id="head${id}" markerWidth="6" markerHeight="6" refX="5" refY="3"`
      + ` orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#e8e8ea"/></marker></defs>`);
    parts.push(`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"`
      + ` stroke="#e8e8ea" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#head${id})"/>`);
    parts.push(`<text x="${x1.toFixed(1)}" y="${(y1 - 8).toFixed(1)}" fill="#e8e8ea"`
      + ` font-family="system-ui, sans-serif" font-size="12">driving direction</text>`);
    // The two ends of the set-back run, called what they are.
    for (const [wx, wz, label, colour] of arrow.marks ?? []) {
      const [mx, my] = px(wx, wz);
      parts.push(`<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="4" fill="none"`
        + ` stroke="${colour}" stroke-width="2"/>`);
      parts.push(`<text x="${(mx + 9).toFixed(1)}" y="${(my + 4).toFixed(1)}" fill="${colour}"`
        + ` font-family="system-ui, sans-serif" font-size="12">${label}</text>`);
    }
  }
  parts.push('</g>');
  parts.push(`<rect x="8" y="8" width="${title.length * 7 + 14}" height="22" rx="3" fill="#121316" opacity="0.85"/>`);
  parts.push(`<text x="15" y="23" fill="#e6e6e6" font-family="system-ui, sans-serif" font-size="13">${title}</text>`);
  parts.push('</g>');
  return parts.join('\n');
}

const lap = frames[frames.length - 1].dist;
/* Centred on the gate itself -- the set-back piece only exists at one -- so
   the plan view can be zoomed in far enough to read.
 */
const behindMesh = defs.find((d) => /_gate$/.test(d.name));
const bp = behindMesh.geometry.getAttribute('position');
/* The FIRST gate, not the average of them: a circuit with fourteen of them
   averages out to a point in a field with nothing on it. */
const gate = { pos: { x: bp.getX(0), z: bp.getZ(0) } };
/* Centred on a panel the builder really emitted, not on where one was meant
   to be: a plot that centres on the intention shows an empty field when the
   thing is missing, which is the one case worth looking at. */
const screen = defs.find((d) => /^1OBJ_flagpanel_\w+$/.test(d.name));
const screenPos = screen.geometry.getAttribute('position');
const panelAt = { pos: { x: screenPos.getX(0), z: screenPos.getZ(0) } };
const S = 420;
const PAD = 12;
const legend = HILITE.map(([, colour, label], i) =>
  `<rect x="${PAD + i * 210}" y="${S + PAD + 10}" width="12" height="12" fill="${colour}"/>`
  + `<text x="${PAD + i * 210 + 18}" y="${S + PAD + 20}" fill="#c8ccd0" font-family="system-ui, sans-serif"`
  + ` font-size="12">${label}</text>`).join('\n');

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${S * 2 + PAD * 3}" height="${S + PAD * 2 + 34}"`
  + ` viewBox="0 0 ${S * 2 + PAD * 3} ${S + PAD * 2 + 34}">`,
  `<rect width="100%" height="100%" fill="#17181b"/>`,
  panel(`access gate, plan view`, [gate.pos.x, gate.pos.z], 13, PAD, PAD, S, {
    x: gate.pos.x,
    z: gate.pos.z,
    ...(() => {
      const f = frames.reduce((b, q) => {
        const d = (q.pos.x - gate.pos.x) ** 2 + (q.pos.z - gate.pos.z) ** 2;
        return d < (b.pos.x - gate.pos.x) ** 2 + (b.pos.z - gate.pos.z) ** 2 ? q : b;
      }, frames[0]);
      /* The two ends of the set-back run, told apart by the driving direction:
         the one further back is where the slot is open, the one further on is
         where it overlaps the barrier in front. */
      let lo = null;
      let hi = null;
      let loD = Infinity;
      let hiD = -Infinity;
      for (let i = 0; i < bp.count; i++) {
        const dx = bp.getX(i) - gate.pos.x;
        const dz = bp.getZ(i) - gate.pos.z;
        if (Math.hypot(dx, dz) > 40) continue;
        const along = dx * f.fwd.x + dz * f.fwd.z;
        if (along < loD) { loD = along; lo = [bp.getX(i), bp.getZ(i)]; }
        if (along > hiD) { hiD = along; hi = [bp.getX(i), bp.getZ(i)]; }
      }
      return {
        dx: f.fwd.x,
        dz: f.fwd.z,
        marks: [
          [...lo, 'open here (rear)', '#ffd21e'],
          [...hi, 'overlaps the barrier', '#7fd4ff'],
        ],
      };
    })(),
  }),
  panel('a marshalling panel on the barrier', [panelAt.pos.x, panelAt.pos.z], 9, PAD * 2 + S, PAD, S),
  legend,
  '</svg>',
].join('\n');

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/barrier.svg', svg);
console.log(`wrote tmp/barrier.svg (${tris.length} triangles, lap ${lap.toFixed(0)} m)`);
