import { useState, useSyncExternalStore, type ReactElement } from 'react';
import type { EditorMode } from '../store/store';
import { useEditor } from '../store/store';
import { getDerived, useDerived } from '../store/derived';
import { faultReason, findBarrierFaults, type BarrierFault } from '../core/barrierCheck';
import { alignPlacementToPath, clearPlantsOffTrack } from '../store/placement';
import { CATEGORIES, GRASS_KINDS, isGroundPad, LIBRARY, propSize, propTileBox } from '../core/library';
import { PREFABS, PREFAB_PREFIX } from '../core/prefabs';
import { fitTerrainToTrack, GROUND_KINDS, paintCellSize, resampleTerrain, sampleHeights } from '../core/terrain';
import { plateLength } from '../core/spline';
import {
  arrayBufferToBase64, assetError, ASSET_PREFIX, assetVersion, AUTOSAVE_SAFE_MB, ensureAsset, extOf,
  forgetAsset, getAsset, MODEL_LIMIT_MB, onAssetsChanged,
} from '../io/assetCache';
import { pickFile } from '../io/project';
import { Check, Num, Row, Seg, Section, Slider } from './controls';
import { IconBarrier, IconCursor, IconErase, IconFlag, IconGround, IconKerb, IconPit, IconPlace, IconRoad, IconScatter, IconTerrain, IconTrack, IconTrash } from './icons';
import {
  APRON_COLOURS,
  fullLapKerbs,
  insertKerbSpan,
  KERB_STYLES,
  moveKerbSpan,
  spanMetres,
  STYLE_HEIGHT,
} from '../core/kerbs';
import { DRAW_MODES, FREEHAND_SPACING } from '../core/draw';
import { pathDataOf } from '../types';
import type { KerbStyle, PathId, Tool } from '../types';
import type { KerbCfg } from '../store/store';

/**
 * `modes` lists where a tool earns its place.
 *
 * Three of them are worse than useless on an imported track: Sculpt shapes a
 * terrain that is switched off there, and Track and Pit lane redraw a centre
 * line that is only a guide for placing things -- moving it changes nothing
 * about the circuit, which is exactly the kind of control that makes an editor
 * feel broken.
 */
const TOOLS: Array<{
  id: Tool | 'race'; label: string; icon: () => ReactElement; title: string;
  modes?: EditorMode[];
}> = [
  { id: 'select', label: 'Select', icon: IconCursor, title: 'Select and move things (V)' },
  { id: 'drawTrack', label: 'Track', icon: IconTrack, title: 'Click the ground to add track points (T)', modes: ['build'] },
  { id: 'drawPit', label: 'Pit lane', icon: IconPit, title: 'Click the ground to add pit lane points (P)', modes: ['build'] },
  { id: 'drawRoad', label: 'Roads', icon: IconRoad, title: 'Draw access and service roads (U). Ends near the circuit glue themselves onto it.' },
  { id: 'terrain', label: 'Sculpt', icon: IconTerrain, title: 'Raise, lower and smooth the ground (G)', modes: ['build'] },
  { id: 'ground', label: 'Ground', icon: IconGround, title: 'Paint grass, asphalt, concrete or gravel into the ground itself, run off included (M). Alt rubs it out.', modes: ['build'] },
  { id: 'kerb', label: 'Kerbs', icon: IconKerb, title: 'Drag along the roadside to lay a kerb (K). Alt removes.' },
  { id: 'barrier', label: 'Barrier', icon: IconBarrier, title: 'Drag along the roadside to add or remove barriers (C)' },
  { id: 'place', label: 'Place', icon: IconPlace, title: 'Drop objects onto the ground (B)' },
  { id: 'scatter', label: 'Plant', icon: IconScatter, title: 'Paint trees and bushes over an area (N). Alt clears them.' },
  { id: 'erase', label: 'Erase', icon: IconErase, title: 'Sweep the circle over objects to delete them (X)' },
  { id: 'race', label: 'Race', icon: IconFlag, title: 'Grid, pits, sectors and AI line' },
];

