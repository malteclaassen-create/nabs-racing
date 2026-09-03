import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../store/store';
import {
  bridgeStatus, listTracks, setAcRoot, trackDetail,
  type AcLayout, type AcTrackSummary,
} from '../ac/bridge';

/**
 * Picking a track out of the installed copy of Assetto Corsa.
 *
 * The list comes from the dev server, which is on the same machine as the
 * game -- Chrome will not open a directory under Program Files, and a track is
 * hundreds of megabytes anyway, so a file dialog was never going to be the way
 * in. Without the bridge (a production build, or no installation) the dialog
 * says so plainly instead of offering something that cannot work.
 */

type Phase = 'checking' | 'no-bridge' | 'listing' | 'ready' | 'loading' | 'error';

function megabytes(bytes: number): string {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

function layoutLabel(l: AcLayout): string {
  return l.id === '' ? 'the only layout' : l.id;
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const importAcTrack = useEditor((s) => s.importAcTrack);
  const loading = useEditor((s) => s.acLoading);

  const [phase, setPhase] = useState<Phase>('checking');
  const [root, setRoot] = useState<string | null>(null);
  const [rootInput, setRootInput] = useState('');
  const [tracks, setTracks] = useState<AcTrackSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [chosen, setChosen] = useState<AcTrackSummary | null>(null);
  const [layout, setLayout] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('checking');
    setError('');
    (async () => {
      const status = await bridgeStatus();
      if (cancelled) return;
      if (!status) { setPhase('no-bridge'); return; }
      setRoot(status.root);
      if (!status.root) { setPhase('no-bridge'); return; }
      setPhase('listing');
      try {
        const list = await listTracks();
        if (cancelled) return;
        setTracks(list);
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return tracks;
    return tracks.filter(
      (t) => t.name.toLowerCase().includes(needle) || t.slug.toLowerCase().includes(needle),
    );
  }, [tracks, filter]);

  if (!open) return null;

  const pick = async (track: AcTrackSummary) => {
    setChosen(track);
    setLayout(track.layouts[0]?.id ?? '');
    // The summary already has the layouts; asking again keeps the file list
    // warm on the server for the import that follows.
    try { await trackDetail(track.slug); } catch { /* not fatal */ }
  };

  const run = async () => {
    if (!chosen) return;
    setPhase('loading');
    setError('');
    try {
      await importAcTrack(chosen.slug, layout);
      onClose();
      setPhase('ready');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  };

  const useRoot = async () => {
    try {
      const r = await setAcRoot(rootInput);
      setRoot(r);
      setPhase('listing');
      setTracks(await listTracks());
      setPhase('ready');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={{ maxWidth: 720 }}>
        <header>
          <span>Import a track from Assetto Corsa</span>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </header>

        <div className="body">
          {/*
            Two different "no bridge" situations, and telling them apart is the
            whole point. Run locally, it means the game was not found where the
            editor looked, and typing the folder in fixes it. Served from the
            league site, there IS no bridge to find and never will be -- the
            page is on nabsracing.com and the game is on the visitor's own
            machine -- so a folder box would be inviting people to type a path
            that cannot be read from here, and then to wonder why it did
            nothing. DEV is exactly the right test: start.cmd runs the dev
            server, and only the dev server carries the bridge.
          */}
          {phase === 'no-bridge' && !import.meta.env.DEV && (
            <div className="callout info">
              <b>This is the online edition.</b> A web page cannot read files off your machine, so
              importing is not available here.
              <br />
              <br />
              To edit an installed track, run the editor locally with <code>start.cmd</code>.
            </div>
          )}

          {phase === 'no-bridge' && import.meta.env.DEV && (
            <>
              <div className="callout info">
                <b>No Assetto Corsa installation found.</b> Point the editor at the game folder by hand:
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <label>Game folder</label>
                <input
                  value={rootInput}
                  placeholder="C:\\Program Files (x86)\\Steam\\steamapps\\common\\assettocorsa"
                  onChange={(e) => setRootInput(e.target.value)}
                />
              </div>
              <button className="btn" style={{ marginTop: 8 }} onClick={useRoot}>
                Use this folder
              </button>
            </>
          )}

          {phase === 'checking' && <div className="callout info">Looking for Assetto Corsa…</div>}
          {phase === 'listing' && <div className="callout info">Reading the track list…</div>}

          {phase === 'error' && (
            <div className="callout" style={{ borderLeftColor: 'var(--danger)' }}>
              <b>That did not work.</b><br />{error}
            </div>
          )}

          {(phase === 'ready' || phase === 'loading' || (phase === 'error' && tracks.length > 0)) && (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Reading from <code>{root}</code>, {tracks.length} tracks. The original is never
                written to.
              </p>

              <div className="row">
                <label>Search</label>
                <input
                  value={filter}
                  autoFocus
                  placeholder="hockenheim"
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>

              <div className="list" style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
                {shown.slice(0, 300).map((t) => (
                  <div
                    key={t.slug}
                    className={`list-item${chosen?.slug === t.slug ? ' on' : ''}`}
                    onClick={() => pick(t)}
                  >
                    <span className="grow">{t.name}</span>
                    <span style={{ color: 'var(--text-faint)', flex: '0 0 auto' }}>
                      {t.layouts.length > 1 ? `${t.layouts.length} layouts · ` : ''}
                      {megabytes(t.bytes)}
                    </span>
                  </div>
                ))}
                {shown.length === 0 && <div className="hint" style={{ padding: 10 }}>Nothing matches.</div>}
              </div>

              {chosen && chosen.layouts.length > 1 && (
                <div className="row" style={{ marginTop: 10 }}>
                  <label>Layout</label>
                  <select value={layout} onChange={(e) => setLayout(e.target.value)}>
                    {chosen.layouts.map((l) => (
                      <option key={l.id} value={l.id}>{layoutLabel(l)}</option>
                    ))}
                  </select>
                </div>
              )}

              {chosen && (
                <div className="callout" style={{ marginTop: 10 }}>
                  <b>{chosen.name}</b>, {chosen.fileCount} files, {megabytes(chosen.bytes)}.
                  {chosen.layouts.length > 1 && (
                    <> All {chosen.layouts.length} layouts are kept on export, only{' '}
                      <code>{layoutLabel(chosen.layouts.find((l) => l.id === layout) ?? chosen.layouts[0])}</code>{' '}
                      is loaded.</>
                  )}
                  <br />
                  Textures are loaded for the main model only.
                </div>
              )}

              {loading && (
                <div className="callout info" style={{ marginTop: 10 }}>
                  {loading.message}… {Math.round(loading.fraction * 100)}%
                  <div className="progress"><div style={{ width: `${loading.fraction * 100}%` }} /></div>
                </div>
              )}
            </>
          )}
        </div>

        <footer>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!chosen || phase === 'loading'}
            onClick={run}
          >
            {phase === 'loading' ? 'Loading…' : 'Import'}
          </button>
        </footer>
      </div>
    </div>
  );
}
