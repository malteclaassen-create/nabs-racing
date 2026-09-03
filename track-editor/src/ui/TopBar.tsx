import { useEditor } from '../store/store';
import {
  IconExport,
  IconMove,
  IconNew,
  IconOpen,
  IconRedo,
  IconRotate,
  IconSave,
  IconScale,
  IconUndo,
} from './icons';
import { deserializeProject, downloadProject, pickFile } from '../io/project';

export function TopBar({
  onExport,
  onImport,
  onNew,
  onTutorial,
}: {
  onExport: () => void;
  onImport: () => void;
  onNew: () => void;
  onTutorial: () => void;
}) {
  const imported = useEditor((s) => s.project.acImport);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  // Only the name is rendered here. Subscribing to the whole project would put
  // the toolbar on the render path of every single edit frame.
  const name = useEditor((s) => s.project.meta.name);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const gizmo = useEditor((s) => s.gizmo);
  const setGizmo = useEditor((s) => s.setGizmo);
  const quality = useEditor((s) => s.quality);
  const setQuality = useEditor((s) => s.setQuality);
  const { undo, redo, commit, replaceProject, setStatus } = useEditor.getState();

  const openProject = async () => {
    const file = await pickFile('.json,.actrack.json');
    if (!file) return;
    try {
      replaceProject(deserializeProject(await file.text()));
    } catch (err) {
      setStatus(`Could not open project: ${(err as Error).message}`);
    }
  };

  return (
    <div className="topbar">
      {/* The mark is the way back to the league site: a real link, since the
          editor is its own page under /track-editor and the home page is the
          site's, not this app's. */}
      <a className="brand" href="/" title="Back to NABS Racing">
        {/* The league's own mark, the pink one meant for dark backgrounds
            (nabs-racing/frontend/public/logo-dark.png).

            Through BASE_URL, not as "/nabs-logo.png": served from the league
            site the editor lives under /track-editor, and the bare path would
            ask the website for a file it does not have. Its SPA fallback
            answers any unknown path with the site's index.html, so the browser
            got HTML where it wanted a PNG and the mark silently vanished. */}
        <img
          className="brand-mark"
          src={`${import.meta.env.BASE_URL}nabs-logo.png`}
          alt="NABS Racing"
          width={22}
          height={22}
        />
        <div className="brand-name">
          <span className="brand-league">NABS</span> Track Editor
        </div>
      </a>

      <button className="btn ghost icon" title="New project" onClick={onNew}>
        <IconNew />
      </button>
      <button className="btn ghost icon" title="Open project" onClick={openProject}>
        <IconOpen />
      </button>
      <button
        className="btn ghost icon"
        title="Save project (Ctrl+S)"
        onClick={() => downloadProject(useEditor.getState().project)}
      >
        <IconSave />
      </button>

      {/*
        Two jobs, two sets of tools. Building a circuit of our own and editing
        somebody else's baked one share a viewport and almost nothing else, and
        showing the ground sculptor next to a track whose ground is a fixed mesh
        is how an editor teaches people that its controls do not mean anything.
      */}
      <div className="viewtoggles" title="What you are working on">
        <button
          className={mode === 'build' ? 'on' : ''}
          onClick={() => setMode('build')}
          title="Draw a circuit of your own, or open a project you made here"
        >
          Build
        </button>
        <button
          className={mode === 'edit' ? 'on' : ''}
          onClick={() => setMode('edit')}
          title="Edit a finished Assetto Corsa track"
        >
          Edit AC track
        </button>
      </div>

      <button
        className="btn ghost"
        title="Open a track from your Assetto Corsa installation and edit it"
        onClick={onImport}
      >
        Import track
      </button>

      <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 4px' }} />

      <button className="btn ghost icon" title="Undo (Ctrl+Z)" disabled={past === 0} onClick={undo}>
        <IconUndo />
      </button>
      <button className="btn ghost icon" title="Redo (Ctrl+Y)" disabled={future === 0} onClick={redo}>
        <IconRedo />
      </button>

      <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 4px' }} />

      <div className="viewtoggles" title="Gizmo mode: 1 / 2 / 3">
        <button className={gizmo === 'translate' ? 'on' : ''} onClick={() => setGizmo('translate')}>
          <IconMove />
        </button>
        <button className={gizmo === 'rotate' ? 'on' : ''} onClick={() => setGizmo('rotate')}>
          <IconRotate />
        </button>
        <button className={gizmo === 'scale' ? 'on' : ''} onClick={() => setGizmo('scale')}>
          <IconScale />
        </button>
      </div>

      <input
        className="title-input"
        value={name}
        onChange={(e) =>
          commit((p) => {
            p.meta.name = e.target.value;
          })
        }
      />

      <div className="spacer" />

      <div
        className="viewtoggles"
        title="Render quality, lower it if the viewport feels sluggish. Draft also drops the grid and the AI line."
      >
        {(
          [
            ['high', 'High'],
            ['balanced', 'Balanced'],
            ['fast', 'Fast'],
            ['draft', 'Draft'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={quality === key ? 'on' : ''} onClick={() => setQuality(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="viewtoggles">
        {(
          [
            ['road', 'Road'],
            ['terrain', 'Terrain'],
            ['props', 'Props'],
            ['markers', 'Markers'],
            ['aiLine', 'AI'],
            ['grid', 'Grid'],
            ['sky', 'Sky'],
            ['wireframe', 'Wire'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={view[key] ? 'on' : ''} onClick={() => setView({ [key]: !view[key] })}>
            {label}
          </button>
        ))}
      </div>

      <button className="btn ghost icon" title="Walk through the editor" onClick={onTutorial}>
        ?
      </button>

      <button className="btn primary" onClick={onExport}>
        <IconExport />
        {imported ? `Export ${imported.targetSlug}` : 'Export for AC'}
      </button>
    </div>
  );
}
