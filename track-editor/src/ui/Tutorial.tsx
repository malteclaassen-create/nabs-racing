import { useEffect, useState } from 'react';
import { useEditor, type RightTab } from '../store/store';
import type { Tool } from '../types';

/**
 * A guided walk through the editor, in the corner of the viewport.
 *
 * Deliberately NOT modal: every step puts the tool it is describing in the
 * author's hand and leaves the whole editor live, so the panel being talked
 * about is on screen next to the words. A tutorial you have to dismiss before
 * you can try the thing it just described is a slideshow.
 */
interface Step {
  title: string;
  body: string;
  /** Selected when the step opens, so the panel under discussion is showing. */
  tool?: Tool;
  tab?: RightTab;
}

const STEPS: Step[] = [
  {
    title: 'The viewport',
    body: 'WASD flies the camera, middle drag orbits, right drag pans, the wheel zooms. The left button always belongs to the tool you are holding.',
    tool: 'select',
  },
  {
    title: 'Tools on the left',
    body: 'Pick a tool in the rail; its settings appear underneath. The line along the bottom of the viewport says what the left button does with it.',
    tool: 'select',
  },
  {
    title: 'Draw the centre line',
    body: 'The Track tool (T) appends a control point wherever you click. The drawing mode decides what a click means: free, straight, curve or freehand.',
    tool: 'drawTrack',
  },
  {
    title: 'Shape it',
    body: 'Select (V) drags points about, including up and down for elevation. Alt+click the line inserts a point, Shift+click a second point takes the whole stretch between two.',
    tool: 'select',
  },
  {
    title: 'The road itself',
    body: 'Everything the road is made of lives in the Track tab: width, run off, barriers, textures and detail.',
    tool: 'select',
    tab: 'track',
  },
  {
    title: 'The ground',
    body: 'Sculpt (G) raises, lowers and smooths the terrain. The ground under the road is blended back to the tarmac on every stroke.',
    tool: 'terrain',
  },
  {
    title: 'What the ground is made of',
    body: 'Ground (M) paints asphalt, concrete or gravel into the terrain itself, Alt puts grass back. Use the brush, pull a rectangle out, or click an outline and close it.',
    tool: 'ground',
  },
  {
    title: 'Kerbs',
    body: 'Drag along the roadside with the Kerb tool (K) to lay one. Click a kerb to change its style, width and ramps, Alt+drag rubs it out.',
    tool: 'kerb',
  },
  {
    title: 'Barriers',
    body: 'Every stretch of roadside has a handle. Click one to fence it, drag along several to paint a run, or use Close in the panel to fence the whole lap at once.',
    tool: 'barrier',
  },
  {
    title: 'Scenery',
    body: 'Place (B) drops buildings, barriers and ground patches; Plant (N) paints trees over an area; Erase (X) sweeps a circle over anything you want gone.',
    tool: 'place',
  },
  {
    title: 'Making it a race track',
    body: 'The Race tab holds the grid, the pit boxes, the timing sectors and the AI line, everything Assetto Corsa needs to start a session.',
    tool: 'select',
    tab: 'race',
  },
  {
    title: 'Export',
    body: 'Export for AC writes the finished content/tracks folder as a ZIP. Extract it into Assetto Corsa and drive.',
    tool: 'select',
    tab: 'export',
  },
  {
    title: 'That is the tour',
    body: 'Ctrl+S saves the project file, Ctrl+Z undoes, and the editor autosaves into this browser as you work. The panel of each tool explains the rest.',
    tool: 'select',
    tab: 'properties',
  },
];

export function Tutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const setTool = useEditor((s) => s.setTool);
  const setRightTab = useEditor((s) => s.setRightTab);

  // Reopening starts at the beginning rather than where it was abandoned.
  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  const step = STEPS[i];
  useEffect(() => {
    if (!open || !step) return;
    if (step.tool) setTool(step.tool);
    if (step.tab) setRightTab(step.tab);
  }, [open, step, setTool, setRightTab]);

  if (!open || !step) return null;

  return (
    <div className="tutorial">
      <div className="tutorial-head">
        <span className="tutorial-step">
          {i + 1} / {STEPS.length}
        </span>
        <b>{step.title}</b>
        <button className="btn ghost icon" title="Close the tutorial" onClick={onClose}>
          ✕
        </button>
      </div>
      <p>{step.body}</p>
      <div className="tutorial-foot">
        <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>
          Back
        </button>
        {i === STEPS.length - 1 ? (
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <button className="btn primary" onClick={() => setI(i + 1)}>
            Next
          </button>
        )}
      </div>
    </div>
  );
}