export function LeftPanel() {
  const mode = useEditor((s) => s.mode);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const setRightTab = useEditor((s) => s.setRightTab);

  return (
    <div className="leftpanel">
      <div className="toolrail">
        {TOOLS.filter((t) => !t.modes || t.modes.includes(mode)).map((t) => {
          const Icon = t.icon;
          const active = t.id === 'race' ? false : tool === t.id;
          return (
            <button
              key={t.id}
              className={`tool ${active ? 'active' : ''}`}
              title={t.title}
              onClick={() => {
                if (t.id === 'race') {
                  setTool('select');
                  setRightTab('race');
                } else {
                  setTool(t.id);
                }
              }}
            >
              <Icon />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="panel-scroll">
        {tool === 'select' && <SelectOptions />}
        {(tool === 'drawTrack' || tool === 'drawPit') && <DrawOptions />}
        {tool === 'drawRoad' && <RoadOptions />}
        {tool === 'terrain' && <TerrainOptions />}
        {tool === 'ground' && <GroundOptions />}
        {tool === 'kerb' && <KerbOptions />}
        {tool === 'barrier' && <BarrierOptions />}
        {tool === 'place' && <PlaceOptions />}
        {tool === 'scatter' && <ScatterOptions />}
        {tool === 'erase' && <EraseOptions />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SnapRow() {
  const snap = useEditor((s) => s.snap);
  const setSnap = useEditor((s) => s.setSnap);
  return (
    <Row label="Snap">
      <Seg
        value={snap}
        options={[
          { value: 0, label: 'Off' },
          { value: 1, label: '1 m' },
          { value: 5, label: '5 m' },
          { value: 10, label: '10 m' },
        ]}
        onChange={setSnap}
      />
    </Row>
  );
}

function SelectOptions() {
  const gizmo = useEditor((s) => s.gizmo);
  const setGizmo = useEditor((s) => s.setGizmo);
  const marked = useEditor((s) => s.marked);
  const setMarked = useEditor((s) => s.setMarked);
  const deleteMarked = useEditor((s) => s.deleteMarked);
  const setStatus = useEditor((s) => s.setStatus);
  return (
    <Section
      title="Select"
      right={marked.length > 0 ? <span className="badge">{marked.length} marked</span> : undefined}
    >
      {marked.length > 0 && (
        <Row label="">
          <div style={{ display: 'flex', gap: 6, width: '100%' }}>
            <button
              className="btn danger"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setStatus(`${deleteMarked()} objects deleted`)}
            >
              Delete {marked.length}
            </button>
            <button
              className="btn"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setMarked([])}
            >
              Clear marks
            </button>
          </div>
        </Row>
      )}
      <Row label="Gizmo">
        <Seg
          value={gizmo}
          options={[
            { value: 'translate' as const, label: 'Move' },
            { value: 'rotate' as const, label: 'Rotate' },
            { value: 'scale' as const, label: 'Scale' },
          ]}
          onChange={setGizmo}
        />
      </Row>
      <SnapRow />
      <p className="hint">
        Drag the arrows to move the selection, or type exact figures in Properties. Del removes it.
      </p>
      <p className="hint" style={{ marginTop: 0 }}>
        <b>Box drag</b> on empty ground marks everything inside it · <b>Alt+click</b> the centre
        line inserts a point · <b>Shift+click</b> a second point takes the stretch between two,
        <b> Shift</b> again as you drag it moves that run up and down.
      </p>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

function DrawOptions() {
  const tool = useEditor((s) => s.tool);
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const drawMode = useEditor((s) => s.drawMode);
  const setDrawMode = useEditor((s) => s.setDrawMode);
  const isTrack = tool === 'drawTrack';
  const path = isTrack ? project.track : project.pit;

  return (
    <>
      <Section title={isTrack ? 'Track spline' : 'Pit lane spline'}>
        <Row label="Points">
          <span className="badge">{path.nodes.length}</span>
        </Row>
        <Row label="Closed loop">
          <Check
            label={path.closed ? 'Loop' : 'Open ends'}
            checked={path.closed}
            onChange={(v) =>
              commit((p) => {
                if (isTrack) p.track.closed = v;
                else p.pit.closed = v;
              })
            }
          />
        </Row>
        <Row label="Drawing">
          <Seg
            value={drawMode}
            options={DRAW_MODES.map((m) => ({ value: m.value, label: m.label }))}
            onChange={setDrawMode}
          />
        </Row>
        <p className="hint" style={{ marginTop: 0 }}>
          {DRAW_MODES.find((m) => m.value === drawMode)?.hint}
          {drawMode === 'straight' && ' Steps of 15°; hold Alt for any angle at all.'}
          {drawMode === 'arc' && ' It needs two points to know which way the track is already going.'}
          {drawMode === 'freehand' && ` One point every ${FREEHAND_SPACING} m, and one undo for the whole stroke.`}
        </p>
        <SnapRow />
        <p className="hint" style={{ marginTop: 0 }}>
          The grid rounds where a point lands, and in Straight mode the length of the run with it.
          Alt ignores it.
        </p>
        <Row label="">
          <button
            className="btn danger"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => {
              if (!confirm(`Delete all ${isTrack ? 'track' : 'pit lane'} points?`)) return;
              commit((p) => {
                if (isTrack) p.track.nodes = [];
                else p.pit.nodes = [];
              });
            }}
          >
            Clear all points
          </button>
        </Row>
      </Section>

      <NewPointSection path={isTrack ? 'track' : 'pit'} />

      {isTrack && <RoadShapeSection />}
    </>
  );
}

/**
 * The Road tool's panel: which road the next click extends, what it is made
 * of, and the same drawing options the other two spline tools have.
 */
function RoadOptions() {
  const roads = useEditor((s) => s.project.decoRoads);
  const activeDeco = useEditor((s) => s.activeDeco);
  const setActiveDeco = useEditor((s) => s.setActiveDeco);
  const decoSurface = useEditor((s) => s.decoSurface);
  const setDecoSurface = useEditor((s) => s.setDecoSurface);
  const updateDecoRoad = useEditor((s) => s.updateDecoRoad);
  const deleteDecoRoad = useEditor((s) => s.deleteDecoRoad);
  const drawMode = useEditor((s) => s.drawMode);
  const setDrawMode = useEditor((s) => s.setDrawMode);
  const setStatus = useEditor((s) => s.setStatus);
  const roundaboutArm = useEditor((s) => s.roundaboutArm);
  const setRoundaboutArm = useEditor((s) => s.setRoundaboutArm);
  const roundaboutRadius = useEditor((s) => s.roundaboutRadius);
  const setRoundaboutRadius = useEditor((s) => s.setRoundaboutRadius);

  const active = roads.find((r) => r.id === activeDeco) ?? null;
  const surface = active ? active.surface : decoSurface;
  const line = active ? (active.line ?? false) : decoSurface === 'asphalt';

  return (
    <>
      <Section title="Access roads">
        <p className="hint" style={{ marginTop: 0 }}>
          Deco roads you can actually drive on. End one at the circuit and it glues itself onto the
          tarmac, junction and all; the ground is bedded under it wherever it runs.
        </p>
        <Row label="Surface">
          <Seg
            value={surface}
            options={[
              { value: 'asphalt' as const, label: 'Asphalt' },
              { value: 'concrete' as const, label: 'Concrete' },
            ]}
            onChange={(v) => {
              setDecoSurface(v);
              if (active) updateDecoRoad(active.id, { surface: v });
            }}
          />
        </Row>
        <Row label="Centre line">
          <label className="check" title="The dashed line down the middle of a two-way road. It stops on its own at junctions and crossings.">
            <input
              type="checkbox"
              checked={line}
              disabled={!active}
              onChange={(e) => {
                if (active) updateDecoRoad(active.id, { line: e.target.checked });
              }}
            />
            <span>{active ? 'Dashed centre line' : 'Pick a road first'}</span>
          </label>
        </Row>
        <Row label="Drawing">
          <Seg
            value={drawMode}
            options={DRAW_MODES.map((m) => ({ value: m.value, label: m.label }))}
            onChange={setDrawMode}
          />
        </Row>
        <SnapRow />
        <Row label="">
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={!active}
            onClick={() => {
              setActiveDeco(null);
              setStatus('Road finished — the next click starts a new one');
            }}
          >
            {active ? `Finish "${active.name}"` : 'Click the ground to start a road'}
          </button>
        </Row>
        {roads.length > 0 && (
          <div className="list">
            {roads.map((r) => (
              <div
                key={r.id}
                className={`list-item ${r.id === activeDeco ? 'on' : ''}`}
                onClick={() => setActiveDeco(r.id)}
                title="Click to keep drawing this road"
              >
                <span className="dot" style={{ background: '#7bd88f' }} />
                <span className="grow">{r.name}</span>
                <span className="badge">{r.path.nodes.length} pts · {r.surface}</span>
                <button
                  className="btn ghost icon"
                  style={{ padding: 2 }}
                  title="Delete this road"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteDecoRoad(r.id);
                  }}
                >
                  <IconTrash />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Roundabout">
        <p className="hint" style={{ marginTop: 0 }}>
          A closed ring road. Lay it down first, then draw the approach roads: a road ended at the
          ring docks onto its edge like it docks onto the circuit.
        </p>
        <Row label="Radius">
          <input
            type="range"
            min={8}
            max={30}
            step={1}
            value={roundaboutRadius}
            onChange={(e) => setRoundaboutRadius(Number(e.target.value))}
          />
          <span className="num">{roundaboutRadius} m</span>
        </Row>
        <Row label="">
          <button
            className={`btn ${roundaboutArm ? 'primary' : ''}`}
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => {
              setRoundaboutArm(!roundaboutArm);
              setStatus(
                roundaboutArm
                  ? 'Roundabout cancelled'
                  : 'Click the ground where the roundabout centre should be',
              );
            }}
          >
            {roundaboutArm ? 'Click the ground (or click here to cancel)' : 'Place a roundabout'}
          </button>
        </Row>
      </Section>

      <Section title="Car parks">
        <p className="hint" style={{ marginTop: 0 }}>
          Build one yourself: drag an <b>asphalt patch</b> out with the Place tool, stamp{' '}
          <b>Parking bays</b> onto it (Track furniture — rows latch flush against each other), and
          end a road at the patch: it docks onto the edge, square and level, exactly like it docks
          onto the circuit.
        </p>
      </Section>

      <NewPointSection path={active ? `road:${active.id}` : 'road:none'} />
    </>
  );
}

/**
 * What the next point will be, before there is one.
 *
 * Raw range inputs rather than `Slider`, for the same reason the scatter brush
 * uses them: `Slider` routes every pixel of travel through `tweakRun`, which
 * opens an undo burst, and none of this touches the project at all.
 */
/** Stable empty list for the selector above. */
const NO_NODES: never[] = [];

function NewPointSection({ path }: { path: PathId }) {
  const cfg = useEditor((s) => s.drawCfg);
  const setDrawCfg = useEditor((s) => s.setDrawCfg);
  const applyDrawWidth = useEditor((s) => s.applyDrawWidth);
  const applyDrawLevel = useEditor((s) => s.applyDrawLevel);
  const terrain = useEditor((s) => s.project.terrain);
  const setStatus = useEditor((s) => s.setStatus);
  const nodes = useEditor((s) => pathDataOf(s.project, path)?.nodes ?? NO_NODES);
  const heights = useDerived().terrainHeights;

  const isTrack = path === 'track';
  const isPit = path === 'pit';
  const widthL = isTrack ? cfg.trackWidthL : isPit ? cfg.pitWidthL : cfg.roadWidthL;
  const widthR = isTrack ? cfg.trackWidthR : isPit ? cfg.pitWidthR : cfg.roadWidthR;
  const total = widthL + widthR;
  const what = isTrack ? 'track' : isPit ? 'pit lane' : 'road';

  const setL = (v: number) =>
    setDrawCfg(isTrack ? { trackWidthL: v } : isPit ? { pitWidthL: v } : { roadWidthL: v });
  const setR = (v: number) =>
    setDrawCfg(isTrack ? { trackWidthR: v } : isPit ? { pitWidthR: v } : { roadWidthR: v });
  /* Scaling both halves keeps a deliberately lopsided road lopsided: setting
     each to half the total would quietly straighten out a 8/4 m road the first
     time the overall width was nudged. */
  const setTotal = (v: number) => {
    if (total <= 0.01) {
      setL(v / 2);
      setR(v / 2);
      return;
    }
    const k = v / total;
    setL(Math.round(widthL * k * 10) / 10);
    setR(Math.round(widthR * k * 10) / 10);
  };

  const groundAt = (x: number, z: number) => sampleHeights(terrain, heights, x, z);

  return (
    <Section title="New points">
      <Row label="Width">
        <input
          type="range"
          min={3}
          max={isTrack ? 30 : 16}
          step={0.5}
          value={Math.min(isTrack ? 30 : 16, total)}
          onChange={(e) => setTotal(Number(e.target.value))}
        />
        <span className="unit">{total.toFixed(1)} m</span>
      </Row>
      <Row label="Left / right">
        <Num value={widthL} min={0.5} max={40} step={0.5} onChange={setL} />
        <Num value={widthR} min={0.5} max={40} step={0.5} suffix="m" onChange={setR} />
      </Row>
      <Row label="Height">
        <Seg
          value={cfg.heightMode}
          options={[
            { value: 'ground' as const, label: 'On ground' },
            { value: 'level' as const, label: 'Level' },
            { value: 'offset' as const, label: 'Above' },
          ]}
          onChange={(v) => setDrawCfg({ heightMode: v })}
        />
      </Row>
      {cfg.heightMode === 'level' && (
        <Row label="At">
          <input
            type="range"
            min={-50}
            max={50}
            step={0.5}
            value={Math.max(-50, Math.min(50, cfg.level))}
            onChange={(e) => setDrawCfg({ level: Number(e.target.value) })}
          />
          <Num value={cfg.level} min={-500} max={500} step={0.5} suffix="m" onChange={(v) => setDrawCfg({ level: v })} />
        </Row>
      )}
      {cfg.heightMode === 'offset' && (
        <Row label="Above ground">
          <input
            type="range"
            min={-10}
            max={20}
            step={0.25}
            value={Math.max(-10, Math.min(20, cfg.offset))}
            onChange={(e) => setDrawCfg({ offset: Number(e.target.value) })}
          />
          <Num value={cfg.offset} min={-100} max={100} step={0.25} suffix="m" onChange={(v) => setDrawCfg({ offset: v })} />
        </Row>
      )}
      <p className="hint" style={{ marginTop: 0 }}>
        {cfg.heightMode === 'ground' && 'Every point lands on the ground under the click.'}
        {cfg.heightMode === 'level' &&
          `Every point lands at exactly this height; the terrain is blended to meet it. The setting for a flat circuit.`}
        {cfg.heightMode === 'offset' &&
          'Points follow the ground but sit this far above it — an embankment at plus, a cutting at minus.'}
      </p>
      <Row label="Apply to all">
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <button
            className="btn"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={nodes.length === 0}
            onClick={() => setStatus(`Width set on ${applyDrawWidth(path)} ${what} points`)}
          >
            Width
          </button>
          <button
            className="btn"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={nodes.length === 0 || cfg.heightMode === 'ground'}
            title={
              cfg.heightMode === 'ground'
                ? 'Pick Level or Above first — On ground has no height of its own to apply.'
                : `Move every existing ${what} point onto this height`
            }
            onClick={() => setStatus(`Height set on ${applyDrawLevel(path, groundAt)} ${what} points`)}
          >
            Height
          </button>
        </div>
      </Row>
      <p className="hint">
        Settings for the <b>next</b> point; the buttons push them onto the {nodes.length} already
        down, as one undo step. Banking, run off and barriers still carry over from the point before.
      </p>
    </Section>
  );
}

export function RoadShapeSection() {
  const road = useEditor((s) => s.project.road);
  const track = useEditor((s) => s.project.track);
  const commit = useEditor((s) => s.commit);
  const plate = plateLength(track, road.samplesPerSegment);
  const sections = useDerived().trackFrames.length;
  const set = <K extends keyof typeof road>(k: K, v: (typeof road)[K]) =>
    commit((p) => {
      p.road[k] = v;
    });

  return (
    <Section title="Road profile">
      <Row label="Kerbs">
        <span className="badge">{road.kerbs.length} on the track</span>
      </Row>
      <p className="hint" style={{ marginTop: 0 }}>
        Each kerb is a stretch of its own, drawn with the <b>Kerb tool (K)</b>. The white edge line
        and the tarmac strip belong to it too.
      </p>
      <Row label="Run off">
        <Slider value={road.runoffWidth} min={0} max={60} step={1} unit=" m" onChange={(v) => set('runoffWidth', v)} />
      </Row>
      <Row label="Run off drop">
        <Slider value={road.runoffDrop} min={0} max={3} step={0.05} unit=" m" digits={2} onChange={(v) => set('runoffDrop', v)} />
      </Row>
      <Row label="Run off type">
        <Seg
          value={road.runoffSurface}
          options={[
            { value: 'GRASS' as const, label: 'Grass' },
            { value: 'SAND' as const, label: 'Gravel' },
            { value: 'CONCRETE' as const, label: 'Tarmac' },
          ]}
          onChange={(v) => set('runoffSurface', v)}
        />
      </Row>
      <Row label="">
        <Check
          label="Ground brush can paint the run off"
          checked={road.runoffPaint}
          onChange={(v) => set('runoffPaint', v)}
        />
      </Row>
      <p className="hint" style={{ marginTop: 0 }}>
        The run off is part of the road, so the type above is what it is made of everywhere. With
        this on, the <b>Ground tool (G)</b> overrules it wherever you have painted: gravel at the
        outside of one corner, tarmac at the exit of the next, and the type above for the rest.
      </p>
      <Row label="Barriers">
        <Check label="Barrier at the edge" checked={road.wall} onChange={(v) => set('wall', v)} />
      </Row>
      {road.wall && (
        <Row label="Barrier height">
          <Slider value={road.wallHeight} min={0.3} max={4} step={0.1} unit=" m" digits={1} onChange={(v) => set('wallHeight', v)} />
        </Row>
      )}
      <Row label="Detail">
        <Slider
          value={road.samplesPerSegment}
          min={4}
          max={80}
          step={1}
          unit="x"
          onChange={(v) => set('samplesPerSegment', v)}
        />
      </Row>
      <p className="hint">
        {plate > 0 && (
          <>
            One flat plate every <b>{plate.toFixed(1)} m</b>, <b>{sections}</b> cross sections in
            all — all of them rebuilt per frame while you drag, so it sets the editor's pace too.{' '}
          </>
        )}
        Everything between two cross sections is dead flat, so this is the facet you drive over.
        Halve the plate and you halve the crease at each joint. Counted per <i>segment</i>, so
        points drawn far apart need a higher number for the same metres.
      </p>
      <Row label="Texture length">
        <Slider value={road.uvLength} min={2} max={40} step={1} unit=" m" onChange={(v) => set('uvLength', v)} />
      </Row>
      <Row label="Texture width">
        <Slider value={road.uvWidth} min={2} max={40} step={1} unit=" m" onChange={(v) => set('uvWidth', v)} />
      </Row>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The barrier tool draws its own handles in the viewport, so this panel only
 * carries the settings that apply to all of them at once.
 */
function KerbOptions() {
  const cfg = useEditor((s) => s.kerbCfg);
  const setKerbCfg = useEditor((s) => s.setKerbCfg);
  const road = useEditor((s) => s.project.road);
  const closed = useEditor((s) => s.project.track.closed);
  const selection = useEditor((s) => s.selection);
  const commit = useEditor((s) => s.commit);
  const applyKerbs = useEditor((s) => s.applyKerbs);
  const updateKerb = useEditor((s) => s.updateKerb);
  const deleteKerb = useEditor((s) => s.deleteKerb);
  const select = useEditor((s) => s.select);
  const setStatus = useEditor((s) => s.setStatus);
  const derived = useDerived();
  const count = road.kerbs.length;

  /*
   * The panel edits the SELECTED kerb when there is one, and the settings for
   * the next one otherwise -- with the same controls either way. Drawing a kerb
   * leaves it selected, so the style can be tried out on the thing just drawn
   * without letting go of the tool, which is the whole point: picking a style
   * blind and redrawing when it was the wrong one is not a choice, it is a
   * guess.
   */
  const selected = selection?.kind === 'kerb' ? road.kerbs.find((s) => s.id === selection.id) ?? null : null;
  const shape = selected ?? cfg;
  const hint = KERB_STYLES.find((s) => s.value === shape.style)?.hint ?? '';
  const metres = selected
    ? spanMetres(selected, derived.trackFrames, closed, derived.trackLength)
    : null;

  /** Whatever is being edited, plus the memory of it for the next kerb. */
  const setShape = (patch: Partial<KerbCfg>) => {
    setKerbCfg(patch);
    if (!selected) return;
    const full: Partial<KerbCfg> = { ...patch };
    // A style change carries its usual height along, but only while the height
    // is still the one that style came with: a hand set 4 cm kerb stays 4 cm.
    if (patch.style && patch.height === undefined &&
        Math.abs(selected.height - STYLE_HEIGHT[selected.style]) < 1e-6) {
      full.height = STYLE_HEIGHT[patch.style];
    }
    updateKerb(selected.id, full);
  };

  const place = (start: number, length: number) => {
    if (!selected) return;
    applyKerbs((list) =>
      moveKerbSpan(list, selected, start, length, derived.trackFrames, closed, derived.trackLength),
    );
  };

  return (
    <>
      <Section
        title={selected ? `Kerb on the ${selected.side < 0 ? 'left' : 'right'}` : 'Kerb tool'}
        right={
          selected ? (
            <button className="btn ghost icon" title="Delete this kerb (Del)" onClick={() => deleteKerb(selected.id)}>
              <IconTrash />
            </button>
          ) : (
            <span className="badge">{count} on the track</span>
          )
        }
      >
        {selected ? (
          <p className="hint" style={{ marginTop: 0 }}>
            Changes this kerb, and is kept for the next one. Drag it along the road to move it, the
            white grips to lengthen it.
          </p>
        ) : (
          <p className="hint" style={{ marginTop: 0 }}>
            Drag along the roadside to lay a kerb, click one to pick it up again, <b>Alt</b>+drag to
            rub it out.
          </p>
        )}
        <Row label="Style">
          <Seg
            value={shape.style}
            options={KERB_STYLES.map((s) => ({ value: s.value as KerbStyle, label: s.label }))}
            onChange={(v) => setShape({ style: v })}
          />
        </Row>
        <p className="hint" style={{ marginTop: 0 }}>{hint}</p>
        {shape.style !== 'none' && (
          <>
            <Row label="Width">
              <Slider value={shape.width} min={0.2} max={4} step={0.1} unit=" m" digits={1} onChange={(v) => setShape({ width: v })} />
            </Row>
            {/* Down to nothing, not to a centimetre. A painted kerb with no
                step at all is a real thing -- most modern circuits have long
                stretches of one -- and it still rattles the car, because the
                rumble comes from the KERB surface in AC, not from geometry. */}
            <Row label="Height">
              <Slider value={shape.height} min={0} max={0.25} step={0.005} unit=" m" digits={3} onChange={(v) => setShape({ height: v })} />
            </Row>
            {shape.height < 0.005 && (
              <p className="hint" style={{ marginTop: 0 }}>
                Flat: painted onto the road with no step to climb. It is still exported as kerb, so
                it still rumbles and still counts as track — just nothing to unsettle a car mid
                corner.
              </p>
            )}
            <Row label="Ramp ends">
              <Slider value={shape.taper} min={0} max={12} step={0.5} unit=" m" digits={1} onChange={(v) => setShape({ taper: v })} />
            </Row>
          </>
        )}
        <Row label="Tarmac strip">
          <Slider value={shape.apron} min={0} max={12} step={0.25} unit=" m" digits={2} onChange={(v) => setShape({ apron: v })} />
        </Row>
        {selected && metres && (
          <>
            <Row label="Starts at">
              <Num value={metres.start} step={5} suffix="m" onChange={(v) => place(v, metres.length)} />
            </Row>
            <Row label="Length">
              <Num value={metres.length} step={5} suffix="m" onChange={(v) => place(metres.start, v)} />
            </Row>
            <Row label="Side">
              <Seg
                value={selected.side < 0 ? 'L' : 'R'}
                options={[
                  { value: 'L' as const, label: 'Left' },
                  { value: 'R' as const, label: 'Right' },
                ]}
                onChange={(v) =>
                  applyKerbs((list) =>
                    insertKerbSpan(
                      list.filter((s) => s.id !== selected.id),
                      { ...selected, side: v === 'L' ? -1 : 1 },
                      closed,
                    ),
                  )
                }
              />
            </Row>
            <Row label="">
              <button
                className="btn"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => select(null)}
              >
                Done, draw a new one
              </button>
            </Row>
          </>
        )}
        <p className="hint">
          The ramp is the wedge each end runs out over. The tarmac strip is the coloured asphalt
          outside the kerb — drivable, colour set below.
        </p>
      </Section>

      <Section title="Everything at once" right={<span className="badge">{count} kerbs</span>}>
        <Row label="Whole lap">
          <div style={{ display: 'flex', gap: 6, width: '100%' }}>
            <button
              className="btn"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                applyKerbs(() => fullLapKerbs(road).map((s) => ({ ...s, ...cfg })));
                setStatus('Kerbs down both sides of the lap');
              }}
            >
              Kerb it all
            </button>
            <button
              className="btn"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                applyKerbs(() => []);
                setStatus('All kerbs removed');
              }}
            >
              Clear
            </button>
          </div>
        </Row>
        <Row label="Edge line">
          <Check
            label="White line at the edge"
            checked={road.edgeLine}
            onChange={(v) => commit((p) => { p.road.edgeLine = v; })}
          />
        </Row>
        {road.edgeLine && (
          <Row label="Line width">
            <Slider
              value={road.edgeLineWidth}
              min={0.05}
              max={0.5}
              step={0.01}
              unit=" m"
              digits={2}
              onChange={(v) => commit((p) => { p.road.edgeLineWidth = v; })}
            />
          </Row>
        )}
        <Row label="Strip colour">
          <Seg
            value={road.apronColour}
            options={APRON_COLOURS.map((c) => ({ value: c.value, label: c.label }))}
            onChange={(v) => commit((p) => { p.road.apronColour = v; })}
          />
        </Row>
        <p className="hint">
          The white line is cut out of the road surface, not laid over it, so it cannot flicker. It
          runs the whole way round, kerb or no kerb.
        </p>
      </Section>
    </>
  );
}

/**
 * Drawing a barrier anywhere, out of the modules in the library.
 *
 * The generated barrier follows the edge of the track and cannot do anything
 * else -- which is right for the roadside and no use for a wall across a
 * paddock or a run of armco down an escape road. This draws with the same three
 * modes the track tool has, and what it leaves behind is ordinary objects.
 */
function FreeBarrierOptions() {
  const kind = useEditor((s) => s.barrierKind);
  const setBarrierKind = useEditor((s) => s.setBarrierKind);
  const drawMode = useEditor((s) => s.drawMode);
  const setDrawMode = useEditor((s) => s.setDrawMode);
  const draft = useEditor((s) => s.barrierDraft);
  const setBarrierDraft = useEditor((s) => s.setBarrierDraft);
  const setStatus = useEditor((s) => s.setStatus);
  const modules = LIBRARY.filter((d) => d.category === 'Barriers');
  const length = propTileBox(kind).hz * 2;

  return (
    <Section title="Draw a barrier">
      <div className="propgrid">
        {modules.map((d) => (
          <button
            key={d.key}
            className={`propcard ${kind === d.key ? 'on' : ''}`}
            onClick={() => setBarrierKind(d.key)}
          >
            {d.label}
            <br />
            <span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>
              {(propTileBox(d.key).hz * 2).toFixed(1)} m each
            </span>
          </button>
        ))}
      </div>
      <Row label="Drawing">
        <Seg
          value={drawMode === 'freehand' ? 'free' : drawMode}
          options={DRAW_MODES.filter((m) => m.value !== 'freehand').map((m) => ({
            value: m.value,
            label: m.label,
          }))}
          onChange={setDrawMode}
        />
      </Row>
      <SnapRow />
      <Row label="">
        <button
          className="btn"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={draft.length === 0}
          onClick={() => {
            setBarrierDraft([]);
            setStatus('Barrier run ended');
          }}
        >
          {draft.length === 0 ? 'No run in progress' : `End this run (${draft.length} points)`}
        </button>
      </Row>
      <p className="hint">
        Click the ground to start, then click again for each leg — modules are laid end to end along
        the green line, {length.toFixed(1)} m at a time, following the ground as they go.{' '}
        <b>Straight</b> locks the heading to 15° steps and <b>Curve</b> bends away from the run in
        the direction it was already going, exactly as they do for the track. <b>Esc</b> ends the
        run, and each leg is its own undo step.
      </p>
      <p className="hint">
        What it leaves behind is ordinary objects: movable with Select, exported with their own
        physics.
      </p>
    </Section>
  );
}

/**
 * A row of modules along the edge of the road, laid by dragging over it.
 *
 * The counterpart to drawing freely: the commonest run is "tyres along the
 * outside of this corner", and the editor already knows that curve exactly, so
 * there is no reason to trace it by hand.
 */
function EdgeRowOptions() {
  const kind = useEditor((s) => s.barrierKind);
  const setBarrierKind = useEditor((s) => s.setBarrierKind);
  const rowGap = useEditor((s) => s.rowGap);
  const setRowGap = useEditor((s) => s.setRowGap);
  const modules = LIBRARY.filter((d) => d.category === 'Barriers');

  return (
    <Section title="Row along the edge">
      <div className="propgrid">
        {modules.map((d) => (
          <button
            key={d.key}
            className={`propcard ${kind === d.key ? 'on' : ''}`}
            onClick={() => setBarrierKind(d.key)}
          >
            {d.label}
            <br />
            <span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>
              {(propTileBox(d.key).hz * 2).toFixed(1)} m each
            </span>
          </button>
        ))}
      </div>
      <Row label="Off the edge">
        {/* A raw range input on purpose: Slider opens an undo burst through
            tweakRun, and this setting does not touch the project at all. */}
        <input
          type="range"
          min={-10}
          max={20}
          step={0.5}
          value={rowGap}
          onChange={(e) => setRowGap(parseFloat(e.target.value))}
        />
        <span className="val">{rowGap.toFixed(1)} m</span>
      </Row>
      <p className="hint">
        Press on the roadside where the row should start and drag to where it ends — the
        modules follow the edge of the built-up roadside at this distance, end to end round
        the corner. Negative puts them on the run off. What is laid down is ordinary
        objects: pick one up with Select if a single module needs nudging.
      </p>
    </Section>
  );
}

/**
 * Taking pieces back out of the generated barrier, and being told where to.
 *
 * The check is the important half. The barrier is derived from the shape of
 * the track rather than placed, so a corner drawn tight enough will always
 * find a way to make it come out wrong, and until now the only way to know
 * was to fly down and look along five kilometres of it. This measures the
 * line that was actually built -- see core/barrierCheck.ts -- and hands back
 * the stretches, which are the same thing the Remove tool makes by hand.
 */
function BarrierCutOptions() {
  const cutLength = useEditor((s) => s.cutLength);
  const setCutLength = useEditor((s) => s.setCutLength);
  const cuts = useEditor((s) => s.project.road.wallCuts);
  const clearWallCuts = useEditor((s) => s.clearWallCuts);
  const openBarrierFaults = useEditor((s) => s.openBarrierFaults);
  const setStatus = useEditor((s) => s.setStatus);
  const project = useEditor((s) => s.project);
  const [faults, setFaults] = useState<BarrierFault[] | null>(null);

  const check = () => {
    const d = getDerived(project);
    const found = findBarrierFaults(d.trackFrames, d.profile, project.track.closed, cuts);
    setFaults(found);
    setStatus(
      found.length === 0
        ? 'Checked: nothing wrong with the barriers'
        : `${found.length} stretch${found.length === 1 ? '' : 'es'} of barrier came out wrong`,
    );
  };

  return (
    <>
      <Section title="Check the barriers">
        <Row label="">
          <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={check}>
            Find bad stretches
          </button>
        </Row>
        {faults !== null && faults.length === 0 && (
          <p className="hint" style={{ marginTop: 0 }}>
            Nothing found: no stretch doubles back, stands on the tarmac, runs through another one
            or is wound into a hook.
          </p>
        )}
        {faults !== null && faults.length > 0 && (
          <>
            <div style={{ maxHeight: 168, overflowY: 'auto', margin: '2px 0 6px' }}>
              {faults.slice(0, 12).map((f, i) => (
                <div
                  key={i}
                  className="hint"
                  style={{ margin: '3px 0', display: 'flex', justifyContent: 'space-between', gap: 8 }}
                >
                  <span>
                    {f.side < 0 ? 'Left' : 'Right'}, {f.metres.toFixed(0)} m — {faultReason(f.kind)}
                  </span>
                </div>
              ))}
              {faults.length > 12 && (
                <p className="hint" style={{ margin: '3px 0' }}>…and {faults.length - 12} more.</p>
              )}
            </div>
            <Row label="">
              <button
                className="btn"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => {
                  const n = openBarrierFaults(faults);
                  setFaults(null);
                  setStatus(`${n} bad stretch${n === 1 ? '' : 'es'} of barrier removed`);
                }}
              >
                Remove all {faults.length} of them
              </button>
            </Row>
          </>
        )}
      </Section>

      <Section title="Remove by hand">
        <Row label="Length">
          {/* A raw range: this setting never touches the project, so it must
              not open an undo step the way a Slider would. */}
          <input
            type="range"
            min={4}
            max={60}
            step={2}
            value={cutLength}
            onChange={(e) => setCutLength(parseFloat(e.target.value))}
          />
          <span className="val">{cutLength} m</span>
        </Row>
        <p className="hint" style={{ marginTop: 0 }}>
          Click the roadside band where the barrier should stop. Amber is barrier that stands,
          brown is a stretch already taken out — clicking a brown one puts it back. Each click is
          its own undo step.
        </p>
        <Row label="">
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={cuts.length === 0}
            onClick={() => {
              const n = clearWallCuts();
              setFaults(null);
              setStatus(n === 0 ? 'No gaps to put back' : `${n} gap${n === 1 ? '' : 's'} closed up`);
            }}
          >
            {cuts.length === 0 ? 'No gaps' : `Put all ${cuts.length} back`}
          </button>
        </Row>
      </Section>
    </>
  );
}

function BarrierOptions() {
  const road = useEditor((s) => s.project.road);
  const commit = useEditor((s) => s.commit);
  const setStatus = useEditor((s) => s.setStatus);
  const mode = useEditor((s) => s.barrierMode);
  const setBarrierMode = useEditor((s) => s.setBarrierMode);

  const setAll = (on: boolean) => {
    commit((p) => {
      for (const n of p.track.nodes) {
        n.wallL = on;
        n.wallR = on;
      }
    });
    setStatus(on ? 'Barrier all the way round, both sides' : 'All barriers removed');
  };

  const modeRow = (
    <Section title="Barrier tool">
      <Row label="Mode">
        <Seg
          value={mode}
          options={[
            { value: 'track' as const, label: 'Along the track' },
            { value: 'cut' as const, label: 'Remove a stretch' },
            { value: 'edge' as const, label: 'Row on the edge' },
            { value: 'free' as const, label: 'Draw freely' },
          ]}
          onChange={setBarrierMode}
        />
      </Row>
      <p className="hint" style={{ marginTop: 0 }}>
        {mode === 'track'
          ? 'Paints the generated barrier onto the edge of the road, which follows every change to the track afterwards.'
          : mode === 'cut'
            ? 'Takes short pieces back out of the generated barrier, measured in metres rather than in control points.'
            : mode === 'edge'
              ? 'Drags a row of modules along the edge of the roadside — tyres round a corner, armco down a straight — without tracing the curve by hand.'
              : 'Draws a run of barrier modules wherever you like, following the ground. Nothing to do with the track.'}
      </p>
    </Section>
  );

  if (mode === 'cut') {
    return (
      <>
        {modeRow}
        <BarrierCutOptions />
      </>
    );
  }

  if (mode === 'edge') {
    return (
      <>
        {modeRow}
        <EdgeRowOptions />
      </>
    );
  }

  if (mode === 'free') {
    return (
      <>
        {modeRow}
        <FreeBarrierOptions />
      </>
    );
  }

  return (
    <>
      {modeRow}
      <Section title="Barrier">
      <p className="hint" style={{ marginTop: 0 }}>
        Every stretch of roadside has a handle. Click one to switch its barrier on or off, drag
        along several to paint a run, <b>Shift+drag</b> sideways to move that stretch in or out.
      </p>
      <Row label="Build them">
        <Check
          label="Barriers enabled"
          checked={road.wall}
          onChange={(v) => commit((p) => { p.road.wall = v; })}
        />
      </Row>
      <Row label="Style">
        <Seg
          value={road.wallStyle}
          options={[
            { value: 'wall' as const, label: 'Armco' },
            { value: 'fence' as const, label: 'Catch fence' },
          ]}
          onChange={(v) =>
            commit((p) => {
              p.road.wallStyle = v;
              // A catch fence at 1.1 m is a wall with a lip on it. Give it a
              // sensible height the first time it is picked, rather than
              // leaving it looking broken until the slider is found.
              if (v === 'fence' && p.road.wallHeight < 2.5) p.road.wallHeight = 3.6;
              if (v === 'wall' && p.road.wallHeight > 2.5) p.road.wallHeight = 1.1;
            })
          }
        />
      </Row>
      <Row label="Height">
        <Slider
          value={road.wallHeight}
          min={0}
          max={road.wallStyle === 'fence' ? 6 : 3}
          step={0.1}
          digits={1}
          unit=" m"
          onChange={(v) => commit((p) => { p.road.wallHeight = v; })}
        />
      </Row>
      <Row label="Whole lap">
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAll(true)}>
            Barrier all round
          </button>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAll(false)}>
            None at all
          </button>
        </div>
      </Row>
      <p className="hint">
        <b>Barrier all round</b> switches it on down both sides of the entire lap; <b>None at all</b>
        {' '}takes every stretch off again. Anything in between is painted with the handles. A
        stretch runs from one control point to the next, so Alt+click in the Select tool inserts a
        point wherever a barrier has to start or stop.
        {!road.wall && ' Barriers are switched off entirely, so nothing will be built.'}
      </p>
      <p className="hint">
        {road.wallStyle === 'fence'
          ? 'Catch fence: armco for its first ≈1 m whatever the height says, chain link above it, and the top metre angled back over the circuit so anything thrown at it drops back inside.'
          : 'Armco: the steel beams themselves, stacked as many as the height takes — three of them at about a metre, which is what a circuit really has.'}
      </p>
      </Section>
    </>
  );
}

/**
 * Putting an old project back onto a zero datum.
 *
 * New projects start their ground at 0. Anything saved before that carries its
 * own datum in the file, so it opens at -0.6 with everything built on it -- and
 * a track whose control points read -0.6 makes every height typed in anywhere
 * else a number relative to nothing. Moving the whole project together fixes
 * the numbers and changes nothing about the circuit.
 */
function DatumRow() {
  const base = useEditor((s) => s.project.terrain.base);
  const shiftDatum = useEditor((s) => s.shiftDatum);
  const setStatus = useEditor((s) => s.setStatus);
  const off = Math.abs(base) > 1e-6;

  return (
    <>
      <Row label="">
        <button
          className="btn"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={!off}
          title="Moves the ground, the track, the pit lane and every object by the same amount"
          onClick={() => {
            const d = shiftDatum(-base);
            setStatus(`Everything moved ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(2)} m onto a 0 datum`);
          }}
        >
          {off ? `Put everything on a 0 datum (${base > 0 ? '−' : '+'}${Math.abs(base).toFixed(2)} m)` : 'Ground is already at 0'}
        </button>
      </Row>
      {off && (
        <p className="hint" style={{ marginTop: 0 }}>
          This project's ground starts at {base.toFixed(2)} m. The button moves terrain, track,
          pit lane and objects together, so the circuit stays identical and the figures come out
          round. One undo step.
        </p>
      )}
    </>
  );
}

function TerrainOptions() {
  const brush = useEditor((s) => s.brush);
  const setBrush = useEditor((s) => s.setBrush);
  const brushRoad = useEditor((s) => s.brushRoad);
  const setBrushRoad = useEditor((s) => s.setBrushRoad);
  const terrain = useEditor((s) => s.project.terrain);
  const commit = useEditor((s) => s.commit);
  const derived = useDerived();

  return (
    <>
      <Section title="Sculpt brush">
        <Row label="Mode">
          <Seg
            value={brush.mode}
            options={[
              { value: 'raise' as const, label: 'Raise' },
              { value: 'lower' as const, label: 'Lower' },
              { value: 'smooth' as const, label: 'Smooth' },
              { value: 'flatten' as const, label: 'Flatten' },
            ]}
            onChange={(v) => setBrush({ mode: v })}
          />
        </Row>
        <Row label="Radius">
          <Slider value={brush.radius} min={4} max={200} step={1} unit=" m" onChange={(v) => setBrush({ radius: v })} />
        </Row>
        <Row label="Strength">
          <Slider value={brush.strength} min={1} max={60} step={1} onChange={(v) => setBrush({ strength: v })} />
        </Row>
        <Row label="Road">
          <Check
            label="Carry the road with the brush"
            checked={brushRoad}
            onChange={setBrushRoad}
          />
        </Row>
        <p className="hint">
          Drag to sculpt, <b>Shift</b> inverts raise and lower.{' '}
          {brushRoad ? (
            <>
              A stroke over the track or the pit lane lifts and lowers the road with the ground,
              so everything moves as one surface.
            </>
          ) : (
            <>
              The road holds its line: the ground under it is always blended back to the tarmac,
              so a stroke there does not show.
            </>
          )}
        </p>
      </Section>

      <Section title="Terrain">
        <Row label="Visible">
          <Check
            label="Show and export terrain"
            checked={terrain.enabled}
            onChange={(v) =>
              commit((p) => {
                p.terrain.enabled = v;
              })
            }
          />
        </Row>
        {!terrain.enabled && (
          <p className="hint" style={{ marginTop: 0 }}>
            Terrain off is the fastest the editor gets: no ground to rebuild, and
            you draw on a flat plane instead. Good for laying a long track out,
            switch it back on to shape the landscape.
          </p>
        )}
        <Row label="3D grass">
          <Check
            label="Grass tufts along the verges"
            checked={terrain.grass3d}
            onChange={(v) =>
              commit((p) => {
                p.terrain.grass3d = v;
              })
            }
          />
        </Row>
        {terrain.grass3d && (
          <p className="hint" style={{ marginTop: 0 }}>
            A strip of little grass cards either side of the road, like the 3D
            grass on real circuits. It follows the track and the ground paint by
            itself and is baked into the export.
          </p>
        )}
        <Row label="Size">
          <Num
            value={terrain.size}
            step={50}
            min={100}
            suffix="m"
            onChange={(v) =>
              commit((p) => {
                p.terrain.size = v;
              })
            }
          />
        </Row>
        <Row label="Resolution">
          <Seg
            value={terrain.res}
            options={[
              { value: 97, label: 'Low' },
              { value: 193, label: 'Medium' },
              { value: 289, label: 'High' },
            ]}
            onChange={(v) =>
              commit((p) => {
                p.terrain = resampleTerrain(p.terrain, v);
              })
            }
          />
        </Row>
        <Row label="Blend">
          <Slider
            value={terrain.blend}
            min={2}
            max={80}
            step={1}
            unit=" m"
            onChange={(v) =>
              commit((p) => {
                p.terrain.blend = v;
              })
            }
          />
        </Row>
        <Row label="">
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() =>
              commit((p) => {
                p.terrain = fitTerrainToTrack(p.terrain, derived.trackFrames, 260);
              })
            }
          >
            Fit terrain to track
          </button>
        </Row>
        <DatumRow />
        <p className="hint">
          Grid: {terrain.res} x {terrain.res} vertices over {Math.round(terrain.size)} m, about{' '}
          {(terrain.size / (terrain.res - 1)).toFixed(1)} m per cell.
        </p>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The ground brush.
 *
 * What it paints is the ground itself, not a slab laid on top of it: there is
 * one ground and this says what it is made of where. So there is no height to
 * set and nothing to select afterwards -- sculpt a dip through a gravel bed and
 * the gravel goes down with it, because it is the same surface.
 */
function GroundOptions() {
  const ground = useEditor((s) => s.ground);
  const setGround = useEditor((s) => s.setGround);
  const terrain = useEditor((s) => s.project.terrain);
  const draft = useEditor((s) => s.groundDraft);
  const setGroundDraft = useEditor((s) => s.setGroundDraft);
  const addGroundShape = useEditor((s) => s.addGroundShape);
  const clearGroundPaint = useEditor((s) => s.clearGroundPaint);
  const fillGround = useEditor((s) => s.fillGround);
  const setStatus = useEditor((s) => s.setStatus);
  const painted = terrain.paint !== null;
  const material = GROUND_KINDS[ground.kind];

  return (
    <Section title="Ground">
      <Row label="Material">
        <Seg
          value={ground.kind}
          options={GROUND_KINDS.map((k, i) => ({ value: i, label: k.label }))}
          onChange={(v) => setGround({ kind: v })}
        />
      </Row>
      <Row label="Shape">
        <Seg
          value={ground.mode}
          options={[
            { value: 'brush' as const, label: 'Brush' },
            { value: 'rect' as const, label: 'Rectangle' },
            { value: 'polygon' as const, label: 'Outline' },
            { value: 'path' as const, label: 'Line' },
          ]}
          onChange={(v) => {
            setGround({ mode: v });
            if (v !== 'polygon' && v !== 'path') setGroundDraft([]);
          }}
        />
      </Row>
      {ground.mode === 'brush' && (
        <Row label="Radius">
          <Slider
            value={ground.radius}
            min={2}
            max={120}
            step={1}
            unit=" m"
            onChange={(v) => setGround({ radius: v })}
          />
        </Row>
      )}
      {ground.mode === 'path' && (
        <Row label="Width">
          <Slider
            value={ground.pathWidth}
            min={1}
            max={30}
            step={0.5}
            digits={1}
            unit=" m"
            onChange={(v) => setGround({ pathWidth: v })}
          />
        </Row>
      )}
      {(ground.mode === 'rect' || ground.mode === 'polygon') && !(ground.mode === 'polygon' && ground.curve) && (
        <Row label="Corners">
          <Slider
            value={ground.cornerRadius}
            min={0}
            max={25}
            step={0.5}
            digits={1}
            unit=" m"
            onChange={(v) => setGround({ cornerRadius: v })}
          />
        </Row>
      )}
      {(ground.mode === 'polygon' || ground.mode === 'path') && (
        <Row label="">
          <Check
            label="Curve through the points"
            checked={ground.curve}
            onChange={(v) => setGround({ curve: v })}
          />
        </Row>
      )}
      {ground.mode !== 'brush' && <SnapRow />}
      {!terrain.enabled && (
        <p className="hint" style={{ marginTop: 0 }}>
          The terrain is switched off, so there is no ground to paint. Turn it back on under
          <b> Sculpt</b>.
        </p>
      )}

      {ground.mode === 'brush' && (
        <p className="hint">
          Drag to paint. Free hand, so it is the one for a verge, the mouth of a gravel trap, or
          anything with no straight line in it.
        </p>
      )}
      {ground.mode === 'rect' && (
        <p className="hint">
          Pull a rectangle out corner to corner. Nothing is painted until you let go, and the snap
          above is what makes two of them meet exactly. <b>Corners</b> rounds the four corners into
          circular fillets while the sides stay dead straight — how a real run off area ends.
        </p>
      )}
      {ground.mode === 'polygon' && (
        <p className="hint">
          Click the corners of the area. Clicking the first one again — or <b>Enter</b> — closes it
          and fills it in; <b>Esc</b> drops it. For a paddock or a run off area that is neither
          round nor square, which on a circuit is most of them.
        </p>
      )}
      {ground.mode === 'path' && (
        <p className="hint">
          Click points along the line, <b>Enter</b> paints it; clicking the first point again joins
          it into a ring, <b>Esc</b> drops it. Dead straight between the points, or one continuous
          curve through them with the toggle on — the precise way to lay a service road or a
          painted band, exactly where you put it.
        </p>
      )}
      {ground.mode === 'path' && draft.length > 0 && (
        <Row label="">
          <div style={{ display: 'flex', gap: 6, width: '100%' }}>
            <button
              className="btn"
              style={{ flex: 1, justifyContent: 'center' }}
              disabled={draft.length < 2}
              onClick={() => {
                addGroundShape(draft.map(([x, z]) => ({ x, z })), 'line', false);
                setGroundDraft([]);
                setStatus('Line laid · click a point to reshape it');
              }}
            >
              Paint {draft.length} points
            </button>
            <button
              className="btn"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                setGroundDraft([]);
                setStatus('Line dropped');
              }}
            >
              Drop it
            </button>
          </div>
        </Row>
      )}
      {ground.mode === 'polygon' && draft.length > 0 && (
        <Row label="">
          <div style={{ display: 'flex', gap: 6, width: '100%' }}>
            <button
              className="btn"
              style={{ flex: 1, justifyContent: 'center' }}
              disabled={draft.length < 3}
              onClick={() => {
                addGroundShape(draft.map(([x, z]) => ({ x, z })), 'area', true);
                setGroundDraft([]);
                setStatus('Ground area laid · click a point to reshape it');
              }}
            >
              Close {draft.length} corners
            </button>
            <button
              className="btn"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                setGroundDraft([]);
                setStatus('Outline dropped');
              }}
            >
              Drop it
            </button>
          </div>
        </Row>
      )}

      <p className="hint" style={{ marginTop: 0 }}>
        <b>Alt</b> rubs the paint out in any of the four, which is not the same as painting grass:
        grass is a material you lay over what was there, the eraser hands the patch back. Whatever
        you paint <i>replaces</i> the ground rather than covering it: nothing sits on top, nothing
        shows through, and sculpting moves it with the rest. Each material is exported as its own
        mesh, so a car really does slide on the gravel.
      </p>
      <p className="hint" style={{ marginTop: 0 }}>
        The edge is cut where the material changes, every{' '}
        {paintCellSize(terrain).toFixed(1)} m, and it is cut where the shape really ran rather than
        halfway between two samples, so a rectangle at any angle at all comes out with straight
        sides instead of a staircase. A finer terrain resolution makes it finer still.
      </p>

      <Row label="">
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <button
            className="btn"
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => {
              fillGround(ground.kind);
              setStatus(`The whole field is ${material.label.toLowerCase()}`);
            }}
          >
            Fill the field
          </button>
          <button
            className="btn"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={!painted}
            onClick={() => {
              clearGroundPaint();
              setStatus('Ground is untouched again');
            }}
          >
            Rub it all out
          </button>
        </div>
      </Row>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Aiming the next object.
 *
 * A raw range input rather than `Slider`: that one routes every pixel of travel
 * through `tweakRun`, which opens an undo burst, and the placement heading is
 * not part of the project at all -- the same reason the scatter settings use
 * one further down.
 *
 * It stops at 359 rather than wrapping at 360. Headings are normalised into
 * 0..360, so a slider that could reach the top jumped to the far left the
 * instant it got there and threw away a heading that had taken a while to dial
 * in. The step is 1°, and the box beside it takes any angle typed in directly,
 * because 15° jumps line up with nothing that a spline produced.
 */
