import type { AcImport } from '../types';
import type { Frame } from '../core/spline';
import {
  fetchTrackFile, installBegin, installCopy, installPut, trackDetail,
  type AcFileEntry, type AcLayout,
} from './bridge';
import { appendSection, iniBytes, iniNumbered, parseIni, type IniFile } from './iniFile';
import { readKn5 } from './kn5Read';
import { writeKn5 } from './kn5Write';
import {
  appendPieceCopies, patchMarkers, patchMeshes, planMarkerEdits, transformMeshes,
  type MarkerPatchResult, type MarkerRef,
} from './patchKn5';

/**
 * Writing an imported track back out, without losing anything.
 *
 * The promise the whole import feature rests on is that a track can go through
 * this editor and come out still being the track it was. The way that promise
 * is kept is not care, it is structure:
 *
 *   1. EVERY file of the source folder is accounted for. The manifest is the
 *      list, and anything not deliberately changed is COPIED -- server side,
 *      disk to disk, never through the browser. Files the editor does not
 *      understand (encrypted models, .rar files somebody left in data/, the
 *      Custom Shaders Patch extension folder, six layouts that were not being
 *      edited) travel across untouched precisely because nothing here looks at
 *      them.
 *
 *   2. Files that DO change are re-read from disk at this moment, patched, and
 *      written. Nothing is carried over from a model that was loaded for
 *      display, where the textures were thrown away to save memory.
 *
 *   3. Anything the editor ADDS goes into a new model of its own, listed in
 *      models.ini beside the originals. Kerbs, painted lines and braking
 *      boards therefore cannot damage the original geometry: they are not in
 *      the same file as it.
 *
 * And it writes to a NEW folder. The source is opened read only and stays that
 * way; there is no code path here that writes into it.
 */

export interface AcExportOptions {
  /** The extra model holding what the editor generated. */
  generated?: { fileName: string; bytes: Uint8Array } | null;
  /**
   * Every AC_* marker on the track and which model it lives in.
   *
   * Needed because marker NUMBERING belongs to the track, not to a file: extra
   * pit boxes are routinely shipped in a second model holding AC_PIT_25 to 40,
   * and closing a gap has to be worked out across all of them at once. Without
   * it, marker edits are applied but nothing is renumbered, and a warning says
   * so rather than quietly renumbering one file into another file's numbers.
   */
  markerInventory?: readonly MarkerRef[];
  /**
   * The track's cross sections, for edits that resize along the track.
   *
   * Supplied by the editor because only it has the derived centre line. Without
   * them such an edit is reported as skipped rather than quietly applied as an
   * axis scale, which would put a kerb metres off the tarmac.
   */
  ribbonFrames?: readonly Frame[];
  /** Replace the target folder if it is already there. */
  overwrite?: boolean;
  onProgress?: (message: string, fraction: number) => void;
  /**
   * Read every written model back and check it parses.
   *
   * On by default. It is a few seconds on a big track and it turns "the export
   * said it worked" into "the export checked".
   */
  verify?: boolean;
}

export interface AcExportReport {
  target: string;
  /** Where it landed. */
  dir: string;
  copied: number;
  copiedBytes: number;
  written: Array<{ path: string; bytes: number; note: string }>;
  markers: Record<string, MarkerPatchResult>;
  /** Group -> how many markers the track ends up with. */
  markerCounts: Record<string, number>;
  warnings: string[];
  /** Every source file, and whether it was copied, rewritten or is new. */
  accounted: number;
  sourceFiles: number;
}

function modelsUsingEdits(imported: AcImport): Set<string> {
  const out = new Set<string>();
  for (const k of Object.keys(imported.edits.transforms)) out.add(k);
  for (const [k, list] of Object.entries(imported.edits.copies)) {
    if (list.length > 0) out.add(k);
  }
  for (const k of Object.keys(imported.edits.hidden)) out.add(k);
  for (const k of Object.keys(imported.edits.renamed)) out.add(k);
  for (const [k, list] of Object.entries(imported.edits.markers)) {
    if (list.length > 0) out.add(k);
  }
  return out;
}

/**
 * Add the generated model to a layout's models.ini, or write one that says
 * what AC was doing by default.
 *
 * The second case matters more than it looks. With no models.ini AC loads the
 * one model named after the FOLDER, and the folder is about to be called
 * something else -- so a track that had no models.ini would lose its entire
 * model by being renamed. Writing one that names the file explicitly keeps the
 * behaviour and stops depending on the folder name at all.
 */
