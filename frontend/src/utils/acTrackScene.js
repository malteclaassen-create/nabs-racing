// ---------------------------------------------------------------------------
// An installed Assetto Corsa track, read from the driver's own folder and
// built into something three.js can draw — for the 3D view of the lap
// comparison (components/TelemetryTrack3D.jsx).
//
// The model files are read by the track editor's own parser
// (track-editor/src/ac), imported straight from there so there is one reader
// of the format in the repository, not two. What this file adds is the
// viewer's side: draw everything the game draws, keep the ground the cars
// drive on, and stay within what a browser tab can hold.
//
// What a tab can hold is the constraint. A modern track is several hundred
// megabytes, nearly all of it textures (track-editor/src/ac/trackFolder.ts
// measured 95% on vhe_hockenheim). So textures go to the graphics card still
// compressed, and anything bigger than MAX_TEXTURE on a side drops its top
// mip levels: a 4096² wall texture costs 1/16 of itself and nobody watching a
// replay can tell. Each model file is read, built and let go before the next.
//
// Nothing read here is sent anywhere.
// ---------------------------------------------------------------------------
import * as THREE from "three";
import { DDSLoader } from "three/examples/jsm/loaders/DDSLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { readKn5, decodeMesh } from "../../../track-editor/src/ac/kn5Read.ts";
import { parseIni, iniGet, iniNumbered } from "../../../track-editor/src/ac/iniFile.ts";
import { parseModelsIni, parseSurfacesIni } from "../../../track-editor/src/ac/trackFolder.ts";
import { surfaceOfMesh, STANDARD_SURFACE_KEYS } from "../../../track-editor/src/ac/surfaceName.ts";
import { describeLayouts, layoutProbes, pickLayout, trackBases } from "./acTrackLayout.js";
import { groundGrid } from "./groundHeight.js";

const MAX_TEXTURE = 1024;
// Custom Shaders Patch appends a 42 byte marker to models it touched; anything
// longer after the node tree is an encrypted model whose tree is nonsense
// (see kn5Safety in track-editor/src/ac/kn5Read.ts).
const TRAILING_MARKER_LIMIT = 64;

export class TrackNotFoundError extends Error {
  constructor(track) {
    super(`content/tracks/${track} is not in that folder`);
    this.name = "TrackNotFoundError";
    this.track = track;
  }
}

const lower = (s) => String(s || "").toLowerCase();

async function findTrack(reader, track) {
  for (const base of trackBases(track)) if (await reader.hasDir(base)) return base;
  // The driver picked the track's own folder.
  return lower(reader.name) === lower(track) ? "" : null;
}

// A file's bytes, reporting as they come: the main model of a modern track is
// over 100 MB, and a bar that sits still for ten seconds reads as broken.
async function readBytes(file, onBytes) {
  if (!file.stream) return new Uint8Array(await file.arrayBuffer());
  const out = new Uint8Array(file.size);
  const reader = file.stream().getReader();
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, at);
    at += value.length;
    onBytes?.(at);
  }
  return at === out.length ? out : out.subarray(0, at);
}

const readText = async (reader, path) => {
  const file = await reader.getFile(path);
  return file ? new Uint8Array(await file.arrayBuffer()) : null;
};

const triple = (value) => {
  const parts = String(value || "").split(",").map((s) => Number(s.trim()));
  return parts.length === 3 && parts.every(Number.isFinite) ? parts : null;
};

// AC's TV cameras for the layout: where each stands, and which stretch of the
// lap (spline 0..1) it covers. An empty list when the track has none.
function readCameras(ini) {
  if (!ini) return [];
  const num = (section, key, fallback) => {
    const v = Number(iniGet(ini, section, key));
    return Number.isFinite(v) && iniGet(ini, section, key) !== null ? v : fallback;
  };
  return iniNumbered(ini, "CAMERA_")
    .map(({ section }) => ({
      position: triple(iniGet(ini, section, "POSITION")),
      inPoint: num(section, "IN_POINT", NaN),
      outPoint: num(section, "OUT_POINT", NaN),
      minFov: num(section, "MIN_FOV", 6),
      maxFov: num(section, "MAX_FOV", 60),
    }))
    .filter((c) => c.position && Number.isFinite(c.inPoint) && Number.isFinite(c.outPoint));
}

