/**
 * Vite dev plugin: the editor's window onto the installed copy of Assetto
 * Corsa.
 *
 * Why a server plugin and not the browser's own directory picker: Chrome's
 * File System Access API refuses to open anything under Program Files, which
 * is exactly where Steam puts the game. And a track is not a small thing --
 * vhe_hockenheim is 26 models and about 700 MB. Pushing that through a file
 * dialog and into the tab's memory to then push most of it straight back out
 * again would be silly when there is already a Node process running on the
 * same machine with the files right there.
 *
 * So the browser reads what it needs over HTTP, and on the way out it sends
 * back ONLY the files it actually changed -- the server copies the rest
 * straight from the source folder, disk to disk. Editing a pit box on
 * Hockenheim therefore moves about 100 KB over the wire instead of 700 MB.
 *
 * Endpoints, all under /__ac:
 *
 *   GET  /__ac/status                    where the game is, if it was found
 *   POST /__ac/root                      point it somewhere else by hand
 *   GET  /__ac/tracks                    every installed track, with layouts
 *   GET  /__ac/track/<slug>              one track: file list with sizes
 *   GET  /__ac/file/<slug>/<path>        raw bytes of one file
 *   POST /__ac/install/<target>/put/<path>    write one file into a new track
 *   POST /__ac/install/<target>/copy          copy the untouched rest across
 *   POST /__ac/install/<target>/begin         create/clear the target folder
 *
 * Dev only. `vite build` output has none of this, and the editor falls back to
 * a plain zip download when /__ac/status says there is no bridge.
 */

import {
  copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync,
  readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const PREFIX = '/__ac';

/* ------------------------------------------------------------------ */
/* Finding the game                                                    */
/* ------------------------------------------------------------------ */

const CONFIG_FILE = 'ac-root.txt';

function steamLibraries() {
  const roots = [];
  for (const steam of ['C:/Program Files (x86)/Steam', 'C:/Program Files/Steam']) {
    const vdf = join(steam, 'steamapps', 'libraryfolders.vdf');
    if (!existsSync(vdf)) continue;
    try {
      const text = readFileSync(vdf, 'utf8');
      // The file is Valve's own key/value format; the only thing wanted here
      // is every "path" value, so a regex beats pulling in a parser.
      for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
        roots.push(m[1].replace(/\\\\/g, '/'));
      }
    } catch { /* unreadable, move on */ }
  }
  return roots;
}

function detectRoot(projectDir) {
  const configured = join(projectDir, CONFIG_FILE);
  if (existsSync(configured)) {
    const p = readFileSync(configured, 'utf8').trim();
    if (p && existsSync(join(p, 'content', 'tracks'))) return p;
  }
  if (process.env.AC_ROOT && existsSync(join(process.env.AC_ROOT, 'content', 'tracks'))) {
    return process.env.AC_ROOT;
  }
  const guesses = [
    'C:/Program Files (x86)/Steam/steamapps/common/assettocorsa',
    'C:/Program Files/Steam/steamapps/common/assettocorsa',
    ...steamLibraries().map((r) => join(r, 'steamapps', 'common', 'assettocorsa')),
    'D:/Steam/steamapps/common/assettocorsa',
    'D:/SteamLibrary/steamapps/common/assettocorsa',
    'E:/SteamLibrary/steamapps/common/assettocorsa',
  ];
  for (const g of guesses) {
    if (existsSync(join(g, 'content', 'tracks'))) return g.replace(/\\/g, '/');
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Path safety                                                         */
/* ------------------------------------------------------------------ */

/**
 * Resolve `relative` inside `base`, or throw.
 *
 * This is a local tool, but it is still a server accepting paths from a page,
 * and "../../../Windows/System32" is one typo in the editor away from being
 * sent by accident. Everything that touches the disk goes through here.
 */
function inside(base, relative) {
  const clean = String(relative).replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(`path escapes the folder: ${relative}`);
  }
  const full = resolve(base, clean);
  const baseResolved = resolve(base);
  if (full !== baseResolved && !full.startsWith(baseResolved + sep)) {
    throw new Error(`path escapes the folder: ${relative}`);
  }
  return full;
}

/** A track folder name AC will accept, and that cannot be a path. */
function cleanSlug(s) {
  const slug = String(s).trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(slug)) throw new Error(`bad track name: ${s}`);
  return slug;
}

