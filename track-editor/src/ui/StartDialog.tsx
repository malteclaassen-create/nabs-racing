import { useState } from 'react';
import { defaultProject, emptyProject, generatedProject, useEditor } from '../store/store';
import { deserializeProject } from '../io/project';
import type { CircuitSize } from '../core/generate';
import type { Project } from '../types';

/**
 * What the editor opens with.
 *
 * It used to open with a demo oval, always, which is a decision made for the
 * author before they have said anything: anyone starting a circuit of their own
 * had to delete twelve control points and a pit lane first, and anyone who just
 * wanted a look round had no idea the oval was a sample rather than the tool.
 * Asking is one click and it removes both problems.
 *
 * The autosave offer lives here too. It used to be its own dialog immediately
 * after this one would have been, and two modal questions in a row before the
 * first frame is a worse greeting than one.
 */
export type StartChoice = 'empty' | 'generate' | 'demo' | 'showcase';

/*
 * The showcase is a real project file rather than something built in code, and
 * it is FETCHED rather than imported: two megabytes of terrain heights, paint
 * and seven thousand objects belong in nobody's initial download, least of all
 * that of a visitor who is about to draw a circuit of their own. Bundled, it
 * would be parsed on every single load; as a file in public/ it costs one
 * request, made only when somebody asks for it.
 *
 * BASE_URL, not a leading slash: the editor is served under /track-editor on
 * the league site (see vite.config.ts) and from the root in dev.
 */
/* Imported through the bundler rather than fetched from public/: the file is
   emitted under a content hash, so every new build gets a new address. From
   public/ it sat at ONE url that the server caches for a week -- ship a
   reworked showcase and everybody's browser kept serving the old one until
   the cache ran out. */
import showcaseUrl from '../assets/showcase.actrack.json?url';
const SHOWCASE_URL = showcaseUrl;

async function loadShowcase(): Promise<Project> {
  const res = await fetch(SHOWCASE_URL);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return deserializeProject(await res.text());
}

const SIZES: Array<{ value: CircuitSize; label: string; note: string }> = [
  { value: 'short', label: 'Short', note: '4 km' },
  { value: 'medium', label: 'Medium', note: '5.5 km' },
  { value: 'long', label: 'Long', note: '7 km' },
];

export function StartDialog({
  open,
  restore,
  onClose,
  onTutorial,
}: {
  open: boolean;
  /** The autosaved project, if this browser is holding one. */
  restore: Project | null;
  onClose: () => void;
  onTutorial: () => void;
}) {
  const [choice, setChoice] = useState<StartChoice>('generate');
  const [size, setSize] = useState<CircuitSize>('medium');
  const [trees, setTrees] = useState(true);
  const [paddock, setPaddock] = useState(true);
  const [hills, setHills] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  // The showcase is a two-megabyte fetch, so Start has to say something and
  // stop taking clicks while it is in the air; `error` keeps the dialog open
  // with a reason instead of closing onto an unchanged editor.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const { replaceProject, setStatus } = useEditor.getState();

  const start = async () => {
    if (choice === 'showcase') {
      setBusy(true);
      setError(null);
      try {
        const p = await loadShowcase();
        replaceProject(p);
        setStatus(`${p.meta.name} loaded, an entire circuit to take apart.`);
      } catch (err) {
        setError((err as Error).message);
        setBusy(false);
        return; // stay open: the editor still holds whatever it had
      }
      setBusy(false);
      onClose();
      if (tutorial) onTutorial();
      return;
    }
    if (choice === 'empty') {
      replaceProject(emptyProject({ hills }));
      setStatus(
        hills
          ? 'Open country. Draw a centre line with the Track tool (T), it follows the ground.'
          : 'Empty field. Draw a centre line with the Track tool (T).',
      );
    } else if (choice === 'generate') {
      replaceProject(generatedProject(size, { trees, paddock }));
      setStatus('Circuit generated. Drag the control points to shape it.');
    } else {
      replaceProject(defaultProject());
      setStatus('Demo oval loaded');
    }
    onClose();
    if (tutorial) onTutorial();
  };

  const restoreIt = () => {
    if (!restore) return;
    replaceProject(restore);
    setStatus('Last session restored');
    onClose();
    if (tutorial) onTutorial();
  };

  const opt = (value: StartChoice, title: string, body: string) => (
    <button
      className={`startopt ${choice === value ? 'on' : ''}`}
      onClick={() => setChoice(value)}
      key={value}
    >
      <b>{title}</b>
      <span>{body}</span>
    </button>
  );

  return (
    <div className="overlay">
      <div className="dialog" style={{ width: 520 }}>
        <header>
          <span>New project</span>
        </header>
        <div className="body">
          {restore && (
            <button className="startopt resume" onClick={restoreIt}>
              <b>Continue last session</b>
              <span>The project autosaved in this browser, exactly as you left it.</span>
            </button>
          )}

          {opt(
            'generate',
            'Generate a circuit',
            'A full lap at the length real circuits are, laid over hills of its own: straights and corners, a levelled start/finish, a catch fence right round it, and a pit lane attached to it either side of the line.',
          )}
          {choice === 'generate' && (
            <>
              <div className="seg" style={{ margin: '0 0 8px' }}>
                {SIZES.map((s) => (
                  <button key={s.value} className={size === s.value ? 'on' : ''} onClick={() => setSize(s.value)}>
                    {s.label} <span style={{ color: 'var(--text-faint)' }}>{s.note}</span>
                  </button>
                ))}
              </div>
              <label className="checkbox" style={{ margin: '0 0 4px' }}>
                <input type="checkbox" checked={trees} onChange={(e) => setTrees(e.target.checked)} />
                Plant the country: woods and clearings along the circuit
              </label>
              <label className="checkbox" style={{ margin: '0 0 8px' }}>
                <input type="checkbox" checked={paddock} onChange={(e) => setPaddock(e.target.checked)} />
                Build the paddock: garages, race control, grandstands
              </label>
            </>
          )}
          {opt('empty', 'Empty field', '2 km of open ground and nothing on it. The Track tool draws the first line.')}
          {choice === 'empty' && (
            <div className="seg" style={{ margin: '0 0 8px' }}>
              <button className={!hills ? 'on' : ''} onClick={() => setHills(false)}>
                Flat <span style={{ color: 'var(--text-faint)' }}>a level slab</span>
              </button>
              <button className={hills ? 'on' : ''} onClick={() => setHills(true)}>
                Rolling hills <span style={{ color: 'var(--text-faint)' }}>~35 m of relief</span>
              </button>
            </div>
          )}
          {opt(
            'showcase',
            'Open the showcase circuit',
            'A finished 5 km circuit as it comes out of this editor: banked corners, a full pit complex with forty boxes, grandstands, and seven thousand trees over three square kilometres of sculpted ground. The fastest way to see what the tool can do, and everything in it can be dragged, repainted or deleted.',
          )}
          {opt('demo', 'Demo oval', 'The sample circuit: twelve points, a pit lane, somewhere to press every button.')}

          {error && (
            <div className="callout" style={{ borderLeftColor: 'var(--danger)', marginTop: 8 }}>
              <b>The showcase would not load.</b><br />{error}
            </div>
          )}

          <label className="checkbox" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={tutorial} onChange={(e) => setTutorial(e.target.checked)} />
            Walk me through the editor
          </label>
        </div>
        <footer>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={start} disabled={busy}>
            {busy ? 'Loading the circuit…' : 'Start'}
          </button>
        </footer>
      </div>
    </div>
  );
}
