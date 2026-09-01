import { Profiler, useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from './store/store';
import { useDerived } from './store/derived';
import { alignPlacementToPath, clearPlantsOffTrack } from './store/placement';
import { Viewport } from './scene/Viewport';
import { FpsReadout } from './scene/FpsMeter';
import { TopBar } from './ui/TopBar';
import { LeftPanel } from './ui/LeftPanel';
import { RightPanel } from './ui/RightPanel';
import { ExportDialog } from './ui/ExportDialog';
import { ImportDialog } from './ui/ImportDialog';
import { StartDialog } from './ui/StartDialog';
import { Tutorial } from './ui/Tutorial';
import { autosave, downloadProject, loadAutosave } from './io/project';
import { ensureAssets } from './io/assetCache';
import { noteRender } from './scene/stallLog';
import { deleteSectionInterior } from './core/section';
import { pathDataOf, type Project } from './types';

/*
 * The line along the bottom of the viewport: what the left button does in the
 * tool you are in, and the one or two modifiers that change it. It is a
 * reminder, not a manual -- the tool's own panel is where the longer story is
 * told, and a paragraph floating over the track is a paragraph nobody reads.
 */
const TOOL_HINTS: Record<string, string> = {
  select: 'Click to select · Shift+click a second point for the stretch between · Alt+click the line inserts · Del removes',
  drawTrack: 'Click the ground to append a point · Alt overrides mode and grid · Select tool drags points, height included',
  drawPit: 'Click the ground to append a pit lane point · the lane gets the PIT surface, so the limiter works',
  drawRoad: 'Click the ground to draw an access road · end it at the circuit and it glues itself on · New road in the panel starts another',
  terrain: 'Drag to sculpt · Shift lowers · the road corridor is protected',
  scatter: 'Drag to plant · Alt clears · trees keep off the track and pit lane on their own',
  kerb: 'Drag along the roadside to lay a kerb · click one to edit it · Alt+drag rubs it out',
  barrier: 'Click a handle to switch its barrier on or off · drag along several to paint a run · Shift+drag moves it in or out',
  place: 'Click to drop · R + mouse turns, tap R steps 15° · F squares up to the track, F again flips it · Alt ignores snapping',
};

/** Degrees the preview turns per pixel of mouse travel while R is held. */
const ROTATE_PER_PIXEL = 0.5;

/**
 * Turning the object you are about to place by holding R and moving the mouse.
 *
 * The preview already shows the real landing pose, snapping and all, so the one
 * thing it was missing as a control was a way to aim it -- and two bracket keys
 * in 15° steps is not aiming. It deliberately does NOT take a mouse button:
 * the left one belongs to the tools and the other two drive the camera, and
 * quietly borrowing one of those is how the tools and the camera came to be
 * fighting over the same drag in the first place.
 *
 * Outside the canvas, with the rest of the keyboard handling: it only ever
 * touches the store, and a scene component cannot be exercised without a
 * compositing viewport.
 */
function PlaceRotateKey() {
  useEffect(() => {
    let held = false;
    /** Degrees the mouse has turned the object since the key went down. */
    let turned = 0;
    let shown = NaN;
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (typing(e.target)) return;
      if (useEditor.getState().tool !== 'place') return;
      // Auto-repeat keeps firing keydown while the key is held; only the
      // first one of a press starts a fresh tap-or-turn measurement.
      if (!held) turned = 0;
      held = true;
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r') return;
      // A tap: down and up without the mouse doing any work. Hold-and-turn is
      // invisible until you know it exists, and the natural experiment --
      // press R, see what happens -- used to answer with nothing at all. Now
      // it answers with a 15° step, Shift the other way, and the hold keeps
      // working exactly as before for anyone already turning with the mouse.
      if (held && Math.abs(turned) < 2) {
        const s = useEditor.getState();
        if (s.tool === 'place') {
          s.setPlaceRotation(s.placeRotation + (e.shiftKey ? -15 : 15));
          s.setStatus(`Placement heading ${Math.round(useEditor.getState().placeRotation)}°`);
        }
      }
      held = false;
    };
    const onMove = (e: MouseEvent) => {
      if (!held) return;
      const s = useEditor.getState();
      // Shift is the fine adjustment, for squaring up with something by eye.
      const step = e.movementX * (e.shiftKey ? 0.1 : ROTATE_PER_PIXEL);
      turned += step;
      s.setPlaceRotation(s.placeRotation + step);
      // The status line is a store write and a render; at sixty moves a second
      // it only earns that when the number on it actually changes.
      const now = Math.round(useEditor.getState().placeRotation);
      if (now !== shown) {
        shown = now;
        s.setStatus(`Placement heading ${now}°`);
      }
    };
    // Alt+Tab away mid turn and the keyup lands in the other window.
    const clear = () => {
      held = false;
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return null;
}

/**
 * The one-line hint under the viewport. Its own component, so App itself does
 * not subscribe to anything: with App re-rendering, every panel and the whole
 * viewport re-rendered on every single edit frame.
 */
function ToolHint() {
  const tool = useEditor((s) => s.tool);
  return <div className="overlay-hint">{TOOL_HINTS[tool] ?? ''}</div>;
}

/** Hands a Profiler's measurement to the flight recorder. */
const reportRender = (id: string, _phase: string, actualDuration: number) => {
  noteRender(id, actualDuration);
};

/** The status strip along the bottom. Small, so re-rendering per edit is fine. */
function StatusBar() {
  const status = useEditor((s) => s.status);
  const picked = useEditor((s) => s.acMarked.length);
  const nodeCount = useEditor((s) => s.project.track.nodes.length);
  const propCount = useEditor((s) => s.project.props.length);
  const derived = useDerived();
  return (
    <div className="statusbar">
      <span>{status}</span>
      <span className="spacer" />
      <FpsReadout />
      <span>Track {Math.round(derived.trackLength).toLocaleString('en-US')} m</span>
      <span>Pit {Math.round(derived.pitLength).toLocaleString('en-US')} m</span>
      <span>{nodeCount} points</span>
      <span>{propCount} objects</span>
      {picked > 1 && (
        <span style={{ color: 'var(--accent)' }}>{picked} picked</span>
      )}
      <span>
        Grid {derived.markers.grid.length} / Pits {derived.markers.pits.length}
      </span>
    </div>
  );
}

export default function App() {
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [autosaved, setAutosaved] = useState<Project | null>(null);
  const bootRef = useRef(false);
  const onExport = useCallback(() => setExportOpen(true), []);
  const onExportClose = useCallback(() => setExportOpen(false), []);
  const onImport = useCallback(() => setImportOpen(true), []);
  const onImportClose = useCallback(() => setImportOpen(false), []);
  const onNew = useCallback(() => setStartOpen(true), []);
  const onStartClose = useCallback(() => setStartOpen(false), []);
  const onTutorial = useCallback(() => setTutorialOpen(true), []);
  const onTutorialClose = useCallback(() => setTutorialOpen(false), []);

  /*
   * Ask what to open, once, on first mount.
   *
   * The editor starts on bare ground and the dialog puts something on it --
   * a generated circuit, the demo oval, or nothing at all. The autosave, if
   * this browser is holding one, is offered inside the same dialog rather than
   * as a second question in front of it.
   */
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    setAutosaved(loadAutosave());
    setStartOpen(true);
  }, []);

  /*
   * Asset loading and autosave, driven by a plain store subscription instead of
   * a React subscription: neither needs to render anything, and subscribing App
   * to the project meant re-rendering the entire interface per edit frame.
   *
   * Autosave is throttled and pushed into idle time. Writing to localStorage is
   * synchronous, and the terrain height field turns into a few hundred
   * kilobytes of base64 on the way there. Doing that in the middle of a frame
   * is a visible hitch, so it waits for a gap in the work and only after a good
   * pause in editing.
   */
  useEffect(() => {
    let timer = 0;
    let idle = 0;
    const cancel = () => {
      clearTimeout(timer);
      if (idle && typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
      idle = 0;
    };
    ensureAssets(useEditor.getState().project.assets);
    // Said once, when it starts failing, rather than every four seconds for the
    // rest of the session.
    let quotaReported = false;
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      if (s.project.assets !== prev.project.assets) ensureAssets(s.project.assets);
      cancel();
      timer = setTimeout(() => {
        const run = () => {
          if (autosave(useEditor.getState().project)) {
            quotaReported = false;
            return;
          }
          if (quotaReported) return;
          quotaReported = true;
          useEditor.getState().setStatus(
            'Autosave failed: the project is past what this browser can hold, usually an '
            + 'imported model. Save it to a file — "Continue last session" will not have it.',
          );
        };
        if (typeof requestIdleCallback === 'function') {
          idle = requestIdleCallback(run, { timeout: 4000 });
        } else {
          run();
        }
      }, 4000) as unknown as number;
    });
    return () => {
      unsub();
      cancel();
    };
  }, []);

  /**
   * After the road has been dragged about, clear anything left growing on it.
   *
   * Plants are objects at fixed coordinates; the road is not. Move a control
   * point and the verge you planted becomes tarmac with trees in it, and there
   * is nothing in the plants to notice. So this watches for the END of an
   * interaction -- the moment a drag is let go of -- and, if the track or the
   * pit lane moved during it, takes out whatever is now standing on the hard
   * surface. The run off is left alone: that is grass, and what grows there is
   * the author's business.
   *
   * Tied to a drag ending rather than to any change of the project, and that is
   * not a detail. Running on every change would fire on UNDO as well, quietly
   * deleting the plants the undo just restored, and no amount of Ctrl+Z would
   * ever get them back.
   */
  useEffect(() => {
    let dragging = false;
    let before = useEditor.getState().project;
    return useEditor.subscribe((s) => {
      if (s.interacting) {
        dragging = true;
        return;
      }
      if (!dragging) {
        before = s.project;
        return;
      }
      dragging = false;
      const moved = s.project.track !== before.track || s.project.pit !== before.pit;
      before = s.project;
      if (!moved) return;
      const gone = clearPlantsOffTrack();
      if (gone > 0) {
        before = useEditor.getState().project;
        useEditor.getState().setStatus(
          `${gone} plant${gone === 1 ? '' : 's'} cleared off the road (Ctrl+Z puts them back)`,
        );
      }
    });
  }, []);

  /* Keyboard shortcuts. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const s = useEditor.getState();

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        downloadProject(s.project);
        s.setStatus('Project saved');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        // The browser would bookmark the page otherwise.
        e.preventDefault();
        const sel = s.selection;
        if (sel?.kind === 'prop') {
          s.duplicateProp(sel.id);
          s.setStatus('Duplicated in row');
        }
        return;
      }
      // Aim the next object before dropping it. Ahead of the modifier bail on
      // purpose: German and several other layouts only reach the brackets
      // through AltGr, which the browser reports as Ctrl+Alt, so behind the
      // bail this shortcut simply did not exist on those keyboards. Comma and
      // period do the same job with no modifier on any layout.
      if (s.tool === 'place' && (e.key === '[' || e.key === ']' || e.key === ',' || e.key === '.')) {
        const step = e.key === '[' || e.key === ',' ? -15 : 15;
        s.setPlaceRotation(s.placeRotation + step);
        s.setStatus(`Placement heading ${Math.round(useEditor.getState().placeRotation)}°`);
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 'v': s.setTool('select'); break;
        case 't': s.setTool('drawTrack'); break;
        case 'p': s.setTool('drawPit'); break;
        // Not R: W/E/R drive the camera and R turns a placement.
        case 'u': s.setTool('drawRoad'); break;
        case 'g': s.setTool('terrain'); break;
        // M for material: what the ground is made of, as opposed to its shape.
        case 'm': s.setTool('ground'); break;
        case 'c': s.setTool('barrier'); break;
        case 'k': s.setTool('kerb'); break;
        case 'b': s.setTool('place'); break;
        case 'n': s.setTool('scatter'); break;
        case 'x': s.setTool('erase'); break;
        // Digits, not W/E/R: those three drive the camera now.
        case '1': s.setGizmo('translate'); break;
        case '2': s.setGizmo('rotate'); break;
        case '3': s.setGizmo('scale'); break;
        // Square up with the road, which is the one angle worth hitting exactly
        // and the one no slider will ever land on: a pit lane runs at whatever
        // the spline came out at, 9.454° on the track this was written for.
        case 'f': {
          if (s.tool !== 'place') break;
          s.setStatus(alignPlacementToPath());
          break;
        }
        // An outline being drawn is finished by Enter as well as by clicking
        // its first corner again, because the last corner is often nowhere
        // near the first one on screen.
        case 'enter': {
          // A line only needs two points; an outline needs three corners.
          // Both go down as SHAPES, so they stay editable afterwards.
          if (s.ground.mode === 'path') {
            if (s.groundDraft.length < 2) break;
            s.addGroundShape(s.groundDraft.map(([x, z]) => ({ x, z })), 'line', false);
            s.setGroundDraft([]);
            s.setStatus('Line laid · click a point to reshape it');
            break;
          }
          if (s.groundDraft.length < 3) break;
          s.addGroundShape(s.groundDraft.map(([x, z]) => ({ x, z })), 'area', true);
          s.setGroundDraft([]);
          s.setStatus('Ground area laid · click a point to reshape it');
          break;
        }
        case 'escape': {
          // A barrier run in progress is the thing Escape is most obviously
          // for: it ends the run rather than clearing a selection that is
          // probably not what the user is looking at.
          if (s.barrierDraft.length > 0) {
            s.setBarrierDraft([]);
            s.setStatus('Barrier run ended');
            break;
          }
          if (s.groundDraft.length > 0) {
            s.setGroundDraft([]);
            s.setStatus('Outline dropped');
            break;
          }
          s.select(null);
          break;
        }
        case 'delete':
        case 'backspace': {
          // A marquee full of objects is what Delete most obviously means when
          // there is one, and it takes priority over a single selection.
          if (s.marked.length > 0) {
            const gone = s.deleteMarked();
            s.setStatus(`${gone} objects deleted`);
            break;
          }
          const sel = s.selection;
          if (!sel) break;
          if (sel.kind === 'node') s.deleteNode(sel.path, sel.id);
          else if (sel.kind === 'prop') s.deleteProp(sel.id);
          else if (sel.kind === 'kerb') s.deleteKerb(sel.id);
          else if (sel.kind === 'ground') {
            s.deleteGroundShape(sel.id);
            s.setStatus('Ground shape removed');
          }
          else if (sel.kind === 'section') {
            s.commit((p) => {
              const data = pathDataOf(p, sel.path);
              if (data) deleteSectionInterior(data, sel.fromId, sel.toId);
            });
            s.select({ kind: 'node', path: sel.path, id: sel.fromId });
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <TopBar onExport={onExport} onImport={onImport} onNew={onNew} onTutorial={onTutorial} />
      <PlaceRotateKey />
      {/*
        Each area reports its own render time to the flight recorder. The
        browser will say "React ran for four seconds" and nothing more, which is
        true of every render in the app; these say WHICH part of the interface
        it was. Costs nothing when the diagnostics are off -- noteRender returns
        immediately -- and React strips Profiler callbacks from a production
        build that does not opt into profiling.
      */}
      <Profiler id="left panel" onRender={reportRender}>
        <LeftPanel />
      </Profiler>

      <div className="viewwrap">
        <Profiler id="viewport" onRender={reportRender}>
          <Viewport />
        </Profiler>
        <ToolHint />
        <Tutorial open={tutorialOpen} onClose={onTutorialClose} />
      </div>

      <Profiler id="right panel" onRender={reportRender}>
        <RightPanel onExport={onExport} />
      </Profiler>

      <StatusBar />

      <ExportDialog open={exportOpen} onClose={onExportClose} />
      <ImportDialog open={importOpen} onClose={onImportClose} />

      <StartDialog
        open={startOpen}
        restore={autosaved}
        onClose={onStartClose}
        onTutorial={onTutorial}
      />
    </div>
  );
}