/* --- materials ------------------------------------------------------------ */

const ddsLoader = new DDSLoader();

// A readable colour for a material with no usable texture, by its name, the
// same idea the editor uses: road grey, grass green, kerbs red.
function fallbackColour(name) {
  const n = lower(name);
  if (/asphalt|road|tarmac|track/.test(n)) return 0x3a3d42;
  if (/grass|erba/.test(n)) return 0x4a6b35;
  if (/sand|gravel|ghiaia/.test(n)) return 0xb09a6a;
  if (/kerb|curb|cordolo/.test(n)) return 0xb04a44;
  if (/tree|foglia|leaf/.test(n)) return 0x39592c;
  if (/wall|barrier|guard/.test(n)) return 0x9aa0a8;
  return 0x8a8d90;
}

function ddsTexture(data, ctx) {
  if (!ctx.s3tc) return null;
  const parsed = ddsLoader.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), true);
  if (parsed.isCubemap || !parsed.mipmaps?.length) return null;
  let { mipmaps, width, height } = parsed;
  // Skip the largest levels down to MAX_TEXTURE. The rest of the chain is
  // untouched, so the texture stays complete.
  while ((width > MAX_TEXTURE || height > MAX_TEXTURE) && mipmaps.length > 1) {
    mipmaps = mipmaps.slice(1);
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  }
  const tex = new THREE.CompressedTexture(mipmaps, width, height, parsed.format);
  tex.minFilter = mipmaps.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// PNG and JPEG turn up embedded in older mods. Decoded off the main thread;
// the material shows untextured for the moment that takes.
function imageTexture(data) {
  const tex = new THREE.Texture();
  tex.flipY = false;
  createImageBitmap(new Blob([data]), { imageOrientation: "none" })
    .then((bitmap) => { tex.image = bitmap; tex.needsUpdate = true; })
    .catch(() => {});
  return tex;
}

function textureFrom(data, ctx) {
  if (!data || data.length < 4) return null;
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  let tex = null;
  try {
    if (magic === "DDS ") tex = ddsTexture(data, ctx);
    else if (magic === "\x89PNG" || (data[0] === 0xff && data[1] === 0xd8)) tex = imageTexture(data);
  } catch {
    return null; // one texture that will not decode is not worth the track
  }
  if (!tex) return null;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = ctx.anisotropy;
  return tex;
}

// AC's alpha tested shaders end in AT; trees and grass are alpha tested by
// nature. Tested, never blended, so they stay in the opaque pass.
const alphaTestedShader = (shader) => /AT($|_)/.test(shader) || shader === "ksTree" || shader === "ksGrass";

function makeMaterial(def, textures, ctx) {
  const diffuse = def?.slots.find((s) => s.sampler === "txDiffuse")?.texture;
  const map = diffuse ? textures(diffuse) : null;
  const tested = !!def && (def.alphaTested !== 0 || alphaTestedShader(def.shader));
  // Blend mode 1 is alpha blending: tyre marks, shadows painted on the road,
  // glass. Drawn see-through and without writing depth, or the road under a
  // skid mark disappears.
  const blended = !!def && def.blend === 1 && !tested;
  const material = new THREE.MeshLambertMaterial({
    color: map ? 0xffffff : fallbackColour(def?.name),
    map,
    alphaTest: tested ? 0.5 : 0,
    transparent: blended,
    depthWrite: !blended,
    side: tested ? THREE.DoubleSide : THREE.FrontSide,
  });
  ctx.disposables.push(material);
  return material;
}

/* --- one model file ------------------------------------------------------- */