/* ------------------------------------------------------------------ */
/* Reading a track                                                     */
/* ------------------------------------------------------------------ */

/** Every file under `dir`, as paths relative to it. */
function listFiles(dir, prefix = '', out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    const full = join(dir, e.name);
    if (e.isDirectory()) listFiles(full, rel, out);
    else if (e.isFile()) {
      let size = 0;
      try { size = statSync(full).size; } catch { /* vanished */ }
      out.push({ path: rel, size });
    }
  }
  return out;
}

/**
 * The layouts of a track.
 *
 * A single layout track has data/ and ai/ at the top and no models.ini, or one
 * models.ini. A multi layout track -- vhe_hockenheim has seven -- has
 * models_<layout>.ini beside a <layout>/ folder holding that layout's data and
 * ai, and ui/<layout>/ui_track.json. Both shapes are reported the same way so
 * the editor only has to understand one.
 */
function describeLayouts(trackDir, files) {
  const names = new Set(files.map((f) => f.path));
  const layouts = [];

  for (const f of files) {
    const m = /^models_(.+)\.ini$/.exec(f.path);
    if (!m) continue;
    const id = m[1];
    layouts.push({
      id,
      modelsIni: f.path,
      dataDir: names.has(`${id}/data/surfaces.ini`) ? `${id}/data` : null,
      aiDir: names.has(`${id}/ai/fast_lane.ai`) ? `${id}/ai` : null,
      uiFile: names.has(`ui/${id}/ui_track.json`) ? `ui/${id}/ui_track.json` : null,
    });
  }

  if (layouts.length === 0) {
    layouts.push({
      id: '',
      modelsIni: names.has('models.ini') ? 'models.ini' : null,
      dataDir: names.has('data/surfaces.ini') ? 'data' : null,
      aiDir: names.has('ai/fast_lane.ai') ? 'ai' : null,
      uiFile: names.has('ui/ui_track.json') ? 'ui/ui_track.json' : null,
    });
  }
  layouts.sort((a, b) => a.id.localeCompare(b.id));
  return layouts;
}

function trackSummary(tracksDir, slug) {
  const dir = join(tracksDir, slug);
  const files = listFiles(dir);
  if (files.length === 0) return null;
  const layouts = describeLayouts(dir, files);
  let name = slug;
  const uiPath = layouts.find((l) => l.uiFile)?.uiFile;
  if (uiPath) {
    try {
      // Some ui_track.json files in the wild have a UTF-8 BOM or trailing
      // commas; a failed read must not hide the whole track.
      const raw = readFileSync(join(dir, uiPath), 'utf8').replace(/^\uFEFF/, '');
      const ui = JSON.parse(raw);
      if (ui && typeof ui.name === 'string' && ui.name.trim()) name = ui.name.trim();
    } catch { /* keep the slug */ }
  }
  return {
    slug,
    name,
    layouts,
    fileCount: files.length,
    bytes: files.reduce((a, f) => a + f.size, 0),
  };
}

/* ------------------------------------------------------------------ */
/* The plugin                                                          */
/* ------------------------------------------------------------------ */

