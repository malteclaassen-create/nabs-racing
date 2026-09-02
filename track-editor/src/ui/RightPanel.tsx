import { useState, useSyncExternalStore } from 'react';
import { AcTab, MarkedGroup, SelectedCopy, SelectedMarker, SelectedMesh } from './AcTab';
import { useEditor, type EditorMode, type RightTab } from '../store/store';
import { useDerived } from '../store/derived';
import { LIBRARY_BY_KEY, PAD_SIZE, propSize } from '../core/library';
import { assetIdOf, assetVersion, onAssetsChanged } from '../io/assetCache';
import { Check, Num, Row, Seg, Section, Slider, Text } from './controls';
import { IconCopy, IconTrash } from './icons';
import { pathDataOf, pathLabelOf } from '../types';
import { canCarryBanner } from '../core/banner';
import { getViewportCameraPose } from '../scene/Viewport';
import { CAMERA_SPACING } from '../core/cameras';
import { pickFile } from '../io/project';
import type { PathData, PathId, Project, PropInstance, TrackNode } from '../types';
import {
  applyToSection,
  deleteSectionInterior,
  raiseSection,
  rampSection,
  sectionAll,
  sectionAny,
  sectionAverage,
  sectionIndices,
  sectionNodes,
  smoothSection,
  straightenSection,
  subdivideSection,
} from '../core/section';
import { attachPitLane, nodesAlongPitLane } from '../core/pitLink';
import { GROUND_KINDS } from '../core/terrain';
import { BRAKE_MARKER_KINDS, findCorners, planBrakeMarkers } from '../core/brakeMarkers';
import { SIGN_DISTANCES } from '../core/textures';
import {
  APRON_COLOURS,
  eraseKerbRange,
  insertKerbSpan,
  KERB_STYLES,
  makeKerbSpan,
  moveKerbSpan,
  spanMetres,
} from '../core/kerbs';
import { RoadShapeSection } from './LeftPanel';

/**
 * `modes` says where a tab belongs.
 *
 * Track is the generated road's settings -- width, kerb style, run off -- and
 * on an imported circuit none of it does anything, because the road is a fixed
 * mesh. Import is the other way round.
 */
const TABS: Array<{ id: RightTab; label: string; modes?: EditorMode[] }> = [
  { id: 'scene', label: 'Scene' },
  { id: 'properties', label: 'Properties' },
  { id: 'track', label: 'Track', modes: ['build'] },
  { id: 'race', label: 'Race' },
  { id: 'ac', label: 'Import', modes: ['edit'] },
  { id: 'export', label: 'Export' },
];