function baseMatrix(ref) {
  const [px, py, pz] = ref.position;
  const [rx, ry, rz] = ref.rotation.map((d) => THREE.MathUtils.degToRad(d));
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  );
}

function buildModel(kn5, ref, ctx) {
  const group = new THREE.Group();
  group.name = ref.path;
  const textureCache = new Map();
  const byName = new Map(kn5.textures.map((t) => [t.name, t]));
  const textures = (name) => {
    if (!textureCache.has(name)) {
      const tex = textureFrom(byName.get(name)?.data, ctx);
      if (tex) ctx.disposables.push(tex);
      textureCache.set(name, tex);
    }
    return textureCache.get(name);
  };
  const materials = new Map();
  const byMaterial = new Map();

  const visit = (node, parent) => {
    if (node.kind === "dummy") {
      const here = new THREE.Matrix4().multiplyMatrices(parent, new THREE.Matrix4().fromArray(node.matrix));
      for (const child of node.children) visit(child, here);
      return;
    }
    const surface = surfaceOfMesh(node.name, ctx.surfaceKeys);
    const ground = surface !== null && surface !== "WALL";
    // A mesh that only shows from far away (lodIn above zero) is a stand-in
    // for one drawn up close; drawing both stacks them on top of each other.
    const drawn = node.renderable !== 0 && !(node.lodIn > 0);
    if (ground || drawn) {
      ctx.triangles += node.indexCount / 3;
      const d = decodeMesh(node);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(d.normals, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(d.uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(d.indices, 1));
      geo.applyMatrix4(parent);
      if (ground) ctx.ground.push(groundTriangles(geo));
      if (drawn) {
        const list = byMaterial.get(node.materialId);
        if (list) list.push(geo);
        else byMaterial.set(node.materialId, [geo]);
      } else {
        geo.dispose();
      }
    }
    for (const child of node.children) visit(child, parent);
  };
  visit(kn5.root, baseMatrix(ref));

  // One draw call per material: a circuit is hundreds of meshes, and drawing
  // them one by one costs more than the triangles do.
  for (const [materialId, geos] of byMaterial) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (merged !== geos[0]) for (const g of geos) g.dispose();
    if (!merged) continue;
    if (!materials.has(materialId)) materials.set(materialId, makeMaterial(kn5.materials[materialId], textures, ctx));
    ctx.disposables.push(merged);
    group.add(new THREE.Mesh(merged, materials.get(materialId)));
  }
  return group;
}

// The mesh's triangles as flat world corners, for utils/groundHeight.js.
function groundTriangles(geo) {
  const pos = geo.attributes.position.array;
  const idx = geo.index.array;
  const out = new Float32Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i] * 3;
    out[i * 3] = pos[v];
    out[i * 3 + 1] = pos[v + 1];
    out[i * 3 + 2] = pos[v + 2];
  }
  return out;
}

