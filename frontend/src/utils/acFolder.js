// ---------------------------------------------------------------------------
// Reading a HANDFUL of named files out of a driver's Assetto Corsa folder.
//
// An AC install is tens of gigabytes across hundreds of thousands of files, so
// the usual <input webkitdirectory> is out: it hands the page every file in the
// tree and the browser sits there for a minute first. Both readers below walk
// straight to the paths they were asked for and touch nothing else.
//
//   1. showDirectoryPicker() — Chrome, Edge, Opera. A proper folder dialog.
//   2. the drag-and-drop entry API — everywhere else, including Firefox: the
//      driver drops their assettocorsa (or content) folder onto the page.
//
// Nothing read here leaves the browser; the page only ever sends the hashes it
// computed to the screen (see pages/ContentCheck.jsx), and the 3D lap view
// draws the track it reads (utils/acTrackScene.js).
// ---------------------------------------------------------------------------

export const canPickFolder = () =>
  typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

// The driver may pick `assettocorsa` (what we ask for) or `content` itself —
// both are the natural thing to grab, so a reader accepts either and rewrites
// the manifest's "content/…" paths accordingly.
function pathNormaliser(hasContentDir) {
  return (p) => (hasContentDir ? p : String(p).replace(/^content\//, ""));
}

// --- 1. File System Access API ---------------------------------------------

async function fsaReader(root) {
  let hasContentDir = true;
  try {
    await root.getDirectoryHandle("content");
  } catch {
    hasContentDir = false;
  }
  const norm = pathNormaliser(hasContentDir);
  const dirCache = new Map();

  // A child by name, the exact spelling first and, failing that, any spelling
  // that matches case-insensitively. The manifest's names come off a Linux
  // race server, the driver's folders off a Windows disk, and AC content is
  // full of Formula_2010 / formula_2010 pairs the game itself never minds.
  // The scan only runs on a miss, so the common case costs nothing extra.
  const child = async (dir, name, kind) => {
    const get = kind === "directory" ? "getDirectoryHandle" : "getFileHandle";
    try {
      return await dir[get](name);
    } catch (e) {
      if (e?.name !== "NotFoundError" && e?.name !== "TypeMismatchError") throw e;
    }
    const wanted = name.toLowerCase();
    for await (const [entryName, handle] of dir.entries()) {
      if (entryName.toLowerCase() === wanted && handle.kind === kind) return handle;
    }
    const err = new Error(`${name} not found`);
    err.name = "NotFoundError";
    throw err;
  };

  const dirOf = async (segments) => {
    const key = segments.join("/").toLowerCase();
    if (dirCache.has(key)) return dirCache.get(key);
    let handle = root;
    for (const seg of segments) handle = await child(handle, seg, "directory");
    dirCache.set(key, handle);
    return handle;
  };

  return {
    name: root.name,
    handle: root,
    async getFile(path) {
      const parts = norm(path).split("/").filter(Boolean);
      const file = parts.pop();
      try {
        const dir = await dirOf(parts);
        return await (await child(dir, file, "file")).getFile();
      } catch {
        return null; // not there — which is an answer, not a failure
      }
    },
    // One folder's children, by name and kind. Empty when it is not there.
    async list(path) {
      try {
        const dir = await dirOf(norm(path).split("/").filter(Boolean));
        const out = [];
        for await (const [name, handle] of dir.entries()) out.push({ name, kind: handle.kind });
        return out;
      } catch {
        return [];
      }
    },
    async hasDir(path) {
      const parts = norm(path).split("/").filter(Boolean);
      try {
        await dirOf(parts);
        return true;
      } catch {
        return false;
      }
    },
  };
}

// --- 2. Drag-and-drop entries ----------------------------------------------
// The old FileSystemEntry API. Its getFile(path) does accept a deep path in
// Chrome, but not dependably elsewhere, so this walks one level at a time
// through readEntries — which every browser that has the API implements the
// same way. readEntries hands out at most a hundred children per call, hence
// the loop; content/cars alone is well past that.

const readAllEntries = (dirEntry) =>
  new Promise((resolve) => {
    const reader = dirEntry.createReader();
    const all = [];
    const step = () =>
      reader.readEntries(
        (batch) => {
          if (!batch.length) return resolve(all);
          all.push(...batch);
          step();
        },
        () => resolve(all)
      );
    step();
  });

async function entryReader(rootEntry) {
  const listCache = new Map(); // path -> Map(lowercased name -> entry)

  const childrenOf = async (dirEntry, key) => {
    if (listCache.has(key)) return listCache.get(key);
    const entries = await readAllEntries(dirEntry);
    // Windows paths are case-insensitive and AC content is full of mixed
    // spellings, so lookups are too.
    const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
    listCache.set(key, byName);
    return byName;
  };

  const walk = async (segments) => {
    let entry = rootEntry;
    let key = "";
    for (const seg of segments) {
      const children = await childrenOf(entry, key);
      const next = children.get(seg.toLowerCase());
      if (!next || !next.isDirectory) return null;
      entry = next;
      key = key ? `${key}/${seg}` : seg;
    }
    return entry;
  };

  const rootChildren = await childrenOf(rootEntry, "");
  const norm = pathNormaliser(rootChildren.has("content"));

  return {
    name: rootEntry.name,
    async getFile(path) {
      const parts = norm(path).split("/").filter(Boolean);
      const fileName = parts.pop();
      const dir = await walk(parts);
      if (!dir) return null;
      const child = (await childrenOf(dir, parts.join("/"))).get(fileName.toLowerCase());
      if (!child || !child.isFile) return null;
      return new Promise((resolve) => child.file(resolve, () => resolve(null)));
    },
    async hasDir(path) {
      const parts = norm(path).split("/").filter(Boolean);
      return (await walk(parts)) != null;
    },
    async list(path) {
      const parts = norm(path).split("/").filter(Boolean);
      const dir = await walk(parts);
      if (!dir) return [];
      const children = await childrenOf(dir, parts.join("/"));
      return [...children.values()].map((e) => ({ name: e.name, kind: e.isDirectory ? "directory" : "file" }));
    },
  };
}

// --- 3. A folder from <input webkitdirectory> -------------------------------
// For browsers with neither of the above behind a button (Brave, Firefox,
// Safari), and for Chrome and Opera when Steam is in Program Files, which
// showDirectoryPicker refuses to open. The input hands over every file under the folder, which is why it
// is only ever pointed at the track's own folder, never the whole install.
// Paths come as "<picked folder>/<rest>"; the picked folder is the reader's
// name, which is how acTrackScene recognises a track folder.

export function readerFromFileList(fileList) {
  const list = [...(fileList || [])].filter((f) => f.webkitRelativePath);
  if (!list.length) return null;
  const lower = (s) => s.toLowerCase();
  const files = new Map(); // lowercased path below the picked folder -> File
  const children = new Map(); // lowercased dir -> Map(lowercased name -> { name, kind })
  const add = (dir, name, kind) => {
    if (!children.has(dir)) children.set(dir, new Map());
    const known = children.get(dir);
    if (!known.has(lower(name)) || kind === "directory") known.set(lower(name), { name, kind });
  };
  const rootName = list[0].webkitRelativePath.split("/")[0];
  children.set("", new Map());
  for (const f of list) {
    const parts = f.webkitRelativePath.split("/").slice(1);
    for (let i = 0; i < parts.length; i++) add(lower(parts.slice(0, i).join("/")), parts[i], i === parts.length - 1 ? "file" : "directory");
    files.set(lower(parts.join("/")), f);
  }
  const norm = pathNormaliser(children.get("").has("content"));
  const trim = (p) => lower(norm(String(p || "")).replace(/^\/+|\/+$/g, ""));
  return {
    name: rootName,
    async getFile(path) {
      return files.get(trim(path)) || null;
    },
    async hasDir(path) {
      return children.has(trim(path));
    },
    async list(path) {
      return [...(children.get(trim(path))?.values() || [])];
    },
    // The driver picked content/tracks, or a folder holding the track: the
    // folder named after it wins.
    findDir(track) {
      const named = [...children.keys()].filter((d) => d.split("/").pop() === lower(track)).sort((a, b) => a.length - b.length);
      return named[0] ?? null;
    },
  };
}

// --- the entry points -------------------------------------------------------

export async function pickAcFolder() {
  const root = await window.showDirectoryPicker({ id: "nabs-ac-install", mode: "read" });
  return fsaReader(root);
}

// From a drop event's dataTransfer. Returns null when what was dropped is not
// a folder (a single file, a zip, a link).
export async function readerFromDrop(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) return entryReader(entry);
  }
  return null;
}

