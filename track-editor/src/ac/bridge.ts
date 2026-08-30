/**
 * Browser side of the Assetto Corsa bridge (tools/acBridge.mjs).
 *
 * Everything here talks to the dev server, which is running on the same
 * machine as the game. When the bridge is not there -- a production build, or
 * a machine with no installation -- `bridgeStatus()` returns null and the
 * editor offers importing a zipped track folder instead. Nothing in the rest
 * of the app assumes the bridge exists.
 */

export interface AcLayout {
  /** '' for a single layout track, otherwise the folder/suffix name. */
  id: string;
  modelsIni: string | null;
  dataDir: string | null;
  aiDir: string | null;
  uiFile: string | null;
}

export interface AcTrackSummary {
  slug: string;
  name: string;
  layouts: AcLayout[];
  fileCount: number;
  bytes: number;
}

export interface AcFileEntry {
  path: string;
  size: number;
}

export interface AcTrackDetail {
  slug: string;
  files: AcFileEntry[];
  layouts: AcLayout[];
}

const BASE = '/__ac';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `${res.status} on ${path}`);
  return body as T;
}

async function postJson<T>(path: string, value: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `${res.status} on ${path}`);
  return body as T;
}

/** Where the game is, or null when there is no bridge at all. */
export async function bridgeStatus(): Promise<{ root: string | null } | null> {
  try {
    return await getJson<{ root: string | null }>('/status');
  } catch {
    return null;
  }
}

export async function setAcRoot(root: string): Promise<string> {
  const r = await postJson<{ root: string }>('/root', { root });
  return r.root;
}

export async function listTracks(): Promise<AcTrackSummary[]> {
  const r = await getJson<{ tracks: AcTrackSummary[] }>('/tracks');
  return r.tracks;
}

export async function trackDetail(slug: string): Promise<AcTrackDetail> {
  return getJson<AcTrackDetail>(`/track/${encodeURIComponent(slug)}`);
}

/**
 * One file, raw.
 *
 * `onProgress` exists because the interesting files are big -- the main model
 * of a modern track is over a hundred megabytes -- and a UI that says nothing
 * for twenty seconds looks broken.
 */
export async function fetchTrackFile(
  slug: string,
  path: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const url = `${BASE}/file/${encodeURIComponent(slug)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url);
  if (!res.ok) {
    let message = `${res.status}`;
    try { message = (await res.json())?.error ?? message; } catch { /* not json */ }
    throw new Error(`could not read ${path}: ${message}`);
  }

  const total = Number(res.headers.get('content-length') ?? 0);
  if (!onProgress || !res.body) return new Uint8Array(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/* ------------------------------------------------------------------ */
/* Writing a track back out                                            */
/* ------------------------------------------------------------------ */

export async function installBegin(target: string, overwrite: boolean): Promise<string> {
  const r = await postJson<{ dir: string }>(`/install/${encodeURIComponent(target)}/begin`, { overwrite });
  return r.dir;
}

export async function installPut(target: string, path: string, bytes: Uint8Array): Promise<void> {
  const url = `${BASE}/install/${encodeURIComponent(target)}/put/${path.split('/').map(encodeURIComponent).join('/')}`;
  const body = bytes.slice().buffer as ArrayBuffer;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try { message = (await res.json())?.error ?? message; } catch { /* not json */ }
    throw new Error(`could not write ${path}: ${message}`);
  }
}

/**
 * Copy the untouched files across, disk to disk.
 *
 * This is the reason exporting an imported track is quick: the browser never
 * sees the 700 MB it is not changing.
 */
export async function installCopy(
  target: string,
  source: string,
  files: string[],
): Promise<{ copied: number; bytes: number }> {
  return postJson(`/install/${encodeURIComponent(target)}/copy`, { source, files });
}