function concat(parts) {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/* --- the whole track ------------------------------------------------------ */

// `reader` is from utils/acFolder.js. `track` and `layout` are the ids the
// laps carry. `gpu` says what the graphics card can take: { s3tc, anisotropy }.
// `onProgress(message, fraction)` while it works.
export async function loadTrackScene(reader, { track, layout, gpu, onProgress }) {
  const report = onProgress || (() => {});
  report("Finding the track", 0);
  const base = await findTrack(reader, track);
  if (base === null) throw new TrackNotFoundError(track);
  const at = (p) => (base ? `${base}/${p}` : p);

  const top = await reader.list(base);
  const names = top.filter((e) => e.kind === "file").map((e) => e.name);
  const found = new Set();
  for (const probe of layoutProbes(names)) if (await reader.getFile(at(probe))) found.add(probe);
  const lay = pickLayout(describeLayouts(names, (p) => found.has(p)), layout);
  const warnings = [];
  if (layout && lower(lay.id) !== lower(layout)) warnings.push(`This track has no "${layout}" layout, so ${lay.id || "its main layout"} is shown.`);

  let models;
  const modelsBytes = lay.modelsIni ? await readText(reader, at(lay.modelsIni)) : null;
  if (modelsBytes) {
    models = parseModelsIni(parseIni(modelsBytes)).filter((m) => !m.dynamic);
  } else {
    // No models.ini: AC loads <track>.kn5, or failing that the biggest model.
    const kn5s = names.filter((n) => /\.kn5$/i.test(n));
    const main = kn5s.find((n) => lower(n) === `${lower(track)}.kn5`);
    let pick = main;
    if (!pick && kn5s.length) {
      const sized = await Promise.all(kn5s.map(async (n) => [n, (await reader.getFile(at(n)))?.size || 0]));
      pick = sized.sort((a, b) => b[1] - a[1])[0][0];
    }
    models = pick ? [{ path: pick, position: [0, 0, 0], rotation: [0, 0, 0], section: "", dynamic: false }] : [];
  }
  if (!models.length) throw new Error("This track folder has no 3D model in it.");

  const dataDir = lay.dataDir || (lay.id ? `${lay.id}/data` : "data");
  const surfacesBytes = await readText(reader, at(`${dataDir}/surfaces.ini`));
  const surfaceKeys = surfacesBytes ? parseSurfacesIni(parseIni(surfacesBytes)).map((s) => s.key) : [];
  const camerasBytes = await readText(reader, at(`${dataDir}/cameras_1.ini`));
  const cameras = readCameras(camerasBytes ? parseIni(camerasBytes) : null);

  let name = track;
  const uiBytes = lay.uiFile ? await readText(reader, at(lay.uiFile)) : null;
  if (uiBytes) {
    try {
      const ui = JSON.parse(new TextDecoder().decode(uiBytes).replace(/^﻿/, ""));
      if (typeof ui?.name === "string" && ui.name.trim()) name = ui.name.trim();
    } catch { /* keep the id */ }
  }

  const files = await Promise.all(models.map((m) => reader.getFile(at(m.path))));
  const total = files.reduce((s, f) => s + (f?.size || 0), 0) || 1;
  const ctx = {
    surfaceKeys: surfaceKeys.length ? surfaceKeys : STANDARD_SURFACE_KEYS,
    s3tc: !!gpu?.s3tc,
    anisotropy: gpu?.anisotropy || 1,
    ground: [],
    disposables: [],
    triangles: 0,
  };
  const root = new THREE.Group();
  let done = 0;
  for (let i = 0; i < models.length; i++) {
    const ref = models[i], file = files[i];
    if (!file) { warnings.push(`${ref.path} is missing from the track folder.`); continue; }
    const label = `Reading ${ref.path} (${Math.round(file.size / 1e6)} MB)`;
    report(label, done / total);
    const bytes = await readBytes(file, (n) => report(label, (done + n) / total));
    done += file.size;
    let kn5;
    try {
      kn5 = readKn5(bytes);
    } catch {
      warnings.push(`${ref.path} could not be read.`);
      continue;
    }
    if (kn5.trailing.length > TRAILING_MARKER_LIMIT) {
      warnings.push(`${ref.path} is encrypted by its author and cannot be shown.`);
      continue;
    }
    root.add(buildModel(kn5, ref, ctx));
    // Let the page breathe between models: a big one takes a moment to build.
    await new Promise((r) => setTimeout(r, 0));
  }
  if (!root.children.length) throw new Error(warnings[0] || "None of this track's models could be read.");

  report("Finding the road surface", 1);
  const ground = groundGrid(concat(ctx.ground));
  ctx.ground = null;
  if (!ground.count) warnings.push("No road surface was found, so the cars run at a flat height.");
  const bounds = new THREE.Box3().setFromObject(root);

  return {
    key: `${lower(track)}|${lower(layout)}`,
    name,
    root,
    ground,
    cameras,
    bounds,
    triangles: ctx.triangles,
    warnings,
    dispose() {
      for (const d of ctx.disposables) d.dispose();
      ctx.disposables.length = 0;
    },
  };
}
