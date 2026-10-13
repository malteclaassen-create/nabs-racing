// ---------------------------------------------------------------------------
// A track mod's ZIP, read in place: the same reader shape as utils/acFolder.js
// ({ name, getFile, hasDir, list }), so the 3D view loads a downloaded mod the
// same way it loads an installed track.
//
// For phones above all, which cannot pick a folder but can pick a file. A mod
// is hundreds of megabytes, and unpacking all of it in a phone's browser tab
// is how the tab dies. So only the zip's table of contents is read up front;
// a file is unpacked when it is asked for (an ini, then one model at a time),
// by the browser's own DecompressionStream, and nothing else is ever touched.
//
// Nothing is uploaded: the file never leaves the device.
// ---------------------------------------------------------------------------

const EOCD = 0x06054b50, EOCD64_LOCATOR = 0x07064b50, EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZipError";
  }
}

const bytesOf = async (blob, from, to) => new DataView(await blob.slice(from, to).arrayBuffer());
const u64 = (dv, at) => dv.getUint32(at, true) + dv.getUint32(at + 4, true) * 2 ** 32;
const utf8 = new TextDecoder("utf-8");
const latin1 = (bytes) => String.fromCharCode(...bytes);

// The table of contents: every entry's name, sizes, method and where its
// local header is. Handles ZIP64, which a mod over 4 GB (or with more than
// 65535 files) needs.
export async function zipEntries(blob) {
  const tailFrom = Math.max(0, blob.size - 65557);
  const tail = await bytesOf(blob, tailFrom, blob.size);
  let at = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === EOCD) { at = i; break; }
  if (at < 0) throw new ZipError("This is not a ZIP file.");
  let count = tail.getUint16(at + 10, true);
  let size = tail.getUint32(at + 12, true);
  let offset = tail.getUint32(at + 16, true);
  if ((count === 0xffff || size === 0xffffffff || offset === 0xffffffff) && at >= 20 && tail.getUint32(at - 20, true) === EOCD64_LOCATOR) {
    const recordAt = u64(tail, at - 12);
    const rec = await bytesOf(blob, recordAt, recordAt + 56);
    if (rec.getUint32(0, true) === EOCD64) {
      count = u64(rec, 32);
      size = u64(rec, 40);
      offset = u64(rec, 48);
    }
  }
  const cd = await bytesOf(blob, offset, offset + size);
  const raw = new Uint8Array(cd.buffer);
  const out = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== CENTRAL) break;
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    let compressed = cd.getUint32(p + 20, true);
    let length = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), commentLen = cd.getUint16(p + 32, true);
    let local = cd.getUint32(p + 42, true);
    const nameBytes = raw.subarray(p + 46, p + 46 + nameLen);
    // Bit 11 says UTF-8; without it the name is the old DOS code page, which
    // for the ASCII names AC content uses is the same bytes.
    const name = (flags & 0x800 ? utf8.decode(nameBytes) : latin1(nameBytes)).replace(/\\/g, "/");
    // ZIP64 extra field: the sizes and offset that did not fit, in this order,
    // only those that are 0xFFFFFFFF above.
    let e = p + 46 + nameLen;
    const end = e + extraLen;
    while (e + 4 <= end) {
      const id = cd.getUint16(e, true), len = cd.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (length === 0xffffffff) { length = u64(cd, q); q += 8; }
        if (compressed === 0xffffffff) { compressed = u64(cd, q); q += 8; }
        if (local === 0xffffffff) { local = u64(cd, q); }
      }
      e += 4 + len;
    }
    out.push({ name, method, compressed, length, local, encrypted: !!(flags & 1), dir: name.endsWith("/") });
    p = end + commentLen;
  }
  return out;
}

async function unpack(blob, entry) {
  const head = await bytesOf(blob, entry.local, entry.local + 30);
  if (head.getUint32(0, true) !== LOCAL) throw new ZipError(`${entry.name} is damaged in the ZIP.`);
  const start = entry.local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const data = blob.slice(start, start + entry.compressed);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new ZipError(`${entry.name} is packed in a way the browser cannot unpack.`);
  if (typeof DecompressionStream === "undefined") throw new ZipError("This browser is too old to unpack ZIP files. Update it and try again.");
  return new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
}

const lower = (s) => s.toLowerCase();
const trim = (p) => String(p || "").replace(/^\/+|\/+$/g, "");

export async function readerFromZip(file) {
  const entries = (await zipEntries(file)).filter((e) => !e.encrypted);
  const files = new Map(); // lowercased path -> entry
  const children = new Map(); // lowercased dir -> Map(lowercased name -> { name, kind })
  const add = (dir, name, kind) => {
    if (!children.has(dir)) children.set(dir, new Map());
    const known = children.get(dir);
    if (!known.has(lower(name)) || kind === "directory") known.set(lower(name), { name, kind });
  };
  for (const e of entries) {
    const parts = trim(e.name).split("/").filter(Boolean);
    if (!parts.length) continue;
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      add(lower(parts.slice(0, i).join("/")), parts[i], last && !e.dir ? "file" : "directory");
    }
    if (!e.dir) files.set(lower(parts.join("/")), e);
  }

  return {
    name: String(file.name || "track").replace(/\.zip$/i, ""),
    async getFile(path) {
      const entry = files.get(lower(trim(path)));
      if (!entry) return null;
      const blob = await unpack(file, entry);
      return new File([blob], entry.name.split("/").pop());
    },
    async hasDir(path) {
      return children.has(lower(trim(path)));
    },
    async list(path) {
      return [...(children.get(lower(trim(path)))?.values() || [])];
    },
    // Mods are zipped every which way: content/tracks/<id>, <id> on its own,
    // or inside a folder named after the mod. The folder named after the
    // track wins; failing that, the one folder that holds a track model.
    findDir(track) {
      const named = [...children.keys()].filter((d) => d.split("/").pop() === lower(track)).sort((a, b) => a.length - b.length);
      if (named.length) return named[0];
      const homes = new Set([...files.keys()].filter((p) => p.endsWith(".kn5")).map((p) => p.split("/").slice(0, -1).join("/")));
      return homes.size === 1 ? [...homes][0] : null;
    },
  };
}
