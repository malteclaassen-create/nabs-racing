import { useEffect, useState } from 'react';
import { useEditor } from '../store/store';
import { getDerived } from '../store/derived';
import { buildExport, downloadBytes } from '../export/buildExport';
import type { ReadmeStats } from '../export/readme';
import { AcExportPanel } from './AcExportPanel';

type Phase = 'idle' | 'working' | 'done' | 'error';

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const imported = useEditor((s) => s.project.acImport);
  const setStatus = useEditor((s) => s.setStatus);
  const [phase, setPhase] = useState<Phase>('idle');
  const [stats, setStats] = useState<ReadmeStats | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [sizeKb, setSizeKb] = useState(0);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setStats(null);
      setWarnings([]);
      setError('');
    }
  }, [open]);

  if (!open) return null;

  // An imported track goes out a completely different way: its own folder is
  // rebuilt file by file, most of it copied straight across on disk. Packing it
  // into a zip in the browser would mean holding the whole circuit -- 700 MB on
  // the reference track -- in the tab, for no gain.
  if (imported) return <AcExportPanel imported={imported} onClose={onClose} />;

  const run = async () => {
    setPhase('working');
    // Let the browser paint the spinner before the heavy synchronous work.
    await new Promise((r) => setTimeout(r, 30));
    try {
      /*
       * Exported at FULL detail whatever the editor is set to. The Detail
       * slider is there so dragging control points stays fluid -- every
       * cross section is rebuilt per frame while you drag -- but none of
       * that matters for the one build that goes in the zip. The circuit
       * you drive is always the 80x one; the slider only paces the editor.
       * An editor already set above that keeps its own figure.
       */
      const spp = Math.max(project.road.samplesPerSegment, 80);
      /*
       * `crossCut` goes with it, and for the same reason. A plate of BANKED
       * road is twisted -- its far cross section is rolled further than its
       * near one -- so the four corners do not share a plane, and the plate is
       * drawn as two triangles folded along the diagonal between them. Every
       * plate folds the same way, so what a tyre rides through a banked corner
       * is a saw, and the wheel feels it: on a corner drawn with points 120 m
       * apart, 4 degrees of surface tilt flicking back and forth at 30 Hz.
       * Detail does not touch that -- a shorter plate is a shorter tooth at a
       * higher pitch, nothing more. Cutting the plate ACROSS does, and it
       * costs the editor nothing because only the export asks for it.
       */
      const full = {
        ...project,
        road: { ...project.road, samplesPerSegment: spp, crossCut: true },
      };
      const derived = getDerived(full);
      const result = await buildExport(full, derived);
      downloadBytes(result.zip, result.fileName, 'application/zip');
      setStats(result.stats);
      setWarnings(result.warnings);
      setSizeKb(Math.round(result.zip.length / 1024));
      setPhase('done');
      setStatus(`Exported ${result.fileName}`);
    } catch (err) {
      console.error(err);
      setError((err as Error).message || String(err));
      setPhase('error');
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <header>
          <span>Export for Assetto Corsa</span>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="body">
          {phase === 'idle' && (
            <>
              <div className="callout info">
                Writes the <code>.kn5</code>, surfaces.ini, AI line, minimap and Content Manager files,
                packed as <code>content/tracks/{project.meta.slug}</code> in a ZIP.
              </div>
              <div className="callout">
                Extract it into your Assetto Corsa installation and drive, no ksEditor pass needed.
              </div>
              <p className="hint">Nothing is uploaded. Everything is built in your browser.</p>
            </>
          )}

          {phase === 'working' && <div className="callout info">Building geometry, textures and the AI line…</div>}

          {phase === 'error' && (
            <div className="callout" style={{ borderLeftColor: 'var(--danger)' }}>
              <b>Export failed.</b>
              <br />
              {error}
            </div>
          )}

          {phase === 'done' && stats && (
            <>
              <div className="callout ok">
                <b>ZIP downloaded ({sizeKb.toLocaleString('en-US')} KB).</b> Open the README inside it and
                follow the five steps.
              </div>
              {warnings.map((w) => (
                <div className="callout" key={w}>
                  {w}
                </div>
              ))}
              <div className="kv" style={{ marginTop: 12 }}>
                <span>Track length</span>
                <b>{Math.round(stats.trackLength)} m</b>
                <span>Pit lane</span>
                <b>{Math.round(stats.pitLength)} m</b>
                <span>Meshes</span>
                <b>{stats.meshCount}</b>
                <span>Triangles</span>
                <b>{stats.triangles.toLocaleString('en-US')}</b>
                <span>Grid slots</span>
                <b>{stats.gridSlots}</b>
                <span>Pit boxes</span>
                <b>{stats.pitBoxes}</b>
                <span>Timing gates</span>
                <b>{stats.gates}</b>
                <span>AI points</span>
                <b>{stats.aiPoints}</b>
              </div>
            </>
          )}
        </div>

        <footer>
          <button className="btn" onClick={onClose}>
            {phase === 'done' ? 'Done' : 'Cancel'}
          </button>
          <button className="btn primary" disabled={phase === 'working'} onClick={run}>
            {phase === 'done' ? 'Export again' : 'Build ZIP'}
          </button>
        </footer>
      </div>
    </div>
  );
}