export function RightPanel({ onExport }: { onExport: () => void }) {
  const rawTab = useEditor((s) => s.rightTab);
  const setTab = useEditor((s) => s.setRightTab);
  const mode = useEditor((s) => s.mode);

  const shown = TABS.filter((t) => !t.modes || t.modes.includes(mode));
  // Switching mode can hide the open tab; fall back rather than showing blank.
  const tab = shown.some((t) => t.id === rawTab) ? rawTab : shown[0].id;

  return (
    <div className="rightpanel">
      <div className="tabs">
        {shown.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel-scroll">
        {tab === 'scene' && <SceneTab />}
        {tab === 'properties' && <PropertiesTab />}
        {tab === 'track' && <TrackTab />}
        {tab === 'race' && <RaceTab />}
        {tab === 'ac' && <AcTab />}
        {tab === 'export' && <ExportTab onExport={onExport} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene / outliner                                                    */
/* ------------------------------------------------------------------ */

/**
 * The outliner.
 *
 * Two things here are load bearing, and both were got wrong first time round.
 *
 * It subscribes to the three LISTS, never to `project` as a whole. Sculpting
 * replaces `terrain.heights` sixty times a second and nothing else; with a
 * whole-project subscription every one of those frames re-rendered this
 * component, and with a couple of thousand objects in the scene that is a
 * couple of thousand rows reconciled, restyled and laid out per frame. Measured
 * in the browser on a 2000 object scene: twelve brush dabs took over thirty
 * seconds with this panel open, against a hundredth of that with it closed.
 * Structural sharing in the store is what makes the narrow selectors work --
 * `props` keeps its identity across an edit that did not touch it.
 *
 * And the object list is capped. Even mounted once, thousands of rows is a
 * slow panel and an unusable one; a filter and a count are more use than a list
 * nobody can scroll through anyway.
 */
const SCENE_LIST_CAP = 200;

function SceneTab() {
  const trackNodes = useEditor((s) => s.project.track.nodes);
  const pitNodes = useEditor((s) => s.project.pit.nodes);
  const props = useEditor((s) => s.project.props);
  const trackPath = useEditor((s) => s.project.track);
  const pitPath = useEditor((s) => s.project.pit);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const deleteProp = useEditor((s) => s.deleteProp);
  const [filter, setFilter] = useState('');

  /** Same rule as the viewport: shift extends the pick into a run of points. */
  const pick = (e: { shiftKey: boolean }, path: 'track' | 'pit', id: string) => {
    const anchor =
      selection?.kind === 'node' && selection.path === path
        ? selection.id
        : selection?.kind === 'section' && selection.path === path
          ? selection.fromId
          : null;
    if (e.shiftKey && anchor && anchor !== id) select({ kind: 'section', path, fromId: anchor, toId: id });
    else select({ kind: 'node', path, id });
  };

  // Built once per render rather than walked again for every row in the list.
  const selectedIds =
    selection?.kind === 'section'
      ? new Set(
          sectionNodes(
            selection.path === 'track' ? trackPath : pitPath,
            selection.fromId,
            selection.toId,
          ).map((n) => n.id),
        )
      : null;

  const inSection = (path: 'track' | 'pit', id: string) =>
    selectedIds !== null && selection?.kind === 'section' && selection.path === path && selectedIds.has(id);

  const needle = filter.trim().toLowerCase();
  const matching = needle ? props.filter((p) => p.name.toLowerCase().includes(needle)) : props;
  const shown = matching.length > SCENE_LIST_CAP ? matching.slice(0, SCENE_LIST_CAP) : matching;

  return (
    <div className="section">
      <div className="list-group">
        <h4>Track spline ({trackNodes.length})</h4>
        <div className="list">
          {trackNodes.map((n, i) => {
            const on = selection?.kind === 'node' && selection.path === 'track' && selection.id === n.id;
            return (
              <div
                key={n.id}
                className={`list-item ${on || inSection('track', n.id) ? 'on' : ''}`}
                onClick={(e) => pick(e, 'track', n.id)}
              >
                <span className="dot" style={{ background: '#4da3ff' }} />
                <span className="grow">Point {i + 1}</span>
                <span className="badge">{n.p[1].toFixed(1)} m</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="list-group">
        <h4>Pit lane ({pitNodes.length})</h4>
        <div className="list">
          {pitNodes.map((n, i) => {
            const on = selection?.kind === 'node' && selection.path === 'pit' && selection.id === n.id;
            return (
              <div
                key={n.id}
                className={`list-item ${on || inSection('pit', n.id) ? 'on' : ''}`}
                onClick={(e) => pick(e, 'pit', n.id)}
              >
                <span className="dot" style={{ background: '#ff9f43' }} />
                <span className="grow">Point {i + 1}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="list-group">
        <h4>Objects ({props.length})</h4>
        {props.length > SCENE_LIST_CAP && (
          <input
            type="text"
            placeholder={`Filter ${props.length} objects by name…`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginBottom: 6 }}
          />
        )}
        <div className="list">
          {shown.map((p) => {
            const on = selection?.kind === 'prop' && selection.id === p.id;
            return (
              <div key={p.id} className={`list-item ${on ? 'on' : ''}`} onClick={() => select({ kind: 'prop', id: p.id })}>
                <span className="dot" style={{ background: 'var(--good)' }} />
                <span className="grow">{p.name}</span>
                <button
                  className="btn ghost icon"
                  style={{ padding: 2 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteProp(p.id);
                  }}
                >
                  <IconTrash />
                </button>
              </div>
            );
          })}
          {props.length === 0 && <p className="hint">Nothing placed yet. Use the Place tool.</p>}
          {matching.length > shown.length && (
            <p className="hint">
              Showing {shown.length} of {matching.length}
              {filter ? ' matching' : ''} objects. Filter above, or pick one in the viewport.
            </p>
          )}
          {props.length > 0 && matching.length === 0 && (
            <p className="hint">Nothing matches “{filter}”.</p>
          )}
        </div>
      </div>

      <MarkerCounts />
    </div>
  );
}

/**
 * The marker tallies, split off on purpose.
 *
 * They come from `useDerived`, whose result is a NEW object on every edit --
 * including every one of the sixty height fields a second the sculpt brush
 * produces. Left in the outliner it would drag all those lists back into every
 * brush frame through the back door, however narrow their own subscriptions
 * are. Here it re-renders three numbers instead.
 */
function MarkerCounts() {
  const derived = useDerived();
  return (
    <>
      <div className="list-group">
        <h4>Race markers</h4>
        <div className="kv">
          <span>Grid slots</span>
          <b>{derived.markers.grid.length}</b>
          <span>Pit boxes</span>
          <b>{derived.markers.pits.length}</b>
          <span>Timing gates</span>
          <b>{derived.markers.gates.length}</b>
          <span>AI points</span>
          <b>{derived.ai.length}</b>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Properties of the current selection                                 */
/* ------------------------------------------------------------------ */

function PropertiesTab() {
  const selection = useEditor((s) => s.selection);
  const imported = useEditor((s) => s.project.acImport);
  const picked = useEditor((s) => s.acMarked.length);

  if (!selection) {
    return (
      <Section title="Nothing selected">
        <p className="hint">
          {imported
            ? 'Click a kerb, a barrier, a tree or a pit box in the viewport; Shift-click picks several.'
            : 'Click a control point, an object, a grid slot or a pit box in the viewport.'}
        </p>
      </Section>
    );
  }

  /*
   * The track's own things live here too.
   *
   * They used to be in the Import tab, which is where nobody looked: "Properties"
   * is what the panel is called and selecting something is what fills it in.
   * Import is now only about the track as a whole -- its models, its markers,
   * its object list.
   */
  if (picked > 1) return <MarkedGroup />;
  if (selection.kind === 'acMesh') return <SelectedMesh />;
  if (selection.kind === 'acCopy') return <SelectedCopy />;
  if (selection.kind === 'acMarker') return <SelectedMarker />;
  if (selection.kind === 'section') {
    return <SectionProps path={selection.path} fromId={selection.fromId} toId={selection.toId} />;
  }
  if (selection.kind === 'node') return <NodeProps path={selection.path} id={selection.id} />;
  if (selection.kind === 'kerb') return <KerbProps id={selection.id} />;
  if (selection.kind === 'ground') return <GroundShapeProps id={selection.id} />;
  if (selection.kind === 'prop') return <PropProps id={selection.id} />;
  if (selection.kind === 'grid') return <SlotProps kind="grid" index={selection.index} />;
  if (selection.kind === 'pitbox') return <SlotProps kind="pitbox" index={selection.index} />;
  return null;
}

/* ------------------------------------------------------------------ */
/* One editable painted ground shape                                   */
/* ------------------------------------------------------------------ */

function GroundShapeProps({ id }: { id: string }) {
  const shape = useEditor((s) => s.project.groundShapes.find((g) => g.id === id));
  const updateGroundShape = useEditor((s) => s.updateGroundShape);
  const deleteGroundShape = useEditor((s) => s.deleteGroundShape);
  const commit = useEditor((s) => s.commit);
  if (!shape) {
    return (
      <Section title="Ground shape">
        <p className="hint">That shape is gone. Pick another one with the Ground tool.</p>
      </Section>
    );
  }
  /** Set every point's smoothness at once, for the two whole-shape moods. */
  const allSmooth = (smooth: boolean) =>
    commit((p) => {
      p.groundShapes = p.groundShapes.map((s) =>
        s.id === id ? { ...s, points: s.points.map((pt) => ({ ...pt, smooth })) } : s,
      );
    });
  return (
    <Section
      title={shape.type === 'area' ? 'Ground area' : 'Ground line'}
      right={
        <button className="btn ghost icon" title="Delete this shape (Del)" onClick={() => deleteGroundShape(id)}>
          <IconTrash />
        </button>
      }
    >
      <Row label="Material">
        <Seg
          value={shape.kind}
          options={GROUND_KINDS.map((k, i) => ({ value: i, label: k.label }))}
          onChange={(v) => updateGroundShape(id, { kind: v })}
        />
      </Row>
      {shape.type === 'line' && (
        <Row label="Width">
          <Slider value={shape.width} min={1} max={30} step={0.5} digits={1} unit=" m" onChange={(v) => updateGroundShape(id, { width: v })} />
        </Row>
      )}
      <Row label="Corners">
        <Slider value={shape.cornerRadius} min={0} max={25} step={0.5} digits={1} unit=" m" onChange={(v) => updateGroundShape(id, { cornerRadius: v })} />
      </Row>
      <Row label="">
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => allSmooth(true)}>
            All curved
          </button>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => allSmooth(false)}>
            All corners
          </button>
        </div>
      </Row>
      <p className="hint">
        {shape.points.length} points. In the viewport, drag a point to move it, <b>Alt</b>-click
        one to flip it between corner and curve, and <b>Del</b> takes the picked point out
        (<b>Shift+Del</b> removes the whole shape). Click the border between two points to add a
        point there; drag the border to move the whole shape. The corner radius rounds the CORNER
        points; curved ones already bend.
      </p>
    </Section>
  );
}

function NodeProps({ path, id }: { path: PathId; id: string }) {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const deleteNode = useEditor((s) => s.deleteNode);
  const list = pathDataOf(project, path)?.nodes ?? [];
  const index = list.findIndex((n) => n.id === id);
  const node = list[index];
  if (!node) return <Section title="Control point">{null}</Section>;
  // Barriers, run off and the AI line belong to the circuit; a deco road has
  // none of them, so its points only offer what actually does something.
  const isRoad = path !== 'track' && path !== 'pit';

  const edit = (fn: (n: typeof node) => void) =>
    commit((p) => {
      const n = pathDataOf(p, path)?.nodes.find((x) => x.id === id);
      if (n) fn(n);
    });

  const label = pathLabelOf(project, path);
  return (
    <>
      <Section
        title={`${label[0].toUpperCase()}${label.slice(1)} point ${index + 1}`}
        right={
          <button className="btn ghost icon" title="Delete point (Del)" onClick={() => deleteNode(path, id)}>
            <IconTrash />
          </button>
        }
      >
        <Row label="X">
          <Num value={node.p[0]} step={1} suffix="m" onChange={(v) => edit((n) => { n.p[0] = v; })} />
        </Row>
        <Row label="Height">
          <Num value={node.p[1]} step={0.5} suffix="m" onChange={(v) => edit((n) => { n.p[1] = v; })} />
        </Row>
        <Row label="Z">
          <Num value={node.p[2]} step={1} suffix="m" onChange={(v) => edit((n) => { n.p[2] = v; })} />
        </Row>
      </Section>

      <Section title="Road at this point">
        <Row label="Width left">
          <Slider value={node.widthL} min={1} max={25} step={0.25} unit=" m" digits={2} onChange={(v) => edit((n) => { n.widthL = v; })} />
        </Row>
        <Row label="Width right">
          <Slider value={node.widthR} min={1} max={25} step={0.25} unit=" m" digits={2} onChange={(v) => edit((n) => { n.widthR = v; })} />
        </Row>
        <Row label="Both">
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => edit((n) => { const w = (n.widthL + n.widthR) / 2; n.widthL = w; n.widthR = w; })}
          >
            Make symmetric
          </button>
        </Row>
        <Row label="Banking">
          <Slider value={node.bank} min={-25} max={25} step={0.5} unit="°" digits={1} onChange={(v) => edit((n) => { n.bank = v; })} />
        </Row>
        {!isRoad && <><Row label="Barriers">
          <Check label="Left" checked={node.wallL} onChange={(v) => edit((n) => { n.wallL = v; })} />
          <Check label="Right" checked={node.wallR} onChange={(v) => edit((n) => { n.wallR = v; })} />
        </Row>
        <Row label="Barrier gap L">
          <Slider value={node.wallGapL} min={-10} max={40} step={0.5} digits={1} unit=" m" onChange={(v) => edit((n) => { n.wallGapL = v; })} />
        </Row>
        <Row label="Barrier gap R">
          <Slider value={node.wallGapR} min={-10} max={40} step={0.5} digits={1} unit=" m" onChange={(v) => edit((n) => { n.wallGapR = v; })} />
        </Row>
        <Row label="Run off L">
          <Slider value={node.runoffL} min={0} max={2} step={0.05} digits={2} unit="x" onChange={(v) => edit((n) => { n.runoffL = v; })} />
        </Row>
        <Row label="Run off R">
          <Slider value={node.runoffR} min={0} max={2} step={0.05} digits={2} unit="x" onChange={(v) => edit((n) => { n.runoffR = v; })} />
        </Row>
        <Row label="AI offset">
          <Slider value={node.aiOffset} min={-12} max={12} step={0.25} unit=" m" digits={2} onChange={(v) => edit((n) => { n.aiOffset = v; })} />
        </Row>
        <p className="hint">
          Pushes the racing line sideways here: negative left, positive right.
        </p></>}
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One stretch of kerb                                                 */
/* ------------------------------------------------------------------ */

function KerbProps({ id }: { id: string }) {
  const road = useEditor((s) => s.project.road);
  const closed = useEditor((s) => s.project.track.closed);
  const updateKerb = useEditor((s) => s.updateKerb);
  const deleteKerb = useEditor((s) => s.deleteKerb);
  const applyKerbs = useEditor((s) => s.applyKerbs);
  const commit = useEditor((s) => s.commit);
  const derived = useDerived();

  const span = road.kerbs.find((s) => s.id === id);
  if (!span) {
    return (
      <Section title="Kerb">
        <p className="hint">That kerb is gone. Pick another one with the Kerb tool.</p>
      </Section>
    );
  }

  const frames = derived.trackFrames;
  const total = derived.trackLength;
  const m = spanMetres(span, frames, closed, total);
  const whole = m.length >= total - 0.5;

  /** Move an end without letting it grow into a neighbouring kerb. */
  const setBounds = (start: number, length: number) => {
    applyKerbs((list) => moveKerbSpan(list, span, start, length, frames, closed, total));
  };

  const style = KERB_STYLES.find((s) => s.value === span.style);

  return (
    <>
      <Section
        title={`Kerb on the ${span.side < 0 ? 'left' : 'right'}`}
        right={
          <button className="btn ghost icon" title="Delete this kerb (Del)" onClick={() => deleteKerb(id)}>
            <IconTrash />
          </button>
        }
      >
        <Row label="Style">
          <Seg
            value={span.style}
            options={KERB_STYLES.map((s) => ({ value: s.value, label: s.label }))}
            onChange={(v) => updateKerb(id, { style: v })}
          />
        </Row>
        <p className="hint" style={{ marginTop: 0 }}>{style?.hint}</p>
        <Row label="Side">
          <Seg
            value={span.side < 0 ? 'L' : 'R'}
            options={[
              { value: 'L' as const, label: 'Left' },
              { value: 'R' as const, label: 'Right' },
            ]}
            onChange={(v) => {
              const side = v === 'L' ? -1 : 1;
              // Swapping sides can land on top of a kerb already over there, so
              // it goes through the same insert the tool uses.
              applyKerbs((list) =>
                insertKerbSpan(list.filter((s) => s.id !== id), { ...span, side }, closed),
              );
            }}
          />
        </Row>
      </Section>

      <Section title="Where it runs">
        <Row label="Starts at">
          <Num value={m.start} step={5} suffix="m" onChange={(v) => setBounds(v, m.length)} />
        </Row>
        <Row label="Length">
          <Num value={m.length} step={5} suffix="m" onChange={(v) => setBounds(m.start, v)} />
        </Row>
        {closed && (
          <Row label="">
            <button
              className="btn"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => applyKerbs((list) =>
                insertKerbSpan(list.filter((s) => s.id !== id), { ...span, from: 0, to: 1 }, closed),
              )}
            >
              Round the whole lap
            </button>
          </Row>
        )}
        <p className="hint">
          Measured along the centre line from the start/finish line.
          {whole && ' This one goes all the way round, so it has no ends to ramp.'}
        </p>
      </Section>

      <Section title="Shape">
        {span.style !== 'none' && (
          <>
            <Row label="Width">
              <Slider value={span.width} min={0.2} max={4} step={0.1} unit=" m" digits={1} onChange={(v) => updateKerb(id, { width: v })} />
            </Row>
            <Row label="Height">
              <Slider value={span.height} min={0.01} max={0.25} step={0.005} unit=" m" digits={3} onChange={(v) => updateKerb(id, { height: v })} />
            </Row>
            <Row label="Ramp ends">
              <Slider value={span.taper} min={0} max={12} step={0.5} unit=" m" digits={1} onChange={(v) => updateKerb(id, { taper: v })} />
            </Row>
          </>
        )}
        <Row label="Tarmac strip">
          <Slider value={span.apron} min={0} max={12} step={0.25} unit=" m" digits={2} onChange={(v) => updateKerb(id, { apron: v })} />
        </Row>
        {span.apron > 0 && (
          <Row label="Strip colour">
            <Seg
              value={road.apronColour}
              options={APRON_COLOURS.map((c) => ({ value: c.value, label: c.label }))}
              onChange={(v) => commit((p) => { p.road.apronColour = v; })}
            />
          </Row>
        )}
        <p className="hint">
          The ramp is the wedge at each end. A kerb narrowed by a tight bend loses its height in
          step with its width, so it runs out rather than leaving a lip.
          {span.apron > 0 && ' The strip colour is shared by every kerb on the circuit.'}
        </p>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* A run of control points                                             */
/* ------------------------------------------------------------------ */

/**
 * Lay or lift a kerb over exactly the stretch a section covers.
 *
 * The section panel used to flip the kerb flag on each of its control points,
 * which is the very thing that made a kerb start and stop at points. Now it
 * builds a span across the same stretch instead -- the result looks the same
 * and can afterwards be trimmed to the metre with the Kerb tool.
 */
function kerbSection(path: PathId, data: PathData, from: number, to: number, on: boolean) {
  const store = useEditor.getState();
  if (path !== 'track' || from < 0 || to < 0 || from === to) return;
  const count = data.nodes.length;
  const closed = data.closed && count >= 3;
  const segCount = closed ? count : count - 1;
  if (segCount < 1) return;
  const fromT = from / segCount;
  const toT = to / segCount;

  store.applyKerbs((list) => {
    let out = list;
    for (const side of [-1, 1] as const) {
      out = on
        ? insertKerbSpan(out, makeKerbSpan(side, fromT, toT, store.kerbCfg), closed)
        : eraseKerbRange(out, side, fromT, toT, closed);
    }
    return out;
  });
  store.setStatus(on ? 'Kerb laid along the section' : 'Kerbs lifted from the section');
}

function SectionProps({ path, fromId, toId }: { path: PathId; fromId: string; toId: string }) {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  const data = pathDataOf(project, path) ?? { closed: false, nodes: [] };
  const nodes = sectionNodes(data, fromId, toId);
  const indices = sectionIndices(data, fromId, toId);

  if (nodes.length === 0) {
    return (
      <Section title="Section">
        <p className="hint">Those points are gone. Pick two points again.</p>
      </Section>
    );
  }

  /** Run an operation on the live project copy of this section. */
  const run = (fn: (p: Project, d: PathData) => void) =>
    commit((p) => {
      const d = pathDataOf(p, path);
      if (d) fn(p, d);
    });

  const setAll = (fn: (n: TrackNode) => void) =>
    run((_, d) => applyToSection(d, fromId, toId, (n) => fn(n)));

  const avgWidthL = sectionAverage(nodes, (n) => n.widthL);
  const avgWidthR = sectionAverage(nodes, (n) => n.widthR);
  const avgBank = sectionAverage(nodes, (n) => n.bank);
  const avgRunoffL = sectionAverage(nodes, (n) => n.runoffL);
  const avgRunoffR = sectionAverage(nodes, (n) => n.runoffR);
  const avgGapL = sectionAverage(nodes, (n) => n.wallGapL);
  const avgGapR = sectionAverage(nodes, (n) => n.wallGapR);
  const from = data.nodes.findIndex((n) => n.id === fromId);
  const to = data.nodes.findIndex((n) => n.id === toId);

  const btn = { width: '100%', justifyContent: 'center' } as const;

  return (
    <>
      <Section
        title={`Section, point ${from + 1} to ${to + 1}`}
        right={<span className="badge">{nodes.length} points</span>}
      >
        <p className="hint" style={{ marginTop: 0 }}>
          Everything here applies to all {nodes.length} points at once. The run goes forwards from
          {' '}{from + 1} to {to + 1}; picking them the other way round takes the other side of the lap.
        </p>
        <Row label="">
          <button className="btn" style={btn} onClick={() => select({ kind: 'node', path, id: fromId })}>
            Back to a single point
          </button>
        </Row>
      </Section>

      <Section title="Shape">
        <Row label="Width left">
          <Slider value={avgWidthL} min={1} max={25} step={0.25} digits={2} unit=" m" onChange={(v) => setAll((n) => { n.widthL = v; })} />
        </Row>
        <Row label="Width right">
          <Slider value={avgWidthR} min={1} max={25} step={0.25} digits={2} unit=" m" onChange={(v) => setAll((n) => { n.widthR = v; })} />
        </Row>
        <Row label="Banking">
          <Slider value={avgBank} min={-25} max={25} step={0.5} digits={1} unit="°" onChange={(v) => setAll((n) => { n.bank = v; })} />
        </Row>
        <Row label="Height">
          <button className="btn" onClick={() => run((_, d) => raiseSection(d, fromId, toId, 2))}>+2 m</button>
          <button className="btn" onClick={() => run((_, d) => raiseSection(d, fromId, toId, -2))}>-2 m</button>
          <button className="btn" onClick={() => run((_, d) => rampSection(d, fromId, toId))} title="Turn the section into an even climb or descent between its two ends">
            Ramp
          </button>
        </Row>
        <Row label="">
          <button className="btn" style={btn} onClick={() => run((_, d) => smoothSection(d, fromId, toId))}>
            Smooth the bumps out
          </button>
        </Row>
        <Row label="">
          <button className="btn" style={btn} onClick={() => run((_, d) => straightenSection(d, fromId, toId))} title="Pull the points onto the straight line between the two ends">
            Straighten
          </button>
        </Row>
      </Section>

      <Section title="Edges">
        <Row label="Kerbs">
          <button
            className="btn"
            style={btn}
            title="Lay a kerb down both sides of exactly this stretch"
            onClick={() => kerbSection(path, data, from, to, true)}
          >
            On
          </button>
          <button className="btn" style={btn} onClick={() => kerbSection(path, data, from, to, false)}>
            Off
          </button>
        </Row>
        <Row label="Barrier left">
          <Seg
            value={sectionAll(nodes, (n) => n.wallL) ? 'on' : sectionAny(nodes, (n) => n.wallL) ? 'mixed' : 'off'}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => setAll((n) => { n.wallL = v === 'on'; })}
          />
        </Row>
        <Row label="Barrier right">
          <Seg
            value={sectionAll(nodes, (n) => n.wallR) ? 'on' : sectionAny(nodes, (n) => n.wallR) ? 'mixed' : 'off'}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => setAll((n) => { n.wallR = v === 'on'; })}
          />
        </Row>
        <Row label="Barrier gap L">
          <Slider value={avgGapL} min={-10} max={40} step={0.5} digits={1} unit=" m" onChange={(v) => setAll((n) => { n.wallGapL = v; })} />
        </Row>
        <Row label="Barrier gap R">
          <Slider value={avgGapR} min={-10} max={40} step={0.5} digits={1} unit=" m" onChange={(v) => setAll((n) => { n.wallGapR = v; })} />
        </Row>
        <Row label="Run off left">
          <Slider value={avgRunoffL} min={0} max={2} step={0.05} digits={2} unit="x" onChange={(v) => setAll((n) => { n.runoffL = v; })} />
        </Row>
        <Row label="Run off right">
          <Slider value={avgRunoffR} min={0} max={2} step={0.05} digits={2} unit="x" onChange={(v) => setAll((n) => { n.runoffR = v; })} />
        </Row>
        <p className="hint">
          Run off is a factor of the global width in the Track tab. Set it to 0 and the grass strip
          on that side disappears completely, which is what you want where the pit lane runs. The
          barrier gap moves the barrier off that edge: out into the grass, or back in over it.
        </p>
      </Section>

      <Section title="Points">
        <Row label="">
          <button
            className="btn"
            style={btn}
            onClick={() => run((_, d) => { subdivideSection(d, fromId, toId); })}
            title="Add a control point between every pair, so you can shape the section in more detail"
          >
            Add points in between ({indices.length - 1} new)
          </button>
        </Row>
        <Row label="">
          <button
            className="btn danger"
            style={btn}
            disabled={nodes.length < 3}
            onClick={() => {
              run((_, d) => deleteSectionInterior(d, fromId, toId));
              select({ kind: 'node', path, id: fromId });
            }}
          >
            Remove the {Math.max(0, nodes.length - 2)} points in between
          </button>
        </Row>
      </Section>
    </>
  );
}

/** Metres back to the multiplier the transform stores. */
function safeScale(metres: number, original: number): number {
  if (!(original > 1e-6)) return 1;
  return Math.max(0.05, metres) / original;
}

function PropProps({ id }: { id: string }) {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const deleteProp = useEditor((s) => s.deleteProp);
  const duplicateProp = useEditor((s) => s.duplicateProp);
  // An imported model's size is only known once it has parsed, which happens
  // outside React.
  useSyncExternalStore(onAssetsChanged, assetVersion);
  const inst = project.props.find((p) => p.id === id);
  if (!inst) return null;
  const def = LIBRARY_BY_KEY.get(inst.kind);
  const assetId = assetIdOf(inst.kind);
  // The model's own size, so the boxes below can be in metres. Unscaled, and
  // never zero on any axis -- a flat object would otherwise divide by nothing.
  const base = propSize(inst.kind);
  /*
   * An imported model is sized in metres, like a building.
   *
   * The 0.2x - 5x slider it used to get is the wrong control twice over: the
   * only reliable fact about an imported file is the size it came in at, and
   * when that is wrong -- an FBX in the wrong unit is the usual case -- it is
   * wrong by a factor of a hundred, which the slider cannot reach in either
   * direction. Typing the metres you want needs no arithmetic and has no range.
   */
  const inMetres = def?.category === 'Buildings' || assetId !== null;

  const edit = (fn: (i: PropInstance) => void) =>
    commit((p) => {
      const t = p.props.find((x) => x.id === id);
      if (t) fn(t);
    });

  return (
    <>
      <Section
        title={
          def?.label
          ?? project.assets.find((a) => a.id === assetId)?.name
          ?? 'Imported model'
        }
        right={
          <span style={{ display: 'flex', gap: 2 }}>
            <button
              className="btn ghost icon"
              title="Duplicate in row (Ctrl+D). Buildings extend sideways, barriers carry on end to end."
              onClick={() => duplicateProp(id)}
            >
              <IconCopy />
            </button>
            <button className="btn ghost icon" title="Delete (Del)" onClick={() => deleteProp(id)}>
              <IconTrash />
            </button>
          </span>
        }
      >
        <Row label="Name">
          <Text value={inst.name} onChange={(v) => edit((i) => { i.name = v; })} />
        </Row>
        <Row label="X">
          <Num value={inst.p[0]} step={0.5} suffix="m" onChange={(v) => edit((i) => { i.p[0] = v; })} />
        </Row>
        <Row label="Y">
          <Num value={inst.p[1]} step={0.25} suffix="m" onChange={(v) => edit((i) => { i.p[1] = v; })} />
        </Row>
        <Row label="Z">
          <Num value={inst.p[2]} step={0.5} suffix="m" onChange={(v) => edit((i) => { i.p[2] = v; })} />
        </Row>
        <Row label="On ground">
          <Check label="Follow terrain height" checked={inst.ground} onChange={(v) => edit((i) => { i.ground = v; })} />
        </Row>
      </Section>

      <Section title="Transform">
        <Row label="Rotation Y">
          <Slider value={inst.r[1]} min={-180} max={180} step={1} unit="°" onChange={(v) => edit((i) => { i.r[1] = v; })} />
        </Row>
        <Row label="Tilt X">
          <Slider value={inst.r[0]} min={-45} max={45} step={0.5} unit="°" digits={1} onChange={(v) => edit((i) => { i.r[0] = v; })} />
        </Row>
        <Row label="Tilt Z">
          <Slider value={inst.r[2]} min={-45} max={45} step={0.5} unit="°" digits={1} onChange={(v) => edit((i) => { i.r[2] = v; })} />
        </Row>
        {def?.category === 'Ground' ? (
          <>
            {/* The range runs to 600 m because a patch is dragged out now, and
                a slider that tops out below the size on screen does not just
                display wrong -- one touch of it shrinks the patch to its own
                maximum. */}
            <Row label="Width">
              <Slider
                value={inst.s[0] * PAD_SIZE}
                min={2}
                max={600}
                step={1}
                unit="m"
                onChange={(v) => edit((i) => { i.s[0] = v / PAD_SIZE; })}
              />
            </Row>
            <Row label="Length">
              <Slider
                value={inst.s[2] * PAD_SIZE}
                min={2}
                max={600}
                step={1}
                unit="m"
                onChange={(v) => edit((i) => { i.s[2] = v / PAD_SIZE; })}
              />
            </Row>
          </>
        ) : inMetres ? (
          /*
           * Buildings and imported models are sized in METRES, per axis.
           *
           * A pit lane is as long as the circuit needs it to be, and the answer
           * to that used to be "drop five copies of a 40 m block and hope the
           * seams do not show". One number instead. The models in this category
           * are drawn so the length is the axis you actually pull -- nothing on
           * them has a rhythm along X that stretching would turn into a
           * caricature of itself.
           */
          <>
            <Row label="Size (m)">
              <Num
                value={+(base.x * inst.s[0]).toFixed(2)}
                step={1}
                onChange={(v) => edit((i) => { i.s[0] = safeScale(v, base.x); })}
              />
              <Num
                value={+(base.y * inst.s[1]).toFixed(2)}
                step={0.5}
                onChange={(v) => edit((i) => { i.s[1] = safeScale(v, base.y); })}
              />
              <Num
                value={+(base.z * inst.s[2]).toFixed(2)}
                step={0.5}
                onChange={(v) => edit((i) => { i.s[2] = safeScale(v, base.z); })}
              />
            </Row>
            <p className="hint">
              Length × height × depth. Was {base.x.toFixed(1)} × {base.y.toFixed(1)} ×{' '}
              {base.z.toFixed(1)} m.{' '}
              {assetId !== null
                ? 'The file came in at that size. Type what it should be, an import in the '
                  + 'wrong unit is off by a factor of a hundred, not a few per cent.'
                : 'Length is the side the front faces along, so a pit building grows down the '
                  + 'lane rather than back into the paddock.'}
            </p>
          </>
        ) : (
          <Row label="Scale">
            <Slider
              value={inst.s[0]}
              min={0.2}
              max={5}
              step={0.05}
              digits={2}
              unit="x"
              onChange={(v) => edit((i) => { i.s = [v, v, v]; })}
            />
          </Row>
        )}
        <p className="hint">
          Exported as{' '}
          <code>{def?.surface ? `1PROP_${def.surface}_` : 'OBJ_'}{inst.name}</code>.{' '}
          {def?.surface
            ? `Cars ${def.surface === 'WALL' ? 'collide with it' : `drive on it as ${def.surface}`} `
              + `(invisible 1${def.surface}_ copy in the kn5).`
            : 'Decoration only, cars drive through it.'}
        </p>
      </Section>

      {canCarryBanner(inst.kind) && (
        <BannerSection inst={inst} images={project.images} edit={edit} />
      )}
    </>
  );
}

/**
 * The sponsor banner on a bridge deck segment: pick one of the project's
 * pictures, upload a new one, or take it off. The picture is stretched over
 * both side faces of THIS segment -- each segment carries its own, so a long
 * bridge can read D-H-L one letterboard at a time or one sponsor per span.
 */
function BannerSection({
  inst,
  images,
  edit,
}: {
  inst: PropInstance;
  images: Project['images'];
  edit: (fn: (i: PropInstance) => void) => void;
}) {
  const addProjectImage = useEditor((s) => s.addProjectImage);
  const setStatus = useEditor((s) => s.setStatus);

  const upload = async () => {
    const file = await pickFile('image/png,image/jpeg,image/webp');
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setStatus('That picture is over 4 MB, banners want small files, they are stretched over 12 m anyway');
      return;
    }
    const buf = await file.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const id = addProjectImage(file.name, file.type || 'image/png', btoa(bin));
    edit((i) => { i.banner = id; });
    setStatus(`Banner "${file.name}" on this segment`);
  };

  const current = images.find((i) => i.id === inst.banner);
  return (
    <Section title="Sponsor banner">
      <p className="hint" style={{ marginTop: 0 }}>
        A picture across both side faces of this segment, the space over the track a real
        circuit sells. Wide pictures work best: the face is about 12 × 2 m.
      </p>
      {current && (
        <Row label="Showing">
          <span className="badge">{current.name}</span>
          <button
            className="btn ghost icon"
            title="Take the banner off this segment"
            onClick={() => edit((i) => { i.banner = undefined; })}
          >
            <IconTrash />
          </button>
        </Row>
      )}
      <Row label="">
        <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={upload}>
          Upload a picture…
        </button>
      </Row>
      {images.length > 0 && (
        <div className="list">
          {images.map((img) => (
            <div
              key={img.id}
              className={`list-item ${img.id === inst.banner ? 'on' : ''}`}
              onClick={() => edit((i) => { i.banner = img.id; })}
              title="Show this picture on the selected segment"
            >
              <img
                src={`data:${img.mime};base64,${img.data}`}
                alt=""
                style={{ width: 42, height: 16, objectFit: 'cover', borderRadius: 2 }}
              />
              <span className="grow">{img.name}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function SlotProps({ kind, index }: { kind: 'grid' | 'pitbox'; index: number }) {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const overrides = kind === 'grid' ? project.grid.overrides : project.pitCfg.overrides;
  const ov = overrides[index];

  return (
    <Section title={kind === 'grid' ? `Grid slot ${index + 1}` : `Pit box ${index + 1}`}>
      <p className="hint" style={{ marginTop: 0 }}>
        Exported as <code>{kind === 'grid' ? `AC_START_${index}` : `AC_PIT_${index}`}</code>.
      </p>
      {ov ? (
        <>
          <Row label="X">
            <Num value={ov.p[0]} step={0.25} suffix="m" onChange={(v) => commit((p) => { const o = kind === 'grid' ? p.grid.overrides : p.pitCfg.overrides; o[index].p[0] = v; })} />
          </Row>
          <Row label="Y">
            <Num value={ov.p[1]} step={0.1} suffix="m" onChange={(v) => commit((p) => { const o = kind === 'grid' ? p.grid.overrides : p.pitCfg.overrides; o[index].p[1] = v; })} />
          </Row>
          <Row label="Z">
            <Num value={ov.p[2]} step={0.25} suffix="m" onChange={(v) => commit((p) => { const o = kind === 'grid' ? p.grid.overrides : p.pitCfg.overrides; o[index].p[2] = v; })} />
          </Row>
          <Row label="Heading">
            <Slider value={ov.rot} min={-180} max={180} step={1} unit="°" onChange={(v) => commit((p) => { const o = kind === 'grid' ? p.grid.overrides : p.pitCfg.overrides; o[index].rot = v; })} />
          </Row>
          <Row label="">
            <button
              className="btn"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() =>
                commit((p) => {
                  const o = kind === 'grid' ? p.grid.overrides : p.pitCfg.overrides;
                  delete o[index];
                })
              }
            >
              Back to automatic placement
            </button>
          </Row>
        </>
      ) : (
        <p className="hint">
          Placed automatically from the settings in the Race tab. Drag it in the viewport to override
          just this one, the rest stays automatic.
        </p>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Track tab                                                           */
/* ------------------------------------------------------------------ */

function TrackTab() {
  const meta = useEditor((s) => s.project.meta);
  const commit = useEditor((s) => s.commit);
  const set = <K extends keyof typeof meta>(k: K, v: (typeof meta)[K]) =>
    commit((p) => {
      p.meta[k] = v;
    });

  return (
    <>
      <Section title="Track identity">
        <Row label="Name">
          <Text value={meta.name} onChange={(v) => set('name', v)} />
        </Row>
        <Row label="Folder">
          <Text
            value={meta.slug}
            onChange={(v) => set('slug', v.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
          />
        </Row>
        <Row label="Author">
          <Text value={meta.author} onChange={(v) => set('author', v)} />
        </Row>
        <Row label="Country">
          <Text value={meta.country} onChange={(v) => set('country', v)} />
        </Row>
        <Row label="City">
          <Text value={meta.city} onChange={(v) => set('city', v)} />
        </Row>
        <Row label="Version">
          <Text value={meta.version} onChange={(v) => set('version', v)} />
        </Row>
        <Row label="Direction">
          <Seg
            value={meta.run}
            options={[
              { value: 'clockwise' as const, label: 'Clockwise' },
              { value: 'counterclockwise' as const, label: 'Counter' },
            ]}
            onChange={(v) => set('run', v)}
          />
        </Row>
        <Row label="Description">
          <textarea
            rows={3}
            value={meta.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Row>
        <p className="hint">
          The folder name becomes <code>content/tracks/{meta.slug || 'my_track'}</code> and the kn5 has to
          be named the same.
        </p>
      </Section>

      <RoadShapeSection />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Race tab                                                            */
/* ------------------------------------------------------------------ */

/**
 * Braking boards, placed off the shape of the circuit.
 *
 * It lives in the Race tab rather than in the object library because it is the
 * same kind of thing as the grid and the sector gates: something worked out
 * from the track rather than dropped by hand. The boards themselves are still
 * ordinary objects afterwards -- movable, deletable, exported like everything
 * else.
 */
function BrakeMarkerSection() {
  const cfg = useEditor((s) => s.brakeCfg);
  const setBrakeCfg = useEditor((s) => s.setBrakeCfg);
  const applyBrakeMarkers = useEditor((s) => s.applyBrakeMarkers);
  const clearBrakeMarkers = useEditor((s) => s.clearBrakeMarkers);
  const setStatus = useEditor((s) => s.setStatus);
  const closed = useEditor((s) => s.project.track.closed);
  const props = useEditor((s) => s.project.props);
  const derived = useDerived();

  const corners = findCorners(derived.trackFrames, closed, cfg);
  const down = props.filter((p) => BRAKE_MARKER_KINDS.includes(p.kind)).length;

  const toggleDistance = (d: number) => {
    const has = cfg.distances.includes(d);
    if (has && cfg.distances.length === 1) return;
    setBrakeCfg({
      distances: has
        ? cfg.distances.filter((x) => x !== d)
        : [...cfg.distances, d].sort((a, b) => a - b),
    });
  };

  return (
    <Section title="Braking boards" right={<span className="badge">{down} down</span>}>
      <p className="hint" style={{ marginTop: 0 }}>
        {corners.length === 0
          ? 'No corner on this track turns far enough to be worth signing yet. Draw some more of it, or loosen the two settings below.'
          : `${corners.length} corner${corners.length === 1 ? '' : 's'} found, tightest ${Math.round(
              Math.min(...corners.map((c) => c.radius)),
            )} m radius.`}
      </p>
      <Row label="Boards">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, width: '100%', minWidth: 0 }}>
          {SIGN_DISTANCES.map((d) => (
            <button
              key={d}
              className={`btn ${cfg.distances.includes(d) ? 'on' : 'ghost'}`}
              style={{ flex: '1 1 38px', justifyContent: 'center', padding: '5px 6px' }}
              onClick={() => toggleDistance(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Corner from">
        <Slider
          value={cfg.radius}
          min={40}
          max={500}
          step={10}
          unit=" m"
          onChange={(v) => setBrakeCfg({ radius: v })}
        />
      </Row>
      <Row label="Least bend">
        <Slider
          value={cfg.minTurn}
          min={10}
          max={120}
          step={5}
          unit="°"
          onChange={(v) => setBrakeCfg({ minTurn: v })}
        />
      </Row>
      <Row label="Off the kerb">
        <Slider
          value={cfg.offset}
          min={0}
          max={20}
          step={0.5}
          unit=" m"
          digits={1}
          onChange={(v) => setBrakeCfg({ offset: v })}
        />
      </Row>
      <Row label="Side">
        <Seg
          value={cfg.side}
          options={[
            { value: 'outside' as const, label: 'Outside' },
            { value: 'inside' as const, label: 'Inside' },
            { value: 'left' as const, label: 'Left' },
            { value: 'right' as const, label: 'Right' },
          ]}
          onChange={(v) => setBrakeCfg({ side: v })}
        />
      </Row>
      <Row label="">
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <button
            className="btn"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={corners.length === 0}
            onClick={() => {
              const plan = planBrakeMarkers(derived.trackFrames, closed, derived.profile, cfg);
              const n = applyBrakeMarkers(plan);
              setStatus(
                n === 0
                  ? 'No room for a board anywhere: the corners are too close together'
                  : `${n} braking boards at ${corners.length} corners`,
              );
            }}
          >
            Place them
          </button>
          <button
            className="btn"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={down === 0}
            onClick={() => setStatus(`${clearBrakeMarkers()} braking boards removed`)}
          >
            Clear
          </button>
        </div>
      </Row>
      <p className="hint">
        Distances are measured back along the <b>arc</b>, so 100 m is a hundred metres of driving.
        Boards land on the outside of the bend facing the oncoming car. <b>Place them</b> replaces
        every board, so it can be pressed again after the track is reshaped.
      </p>
    </Section>
  );
}

function RaceTab() {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const derived = useDerived();
  const total = derived.trackLength;
  const { timing, grid, pitCfg, exportCfg } = project;

  return (
    <>
      <Section title="Start / finish and sectors">
        <Row label="S/F line">
          <Slider
            value={timing.startS}
            min={0}
            max={0.999}
            step={0.001}
            digits={3}
            onChange={(v) => commit((p) => { p.timing.startS = v; })}
          />
        </Row>
        <p className="hint" style={{ marginTop: 0 }}>
          {Math.round(timing.startS * total)} m along the lap. Exported as <code>AC_TIME_0_L</code> /{' '}
          <code>AC_TIME_0_R</code>.
        </p>

        {timing.sectors.map((s, i) => (
          <Row key={i} label={`Sector ${i + 1}`}>
            <Slider
              value={s}
              min={0}
              max={0.999}
              step={0.001}
              digits={3}
              onChange={(v) => commit((p) => { p.timing.sectors[i] = v; })}
            />
            <button
              className="btn ghost icon"
              onClick={() => commit((p) => { p.timing.sectors.splice(i, 1); })}
            >
              <IconTrash />
            </button>
          </Row>
        ))}
        <Row label="">
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => commit((p) => { p.timing.sectors.push(0.5); })}
          >
            Add sector gate
          </button>
        </Row>
        <Row label="Hotlap start">
          <Slider
            value={timing.hotlapBack}
            min={0}
            max={400}
            step={5}
            unit=" m"
            onChange={(v) => commit((p) => { p.timing.hotlapBack = v; })}
          />
        </Row>
        <Row label="Gantry">
          <Check
            label="Bridge over the line"
            checked={timing.gantry}
            onChange={(v) => commit((p) => { p.timing.gantry = v; })}
          />
        </Row>
        <p className="hint" style={{ marginTop: 0 }}>
          Built over the S/F line rather than placed beside it: it follows the slider above and
          spans whatever the circuit is wide there. It appears once the track is a closed lap. The
          five red lights are wired to the session, lit on the grid, out on the green flag.
        </p>
      </Section>

      <BrakeMarkerSection />

      <Section title="Starting grid">
        <Row label="Slots">
          <Slider value={grid.count} min={0} max={40} step={1} onChange={(v) => commit((p) => { p.grid.count = v; })} />
        </Row>
        <Row label="Pole gap">
          <Slider value={grid.poleBack} min={0} max={120} step={1} unit=" m" onChange={(v) => commit((p) => { p.grid.poleBack = v; })} />
        </Row>
        <Row label="Row spacing">
          <Slider value={grid.rowSpacing} min={3} max={20} step={0.5} unit=" m" digits={1} onChange={(v) => commit((p) => { p.grid.rowSpacing = v; })} />
        </Row>
        <Row label="Side offset">
          <Slider value={grid.lateralOffset} min={0} max={10} step={0.1} unit=" m" digits={1} onChange={(v) => commit((p) => { p.grid.lateralOffset = v; })} />
        </Row>
        <Row label="Layout">
          <Check
            label="Staggered left / right"
            checked={grid.stagger}
            onChange={(v) => commit((p) => { p.grid.stagger = v; })}
          />
        </Row>
        <Row label="Start boxes">
          <Check
            label="Paint a box per slot"
            checked={grid.boxes}
            onChange={(v) => commit((p) => { p.grid.boxes = v; })}
          />
        </Row>
        {grid.boxes && (
          <>
            <Row label="Box width">
              <Slider
                value={grid.boxWidth}
                min={2}
                max={5}
                step={0.1}
                unit=" m"
                digits={1}
                onChange={(v) => commit((p) => { p.grid.boxWidth = v; })}
              />
            </Row>
            <Row label="Box length">
              <Slider
                value={grid.boxLength}
                min={3}
                max={10}
                step={0.1}
                unit=" m"
                digits={1}
                onChange={(v) => commit((p) => { p.grid.boxLength = v; })}
              />
            </Row>
            <Row label="Front line">
              <Check
                label="Yellow front wheel bar"
                checked={grid.boxFrontLine}
                onChange={(v) => commit((p) => { p.grid.boxFrontLine = v; })}
              />
            </Row>
            <p className="hint" style={{ marginTop: 0 }}>
              Formula 1 sizes: 2.7 m clear width, 8 m row spacing, 15 cm paint.
            </p>
          </>
        )}
        <Row label="">
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => commit((p) => { p.grid.overrides = {}; })}
          >
            Reset all manual slots ({Object.keys(grid.overrides).length})
          </button>
        </Row>
      </Section>

      <Section title="Pit lane and track">
        <p className="hint" style={{ marginTop: 0 }}>
          {project.pit.nodes.length < 2
            ? 'Draw a pit lane first with the Pit lane tool.'
            : `Pit lane is ${Math.round(derived.pitLength)} m long and runs on the ${
                derived.pitSide < 0 ? 'left' : 'right'
              } of the track.`}
        </p>
        <Row label="Concrete">
          <Slider
            value={pitCfg.apron}
            min={0}
            max={15}
            step={0.5}
            digits={1}
            unit=" m"
            onChange={(v) => commit((p) => { p.pitCfg.apron = v; })}
          />
        </Row>
        <p className="hint" style={{ marginTop: 0 }}>
          The concrete either side of the lane's tarmac, which is where the work happens: the pit
          wall on the track side, the garages and the boxes on the other. Inside the limiter window
          it is exported as pit lane, so a car with two wheels on it still has its limiter on. Add
          more of it with the <b>Ground tool (G)</b> and its <b>Pit lane</b> material, which is the
          same concrete with the same surface.
        </p>
        <Row label="">
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={project.pit.nodes.length < 2}
            title="Puts the first and last pit lane point on the edge of the track, lines the join up with the driving direction and levels the lane with the track"
            onClick={() =>
              commit((p) => {
                const res = attachPitLane(p.pit, derived.trackFrames, true);
                if (res) p.pit.nodes = res.nodes;
              })
            }
          >
            Attach entry and exit to the track
          </button>
        </Row>
        <Row label="">
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={project.pit.nodes.length < 2}
            title="Switches the barrier off on every track point the pit lane runs past, and takes the run off away on that side"
            onClick={() =>
              commit((p) => {
                const reach =
                  project.road.runoffWidth + project.road.kerbWidth + project.road.pitGap + 30;
                for (const hit of nodesAlongPitLane(p.track.nodes, derived.pitFrames, reach)) {
                  const n = p.track.nodes[hit.index];
                  if (hit.side < 0) {
                    n.wallL = false;
                    n.runoffL = 0;
                  } else {
                    n.wallR = false;
                    n.runoffR = 0;
                  }
                }
              })
            }
          >
            Open the barrier along the pit lane
          </button>
        </Row>
        <Row label="Auto clearance">
          <Check
            label="Keep road and pit lane apart"
            checked={project.road.pitClearance}
            onChange={(v) => commit((p) => { p.road.pitClearance = v; })}
          />
        </Row>
        <Row label="Gap">
          <Slider
            value={project.road.pitGap}
            min={0}
            max={20}
            step={0.5}
            digits={1}
            unit=" m"
            onChange={(v) => commit((p) => { p.road.pitGap = v; })}
          />
        </Row>
        <p className="hint">
          With auto clearance on, the run off stops short of the pit lane and the barrier steps
          aside wherever the two run close together, without changing any of your control points.
          The button above does the same thing permanently, so you can then fine tune it by hand.
        </p>
      </Section>

      <Section title="Pit boxes">
        <Row label="Boxes">
          <Slider value={pitCfg.boxCount} min={0} max={40} step={1} onChange={(v) => commit((p) => { p.pitCfg.boxCount = v; })} />
        </Row>
        <Row label="First box at">
          <Slider value={pitCfg.startDist} min={0} max={Math.max(50, derived.pitLength)} step={1} unit=" m" onChange={(v) => commit((p) => { p.pitCfg.startDist = v; })} />
        </Row>
        <Row label="Limiter on at">
          <Slider
            value={pitCfg.limitStart}
            min={0}
            max={Math.max(20, Math.min(pitCfg.startDist, derived.pitLength / 2))}
            step={1}
            unit=" m"
            onChange={(v) => commit((p) => { p.pitCfg.limitStart = v; })}
          />
        </Row>
        <Row label="Limiter off at">
          <Slider
            value={pitCfg.limitEnd}
            min={0}
            max={Math.max(20, derived.pitLength / 2)}
            step={1}
            unit=" m"
            onChange={(v) => commit((p) => { p.pitCfg.limitEnd = v; })}
          />
        </Row>
        <p className="hint">
          The limiter comes on where the pit surface starts. Before that point the lane is exported
          as ordinary road, so rolling in off the track is still free; the second figure does the
          same at the other end, measured back from where the lane rejoins.{' '}
          {pitCfg.limitStart >= pitCfg.startDist && pitCfg.startDist > 0 && (
            <b>
              It currently starts at or after the first box, so the first cars would reach their box
              with no limiter. Pull it below {pitCfg.startDist} m.
            </b>
          )}
        </p>
        <Row label="Spacing">
          <Slider value={pitCfg.boxSpacing} min={4} max={25} step={0.5} unit=" m" digits={1} onChange={(v) => commit((p) => { p.pitCfg.boxSpacing = v; })} />
        </Row>
        <Row label="Side">
          <Seg
            value={pitCfg.boxSide}
            options={[
              { value: -1 as const, label: 'Left' },
              { value: 1 as const, label: 'Right' },
            ]}
            onChange={(v) => commit((p) => { p.pitCfg.boxSide = v; })}
          />
        </Row>
        <Row label="Distance">
          <Slider value={pitCfg.boxOffset} min={0} max={20} step={0.25} unit=" m" digits={2} onChange={(v) => commit((p) => { p.pitCfg.boxOffset = v; })} />
        </Row>
        <Row label="Markings">
          <Check
            label="Paint the stalls on the working lane"
            checked={pitCfg.boxPaint !== false}
            onChange={(v) => commit((p) => { p.pitCfg.boxPaint = v; })}
          />
        </Row>
        <p className="hint">
          What a real pit lane has in front of every garage: the two dividers between one box and
          its neighbours, the line along the back of the working lane, and the box number painted
          large enough to read from the fast lane. Open towards the fast lane, because the lane's
          own edge line is already the boundary on that side. Paint only, so nothing drives on it.
        </p>
        <Row label="Lane width">
          <Slider
            value={project.pit.nodes[0]?.widthL ?? 4}
            min={2}
            max={12}
            step={0.25}
            unit=" m"
            digits={2}
            onChange={(v) =>
              commit((p) => {
                for (const n of p.pit.nodes) {
                  n.widthL = v;
                  n.widthR = v;
                }
              })
            }
          />
        </Row>
        <Row label="">
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => commit((p) => { p.pitCfg.overrides = {}; })}
          >
            Reset all manual boxes ({Object.keys(pitCfg.overrides).length})
          </button>
        </Row>
        <p className="hint">
          Assetto Corsa needs at least as many pit boxes as cars in the session. {pitCfg.boxCount} boxes,{' '}
          {grid.count} grid slots.
        </p>
        <p className="hint">
          The game itself stands its pit crew -- the man with the board -- at every occupied box,
          on any track whose boxes are placed. Nothing needs adding here for that.
        </p>
      </Section>

      <Section title="AI line">
        <Row label="Point spacing">
          <Slider
            value={exportCfg.aiSpacing}
            min={0.5}
            max={8}
            step={0.5}
            unit=" m"
            digits={1}
            onChange={(v) => commit((p) => { p.exportCfg.aiSpacing = v; })}
          />
        </Row>
        <p className="hint">
          {derived.ai.length} points. Shape the line with the AI offset on each track control point.
          Written to <code>ai/fast_lane.ai</code>.
        </p>
      </Section>

      <CamerasSection />
    </>
  );
}

/**
 * The replay cameras: where the TV cameras stand and which stretch of the
 * lap each one watches. Placed from the viewport's own camera (fly there,
 * press the button), or a whole set at once, one per corner.
 */
function CamerasSection() {
  const cameras = useEditor((s) => s.project.cameras);
  const closed = useEditor((s) => s.project.track.closed);
  const addCamera = useEditor((s) => s.addCamera);
  const updateCamera = useEditor((s) => s.updateCamera);
  const deleteCamera = useEditor((s) => s.deleteCamera);
  const autoCams = useEditor((s) => s.autoCameras);
  const clearCameras = useEditor((s) => s.clearCameras);
  const setStatus = useEditor((s) => s.setStatus);
  const derived = useDerived();
  const total = derived.trackLength;
  const metres = (s: number) => `${Math.round(s * total)} m`;

  return (
    <Section
      title="Replay cameras"
      right={cameras.length > 0 ? <span className="badge">{cameras.length}</span> : undefined}
    >
      <p className="hint" style={{ marginTop: 0 }}>
        TV cameras for replays and streams, written to <code>data/cameras.ini</code>. The catch
        fence has a camera window cut into its mesh at every corner and every {CAMERA_SPACING} m
        along a straight; the full set puts a camera at every window, filming through it, each
        following the car through its stretch of the lap. Fly the view to where a camera should stand and take it from there, or place the
        full set at once.
      </p>
      <Row label="">
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <button
            className="btn"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={derived.trackFrames.length < 2}
            onClick={() => {
              const pose = getViewportCameraPose();
              if (!pose) return;
              addCamera([pose.pos.x, pose.pos.y, pose.pos.z], derived.trackFrames);
              setStatus('Camera placed where the view is; it watches the road running up to the nearest point');
            }}
          >
            Camera from this view
          </button>
          <button
            className="btn"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={derived.trackFrames.length < 8}
            title="One camera at every window in the fence, on the side the cars come towards, the stretches joined end to end. Replaces the set."
            onClick={() => {
              const n = autoCams(derived.trackFrames, derived.profile, derived.cameraWindows);
              setStatus(`${n} cameras placed, one at every window in the fence`);
            }}
          >
            One per window
          </button>
        </div>
      </Row>
      {cameras.length > 0 && (
        <div className="list">
          {cameras.map((cam) => (
            <div key={cam.id} className="list-item" style={{ flexWrap: 'wrap', gap: 4 }}>
              <span className="dot" style={{ background: '#ff5fa2' }} />
              <input
                type="text"
                value={cam.name}
                style={{ flex: 1, minWidth: 80 }}
                onChange={(e) => updateCamera(cam.id, { name: e.target.value })}
              />
              <button
                className="btn ghost icon"
                style={{ padding: 2 }}
                title="Delete this camera"
                onClick={() => deleteCamera(cam.id)}
              >
                <IconTrash />
              </button>
              <div style={{ width: '100%', display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                <span style={{ width: 22 }}>In</span>
                <input
                  type="range" min={0} max={0.999} step={0.001} value={cam.inS} style={{ flex: 1 }}
                  onChange={(e) => updateCamera(cam.id, { inS: Number(e.target.value) })}
                />
                <span style={{ width: 52, textAlign: 'right' }}>{metres(cam.inS)}</span>
              </div>
              <div style={{ width: '100%', display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                <span style={{ width: 22 }}>Out</span>
                <input
                  type="range" min={0} max={0.999} step={0.001} value={cam.outS} style={{ flex: 1 }}
                  onChange={(e) => updateCamera(cam.id, { outS: Number(e.target.value) })}
                />
                <span style={{ width: 52, textAlign: 'right' }}>{metres(cam.outS)}</span>
              </div>
              <div style={{ width: '100%', display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                <span style={{ width: 22 }}>Zoom</span>
                <Num value={cam.fovMin} min={2} max={90} step={1} suffix="°" onChange={(v) => updateCamera(cam.id, { fovMin: v })} />
                <Num value={cam.fovMax} min={2} max={120} step={1} suffix="°" onChange={(v) => updateCamera(cam.id, { fovMax: v })} />
              </div>
            </div>
          ))}
        </div>
      )}
      {cameras.length > 0 && (
        <Row label="">
          <button
            className="btn danger"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => setStatus(`${clearCameras()} cameras removed`)}
          >
            Remove all cameras
          </button>
        </Row>
      )}
      <p className="hint">
        In and Out are metres along the lap from the first track point, the same datum the AI line
        uses; a stretch may run across the start line. The camera is aimed at the middle of its
        stretch and the game turns it onto the car from there. Without any cameras the game uses its
        own default ones, so an empty list is fine too.
        {closed ? '' : ' Cameras want a closed lap to be worth much.'}
      </p>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Export tab                                                          */
/* ------------------------------------------------------------------ */

function ExportTab({ onExport }: { onExport: () => void }) {
  const cfg = useEditor((s) => s.project.exportCfg);
  const commit = useEditor((s) => s.commit);
  const derived = useDerived();

  return (
    <>
      <Section title="What you get">
        <div className="kv">
          <span>Track length</span>
          <b>{Math.round(derived.trackLength)} m</b>
          <span>Pit lane</span>
          <b>{Math.round(derived.pitLength)} m</b>
          <span>Road meshes</span>
          <b>{derived.roadMeshes.length + derived.pitMeshes.length}</b>
          <span>Grid / pits</span>
          <b>
            {derived.markers.grid.length} / {derived.markers.pits.length}
          </b>
          <span>AI points</span>
          <b>{derived.ai.length}</b>
        </div>
      </Section>

      <Section title="Export options">
        <Row label="Markers">
          <Seg
            value={cfg.markerAsMesh ? 'mesh' : 'null'}
            options={[
              { value: 'null', label: 'Empties' },
              { value: 'mesh', label: 'Tiny meshes' },
            ]}
            onChange={(v) => commit((p) => { p.exportCfg.markerAsMesh = v === 'mesh'; })}
          />
        </Row>
        <p className="hint" style={{ marginTop: 0 }}>
          AC_* markers are FBX null objects by default, which is what ksEditor expects. If they do not
          show up after importing, switch to tiny meshes: those always survive.
        </p>
        <Row label="Forward axis">
          <Seg
            value={cfg.markerForward}
            options={[
              { value: '+Z' as const, label: '+Z' },
              { value: '-Z' as const, label: '-Z' },
              { value: '+X' as const, label: '+X' },
              { value: '-X' as const, label: '-X' },
            ]}
            onChange={(v) => commit((p) => { p.exportCfg.markerForward = v; })}
          />
        </Row>
        <p className="hint" style={{ marginTop: 0 }}>
          Assetto Corsa spawns cars along the local +Z of a marker. If cars face the wrong way in game,
          flip this to -Z and export again.
        </p>
        <Row label="Fallback">
          <Check
            label="Also write FBX + glTF"
            checked={cfg.sourceFiles}
            onChange={(v) => commit((p) => { p.exportCfg.sourceFiles = v; })}
          />
        </Row>
        {cfg.sourceFiles && (
          <Row label="Textures">
            <Check
              label="Write PNG textures"
              checked={cfg.writeTextures}
              onChange={(v) => commit((p) => { p.exportCfg.writeTextures = v; })}
            />
          </Row>
        )}
        <p className="hint" style={{ marginTop: 0 }}>
          The editor writes the finished <code>.kn5</code> itself; FBX and glTF are only for the
          manual ksEditor route, and each holds another full copy of the track in memory. Leave off
          unless you want the track in Blender.
        </p>
      </Section>

      <Section title="Build the package">
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={onExport}>
          Export track ZIP
        </button>
        <p className="hint">
          The complete <code>content/tracks/…</code> folder: <code>.kn5</code> with textures baked
          in, surfaces.ini, AI line, minimap, UI files. Drop it into Assetto Corsa and drive.
          {cfg.sourceFiles && ' The FBX and glTF go in beside it under source/.'}
        </p>
      </Section>
    </>
  );
}