function withGeneratedModel(
  existing: IniFile | null,
  mainModel: string | null,
  generatedFile: string | null,
): IniFile {
  const ini = existing ?? parseIni('');
  if (!existing && mainModel) {
    appendSection(ini, 'MODEL_0', [
      ['FILE', mainModel],
      ['POSITION', '0,0,0'],
      ['ROTATION', '0,0,0'],
    ]);
  }
  if (generatedFile) {
    const next = iniNumbered(ini, 'MODEL_').reduce((a, m) => Math.max(a, m.index + 1), 0);
    appendSection(ini, `MODEL_${next}`, [
      ['FILE', generatedFile],
      ['POSITION', '0,0,0'],
      ['ROTATION', '0,0,0'],
    ]);
  }
  return ini;
}

/** The model a track loads when it has no models.ini: the one named after it. */
function impliedMainModel(slug: string, files: AcFileEntry[]): string | null {
  const named = `${slug}.kn5`;
  if (files.some((f) => f.path.toLowerCase() === named.toLowerCase())) return named;
  const top = files
    .filter((f) => /^[^/]+\.kn5$/i.test(f.path))
    .sort((a, b) => b.size - a.size);
  return top[0]?.path ?? null;
}

export async function exportAcTrack(
  imported: AcImport,
  opts: AcExportOptions = {},
): Promise<AcExportReport> {
  const report: AcExportReport = {
    target: imported.targetSlug,
    dir: '',
    copied: 0,
    copiedBytes: 0,
    written: [],
    markers: {},
    markerCounts: {},
    warnings: [],
    accounted: 0,
    sourceFiles: 0,
  };
  const say = opts.onProgress ?? (() => {});
  const verify = opts.verify !== false;

  if (imported.targetSlug === imported.slug) {
    throw new Error(
      'the export target is the same folder as the source. '
      + 'Pick another name -- overwriting the original would destroy it.',
    );
  }

  say('reading the source folder', 0);
  const detail = await trackDetail(imported.slug);
  report.sourceFiles = detail.files.length;
  const layout: AcLayout | undefined =
    detail.layouts.find((l) => l.id === imported.layout) ?? detail.layouts[0];

  /* --- work out what changes --------------------------------------- */
  /* --- marker plan, across every model at once ---------------------- */
  const inventory = opts.markerInventory ?? [];
  const hasMarkerEdits = Object.values(imported.edits.markers).some((l) => l.length > 0);
  const markerPlan = planMarkerEdits(inventory, imported.edits.markers);
  if (hasMarkerEdits && inventory.length === 0) {
    report.warnings.push(
      'the marker list was not available, so gaps left by deleted markers could not be '
      + 'closed. Assetto Corsa stops reading at the first missing number, so check the '
      + 'pit boxes and grid slots in game.',
    );
  }

  const changedModels = modelsUsingEdits(imported);
  // A model can need writing purely because a marker somewhere else moved the
  // numbering. Those are found by the plan, not by the edit list.
  for (const path of markerPlan.renumberedOnly) changedModels.add(path);
  const generated = imported.edits.addGenerated ? opts.generated ?? null : null;
  const generatedFile = generated ? generated.fileName : null;

  // With no models.ini the folder name IS the model name, and the folder is
  // being renamed -- so one has to be written either way.
  const needsModelsIni = generatedFile !== null || !layout?.modelsIni;
  const modelsIniPath = layout?.modelsIni ?? (layout?.id ? `models_${layout.id}.ini` : 'models.ini');

  const rewritten = new Set<string>(changedModels);
  if (needsModelsIni) rewritten.add(modelsIniPath);

  /* --- create the folder -------------------------------------------- */
  say(`creating ${imported.targetSlug}`, 0.02);
  report.dir = await installBegin(imported.targetSlug, opts.overwrite === true);

  /* --- patch the models that changed -------------------------------- */
  let step = 0;
  const steps = Math.max(1, changedModels.size + (needsModelsIni ? 1 : 0) + 1);
  for (const path of changedModels) {
    step += 1;
    say(`patching ${path}`, 0.05 + (0.75 * step) / steps);

    const source = detail.files.find((f) => f.path === path);
    if (!source) {
      report.warnings.push(`${path} is edited but no longer in the source folder; skipped`);
      rewritten.delete(path);
      continue;
    }

    // Read fresh. The copy loaded for display had its textures thrown away.
    const bytes = await fetchTrackFile(imported.slug, path);
    let file;
    try {
      file = readKn5(bytes);
    } catch (e) {
      report.warnings.push(
        `${path} could not be re-read (${(e as Error).message}); copied unchanged, its edits were dropped`,
      );
      rewritten.delete(path);
      continue;
    }

    const notes: string[] = [];
    const meshes = patchMeshes(file, {
      hidden: new Set(imported.edits.hidden[path] ?? []),
      renamed: new Map(Object.entries(imported.edits.renamed[path] ?? {})),
    });
    if (meshes.hidden > 0) notes.push(`${meshes.hidden} mesh(es) removed`);
    if (meshes.renamed > 0) notes.push(`${meshes.renamed} renamed`);

    const moved = transformMeshes(
      file, imported.edits.transforms[path] ?? {}, opts.ribbonFrames,
    );
    if (moved.moved > 0) notes.push(`${moved.moved} mesh(es) moved`);
    if (moved.skippedRibbon > 0) {
      report.warnings.push(
        `${path}: ${moved.skippedRibbon} edit(s) that resize along the track were skipped -- `
        + 'the centre line was not available, and an axis scale would have put them off the track.',
      );
    }

    const copied = appendPieceCopies(file, imported.edits.copies[path] ?? [], opts.ribbonFrames);
    if (copied.added > 0) notes.push(`${copied.added} copy/copies added`);
    for (const why of copied.skipped) report.warnings.push(`${path}: ${why}`);

    const modelPlan = markerPlan.byModel.get(path);
    if (modelPlan) {
      const markers = patchMarkers(file, modelPlan);
      report.markers[path] = markers;
      if (markers.moved) notes.push(`${markers.moved} marker(s) moved`);
      if (markers.deleted) notes.push(`${markers.deleted} deleted`);
      if (markers.added) notes.push(`${markers.added} added`);
      if (markers.renamed) notes.push(`${markers.renamed} renumbered`);
    }

    const out = writeKn5(file);
    if (verify) {
      // Cheap insurance: a model that does not read back is a model AC will
      // refuse to load, and finding that out here beats finding it out in the
      // game with no idea which of thirty files is wrong.
      try {
        readKn5(out);
      } catch (e) {
        throw new Error(`the patched ${path} does not read back: ${(e as Error).message}`);
      }
    }
    await installPut(imported.targetSlug, path, out);
    report.written.push({ path, bytes: out.length, note: notes.join(', ') || 'unchanged' });
  }

  /* --- models.ini --------------------------------------------------- */
  if (needsModelsIni) {
    step += 1;
    say('writing models.ini', 0.05 + (0.75 * step) / steps);
    let existing: IniFile | null = null;
    if (layout?.modelsIni) {
      try {
        existing = parseIni(await fetchTrackFile(imported.slug, layout.modelsIni));
      } catch {
        report.warnings.push(`could not read ${layout.modelsIni}; a new one was written`);
      }
    }
    const ini = withGeneratedModel(
      existing,
      existing ? null : impliedMainModel(imported.slug, detail.files),
      generatedFile,
    );
    const bytes = iniBytes(ini);
    await installPut(imported.targetSlug, modelsIniPath, bytes);
    report.written.push({
      path: modelsIniPath,
      bytes: bytes.length,
      note: generatedFile
        ? `added ${generatedFile}`
        : 'written so the track no longer depends on the folder name',
    });
  }

  /* --- the generated model ------------------------------------------ */
  if (generated) {
    say(`writing ${generated.fileName}`, 0.85);
    await installPut(imported.targetSlug, generated.fileName, generated.bytes);
    report.written.push({
      path: generated.fileName,
      bytes: generated.bytes.length,
      note: 'new: everything this editor added',
    });
  }

  /* --- copy the rest ------------------------------------------------ */
  say('copying everything else', 0.9);
  const copyList = detail.files
    .map((f) => f.path)
    .filter((p) => !rewritten.has(p));
  const copied = await installCopy(imported.targetSlug, imported.slug, copyList);
  report.copied = copied.copied;
  report.copiedBytes = copied.bytes;

  if (copied.copied !== copyList.length) {
    report.warnings.push(
      `${copyList.length - copied.copied} file(s) could not be copied; the export is incomplete`,
    );
  }

  /*
   * The accounting check.
   *
   * Every file that was in the source is either rewritten or copied. If those
   * two numbers do not add back up to the manifest, something was silently
   * dropped -- which is the exact failure this whole design exists to prevent,
   * so it is counted rather than hoped for.
   */
  report.accounted = copied.copied + [...rewritten].filter((p) =>
    detail.files.some((f) => f.path === p)).length;
  if (report.accounted !== report.sourceFiles) {
    report.warnings.push(
      `${report.sourceFiles - report.accounted} of ${report.sourceFiles} source files are missing `
      + 'from the export',
    );
  }

  report.markerCounts = markerPlan.counts;
  say('done', 1);
  return report;
}
