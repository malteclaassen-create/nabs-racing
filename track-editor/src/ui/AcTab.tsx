import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { useEditor } from '../store/store';
import {
  acPieceWorldPoints, applyMarkerEdits, meshPartition,
  type AcSceneMesh, type AcSceneModel,
} from '../ac/acScene';
import { ribbonBounds, ribbonSideOf } from '../ac/ribbon';
import { useDerived } from '../store/derived';
import type { Frame } from '../core/spline';
import { markerGroup } from '../ac/patchKn5';
import {
  identityMeshTransform, isIdentityTransform, partKey,
  type AcMeshTransform, type Vec3,
} from '../types';
import { Check, Num, Row, Seg, Section, Text } from './controls';

/** A new size in metres, as a multiplier of the original. Never zero. */
function safeScale(metres: number, original: number): number {
  if (!(original > 1e-6)) return 1;
  return Math.max(0.01, metres) / original;
}

/**
 * The world point an anchor choice picks out of a box.
 *
 * 0 is the low side of that axis, 1 the high side, 0.5 the middle -- so
 * "grows from the base" is y = 0 and lands exactly on the bottom face.
 */
function anchorPoint(box: THREE.Box3, anchor: readonly number[]): Vec3 {
  return [
    box.min.x + (box.max.x - box.min.x) * anchor[0],
    box.min.y + (box.max.y - box.min.y) * anchor[1],
    box.min.z + (box.max.z - box.min.z) * anchor[2],
  ];
}

/**
 * The imported track's own panel: what came in, and what is being changed
 * about it.
 *
 * Deliberately built around a search box and a capped list rather than a tree
 * of everything. The reference circuit's chosen layout is 630 meshes across 14
 * models, and a component that renders a row per mesh and subscribes to the
 * project would put all of them on the render path of every edit -- the exact
 * mistake the scene tab already had to be rescued from once. So the lists here
 * take narrow selectors, filter first and cap at fifty rows.
 */

const MESH_LIMIT = 50;

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

