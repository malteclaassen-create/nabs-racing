import { unzlibSync, zlibSync } from 'fflate';
import type { AcEdits, AcImport, BarrierCut, DecoRoad, KerbSpan, PathData, Project, RoadSettings } from '../types';
import { defaultProject } from '../store/store';
import { normalizeNode } from '../core/spline';
import { GROUND_KINDS, paintRes } from '../core/terrain';
import { kerbsFromNodeFlags, normalizeKerbSpan } from '../core/kerbs';
import { arrayBufferToBase64, base64ToArrayBuffer } from './assetCache';

/**
 * Project save / load. One JSON file holds the whole track including imported
 * models, so a project is a single portable document.
 */

const FILE_EXT = '.actrack.json';

export function serializeProject(p: Project): string {
  const heights = arrayBufferToBase64(
    p.terrain.heights.buffer.slice(
      p.terrain.heights.byteOffset,
      p.terrain.heights.byteOffset + p.terrain.heights.byteLength,
    ) as ArrayBuffer,
  );
  /*
   * The paint field is deflated first, and that is not a nicety.
   *
   * It is a megabyte of bytes that are nearly all the same one -- grass, or the
   * inside of a patch -- which deflates to a few kilobytes. Raw, base64 of it
   * alone is 1.4 MB, and the autosave writes the whole project into
   * localStorage every few seconds against a quota of about five. The autosave
   * swallows a quota error silently, so the cost of not doing this would be
   * "Continue last session" quietly disappearing on exactly the projects that
   * used the ground brush most.
   */
  const deflate = (bytes: Uint8Array): string => {
    const z = zlibSync(bytes, { level: 6 });
    return arrayBufferToBase64(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer);
  };
  const paint = p.terrain.paint ? deflate(p.terrain.paint) : undefined;
  /* The edge distances go the same way and for the same reason. They are one
     byte per sample like the paint and nearly all of them are the same one --
     "no boundary anywhere near" -- because a boundary is a line through a
     field, so they deflate about as far. Without them a reloaded project keeps
     its materials but loses the angle of every edge, which shows: the
     rectangle that was straight on screen comes back as a staircase. */
  const paintEdge = p.terrain.paintEdge
    ? deflate(new Uint8Array(p.terrain.paintEdge.buffer, p.terrain.paintEdge.byteOffset, p.terrain.paintEdge.byteLength))
    : undefined;
  const plain = {
    ...p,
    terrain: {
      ...p.terrain,
      heights: undefined,
      heightsB64: heights,
      paint: undefined,
      paintZ: paint,
      paintEdge: undefined,
      paintEdgeZ: paintEdge,
      /* Which encoding `paintZ` is in. Version 1 stored the material index
         itself, so grass and untouched ground were the same byte; version 2
         stores the index plus one and keeps zero for "nobody painted here",
         which is what lets a patch of grass be laid over a gravel run off. */
      paintV: 2,
    },
  };
  return JSON.stringify(plain, null, 1);
}

