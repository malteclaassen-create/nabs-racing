import { useMemo, useState } from 'react';
import { useEditor } from '../store/store';
import { exportAcTrack, type AcExportReport } from '../ac/exportAcTrack';
import { buildOverlayModel, type OverlayStats } from '../ac/buildOverlay';
import { getDerived } from '../store/derived';
import { Check } from './controls';
import type { AcImport } from '../types';

/**
 * Writing an imported track back into the game.
 *
 * The important thing this screen has to communicate is what is NOT happening:
 * the source folder is not touched, the six layouts nobody edited are not
 * rewritten, and the models the editor could not read are copied rather than
 * dropped. So it reports the accounting -- how many files came in, how many
 * went out, which ones were rewritten and why -- instead of a progress bar and
 * the word "done".
 */

type Phase = 'idle' | 'working' | 'done' | 'error';

function countEdits(imported: AcImport) {
  const e = imported.edits;
  const hidden = Object.values(e.hidden).reduce((a, l) => a + l.length, 0);
  const renamed = Object.values(e.renamed).reduce((a, m) => a + Object.keys(m).length, 0);
  const markers = Object.values(e.markers).reduce((a, l) => a + l.length, 0);
  return { hidden, renamed, markers, total: hidden + renamed + markers };
}

export function AcExportPanel({ imported, onClose }: { imported: AcImport; onClose: () => void }) {
  const commit = useEditor((s) => s.commit);
  const setStatus = useEditor((s) => s.setStatus);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ message: '', fraction: 0 });
  const [report, setReport] = useState<AcExportReport | null>(null);
  const [overlay, setOverlay] = useState<OverlayStats | null>(null);
  const [error, setError] = useState('');
  const [overwrite, setOverwrite] = useState(false);

  const edits = useMemo(() => countEdits(imported), [imported]);
  const sameName = imported.targetSlug.trim() === imported.slug;

  const run = async () => {
    setPhase('working');
    setError('');
    try {
      // Everything the editor added goes into a model of its own, so it cannot
      // touch the original geometry. Built here rather than inside the export
      // because it needs the derived scene, which is the editor's business.
      let generated: { fileName: string; bytes: Uint8Array } | null = null;
      const { project, acScene } = useEditor.getState();
      if (imported.edits.addGenerated && acScene) {
        setProgress({ message: 'baking the additions', fraction: 0.01 });
        const overlay = await buildOverlayModel(
          project,
          getDerived(project),
          acScene,
          imported.targetSlug,
        );
        if (overlay) {
          generated = { fileName: overlay.fileName, bytes: overlay.bytes };
          setOverlay(overlay.stats);
        } else {
          setOverlay(null);
        }
      }

      const result = await exportAcTrack(imported, {
        generated,
        // Only the editor has the recovered centre line, and resizing something
        // that follows a corner is meaningless without it.
        ribbonFrames: getDerived(project).trackFrames,
        // Marker numbering belongs to the track, not to one file: extra pit
        // boxes are routinely shipped in a second model, and closing a gap has
        // to be worked out across all of them at once.
        markerInventory: acScene?.markers.map((m) => ({ model: m.model, name: m.name })) ?? [],
        overwrite,
        onProgress: (message, fraction) => setProgress({ message, fraction }),
      });
      setReport(result);
      setPhase('done');
      setStatus(`Wrote ${result.target}: ${result.written.length} changed, ${result.copied} copied`);
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={{ maxWidth: 720 }}>
        <header>
          <span>Write {imported.name} back into Assetto Corsa</span>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </header>

        <div className="body">
          <div className="callout info">
            <b>Nothing is lost, by construction.</b> Every file of{' '}
            <code>{imported.slug}</code> is rewritten or copied across untouched, and the source
            folder is never written to.
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <label>New folder</label>
            <input
              value={imported.targetSlug}
              onChange={(e) =>
                commit((p) => {
                  if (p.acImport) p.acImport.targetSlug = e.target.value.replace(/[^A-Za-z0-9_.-]/g, '');
                })
              }
            />
          </div>
          <p className="hint" style={{ marginTop: 4 }}>
            Written to <code>content/tracks/{imported.targetSlug || '…'}</code>. It appears in the
            game beside the original.
          </p>

          {sameName && (
            <div className="callout" style={{ borderLeftColor: 'var(--danger)' }}>
              <b>That is the source folder.</b> Choose a different name, the original must not be
              overwritten.
            </div>
          )}

          <div className="row" style={{ marginTop: 8 }}>
            <label>If it exists</label>
            <div className="rowbody">
              <Check label="Replace the folder" checked={overwrite} onChange={setOverwrite} />
            </div>
          </div>

          <div className="kv" style={{ marginTop: 12 }}>
            <span>Source</span><b>{imported.slug}</b>
            <span>Layout</span><b>{imported.layout || 'the only one'}</b>
            <span>Meshes hidden</span><b>{edits.hidden}</b>
            <span>Meshes renamed</span><b>{edits.renamed}</b>
            <span>Marker changes</span><b>{edits.markers}</b>
          </div>

          {overlay && (
            <>
              <div className="callout ok" style={{ marginTop: 10 }}>
                <b>{overlay.meshes} added mesh(es), {overlay.triangles.toLocaleString('en-US')} triangles</b>{' '}
                in a model of their own, the original geometry is untouched.
                {overlay.drapeTotal > 0 && (
                  <> {Math.round((overlay.draped / overlay.drapeTotal) * 100)}% of their vertices
                    were pinned onto the imported surface.</>
                )}
              </div>
              {overlay.warnings.map((w) => (
                <div className="callout" key={w} style={{ borderLeftColor: 'var(--warn)' }}>{w}</div>
              ))}
            </>
          )}

          {phase === 'working' && (
            <div className="callout info" style={{ marginTop: 10 }}>
              {progress.message}…
              <div className="progress"><div style={{ width: `${progress.fraction * 100}%` }} /></div>
            </div>
          )}

          {phase === 'error' && (
            <div className="callout" style={{ borderLeftColor: 'var(--danger)', marginTop: 10 }}>
              <b>Export failed.</b><br />{error}
            </div>
          )}

          {phase === 'done' && report && (
            <>
              <div
                className={report.warnings.length > 0 ? 'callout' : 'callout ok'}
                style={{ marginTop: 10 }}
              >
                <b>Written to {report.dir}.</b>{' '}
                {report.accounted} of {report.sourceFiles} source files accounted for,{' '}
                {report.copied} copied ({(report.copiedBytes / 1e6).toFixed(0)} MB),{' '}
                {report.written.length} written.
              </div>

              {report.warnings.map((w) => (
                <div className="callout" key={w} style={{ borderLeftColor: 'var(--warn)' }}>{w}</div>
              ))}

              {report.written.length > 0 && (
                <div className="list-group" style={{ marginTop: 12 }}>
                  <h4>Files this editor rewrote</h4>
                  <div className="list">
                    {report.written.map((w) => (
                      <div className="list-item" key={w.path}>
                        <span className="grow">{w.path}</span>
                        <span style={{ color: 'var(--text-faint)' }}>{w.note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <footer>
          <button className="btn" onClick={onClose}>{phase === 'done' ? 'Done' : 'Cancel'}</button>
          <button
            className="btn primary"
            disabled={phase === 'working' || sameName || imported.targetSlug.trim() === ''}
            onClick={run}
          >
            {phase === 'done' ? 'Write again' : 'Write into the game'}
          </button>
        </footer>
      </div>
    </div>
  );
}
