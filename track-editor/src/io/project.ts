import { unzlibSync, zlibSync } from 'fflate';
import type { AcEdits, AcImport, KerbSpan, PathData, Project, RoadSettings } from '../types';
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
  let paint: string | undefined;
  if (p.terrain.paint) {
    const z = zlibSync(p.terrain.paint, { level: 6 });
    paint = arrayBufferToBase64(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer);
  }
  const plain = {
    ...p,
    terrain: { ...p.terrain, heights: undefined, heightsB64: heights, paint: undefined, paintZ: paint },
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
      // Every byte has to name a material this build knows, or the mesh would
      // be cut for a material there is no entry for.
      if (bytes.length === pw * pw && bytes.every((b) => b < GROUND_KINDS.length)) paint = bytes;
    } catch {
      paint = null;
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
    props: raw.props ?? [],
    assets: raw.assets ?? [],
    terrain: { ...base.terrain, ...terrainRaw, heights, paint },
    acImport: normalizeAcImport(raw.acImport),
  };
  delete (project.terrain as unknown as Record<string, unknown>).heightsB64;
  delete (project.terrain as unknown as Record<string, unknown>).paintZ;
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
  const src = (rawRoad ?? {}) as Partial<RoadSettings> & { kerbs?: unknown };
  const road: RoadSettings = { ...base, ...src, kerbs: [] };

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
