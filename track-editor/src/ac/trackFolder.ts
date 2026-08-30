import {
  type AcFileEntry, type AcLayout, type AcTrackDetail,
  fetchTrackFile, trackDetail,
} from './bridge';
import { iniGet, iniNumbered, parseIni, type IniFile } from './iniFile';
import { readKn5, type Kn5File, Kn5ParseError } from './kn5Read';

/**
 * What an installed Assetto Corsa track looks like, and how much of it has to
 * be in the browser at any one time.
 *
 * The second half of that sentence is the whole design. vhe_hockenheim is 26
 * models and roughly 700 MB, and about 95% of that is texture data: the main
 * model is 116 MB of which the geometry is around 5 MB. A tab that loads a
 * track the naive way dies, and this project has already learned that lesson
 * once on export (see the OOM notes in src/export/kn5.ts).
 *
 * So:
 *   - the FILE LIST is cheap and always loaded; the bytes are not
 *   - models load on demand, and for display their textures are dropped and
 *     the source buffer released, leaving only geometry
 *   - EDITS ARE DECLARATIVE. Nothing the user does mutates a loaded model.
 *     At export time each file that needs changing is read again, fresh, and
 *     the recorded edits are applied to it. A track can therefore be edited
 *     without ever holding more than a few megabytes of it.
 */

export interface AcModelRef {
  /** Path inside the track folder, e.g. "obj_barriers.kn5". */
  path: string;
  /** From models.ini. Almost always zero, but helicopters get placed. */
  position: [number, number, number];
  rotation: [number, number, number];
  /** models.ini section it came from, so a rewrite can find it again. */
  section: string;
  /** DYNAMIC_OBJECT entries are animated props, not part of the track. */
  dynamic: boolean;
}

export interface AcSurface {
  /** The KEY, which is also the mesh name prefix: KEY=ROAD means `1ROAD_...`. */
  key: string;
  section: string;
  friction: number;
  isPitlane: boolean;
  isValidTrack: boolean;
}

export interface AcTrackFolder {
  slug: string;
  name: string;
  layout: AcLayout;
  layouts: AcLayout[];
  /** Every file in the folder, so nothing can be forgotten on the way out. */
  files: AcFileEntry[];
  /** Models this layout loads, in load order. */
  models: AcModelRef[];
  /** Parsed surfaces.ini of this layout, empty when it has none. */
  surfaces: AcSurface[];
  /** The raw ini files, kept so an edit can rewrite one line and no more. */
  modelsIni: IniFile | null;
  surfacesIni: IniFile | null;
}

/* ------------------------------------------------------------------ */
/* models.ini                                                          */
/* ------------------------------------------------------------------ */

function triple(value: string | null, fallback: [number, number, number]): [number, number, number] {
  if (!value) return fallback;
  const parts = value.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return fallback;
  return [parts[0], parts[1], parts[2]];
}

export function parseModelsIni(ini: IniFile): AcModelRef[] {
  const out: AcModelRef[] = [];
  for (const prefix of ['MODEL_', 'DYNAMIC_OBJECT_']) {
    for (const { section } of iniNumbered(ini, prefix)) {
      const file = iniGet(ini, section, 'FILE');
      if (!file) continue;
      out.push({
        path: file.trim(),
        position: triple(iniGet(ini, section, 'POSITION'), [0, 0, 0]),
        rotation: triple(iniGet(ini, section, 'ROTATION'), [0, 0, 0]),
        section,
        dynamic: prefix === 'DYNAMIC_OBJECT_',
      });
    }
  }
  return out;
}

export function parseSurfacesIni(ini: IniFile): AcSurface[] {
  const out: AcSurface[] = [];
  for (const { section } of iniNumbered(ini, 'SURFACE_')) {
    const key = iniGet(ini, section, 'KEY');
    if (!key) continue;
    out.push({
      key: key.trim(),
      section,
      friction: Number(iniGet(ini, section, 'FRICTION') ?? '1') || 1,
      isPitlane: (iniGet(ini, section, 'IS_PITLANE') ?? '0').trim() === '1',
      isValidTrack: (iniGet(ini, section, 'IS_VALID_TRACK') ?? '0').trim() === '1',
    });
  }
  return out;
}

/**
 * Which models a track loads when it has no models.ini at all.
 *
 * AC's own rule: load `<slug>.kn5`. Kunos tracks sometimes ship extra numbered
 * models beside it (magione has a 100.kn5) which the game loads only when a
 * models.ini asks for them, so they are deliberately NOT included -- guessing
 * wrong here would add scenery the track never shows.
 */