export function acBridge() {
  let projectDir = process.cwd();
  let root = null;

  const tracksDir = () => {
    if (!root) throw new Error('no Assetto Corsa installation configured');
    return join(root, 'content', 'tracks');
  };

  const readBody = (req) => new Promise((res, rej) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });

  const json = (res, code, value) => {
    const body = Buffer.from(JSON.stringify(value));
    res.writeHead(code, { 'content-type': 'application/json', 'content-length': body.length });
    res.end(body);
  };

  return {
    name: 'ac-bridge',
    apply: 'serve',

    configResolved(config) {
      projectDir = config.root ?? process.cwd();
      root = detectRoot(projectDir);
      if (root) config.logger.info(`  ➜  Assetto Corsa:  ${root}`);
      else config.logger.warn('  ➜  Assetto Corsa:  not found (import disabled, see ac-root.txt)');
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith(PREFIX + '/')) return next();

        const path = decodeURIComponent(url.slice(PREFIX.length).split('?')[0]);
        try {
          /* --- where is the game ------------------------------------ */
          if (path === '/status') {
            return json(res, 200, { root, tracks: root ? tracksDir().replace(/\\/g, '/') : null });
          }

          if (path === '/root' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const candidate = String(body.root ?? '').replace(/\\/g, '/').trim();
            if (!candidate || !existsSync(join(candidate, 'content', 'tracks'))) {
              return json(res, 400, { error: 'no content/tracks under that path' });
            }
            root = candidate;
            // Remembered so the next dev server start finds it again.
            writeFileSync(join(projectDir, CONFIG_FILE), root + '\n');
            return json(res, 200, { root });
          }

          /* --- listing ---------------------------------------------- */
          if (path === '/tracks') {
            const dir = tracksDir();
            const out = [];
            for (const e of readdirSync(dir, { withFileTypes: true })) {
              if (!e.isDirectory()) continue;
              const s = trackSummary(dir, e.name);
              if (s) out.push(s);
            }
            out.sort((a, b) => a.name.localeCompare(b.name));
            return json(res, 200, { tracks: out });
          }

          const trackMatch = /^\/track\/([^/]+)$/.exec(path);
          if (trackMatch) {
            const slug = cleanSlug(trackMatch[1]);
            const dir = inside(tracksDir(), slug);
            if (!existsSync(dir)) return json(res, 404, { error: 'no such track' });
            const files = listFiles(dir);
            return json(res, 200, {
              slug,
              files,
              layouts: describeLayouts(dir, files),
            });
          }

          /* --- one file, streamed ----------------------------------- */
          const fileMatch = /^\/file\/([^/]+)\/(.+)$/.exec(path);
          if (fileMatch) {
            const slug = cleanSlug(fileMatch[1]);
            const full = inside(join(tracksDir(), slug), fileMatch[2]);
            if (!existsSync(full)) return json(res, 404, { error: 'no such file' });
            const size = statSync(full).size;
            res.writeHead(200, {
              'content-type': 'application/octet-stream',
              'content-length': size,
              // The game's files do not change while the editor is open, and
              // these are hundreds of megabytes.
              'cache-control': 'no-cache',
            });
            createReadStream(full).pipe(res);
            return undefined;
          }

          /* --- writing a new track out ------------------------------ */
          const installMatch = /^\/install\/([^/]+)\/(begin|copy|put)(?:\/(.+))?$/.exec(path);
          if (installMatch && req.method === 'POST') {
            const target = cleanSlug(installMatch[1]);
            const action = installMatch[2];
            const targetDir = inside(tracksDir(), target);

            if (action === 'begin') {
              const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
              if (existsSync(targetDir)) {
                if (!body.overwrite) {
                  return json(res, 409, { error: 'that track folder already exists', dir: targetDir });
                }
                // Only ever a folder under content/tracks, checked by inside().
                rmSync(targetDir, { recursive: true, force: true });
              }
              mkdirSync(targetDir, { recursive: true });
              return json(res, 200, { dir: targetDir.replace(/\\/g, '/') });
            }

            if (action === 'put') {
              const full = inside(targetDir, installMatch[3] ?? '');
              mkdirSync(dirname(full), { recursive: true });
              writeFileSync(full, await readBody(req));
              return json(res, 200, { ok: true });
            }

            // copy: the untouched majority, straight from the source folder.
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const source = cleanSlug(body.source ?? '');
            const sourceDir = inside(tracksDir(), source);
            let copied = 0, bytes = 0;
            for (const rel of body.files ?? []) {
              const from = inside(sourceDir, rel);
              const to = inside(targetDir, rel);
              if (!existsSync(from)) continue;
              mkdirSync(dirname(to), { recursive: true });
              copyFileSync(from, to);
              copied += 1;
              bytes += statSync(to).size;
            }
            return json(res, 200, { copied, bytes });
          }

          return json(res, 404, { error: `no such endpoint: ${path}` });
        } catch (err) {
          return json(res, 500, { error: String(err?.message ?? err) });
        }
      });
    },
  };
}

export default acBridge;