// --- remembering the folder -------------------------------------------------
// A picked folder's handle can be stored (IndexedDB keeps it as it is), so the
// next visit asks one "allow" click instead of the whole folder dialog again.
// Only the File System Access reader has a handle; a dropped folder is gone
// once the page closes. Every step may fail (private window, storage off, the
// folder moved) and then the driver simply picks it again.

const DB_NAME = "nabs-ac-folder";
const STORE = "handles";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function rememberAcFolder(reader) {
  if (!reader?.handle || typeof indexedDB === "undefined") return;
  try {
    await withStore("readwrite", (store) => store.put(reader.handle, "install"));
  } catch {
    // Not remembered: the next visit asks for the folder again.
  }
}

// The folder picked last time, or null. `open()` must run inside a click: the
// browser only re-grants read access in answer to the driver doing something.
export async function rememberedAcFolder() {
  if (!canPickFolder() || typeof indexedDB === "undefined") return null;
  try {
    const handle = await withStore("readonly", (store) => store.get("install"));
    if (!handle?.queryPermission) return null;
    return {
      name: handle.name,
      // True when the browser still holds the read grant ("Allow on every
      // visit" in Chrome): then open() needs no click and no dialog.
      async granted() {
        try {
          return (await handle.queryPermission({ mode: "read" })) === "granted";
        } catch {
          return false;
        }
      },
      async open() {
        let state = await handle.queryPermission({ mode: "read" });
        if (state !== "granted") state = await handle.requestPermission({ mode: "read" });
        return state === "granted" ? fsaReader(handle) : null;
      },
    };
  } catch {
    return null;
  }
}