export function defaultModels(slug: string, files: AcFileEntry[]): AcModelRef[] {
  const main = `${slug}.kn5`;
  if (files.some((f) => f.path === main)) {
    return [{ path: main, position: [0, 0, 0], rotation: [0, 0, 0], section: '', dynamic: false }];
  }
  // Nothing matching the folder name: take the biggest .kn5 at the top level
  // and say so, rather than showing an empty scene.
  const candidates = files
    .filter((f) => /^[^/]+\.kn5$/i.test(f.path))
    .sort((a, b) => b.size - a.size);
  if (candidates.length === 0) return [];
  return [{ path: candidates[0].path, position: [0, 0, 0], rotation: [0, 0, 0], section: '', dynamic: false }];
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

async function tryFetchIni(slug: string, path: string | null): Promise<IniFile | null> {
  if (!path) return null;
  try {
    return parseIni(await fetchTrackFile(slug, path));
  } catch {
    return null;
  }
}

/**
 * Everything about a track except the model bytes.
 *
 * `layoutId` picks one of a multi layout track's layouts; pass the id from
 * `detail.layouts`. An unknown id falls back to the first, so a project whose
 * layout was renamed in an update still opens.
 */
export async function loadTrackFolder(
  slug: string,
  layoutId: string,
  detail?: AcTrackDetail,
): Promise<AcTrackFolder> {
  const info = detail ?? await trackDetail(slug);
  const layout = info.layouts.find((l) => l.id === layoutId) ?? info.layouts[0];
  if (!layout) throw new Error(`${slug} has no layouts at all`);

  const modelsIni = await tryFetchIni(slug, layout.modelsIni);
  const surfacesIni = await tryFetchIni(slug, layout.dataDir ? `${layout.dataDir}/surfaces.ini` : null);

  const models = modelsIni ? parseModelsIni(modelsIni) : defaultModels(slug, info.files);
  const surfaces = surfacesIni ? parseSurfacesIni(surfacesIni) : [];

  let name = slug;
  if (layout.uiFile) {
    try {
      const bytes = await fetchTrackFile(slug, layout.uiFile);
      const ui = JSON.parse(new TextDecoder().decode(bytes).replace(/^﻿/, ''));
      if (typeof ui?.name === 'string' && ui.name.trim()) name = ui.name.trim();
    } catch { /* keep the slug */ }
  }

  return {
    slug, name, layout, layouts: info.layouts, files: info.files,
    models, surfaces, modelsIni, surfacesIni,
  };
}

export interface LoadedModel {
  path: string;
  ref: AcModelRef;
  /** null when the file could not be parsed (encrypted, or simply broken). */
  file: Kn5File | null;
  /** Why it could not be parsed, for the UI to show. */
  error: string | null;
  /** Bytes on disk, whether or not it parsed. */
  size: number;
}

export interface LoadModelOptions {
  /**
   * Keep the embedded texture images.
   *
   * Off by default and that is not a detail: on the reference track the
   * textures are 95% of the bytes. Off, a model is parsed, its geometry copied
   * into buffers of its own and the download released, so holding the whole
   * circuit on screen costs a few tens of megabytes instead of most of a
   * gigabyte.
   */
  textures?: boolean;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Give every mesh its own buffers and drop the texture payloads, so the
 * downloaded file can be collected.
 *
 * Typed array views keep their whole ArrayBuffer alive -- a single 20-vertex
 * mesh viewing into a 116 MB download pins all 116 MB. Copying is the point.
 */
function detachGeometry(file: Kn5File) {
  const walk = (node: Kn5File['root']) => {
    if (node.kind === 'mesh') {
      node.vertices = node.vertices.slice();
      node.indices = node.indices.slice();
    }
    for (const c of node.children) walk(c);
  };
  walk(file.root);
  for (const t of file.textures) {
    // Name and size stay: the material browser shows what a mesh is textured
    // with even when the image itself was not kept.
    t.data = new Uint8Array(0);
  }
}

export async function loadModel(
  slug: string,
  ref: AcModelRef,
  size: number,
  opts: LoadModelOptions = {},
): Promise<LoadedModel> {
  let bytes: Uint8Array;
  try {
    bytes = await fetchTrackFile(slug, ref.path, opts.onProgress);
  } catch (e) {
    return { path: ref.path, ref, file: null, error: String((e as Error).message ?? e), size };
  }

  try {
    const file = readKn5(bytes);
    if (!opts.textures) detachGeometry(file);
    return { path: ref.path, ref, file, error: null, size: bytes.length };
  } catch (e) {
    const why = e instanceof Kn5ParseError
      ? `${e.message} (at byte ${e.offset})`
      : String((e as Error).message ?? e);
    return { path: ref.path, ref, file: null, error: why, size: bytes.length };
  }
}

/**
 * A model, complete and unmodified, for the export to patch.
 *
 * Deliberately separate from `loadModel`: this one keeps everything, is used
 * for one file at a time and is thrown away immediately afterwards.
 */
export async function loadModelForEdit(slug: string, path: string): Promise<Kn5File> {
  return readKn5(await fetchTrackFile(slug, path));
}