function ModelList() {
  const scene = useEditor((s) => s.acScene);
  if (!scene) return null;

  return (
    <Section title="Models">
      <div className="list">
        {scene.models.map((m) => (
          <div className="list-item" key={m.path} title={m.readOnlyReason ?? ''}>
            <span
              className="dot"
              style={{ background: m.editable ? 'var(--ok)' : 'var(--warn)' }}
            />
            <span className="grow">{m.path}</span>
            <span style={{ color: 'var(--text-faint)' }}>
              {m.meshes.length} · {Math.round(m.triangles / 1000)}k
            </span>
          </div>
        ))}
      </div>
      {scene.models.some((m) => !m.editable) && (
        <p className="hint">
          An amber dot means that model could not be read, almost always Custom Shaders Patch
          encryption. It is copied across untouched on export, it just cannot be edited.
        </p>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Meshes                                                              */
/* ------------------------------------------------------------------ */

function MeshBrowser() {
  const scene = useEditor((s) => s.acScene);
  const hidden = useEditor((s) => s.project.acImport?.edits.hidden);
  const renamed = useEditor((s) => s.project.acImport?.edits.renamed);
  const setHidden = useEditor((s) => s.setAcMeshHidden);

  const reload = useEditor((s) => s.reloadAcScene);
  const [filter, setFilter] = useState('');
  const [surfacesOnly, setSurfacesOnly] = useState(true);

  const all = useMemo(() => {
    if (!scene) return [] as AcSceneMesh[];
    const out: AcSceneMesh[] = [];
    for (const m of scene.models) out.push(...m.meshes);
    return out;
  }, [scene]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return all
      .filter((m) => (!surfacesOnly || m.surface !== null))
      .filter((m) => !needle || m.name.toLowerCase().includes(needle)
        || (m.surface ?? '').toLowerCase().includes(needle))
      .slice(0, MESH_LIMIT);
  }, [all, filter, surfacesOnly]);

  if (!scene) return null;
  const isHidden = (m: AcSceneMesh) => (hidden?.[m.model] ?? []).includes(m.name);
  const newName = (m: AcSceneMesh) => renamed?.[m.model]?.[m.name];

  return (
    <Section title="Objects in the imported track">
      <Row label="Search">
        <Text value={filter} onChange={setFilter} placeholder="kerb, road, tree…" />
      </Row>
      <Row>
        <Check
          label="Only meshes with a physics surface"
          checked={surfacesOnly}
          onChange={setSurfacesOnly}
        />
      </Row>
      <p className="hint">
        {shown.length} of {all.filter((m) => !surfacesOnly || m.surface !== null).length} shown.
        Hiding a mesh removes it from the exported model completely, its collision goes with it.
      </p>

      <div className="list">
        {shown.map((m) => {
          const gone = isHidden(m);
          const renamedTo = newName(m);
          return (
            <div className="list-item" key={`${m.model}#${m.name}`} title={m.model}>
              <span
                className="dot"
                style={{ background: gone ? 'var(--danger)' : m.surface ? 'var(--ok)' : 'var(--text-faint)' }}
              />
              <span className="grow" style={{ textDecoration: gone ? 'line-through' : undefined }}>
                {renamedTo ?? m.name}
              </span>
              <span style={{ color: 'var(--text-faint)' }}>{m.surface ?? '-'}</span>
              <button
                className="btn ghost"
                style={{ padding: '1px 6px' }}
                onClick={() => setHidden(m.model, m.name, !gone)}
              >
                {gone ? 'Show' : 'Hide'}
              </button>
            </div>
          );
        })}
        {shown.length === 0 && <div className="hint" style={{ padding: 8 }}>Nothing matches.</div>}
      </div>

      <SurfaceReassign />

      <button className="btn" style={{ marginTop: 8 }} onClick={() => reload()}>
        Redraw with the current changes
      </button>
      <p className="hint">
        Hiding and renaming take effect in the exported track straight away; this redraws the
        viewport to match.
      </p>
    </Section>
  );
}

/**
 * Changing a mesh's physics surface.
 *
 * Which is done by RENAMING it: AC reads the surface off the name, so a strip
 * of grass that should be tarmac becomes tarmac by being called `1ROAD_...`.
 * The keys offered are the track's own, from its surfaces.ini, because those
 * are the only ones it defines.
 */
function SurfaceReassign() {
  const scene = useEditor((s) => s.acScene);
  const renameMesh = useEditor((s) => s.renameAcMesh);
  const [mesh, setMesh] = useState('');
  const [key, setKey] = useState('');

  if (!scene) return null;
  const keys = scene.folder.surfaces.map((s) => s.key);
  const hit = mesh
    ? scene.models.flatMap((m) => m.meshes).find((m) => m.name === mesh.trim())
    : null;

  return (
    <div className="list-group" style={{ marginTop: 12 }}>
      <h4>Change a surface</h4>
      <Row label="Mesh">
        <Text value={mesh} onChange={setMesh} placeholder="1grass01" />
      </Row>
      <Row label="Becomes">
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          <option value="">choose a surface…</option>
          {keys.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Row>
      {mesh.trim() !== '' && !hit && (
        <p className="hint" style={{ color: 'var(--warn)' }}>No mesh by that name.</p>
      )}
      <button
        className="btn"
        disabled={!hit || key === ''}
        onClick={() => {
          if (!hit) return;
          // The leading digit is AC's priority and stays; everything after the
          // old key is the author's own name and stays too.
          const rest = hit.surface
            ? hit.name.slice(1 + hit.surface.length)
            : hit.name.slice(1);
          renameMesh(hit.model, hit.name, `1${key}${rest}`);
          setMesh('');
        }}
      >
        Rename it
      </button>
      {hit && key !== '' && (
        <p className="hint">
          <code>{hit.name}</code> → <code>
            {`1${key}${hit.surface ? hit.name.slice(1 + hit.surface.length) : hit.name.slice(1)}`}
          </code>
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The selected mesh                                                   */
/* ------------------------------------------------------------------ */

/**
 * Moving, turning and resizing one of the track's own objects.
 *
 * The gizmo in the viewport does the same thing; this is for the numbers, and
 * for putting one back exactly where it was, which no amount of dragging can
 * do reliably.
 */
/**
 * A copy the user laid down.
 *
 * Its own little panel, because the useful things to do to a copy are not the
 * same as for an original: it can be taken away completely, where an original
 * can only be hidden.
 */
export function SelectedCopy() {
  const selection = useEditor((s) => s.selection);
  const copies = useEditor((s) => s.project.acImport?.edits.copies);
  const remove = useEditor((s) => s.removeAcCopy);
  const setT = useEditor((s) => s.setAcCopyTransform);
  const duplicate = useEditor((s) => s.duplicateAcPiece);
  const frames = useDerived().trackFrames;

  if (selection?.kind !== 'acCopy') return null;
  const copy = copies?.[selection.model]?.find((c) => c.id === selection.id);
  if (!copy) return null;
  const t = copy.t;
  const edit = (patch: Partial<AcMeshTransform>) =>
    setT(selection.model, selection.id, { ...t, ...patch });

  return (
    <Section title="A copy you placed">
      <div className="kv">
        <span>Copy of</span><b style={{ overflowWrap: 'anywhere' }}>{copy.mesh}</b>
        <span>Piece</span><b>{copy.part === undefined ? 'the whole mesh' : copy.part + 1}</b>
        <span>In</span><b>{selection.model}</b>
      </div>
      <Row label={t.ribbon ? 'Slide (m)' : 'Move (m)'}>
        <Num value={t.p[0]} step={0.05} onChange={(v) => edit({ p: [v, t.p[1], t.p[2]] })} />
        <Num value={t.p[1]} step={0.05} onChange={(v) => edit({ p: [t.p[0], v, t.p[2]] })} />
        <Num value={t.p[2]} step={0.05} onChange={(v) => edit({ p: [t.p[0], t.p[1], v] })} />
      </Row>
      {t.ribbon ? (
        <p className="hint">
          Sideways · up · <b>along the lap</b>, this copy follows the corner. Drag the bar on
          it in the viewport to slide it, or the end grips to cover more of the corner.
        </p>
      ) : (
        <Row label="Turn (°)">
          <Num value={t.r[1]} step={1} onChange={(v) => edit({ r: [t.r[0], v, t.r[2]] })} />
        </Row>
      )}
      <p className="hint">
        A copy is a new mesh in the exported model, sharing the original&apos;s material and its
        physics surface. The original is not touched.
      </p>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="btn"
          onClick={() => duplicate({ model: selection.model, name: copy.mesh, part: copy.part }, frames)}
        >
          Another one
        </button>
        <button className="btn ghost" onClick={() => remove(selection.model, selection.id)}>
          Take it away
        </button>
      </div>
    </Section>
  );
}

/**
 * One AC_* marker: a pit box, a grid slot, a timing gate post.
 *
 * Its numbers live here rather than in the track-wide panel for the same
 * reason everything else does: this is what "Properties" means.
 */
export function SelectedMarker() {
  const selection = useEditor((s) => s.selection);
  const scene = useEditor((s) => s.acScene);
  const edits = useEditor((s) => s.project.acImport?.edits.markers);
  const editMarker = useEditor((s) => s.editAcMarker);
  const select = useEditor((s) => s.select);

  if (!scene || selection?.kind !== 'acMarker') return null;
  const live = applyMarkerEdits(scene.markers, edits ?? {});
  const marker = live.find((m) => m.name === selection.name);
  if (!marker) return null;

  const move = (p: [number, number, number], rot: number) =>
    editMarker(selection.model, { op: 'move', name: selection.name, p, rot });

  return (
    <Section title={selection.name}>
      <div className="kv">
        <span>Kind</span><b>{(markerGroup(selection.name) ?? '').replace('AC_', '') || 'marker'}</b>
        <span>In</span><b>{selection.model}</b>
      </div>
      <Row label="Position">
        <Num value={+marker.pos.x.toFixed(2)} step={0.1}
          onChange={(v) => move([v, marker.pos.y, marker.pos.z], marker.rot)} />
        <Num value={+marker.pos.y.toFixed(2)} step={0.1}
          onChange={(v) => move([marker.pos.x, v, marker.pos.z], marker.rot)} />
        <Num value={+marker.pos.z.toFixed(2)} step={0.1}
          onChange={(v) => move([marker.pos.x, marker.pos.y, v], marker.rot)} />
      </Row>
      <Row label="Facing (°)">
        <Num value={+marker.rot.toFixed(1)} step={1}
          onChange={(v) => move([marker.pos.x, marker.pos.y, marker.pos.z], v)} />
      </Row>
      <p className="hint">
        Numbering is repaired across every model on export, so deleting one closes the gap rather
        than cutting the rest off.
      </p>
      <button
        className="btn ghost"
        onClick={() => {
          editMarker(selection.model, { op: 'delete', name: selection.name });
          select(null);
        }}
      >
        Delete this one
      </button>
    </Section>
  );
}

/** Everything picked at once, and what can be done to the lot. */
export function MarkedGroup() {
  const marked = useEditor((s) => s.acMarked);
  const clear = useEditor((s) => s.clearAcMarks);
  const setTransform = useEditor((s) => s.setAcMeshTransform);
  const setHidden = useEditor((s) => s.setAcMeshHidden);
  const refresh = useEditor((s) => s.refreshAcLoose);
  const select = useEditor((s) => s.select);

  if (marked.length < 2) return null;
  const models = new Set(marked.map((m) => m.model));

  return (
    <Section title={`${marked.length} pieces picked`}>
      <p className="hint" style={{ marginTop: 0 }}>
        Drag the gizmo to move, turn or resize them together, they swing about the middle of the
        group, not each about itself. Shift-click adds and removes pieces.
        {models.size > 1 && ` They come from ${models.size} different models, which is fine.`}
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          className="btn"
          onClick={() => {
            for (const ref of marked) setTransform(ref.model, partKey(ref.name, ref.part), null);
            refresh();
          }}
        >
          Put them all back
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            for (const ref of marked) setHidden(ref.model, ref.name, true);
            clear();
            select(null);
            refresh();
          }}
        >
          Remove them
        </button>
        <button className="btn ghost" onClick={clear}>Unpick</button>
      </div>
      <div className="list" style={{ maxHeight: 160, overflowY: 'auto', marginTop: 8 }}>
        {marked.slice(0, 40).map((m) => (
          <div className="list-item" key={`${m.model}#${m.name}#${m.part ?? ''}`} title={m.model}>
            <span className="grow">{m.name}</span>
            <span style={{ color: 'var(--text-faint)' }}>
              {m.part === undefined ? 'whole' : `piece ${m.part + 1}`}
            </span>
          </div>
        ))}
        {marked.length > 40 && (
          <div className="hint" style={{ padding: 6 }}>… and {marked.length - 40} more</div>
        )}
      </div>
    </Section>
  );
}

/**
 * A piece measured in track coordinates rather than world axes.
 *
 * Null when there is no centre line to measure against, in which case the
 * along-the-track resize is not offered at all -- better a missing control than
 * one that silently does the wrong thing.
 */
function ribbonSizeOf(
  frames: readonly Frame[],
  model: AcSceneModel | undefined,
  mesh: AcSceneMesh | undefined,
  part?: number,
  edge?: -1 | 1,
): { length: number; width: number; height: number } | null {
  if (!model || !mesh || frames.length < 2) return null;
  const points = acPieceWorldPoints(model, mesh.name, part);
  if (!points) return null;
  const b = ribbonBounds(frames, points, edge);
  if (!b) return null;
  return {
    length: b.maxS - b.minS,
    width: b.maxLateral - b.minLateral,
    height: b.maxHeight - b.minHeight,
  };
}

/** The edge a fresh ribbon should measure against: the side the piece sits on. */
function edgeSideFor(
  frames: readonly Frame[],
  model: AcSceneModel,
  meshName: string,
  part?: number,
): -1 | 1 | undefined {
  if (frames.length < 2) return undefined;
  const points = acPieceWorldPoints(model, meshName, part);
  const centre = points ? ribbonBounds(frames, points) : null;
  return centre ? ribbonSideOf(centre) : undefined;
}

export function SelectedMesh() {
  const selection = useEditor((s) => s.selection);
  const marked = useEditor((s) => s.acMarked);
  const frames = useDerived().trackFrames;
  const scene = useEditor((s) => s.acScene);
  const transforms = useEditor((s) => s.project.acImport?.edits.transforms);
  const setTransform = useEditor((s) => s.setAcMeshTransform);
  const setHidden = useEditor((s) => s.setAcMeshHidden);
  const refresh = useEditor((s) => s.refreshAcLoose);
  const select = useEditor((s) => s.select);
  const duplicate = useEditor((s) => s.duplicateAcPiece);

  // Every hook BEFORE the early returns: if the selected mesh disappears while
  // this panel is up, a hook behind a `return null` changes the hook count
  // between renders, and React tears the whole tree down.
  const sel = selection?.kind === 'acMesh' && marked.length <= 1 ? selection : null;
  const model = sel && scene ? scene.models.find((m) => m.path === sel.model) : undefined;
  const mesh = sel ? model?.meshes.find((m) => m.name === sel.name) : undefined;
  const [anchor, setAnchor] = useState<[number, number, number]>([0.5, 0, 0.5]);
  const storedT = sel ? transforms?.[sel.model]?.[partKey(sel.name, sel.part)] : undefined;
  // The same piece measured along the track: how far it runs, how wide it is
  // beside its datum (the edge of the tarmac when the ribbon follows one, the
  // centre line otherwise), how tall. Memoised: it projects every vertex onto
  // the centre line, and this panel re-renders on every frame of a drag.
  const storedEdge = storedT?.ribbon?.edge;
  const ribbonSize = useMemo(
    () => (sel && model && mesh ? ribbonSizeOf(frames, model, mesh, sel.part, storedEdge) : null),
    [sel, model, mesh, frames, storedEdge],
  );

  if (!sel || !scene || !model || !mesh) return null;

  const key = partKey(sel.name, sel.part);
  const t = storedT ?? identityMeshTransform();
  const partition = sel.part !== undefined ? meshPartition(model, sel.name) : null;
  const piece = partition?.parts[sel.part ?? -1];
  // The piece as the modder left it: everything on this panel is measured
  // against that, so "1.89 m" always means the same thing however often it has
  // been nudged.
  const worldBox = piece ? piece.box.clone().applyMatrix4(mesh.matrix) : mesh.box.clone();
  const base = worldBox.getSize(new THREE.Vector3());
  const size = base;
  const edit = (patch: Partial<AcMeshTransform>) => {
    setTransform(sel.model, key, { ...t, ...patch });
    refresh();
  };

  return (
    <Section title="Selected object">
      <div className="kv">
        <span>Name</span><b style={{ overflowWrap: 'anywhere' }}>{mesh.name}</b>
        <span>In</span><b>{mesh.model}</b>
        <span>Material</span><b>{mesh.materialName}</b>
        <span>Surface</span><b>{mesh.surface ?? 'scenery, no physics'}</b>
        <span>Triangles</span>
        <b>
          {(piece ? piece.triangles.length : mesh.triangles).toLocaleString('en-US')}
          {piece && ` of ${mesh.triangles.toLocaleString('en-US')}`}
        </b>
        {partition && (
          <>
            <span>Piece</span>
            <b>{(sel.part ?? 0) + 1} of {partition.parts.length}</b>
          </>
        )}
        <span>Size</span>
        <b>{size.x.toFixed(1)} × {size.y.toFixed(1)} × {size.z.toFixed(1)} m</b>
      </div>

      {!model?.editable && (
        <div className="callout" style={{ borderLeftColor: 'var(--warn)' }}>
          This model could not be read, so it can be copied but not changed.
        </div>
      )}

      {/*
        With the ribbon on, these three numbers are reinterpreted downstream as
        sideways / up / along the lap -- which used to happen silently, with
        the label still claiming world axes. Now the label says so.
      */}
      <Row label={t.ribbon ? 'Slide (m)' : 'Move (m)'}>
        <Num value={t.p[0]} step={0.05} onChange={(v) => edit({ p: [v, t.p[1], t.p[2]] })} />
        <Num value={t.p[1]} step={0.05} onChange={(v) => edit({ p: [t.p[0], v, t.p[2]] })} />
        <Num value={t.p[2]} step={0.05} onChange={(v) => edit({ p: [t.p[0], t.p[1], v] })} />
      </Row>
      {t.ribbon && (
        <p className="hint">Sideways · up · <b>along the lap</b>.</p>
      )}
      {!t.ribbon && (
        <Row label="Turn (°)">
          <Num value={t.r[0]} step={1} onChange={(v) => edit({ r: [v, t.r[1], t.r[2]] })} />
          <Num value={t.r[1]} step={1} onChange={(v) => edit({ r: [t.r[0], v, t.r[2]] })} />
          <Num value={t.r[2]} step={1} onChange={(v) => edit({ r: [t.r[0], t.r[1], v] })} />
        </Row>
      )}
      {/*
        Following the corner.

        A kerb is a ribbon, not a box: scaling one on a world axis turns its arc
        into an ellipse and walks it off the tarmac -- measured at 1.41 m on a
        35 degree corner for a two percent change. On, the resize happens in the
        track's own coordinates and the same change stays within a centimetre.
      */}
      <Row>
        <Check
          label="Follow the corner when resizing"
          checked={!!t.ribbon}
          onChange={(v) => {
            if (!v) { edit({ ribbon: undefined }); return; }
            // The datum is chosen ONCE, here: sideways is measured from the
            // edge of the tarmac the piece sits against, so sliding it along
            // the lap follows the edge wherever the road widens or narrows.
            const edge = edgeSideFor(frames, model, sel.name, sel.part);
            edit({
              ribbon: {
                length: 1, width: 1, height: 1,
                anchor: [anchor[0], anchor[1], anchor[2]],
                ...(edge ? { edge } : {}),
              },
            });
          }}
        />
      </Row>
      {!t.ribbon && mesh.surface === 'KERB' && (
        <p className="hint">
          This is a kerb, so the bar and end grips in the viewport already work, the first
          drag switches this on by itself and pins the kerb to the edge of the tarmac.
        </p>
      )}

      {t.ribbon && ribbonSize && (
        <>
          <Row label="Size (m)">
            <Num value={+(ribbonSize.width * t.ribbon.width).toFixed(3)} step={0.01}
              onChange={(v) => edit({ ribbon: { ...t.ribbon!, width: safeScale(v, ribbonSize.width) } })} />
            <Num value={+(ribbonSize.height * t.ribbon.height).toFixed(3)} step={0.01}
              onChange={(v) => edit({ ribbon: { ...t.ribbon!, height: safeScale(v, ribbonSize.height) } })} />
            <Num value={+(ribbonSize.length * t.ribbon.length).toFixed(2)} step={0.05}
              onChange={(v) => edit({ ribbon: { ...t.ribbon!, length: safeScale(v, ribbonSize.length) } })} />
          </Row>
          <p className="hint">
            Across × up × <b>along the track</b>. Was {ribbonSize.width.toFixed(2)} ×{' '}
            {ribbonSize.height.toFixed(2)} × {ribbonSize.length.toFixed(2)} m. Making it longer
            covers more of the corner instead of stretching a straight line through it.
            Or skip the numbers: drag the bar on it in the viewport to slide it along the
            lap (Shift = sideways), and drag either end grip to cover more or less of
            the corner.
          </p>
          <p className="hint">
            <b>Dark gaps after stretching?</b> The modder cut a hole in the ground exactly
            under this piece, and a stretched or slid kerb walks off that hole and shows it.
            To cover more of the corner cleanly, <b>hold Alt and drag an end grip</b>: the
            distance is filled with seamless copies on intact ground and the original never
            moves.
          </p>
        </>
      )}

      {!t.ribbon && (
      <>
      {/*
        Size in METRES, not multipliers.

        Nobody looks at a kerb and thinks "1.027 times wider"; they think "five
        centimetres wider". The original size is known, so the multiplier is
        arithmetic the editor can do instead of the user.
      */}
      <Row label="Size (m)">
        <Num value={+(base.x * t.s[0]).toFixed(3)} step={0.01}
          onChange={(v) => edit({ s: [safeScale(v, base.x), t.s[1], t.s[2]] })} />
        <Num value={+(base.y * t.s[1]).toFixed(3)} step={0.01}
          onChange={(v) => edit({ s: [t.s[0], safeScale(v, base.y), t.s[2]] })} />
        <Num value={+(base.z * t.s[2]).toFixed(3)} step={0.01}
          onChange={(v) => edit({ s: [t.s[0], t.s[1], safeScale(v, base.z)] })} />
      </Row>
      <p className="hint">
        Was {base.x.toFixed(2)} × {base.y.toFixed(2)} × {base.z.toFixed(2)} m.
      </p>

      {/*
        Which end stays put while it grows.

        A kerb made one centimetre taller about its centre goes five millimetres
        up and five millimetres INTO the road. Height almost always wants to
        grow off the base, and this is the control that says so. It is stored as
        the pivot the transform already carries, so nothing downstream needs to
        know about it.
      */}
      </>
      )}

      <Row label="Grows from">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <Seg
            key={axis}
            value={anchor[i]}
            options={[
              { value: 0, label: axis === 'y' ? 'base' : '−' },
              { value: 0.5, label: 'middle' },
              { value: 1, label: axis === 'y' ? 'top' : '+' },
            ]}
            onChange={(v) => {
              const next: [number, number, number] = [...anchor] as [number, number, number];
              next[i] = v;
              setAnchor(next);
              edit({ about: anchorPoint(worldBox, next) });
            }}
          />
        ))}
      </Row>

      <Row>
        <Check
          label="Keep the texture at its real size"
          checked={t.keepTexture !== false}
          onChange={(v) => edit({ keepTexture: v })}
        />
      </Row>
      <p className="hint">
        {partition
          ? `This mesh holds ${partition.parts.length} separate pieces, the modder merged them,
             and only the one you clicked changes.`
          : 'This mesh is one connected object, so it changes as a whole.'}
        {' '}Without the texture option a wider kerb gets wider chequers and stops matching its
        neighbours; with it, the pattern keeps its size and there is simply more of it. It only
        applies where the texture actually repeats.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          className="btn"
          disabled={isIdentityTransform(t)}
          onClick={() => { setTransform(sel.model, key, null); refresh(); }}
        >
          Put it back
        </button>
        <button
          className="btn"
          onClick={() => duplicate({ model: sel.model, name: sel.name, part: sel.part }, frames)}
          title="Lay down another one of these, a section further along"
        >
          Another one
        </button>
        <button
          className="btn ghost"
          onClick={() => { setHidden(sel.model, sel.name, true); select(null); refresh(); }}
        >
          Remove it
        </button>
      </div>
      <p className="hint">
        Shift-click more pieces in the viewport to move a whole group at once, a car is several
        meshes, and a run of barriers is a dozen pieces.
      </p>
      <div style={{ display: 'none' }}>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

function MarkerGroups() {
  const scene = useEditor((s) => s.acScene);
  const edits = useEditor((s) => s.project.acImport?.edits.markers);
  const select = useEditor((s) => s.select);
  const editMarker = useEditor((s) => s.editAcMarker);
  const resetMarkers = useEditor((s) => s.resetAcMarkers);
  const selection = useEditor((s) => s.selection);

  const groups = useMemo(() => {
    if (!scene) return [];
    const live = applyMarkerEdits(scene.markers, edits ?? {});
    const map = new Map<string, typeof live>();
    for (const m of live) {
      const g = markerGroup(m.name) ?? m.name;
      const list = map.get(g);
      if (list) list.push(m);
      else map.set(g, [m]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [scene, edits]);

  if (!scene) return null;
  const selected = selection?.kind === 'acMarker' ? selection : null;
  const changed = Object.values(edits ?? {}).reduce((a, l) => a + l.length, 0);

  return (
    <Section title="Pit boxes, grid and timing">
      <div className="list">
        {groups.map(([group, list]) => (
          <div className="list-item" key={group}>
            <span className="grow">{group.replace('AC_', '')}</span>
            <span style={{ color: 'var(--text-faint)' }}>{list.length}</span>
          </div>
        ))}
      </div>

      {selected ? (
        <div className="list-group" style={{ marginTop: 10 }}>
          <h4>{selected.name}</h4>
          <p className="hint">
            In <code>{selected.model}</code>. Drag it with the gizmo; the numbering is repaired
            across every model on export.
          </p>
          <button
            className="btn"
            onClick={() => {
              editMarker(selected.model, { op: 'delete', name: selected.name });
              select(null);
            }}
          >
            Delete this one
          </button>
        </div>
      ) : (
        <p className="hint">Click a pit box or grid slot in the viewport to move or delete it.</p>
      )}

      {changed > 0 && (
        <>
          <p className="hint" style={{ marginTop: 8 }}>{changed} change(s) recorded.</p>
          {Object.keys(edits ?? {}).map((model) => (
            <button className="btn ghost" key={model} onClick={() => resetMarkers(model)}>
              Undo all changes in {model}
            </button>
          ))}
        </>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */

export function AcTab() {
  const imported = useEditor((s) => s.project.acImport);
  const scene = useEditor((s) => s.acScene);
  const loading = useEditor((s) => s.acLoading);
  const reload = useEditor((s) => s.reloadAcScene);
  const close = useEditor((s) => s.closeAcImport);
  const commit = useEditor((s) => s.commit);

  if (!imported) {
    return (
      <Section title="No imported track">
        <p className="hint">
          Use <b>Import track</b> in the toolbar to open a circuit from your Assetto Corsa
          installation and edit it. The original is opened read only; exporting writes a new
          track folder beside it.
        </p>
      </Section>
    );
  }

  return (
    <>
      <Section title="Imported track">
        <div className="kv">
          <span>Source</span><b>{imported.slug}</b>
          <span>Layout</span><b>{imported.layout || 'the only one'}</b>
          <span>Models loaded</span><b>{scene?.models.length ?? 0}</b>
          <span>Held in memory</span><b>{scene ? `${Math.round(scene.bytes / 1e6)} MB` : '-'}</b>
        </div>
        <Row label="Export as">
          <Text
            value={imported.targetSlug}
            onChange={(v) =>
              commit((p) => {
                if (p.acImport) p.acImport.targetSlug = v.replace(/[^A-Za-z0-9_.-]/g, '');
              })
            }
          />
        </Row>
        {scene && scene.warnings.length > 0 && (
          <div className="list-group" style={{ marginTop: 8 }}>
            <h4>Notes from the import</h4>
            {scene.warnings.map((w) => (
              <p className="hint" key={w} style={{ color: 'var(--warn)' }}>{w}</p>
            ))}
          </div>
        )}
        {loading && (
          <div className="callout info">
            {loading.message}…
            <div className="progress"><div style={{ width: `${loading.fraction * 100}%` }} /></div>
          </div>
        )}
        <p className="hint">
          Click anything on the track to edit it, its size, position and material show up under
          <b> Properties</b>.
        </p>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button className="btn" onClick={() => reload()}>Reload</button>
          <button className="btn ghost" onClick={close}>Close the import</button>
        </div>
      </Section>

      <ModelList />
      <MarkerGroups />
      <MeshBrowser />
    </>
  );
}