export function deserializeProject(json: string): Project {
  const raw = JSON.parse(json);
  const base = defaultProject();

  const terrainRaw = raw.terrain ?? {};
  let heights: Float32Array;
  if (typeof terrainRaw.heightsB64 === 'string') {
    heights = new Float32Array(base64ToArrayBuffer(terrainRaw.heightsB64));
  } else if (Array.isArray(terrainRaw.heights)) {
    heights = new Float32Array(terrainRaw.heights);
  } else {
    heights = base.terrain.heights;
  }

  const res = terrainRaw.res ?? base.terrain.res;
  if (heights.length !== res * res) {
    // Corrupt or mismatched file, fall back to a flat field of the right size.
    const fixed = new Float32Array(res * res);
    fixed.fill(terrainRaw.base ?? base.terrain.base);
    fixed.set(heights.subarray(0, Math.min(heights.length, fixed.length)));
    heights = fixed;
  }

  // What the ground is made of. A file that predates the ground brush has none,
  // and one whose paint does not match its grid -- or will not inflate -- is
  // dropped rather than shown as gravel in the wrong places.
  let paint: Uint8Array | null = null;
  if (typeof terrainRaw.paintZ === 'string') {
    try {
      let bytes = unzlibSync(new Uint8Array(base64ToArrayBuffer(terrainRaw.paintZ)));
      const pw = paintRes(res);
      // The first version of the ground brush stored one value per paint CELL;
      // it is now one per lattice POINT, one more per side, so that an edge can
      // be cut across a cell instead of only along its sides. A file from then
      // is spread onto the lattice rather than thrown away.
      if (bytes.length === (pw - 1) * (pw - 1)) {
        const wide = new Uint8Array(pw * pw);
        for (let j = 0; j < pw; j++) {
          const from = Math.min(pw - 2, j) * (pw - 1);
          for (let i = 0; i < pw; i++) wide[j * pw + i] = bytes[from + Math.min(pw - 2, i)];
        }
        bytes = wide;
      }
      // A file written before painted grass could be told from untouched
      // ground stores the material index itself. Shifted up by one it means the
      // same picture in the encoding this build reads, and its grass -- which
      // back then could only ever be "nothing painted here" -- stays zero.
      if (terrainRaw.paintV !== 2) {
        for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) bytes[i] += 1;
      }
      // Every byte has to name a material this build knows, or the mesh would
      // be cut for a material there is no entry for.
      if (bytes.length === pw * pw && bytes.every((b) => b <= GROUND_KINDS.length)) paint = bytes;
    } catch {
      paint = null;
    }
  }

  /* Where each boundary really ran, so a reloaded edge is as straight as the
     shape that drew it. Optional in every direction: a file without it, or one
     whose field does not match the grid, simply cuts at the midpoints. */
  let paintEdge: Int8Array | null = null;
  if (paint && typeof terrainRaw.paintEdgeZ === 'string') {
    try {
      const bytes = unzlibSync(new Uint8Array(base64ToArrayBuffer(terrainRaw.paintEdgeZ)));
      if (bytes.length === paint.length) {
        paintEdge = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      }
    } catch {
      paintEdge = null;
    }
  }

  const project: Project = {
    ...base,
    ...raw,
    meta: { ...base.meta, ...(raw.meta ?? {}) },
    road: normalizeRoad(raw.road, raw.track, base.road),
    pitCfg: { ...base.pitCfg, ...(raw.pitCfg ?? {}) },
    grid: { ...base.grid, ...(raw.grid ?? {}) },
    timing: { ...base.timing, ...(raw.timing ?? {}) },
    exportCfg: { ...base.exportCfg, ...(raw.exportCfg ?? {}) },
    track: normalizePath(raw.track, base.track),
    pit: normalizePath(raw.pit, base.pit),
    decoRoads: normalizeDecoRoads(raw.decoRoads),
    props: raw.props ?? [],
    assets: raw.assets ?? [],
    // Plain data, so it round trips as JSON; a file from before shapes
    // existed simply has none.
    groundShapes: Array.isArray(raw.groundShapes) ? raw.groundShapes : [],
    terrain: { ...base.terrain, ...terrainRaw, heights, paint, paintEdge },
    acImport: normalizeAcImport(raw.acImport),
  };
  delete (project.terrain as unknown as Record<string, unknown>).heightsB64;
  delete (project.terrain as unknown as Record<string, unknown>).paintZ;
  delete (project.terrain as unknown as Record<string, unknown>).paintEdgeZ;
  delete (project.terrain as unknown as Record<string, unknown>).paintV;
  return project;
}

/**
 * The road settings, and the kerbs that used to live on the control points.
 *
 * Up to July 2026 a kerb was `kerbL` / `kerbR` on each point. A file from then
 * has no `road.kerbs` at all, and taking the default -- a kerb all the way
 * round -- would silently paint kerbs onto every circuit ever saved. So the old
 * flags are read back off the raw nodes and turned into the spans that mean the
 * same thing. `normalizeNode` drops the flags afterwards, so this is the only
 * place they are still understood.
 */
function normalizeRoad(rawRoad: unknown, rawTrack: unknown, base: RoadSettings): RoadSettings {
  const src = (rawRoad ?? {}) as Partial<RoadSettings> & { kerbs?: unknown; wallCuts?: unknown };
  const road: RoadSettings = { ...base, ...src, kerbs: [] };

  /* Every project saved before barrier cuts existed simply has none, and an
     absent list must not arrive as undefined: the mesh builder walks it. */
  road.wallCuts = Array.isArray(src.wallCuts)
    ? (src.wallCuts as BarrierCut[])
        .filter((c) => c && Number.isFinite(c.from) && Number.isFinite(c.to))
        .map((c, i) => ({
          id: typeof c.id === 'string' && c.id ? c.id : `wc${i}`,
          side: c.side === -1 ? -1 : 1,
          from: Math.max(0, Math.min(1, c.from)),
          to: Math.max(0, Math.min(1, c.to)),
        }))
    : [];

  if (Array.isArray(src.kerbs)) {
    road.kerbs = src.kerbs
      .map((s) => normalizeKerbSpan(s as Partial<KerbSpan>))
      .filter((s): s is KerbSpan => s !== null);
    return road;
  }

  const track = rawTrack as { closed?: boolean; nodes?: Array<{ kerbL?: boolean; kerbR?: boolean }> } | undefined;
  if (!track || !Array.isArray(track.nodes) || track.nodes.length === 0) {
    road.kerbs = base.kerbs;
    return road;
  }
  road.kerbs = kerbsFromNodeFlags(track.nodes, Boolean(track.closed), road);
  return road;
}