function HeadingRow({
  value,
  onChange,
  setStatus,
}: {
  value: number;
  onChange: (v: number) => void;
  setStatus: (s: string) => void;
}) {
  return (
    <>
      <Row label="Heading">
        <input
          type="range"
          min={0}
          max={359}
          step={1}
          value={Math.min(359, Math.round(value))}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        {/* The shared number box, so a heading read off a spline keeps the
            three decimals it came with instead of being rounded on screen. */}
        <Num value={value} min={0} max={360} step={1} suffix="°" onChange={onChange} />
      </Row>
      <Row label="">
        <button
          className="btn"
          style={{ width: '100%', justifyContent: 'center' }}
          title="Turn it onto the heading of the nearest track or pit lane cross section (F). Already aligned, it turns round to face the other way."
          onClick={() => setStatus(alignPlacementToPath())}
        >
          Align with the track (F) · again flips
        </button>
      </Row>
    </>
  );
}

/** How big the next ground patch is. Only shown for the things that have one. */
function PadSizeRow() {
  const padSize = useEditor((s) => s.padSize);
  const setPadSize = useEditor((s) => s.setPadSize);
  return (
    <>
      <Row label="Patch size">
        <Num value={padSize.w} min={1} max={600} step={1} suffix="x" onChange={(v) => setPadSize(v, padSize.l)} />
        <Num value={padSize.l} min={1} max={600} step={1} suffix="m" onChange={(v) => setPadSize(padSize.w, v)} />
      </Row>
      <p className="hint">
        Press and pull a rectangle to size a patch as you place it; its corners latch onto the
        patches already down. A plain click drops one at the size above.
      </p>
    </>
  );
}

