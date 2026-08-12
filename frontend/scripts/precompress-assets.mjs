// Writes a .br and a .gz next to every text file in dist/assets after a build.
//
// Why: the server gzips every response on the fly with zlib's fast default
// level, because it has to decide in milliseconds while a visitor waits. A
// build runs once, so it can afford brotli at its slowest, best setting — for
// the main bundle that is roughly another 40 kB off a cold visit, and the
// server stops spending CPU re-compressing the same unchanged file for every
// single visitor. The backend picks these up in src/index.js.
//
// Only text is worth it: png/jpg/woff2 are already compressed containers, and
// running them through brotli costs build time for nothing.
import { promises as fs } from "fs";
import { join } from "path";
import { brotliCompress, gzip, constants } from "zlib";
import { promisify } from "util";
import { pathToFileURL } from "url";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

// Extensions whose bytes actually shrink. .map is included because DevTools
// fetches it on demand and it is the largest file in the folder.
const TEXT = /\.(js|mjs|css|json|map|svg|txt|xml)$/i;

// Below this, the win is a few hundred bytes and the extra request handling is
// not worth two more files in the folder.
const MIN_BYTES = 1024;

export async function precompressAssets(assetsDir) {
  let names;
  try {
    names = await fs.readdir(assetsDir);
  } catch {
    return { files: 0, note: "no assets folder" };
  }

  const targets = names.filter((n) => TEXT.test(n) && !/\.(br|gz)$/i.test(n));
  let written = 0;

  await Promise.all(
    targets.map(async (name) => {
      const file = join(assetsDir, name);
      const raw = await fs.readFile(file);
      if (raw.length < MIN_BYTES) return;

      const [br, gz] = await Promise.all([
        brotliAsync(raw, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, // 11
            [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
          },
        }),
        gzipAsync(raw, { level: 9 }),
      ]);

      // A compressed copy that is not smaller would make the site slower, not
      // faster. Skip it and let the server fall back to the original.
      if (br.length < raw.length) {
        await fs.writeFile(`${file}.br`, br);
        written++;
      }
      if (gz.length < raw.length) {
        await fs.writeFile(`${file}.gz`, gz);
        written++;
      }
    })
  );

  return { files: written };
}

// Also runnable on its own: `node scripts/precompress-assets.mjs [distDir]`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = process.argv[2] || "dist";
  precompressAssets(join(dist, "assets")).then((r) => console.log("precompressed", r));
}