/**
 * The reference to an imported Assetto Corsa track.
 *
 * Only the reference and the edits are ever in the file -- the track's own
 * hundreds of megabytes stay in the installation. Reopening the project
 * therefore has to find that installation again, and a file that names a track
 * which is no longer installed must still open: the reference is kept and the
 * editor says it could not load it, rather than silently dropping every edit
 * the user made to it.
 */
function normalizeAcImport(raw: unknown): AcImport | null {
  const src = raw as Partial<AcImport> | null | undefined;
  if (!src || typeof src.slug !== 'string' || src.slug === '') return null;
  const edits = (src.edits ?? {}) as Partial<AcEdits>;
  return {
    slug: src.slug,
    layout: typeof src.layout === 'string' ? src.layout : '',
    name: typeof src.name === 'string' ? src.name : src.slug,
    targetSlug: typeof src.targetSlug === 'string' && src.targetSlug !== ''
      ? src.targetSlug
      : `${src.slug}_edit`,
    edits: {
      transforms: isRecordOfObjects(edits.transforms)
        ? (edits.transforms as unknown as AcEdits['transforms'])
        : {},
      copies: isRecordOfArrays(edits.copies) ? (edits.copies as AcEdits['copies']) : {},
      hidden: isRecordOfArrays(edits.hidden) ? edits.hidden : {},
      renamed: isRecordOfObjects(edits.renamed) ? edits.renamed : {},
      markers: isRecordOfArrays(edits.markers) ? (edits.markers as AcEdits['markers']) : {},
      addGenerated: edits.addGenerated !== false,
    },
  };
}

function isRecordOfArrays(v: unknown): v is Record<string, never[]> {
  return !!v && typeof v === 'object' && Object.values(v).every(Array.isArray);
}

function isRecordOfObjects(v: unknown): v is Record<string, Record<string, string>> {
  return !!v && typeof v === 'object'
    && Object.values(v).every((x) => !!x && typeof x === 'object' && !Array.isArray(x));
}

/**
 * Projects saved by an earlier version are missing the newer per point fields
 * (barriers, run off factors). Fill them in rather than letting undefined leak
 * into the geometry, where it turns every coordinate into NaN.
 */
function normalizePath(raw: unknown, fallback: PathData): PathData {
  const src = raw as PathData | undefined;
  if (!src || !Array.isArray(src.nodes) || src.nodes.length === 0) return fallback;
  return {
    closed: Boolean(src.closed),
    nodes: src.nodes.map((n) => normalizeNode(n)),
  };
}

/**
 * The decorative roads. A file from before they existed has none, and a road
 * whose nodes will not normalize is dropped rather than left to feed NaN into
 * the geometry.
 */
function normalizeDecoRoads(raw: unknown): DecoRoad[] {
  if (!Array.isArray(raw)) return [];
  const out: DecoRoad[] = [];
  for (const r of raw as Array<Partial<DecoRoad>>) {
    if (!r || typeof r.id !== 'string' || !r.path || !Array.isArray(r.path.nodes)) continue;
    out.push({
      id: r.id,
      name: typeof r.name === 'string' && r.name !== '' ? r.name : `Road ${out.length + 1}`,
      surface: r.surface === 'concrete' ? 'concrete' : 'asphalt',
      // Saves from before the centre line existed get one on their asphalt
      // roads, which is what those roads would have been drawn with today.
      line: typeof r.line === 'boolean' ? r.line : r.surface !== 'concrete',
      path: {
        closed: Boolean(r.path.closed),
        nodes: r.path.nodes.map((n) => normalizeNode(n)),
      },
    });
  }
  return out;
}

export function downloadProject(p: Project) {
  const json = serializeProject(p);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.meta.slug || 'track'}${FILE_EXT}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

const AUTOSAVE_KEY = 'ac-track-editor:autosave';

/**
 * Park the project in the browser, and say whether that worked.
 *
 * The quota is about five megabytes and an imported model eats it whole, so
 * this failing is a normal thing to happen. It used to fail in silence, which
 * meant the first sign of it was "Continue last session" quietly handing back
 * an older project than the one that was being worked on. The caller says so
 * instead.
 */
export function autosave(p: Project): boolean {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(p));
    return true;
  } catch {
    return false;
  }
}

export function loadAutosave(): Project | null {
  try {
    const s = localStorage.getItem(AUTOSAVE_KEY);
    return s ? deserializeProject(s) : null;
  } catch {
    return null;
  }
}

export function clearAutosave() {
  localStorage.removeItem(AUTOSAVE_KEY);
}
