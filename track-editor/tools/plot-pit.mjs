/**
 * Scratch tool: a plan view of the pit lane junction, rasterised from the REAL
 * triangles the mesh builders emit rather than from the widths they were meant
 * to use. Writes tmp/pit-junction.svg.
 *
 *   node --import ./tools/ts-resolve.mjs tools/plot-pit.mjs [demo|short|medium|long]
 */
import { writeFileSync, mkdirSync } from 'node:fs';

import { defaultProject, generatedProject } from '../src/store/store.ts';
import { computeFrames } from '../src/core/spline.ts';
import { attachPitLane, mergePitFrames, pitLead, pitRoadClip, pitTrackLines } from '../src/core/pitLink.ts';
import { sideProfile, buildRoadMeshes, buildPitMeshes } from '../src/core/road.ts';

/** What each material looks like from above. Anything unlisted is skipped. */
const PAINT = {
  asphalt: '#3a3d42',
  concrete: '#8d8f94',
  line_white: '#f5f5f5',
  line_dashed: '#f5f5f5',
  kerb_red: '#b23b34',
  kerb_blue: '#3b5aa8',
  grass: '#2f5d2f',
  gravel: '#9c8a68',
  sand: '#9c8a68',
};

/* One project for both builds. Generating it twice gives two DIFFERENT random
   circuits, so the before and after panels showed different tracks -- which is
   how "before" came out as an empty field. */
function makeProject(which) {
  const project = which === 'demo' ? defaultProject() : generatedProject(which);
  if (which === 'demo') {
    const frames = computeFrames(project.track, project.road.samplesPerSegment);
    const link = attachPitLane(project.pit, frames, true);
    if (link) project.pit.nodes = link.nodes;
  }
  return project;
}

function build(project, withLead) {
  const spp = project.road.samplesPerSegment;
  const trackFrames = computeFrames(project.track, spp);
  const pitRaw = computeFrames(project.pit, spp);
  const pitFrames = mergePitFrames(pitRaw, trackFrames, project.road.pitGap).frames;

  const lead = withLead
    ? pitLead(pitRaw, trackFrames, project.pit.closed, project.track.closed)
    : { frames: pitRaw, from: 0, to: pitRaw.length - 1, length: pitRaw[pitRaw.length - 1].dist };
  const drawFrames = lead.frames === pitRaw
    ? pitFrames
    : mergePitFrames(lead.frames, trackFrames, project.road.pitGap).frames;
  // The profile sees the drawn ribbon, wedges included, as the app does.
  const profile = sideProfile(trackFrames, project.road, drawFrames, project.track.closed);
  const clip = pitRoadClip(
    drawFrames, trackFrames, project.track.closed, profile.kerbWL, profile.kerbWR,
    undefined, withLead ? { from: lead.from, to: lead.to } : undefined,
  );

  const lines = withLead ? pitTrackLines(lead, clip, trackFrames, project.track.closed) : [];
  const defs = [
    ...buildRoadMeshes(trackFrames, project.track.closed, project.road, pitFrames, undefined, profile, lines),
    ...buildPitMeshes(drawFrames, project.pit.closed, project.road, undefined, clip,
      project.pitCfg.limitStart, project.pitCfg.limitEnd, lead.from, lead.to, lead.length),
  ];
  return { defs, drawFrames, lead, trackFrames };
}

/** Every triangle of every mesh, in world space, with its colour and height. */
function triangles(defs) {
  const out = [];
  for (const d of defs) {
    const fill = process.env.PIT_HILITE && /line_pit|1PIT_line/.test(d.name) ? '#ff35c8' : PAINT[d.material];
    if (!fill) continue;
    const pos = d.geometry.getAttribute('position');
    const idx = d.geometry.getIndex();
    const range = d.geometry.drawRange;
    const total = idx ? idx.count : pos.count;
    const count = range.count === Infinity ? total : Math.min(range.count, total - range.start);
    for (let k = 0; k + 2 < count; k += 3) {
      const a = [], y = [];
      for (let o = 0; o < 3; o++) {
        const i = idx ? idx.getX(range.start + k + o) : range.start + k + o;
        a.push([pos.getX(i), pos.getZ(i)]);
        y.push(pos.getY(i));
      }
      out.push({ p: a, y: (y[0] + y[1] + y[2]) / 3, fill });
    }
  }
  // Painter's algorithm: seen from above, whatever is higher wins.
  out.sort((u, v) => u.y - v.y);
  return out;
}

function panel(title, tris, centre, halfSpan, ox, oy, size) {
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
    // Hairline stroke in the same colour: neighbouring triangles otherwise
    // show the background through the seam at this scale.
    const pts = t.p.map(([x, z]) => `${x.toFixed(2)},${z.toFixed(2)}`).join(' ');
    parts.push(`<polygon points="${pts}" fill="${t.fill}" stroke="${t.fill}" stroke-width="0.03"/>`);
  }
  parts.push('</g></g>');
  parts.push(`<rect x="8" y="8" width="${title.length * 7 + 14}" height="22" rx="3" fill="#121316" opacity="0.8"/>`);
  parts.push(`<text x="15" y="23" fill="#e6e6e6" font-family="system-ui, sans-serif" font-size="13">${title}</text>`);
  parts.push('</g>');
  return parts.join('\n');
}

const which = process.argv[2] ?? 'demo';
const project = makeProject(which);
const now = build(project, true);
const was = build(project, false);
const first = now.drawFrames[now.lead.from];
const last = now.drawFrames[now.lead.to];
const tNow = triangles(now.defs);
const tWas = triangles(was.defs);

const W = 385;
const H = 385;
const PAD = 12;
const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2 + PAD * 3}" height="${H + PAD * 2 + 24}" viewBox="0 0 ${W * 2 + PAD * 3} ${H + PAD * 2 + 24}">`,
  '<rect width="100%" height="100%" fill="#121316"/>',
  panel('Pit entry', tNow, [first.pos.x, first.pos.z], 60, PAD, PAD, W, H),
  panel('Pit exit', tNow, [last.pos.x, last.pos.z], 60, PAD * 2 + W, PAD, W, H),
  `<text x="${PAD}" y="${H + PAD * 2 + 16}" fill="#9a9ca1" font-family="system-ui, sans-serif" font-size="12">${which}: every triangle the mesh builders emit, seen from above, painted by material</text>`,
  '</svg>',
].join('\n');

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/pit-junction.svg', svg);
console.log(`wrote tmp/pit-junction.svg (${tNow.length} triangles)`);