function PlaceOptions() {
  const placeKind = useEditor((s) => s.placeKind);
  const setPlaceKind = useEditor((s) => s.setPlaceKind);
  const placeRotation = useEditor((s) => s.placeRotation);
  const setPlaceRotation = useEditor((s) => s.setPlaceRotation);
  const assets = useEditor((s) => s.project.assets);
  const commit = useEditor((s) => s.commit);
  const setStatus = useEditor((s) => s.setStatus);
  const [category, setCategory] = useState<string>('All');
  // What the last import did, kept until the next one. Read the comment on
  // `importModel` for why this is not in the status strip.
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The palette says how big each imported model is and whether it failed, and
  // both of those are only known once the parse finishes -- which happens
  // outside React, on a project load as well as on an import.
  useSyncExternalStore(onAssetsChanged, assetVersion);

  /*
   * Import a model, and only then let it into the project.
   *
   * The parse used to be started and forgotten: a file that could not be read
   * still got a card in the palette, and clicking that card added an object
   * that rendered as nothing, exported as nothing and said nothing. Waiting
   * for the parse costs a moment on a big file and makes the failure a
   * sentence the user can act on.
   *
   * Every outcome lands in `notice`, right under the button, and stays there.
   * The status strip is the wrong place for this: it is one line at the far
   * bottom of the window and the next mouse move writes over it, so a rejected
   * import looked exactly like a button that does nothing at all.
   */
  const importModel = async () => {
    setNotice(null);
    const file = await pickFile('.glb,.gltf,.obj,.fbx');
    if (!file) return;
    const mb = file.size / (1024 * 1024);
    const ext = extOf(file.name);
    if (!ext) {
      setNotice({
        tone: 'error',
        text: `${file.name} is not a model file. Use GLB, GLTF, OBJ or FBX.`,
      });
      return;
    }
    if (mb > MODEL_LIMIT_MB) {
      setNotice({
        tone: 'error',
        text: `${file.name} is ${mb.toFixed(0)} MB. The limit is ${MODEL_LIMIT_MB} MB — a bigger `
          + 'one takes several copies of itself in memory while it is being saved. Reduce the mesh '
          + 'or the textures in the program it came from and import it again.',
      });
      return;
    }

    setBusy(true);
    setNotice({ tone: 'info', text: `Reading ${file.name} (${mb.toFixed(1)} MB)…` });
    try {
      // Let the "reading" line actually reach the screen. Parsing a big model
      // blocks the main thread for seconds, and a state change made straight
      // before it is painted only once the block is over -- which is to say,
      // never, as far as anyone watching is concerned.
      await new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      });

      const buf = await file.arrayBuffer();
      const id = `a${Date.now().toString(36)}`;
      const asset = { id, name: file.name.replace(/\.[^.]+$/, ''), ext, data: arrayBufferToBase64(buf) };
      if (!(await ensureAsset(asset))) {
        const why = assetError(id) ?? 'the file could not be read';
        forgetAsset(id);
        setNotice({ tone: 'error', text: `${file.name} could not be read: ${why}` });
        return;
      }
      commit((p) => {
        p.assets.push(asset);
      });
      const kind = `${ASSET_PREFIX}${id}`;
      setPlaceKind(kind);
      // The size, out loud. It is the one number that decides whether the import
      // is usable -- an FBX in the wrong unit is the usual way this goes wrong --
      // and the inspector can now be typed straight over the top of it.
      const size = propSize(kind);
      const measured = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} m`;
      setNotice({
        tone: mb > AUTOSAVE_SAFE_MB ? 'warn' : 'ok',
        text: `Imported ${file.name} — ${measured}. Click the ground to place it.`
          + (mb > AUTOSAVE_SAFE_MB
            ? ` At ${mb.toFixed(0)} MB it is past what this browser can autosave, so `
              + '"Continue last session" will not bring it back — save the project to a file.'
            : ''),
      });
      setStatus(`Imported ${file.name} — ${measured}`);
    } finally {
      setBusy(false);
    }
  };

  // Superseded entries are still built, so an existing track keeps whatever it
  // already holds -- they just are not offered again.
  const shown = LIBRARY.filter(
    (d) => !d.hidden && (category === 'All' || d.category === category),
  );

  return (
    <>
      <Section title="Object library">
        <Row label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option>All</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Row>
        <div className="propgrid" style={{ marginTop: 8 }}>
          {shown.map((d) => (
            <button
              key={d.key}
              className={`propcard ${placeKind === d.key ? 'on' : ''}`}
              onClick={() => setPlaceKind(d.key)}
            >
              {d.label}
              <br />
              <span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>
                {/* A ground patch is neither: cars drive ON it, and calling
                    that decoration made the pads look like scenery. */}
                {d.surface === null ? 'decoration' : d.surface === 'WALL' ? 'solid' : 'drivable'}
              </span>
            </button>
          ))}
        </div>
        <SnapRow />
        <HeadingRow value={placeRotation} onChange={setPlaceRotation} setStatus={setStatus} />
        {isGroundPad(placeKind) && <PadSizeRow />}
        {isGroundPad(placeKind) && (
          <p className="hint" style={{ marginTop: 0 }}>
            A patch is an object lying <i>on</i> the ground, with a height and a position of its
            own. To make the ground itself asphalt or gravel — no grass underneath it, and the
            sculpt brush moving it with the rest of the terrain — use the{' '}
            <b>Ground tool (M)</b> instead.
          </p>
        )}
        <p className="hint">
          Objects snap to the ground; buildings, patches and barriers line up flush with a
          neighbour of the same sort. <b>R</b> + mouse turns the next one, <b>[</b> <b>]</b> step
          15°, <b>Alt</b> drops it under the cursor unsnapped.
        </p>
      </Section>

      <Section title="Prefabs">
        <div className="propgrid">
          {PREFABS.map((d) => (
            <button
              key={d.key}
              className={`propcard ${placeKind === `${PREFAB_PREFIX}${d.key}` ? 'on' : ''}`}
              onClick={() => setPlaceKind(`${PREFAB_PREFIX}${d.key}`)}
            >
              {d.label}
              <br />
              <span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>{d.hint}</span>
            </button>
          ))}
        </div>
        <p className="hint">
          A whole arrangement in one click, spaced so the parts sit flush against each other. It
          drops as a single undo step, and the heading above turns the lot.
        </p>
      </Section>

      <Section title="Your models">
        <button
          className="btn"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={busy}
          onClick={importModel}
        >
          {busy ? 'Reading the file…' : 'Import GLB / GLTF / OBJ / FBX'}
        </button>
        {notice && (
          <div
            className={`callout ${notice.tone === 'ok' ? 'ok' : notice.tone === 'info' ? 'info' : ''}`}
            style={{
              marginTop: 8,
              marginBottom: 0,
              ...(notice.tone === 'error' ? { borderLeftColor: 'var(--danger)' } : {}),
            }}
          >
            {notice.text}
          </div>
        )}
        {assets.length > 0 && (
          <div className="propgrid" style={{ marginTop: 8 }}>
            {assets.map((a) => {
              const kind = `${ASSET_PREFIX}${a.id}`;
              // A model that will not parse is shown as dead rather than left
              // to be clicked: selecting it could only place an object that
              // renders as nothing and exports as nothing.
              const failed = assetError(a.id);
              const size = getAsset(a.id) ? propSize(kind) : null;
              return (
                <button
                  key={a.id}
                  className={`propcard ${placeKind === kind ? 'on' : ''}`}
                  disabled={failed !== null}
                  title={failed ?? a.name}
                  onClick={() => setPlaceKind(kind)}
                >
                  {a.name}
                  <br />
                  <span
                    style={{ color: failed ? 'var(--danger)' : 'var(--text-faint)', fontSize: 10.5 }}
                  >
                    {failed
                      ? 'could not be read'
                      : size
                        ? `.${a.ext} · ${Math.max(size.x, size.z).toFixed(1)} m`
                        : `.${a.ext} · reading…`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p className="hint">
          Imported models are stored inside the project file, so a saved project stays self contained.
          They are centred and put on the ground automatically; an FBX is converted to metres from
          the unit its file names. Wrong size anyway? Select the object and type the metres you want.
        </p>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The eraser.
 *
 * A brush that deletes whatever it is swept over, whatever that is -- the
 * vegetation brush could only ever rub out its own plants, and the alternative
 * for everything else was clicking objects one at a time.
 */
function EraseOptions() {
  const radius = useEditor((s) => s.eraseRadius);
  const setEraseRadius = useEditor((s) => s.setEraseRadius);
  const count = useEditor((s) => s.project.props.length);

  return (
    <Section title="Erase" right={<span className="badge">{count} objects</span>}>
      <Row label="Radius">
        <input
          type="range"
          min={2}
          max={80}
          step={1}
          value={radius}
          onChange={(e) => setEraseRadius(Number(e.target.value))}
        />
        <span className="unit">{radius} m</span>
      </Row>
      <p className="hint">
        Sweep the red circle over anything you want gone. The whole sweep is <b>one undo step</b>.
      </p>
      <p className="hint" style={{ marginTop: 0 }}>
        What counts is where an object <i>sits</i>, not how big it is: a grandstand whose centre is
        outside the circle stays.
      </p>
      <p className="hint" style={{ marginTop: 0 }}>
        For picking a few specific things instead, use <b>Select</b> and drag a box over them on
        empty ground — then Delete removes the lot.
      </p>
    </Section>
  );
}

function ScatterOptions() {
  const scatter = useEditor((s) => s.scatter);
  const setScatter = useEditor((s) => s.setScatter);
  const setStatus = useEditor((s) => s.setStatus);
  // `hidden` the same way the object library reads it: a superseded plant is
  // still built for the projects that hold one, never offered for a new one.
  const plants = LIBRARY.filter((d) => !d.hidden && d.category === 'Nature');

  const toggle = (key: string) => {
    const has = scatter.kinds.includes(key);
    // Never let the palette empty out: a brush with nothing selected would
    // look broken rather than idle.
    if (has && scatter.kinds.length === 1) return;
    const kinds = has ? scatter.kinds.filter((k) => k !== key) : [...scatter.kinds, key];
    /*
     * Picking grass turns the run off back on to plant on. Grass kept off the
     * verge leaves a shaved strip between the kerb and the first blade, which
     * is not a thing anybody wants and takes a while to work out. The tick box
     * below still shows what happened and still overrides it.
     */
    const patch: Partial<typeof scatter> = { kinds };
    if (!has && GRASS_KINDS.includes(key)) patch.overRunoff = true;
    setScatter(patch);
  };

  return (
    <Section title="Plant">
      <div className="propgrid">
        {plants.map((d) => (
          <button
            key={d.key}
            className={`propcard ${scatter.kinds.includes(d.key) ? 'on' : ''}`}
            onClick={() => toggle(d.key)}
          >
            {d.label}
            <br />
            <span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>
              {scatter.kinds.includes(d.key) ? 'in the mix' : 'off'}
            </span>
          </button>
        ))}
      </div>

      {/* The palette says (2D) on nearly everything in it, which reads as a
          caveat unless the panel says what it is. */}
      <p className="hint" style={{ marginTop: 0 }}>
        <b>(2D)</b> trees are two crossed pictures, the way Assetto Corsa builds them: eight
        triangles against six hundred for a modelled one. That is what makes a wood of a
        thousand trees affordable, and it is what the game does on its own circuits.
      </p>

      {/* Raw range inputs, not the shared Slider: that one opens an undo burst
          on every drag, and these settings never touch the project, so each
          nudge would push an entry identical to the last and wipe the redo
          stack. */}
      <Row label="Radius">
        <input
          type="range"
          min={5}
          max={80}
          step={1}
          value={scatter.radius}
          onChange={(e) => setScatter({ radius: Number(e.target.value) })}
        />
        <span className="unit">{scatter.radius} m</span>
      </Row>
      {/* Down to a metre, because grass is not a tree: a verge wants tufts a
          stride apart, and 3 m was chosen when the only things in this brush
          were pines. */}
      <Row label="Spacing">
        <input
          type="range"
          min={1}
          max={20}
          step={0.5}
          value={scatter.spacing}
          onChange={(e) => setScatter({ spacing: Number(e.target.value) })}
        />
        <span className="unit">{scatter.spacing} m</span>
      </Row>
      <Row label="Size varies">
        <input
          type="range"
          min={0}
          max={0.5}
          step={0.05}
          value={scatter.scaleJitter}
          onChange={(e) => setScatter({ scaleJitter: Number(e.target.value) })}
        />
        <span className="unit">{Math.round(scatter.scaleJitter * 100)} %</span>
      </Row>
      <Row label="Keep off track">
        <input
          type="range"
          min={0}
          max={30}
          step={1}
          value={scatter.keepOff}
          onChange={(e) => setScatter({ keepOff: Number(e.target.value) })}
        />
        <span className="unit">{scatter.keepOff} m</span>
      </Row>
      <Row label="Run off">
        <Check
          label="Plant on it too"
          checked={scatter.overRunoff}
          onChange={(v) => setScatter({ overRunoff: v })}
        />
      </Row>

      <Row label="">
        <button
          className="btn"
          style={{ width: '100%', justifyContent: 'center' }}
          title="Deletes any plant standing on the tarmac, the kerb or the coloured strip"
          onClick={() => {
            const gone = clearPlantsOffTrack();
            setStatus(gone === 0 ? 'Nothing is growing on the road' : `${gone} plants cleared off the road`);
          }}
        >
          Clear plants off the road
        </button>
      </Row>
      <p className="hint" style={{ marginTop: 0 }}>
        Happens by itself after every track drag, as one undo step. The run off is left alone.
      </p>

      <p className="hint">
        Drag to plant, <b>Alt</b> clears again. <b>Spacing</b> is the density. One stroke is one
        undo step, and stops at 400 plants.
      </p>
      <p className="hint" style={{ marginTop: 0 }}>
        <b>Keep off track</b> is measured from the edge of{' '}
        {scatter.overRunoff ? 'the tarmac and its kerb' : 'the run off, at its far side'}, as built.{' '}
        {scatter.overRunoff
          ? 'Ground cover can therefore go right up to the kerb.'
          : 'That keeps trees out of a run off, and ground cover with them — switch this on for grass.'}
      </p>
    </Section>
  );
}
