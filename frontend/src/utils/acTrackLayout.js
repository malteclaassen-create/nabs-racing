// ---------------------------------------------------------------------------
// Finding a lap's track inside a driver's Assetto Corsa folder, and which of
// its layouts the lap was driven on. Pure: the reading is done by the caller
// (utils/acTrackScene.js), which hands in the names it found.
//
// The shapes are the ones the track editor's bridge describes
// (track-editor/tools/acBridge.mjs, describeLayouts):
//
//   one layout     models.ini (optional), data/, ai/, ui/ui_track.json
//   several        models_<layout>.ini beside a <layout>/ folder holding that
//                  layout's data/ and ai/, and ui/<layout>/ui_track.json
//
// Every name is compared without case: the laps carry the ids the race server
// spells, the folder is on a Windows disk, and AC never minds the difference.
// ---------------------------------------------------------------------------

// Where the track can sit relative to the folder the driver picked: the AC
// install (what the page asks for), its content folder, content/tracks, or the
// track's own folder. The last one is recognised by its name, by the caller.
export const trackBases = (track) => [`content/tracks/${track}`, `tracks/${track}`, track];

const lower = (s) => String(s || "").toLowerCase();

// `names` is every file name at the top of the track folder; `exists(path)`
// answers for the deeper paths the caller checked. Returns the layouts in
// the editor's shape: { id, modelsIni, dataDir, aiDir, uiFile }.
export function describeLayouts(names, exists) {
  const layouts = [];
  for (const name of names) {
    const m = /^models_(.+)\.ini$/i.exec(name);
    if (!m) continue;
    const id = m[1];
    layouts.push({
      id,
      modelsIni: name,
      dataDir: exists(`${id}/data/surfaces.ini`) ? `${id}/data` : null,
      aiDir: exists(`${id}/ai/fast_lane.ai`) ? `${id}/ai` : null,
      uiFile: exists(`ui/${id}/ui_track.json`) ? `ui/${id}/ui_track.json` : null,
    });
  }
  if (layouts.length === 0) {
    const has = new Set(names.map(lower));
    layouts.push({
      id: "",
      modelsIni: has.has("models.ini") ? names.find((n) => lower(n) === "models.ini") : null,
      dataDir: exists("data/surfaces.ini") ? "data" : null,
      aiDir: exists("ai/fast_lane.ai") ? "ai" : null,
      uiFile: exists("ui/ui_track.json") ? "ui/ui_track.json" : null,
    });
  }
  return layouts.sort((a, b) => a.id.localeCompare(b.id));
}

// The layout the lap was driven on. A lap with no layout, or one the folder
// does not have (renamed in an update), gets the first: drawing the right
// circuit with the wrong pit exit beats drawing nothing.
export function pickLayout(layouts, layoutId) {
  return layouts.find((l) => lower(l.id) === lower(layoutId)) || layouts[0] || null;
}

// The deeper paths describeLayouts may ask about, so the caller can check
// exactly those and no more.
export function layoutProbes(names) {
  const ids = names.map((n) => /^models_(.+)\.ini$/i.exec(n)?.[1]).filter(Boolean);
  const each = (id) => [`${id}/data/surfaces.ini`, `${id}/ai/fast_lane.ai`, `ui/${id}/ui_track.json`];
  return ids.length ? ids.flatMap(each) : ["data/surfaces.ini", "ai/fast_lane.ai", "ui/ui_track.json"];
}

// AC's TV cameras (data/cameras_1.ini) each cover a stretch of the lap, given
// as spline positions 0..1 — the same scale the laps are sampled on, so slice
// i of n is at i / n. The camera whose stretch holds `pos`; a stretch may run
// across the line (in 0.95, out 0.05). Null when none does.
export function tvCameraAt(cams, pos) {
  for (const cam of cams) {
    const { inPoint: a, outPoint: b } = cam;
    if (a <= b ? pos >= a && pos < b : pos >= a || pos < b) return cam;
  }
  return null;
}
