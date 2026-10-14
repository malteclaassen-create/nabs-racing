// Renders one car's liveries into the pictures the Wrapped scenes use
// (README.md). Needs Python 3 with Pillow + numpy, and Playwright's Chromium.
//
//   node tools/car-renders/render.mjs <car folder> <liveries json> <work dir> [--jobs 3]
//
// For each livery: the model with that skin's textures as a GLB (in the work
// dir, deleted after), then its hero atlas (79 frames, 640x275, from 24
// degrees off the nose round the left side to 30 past the tail, every 3
// degrees, 12 degrees up) and its field strip (16 frames all the way round at
// 15 and 55 degrees up, 128x128). A livery already rendered is skipped.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const [carDir, liveriesPath, workDir] = process.argv.slice(2);
const jobs = Number(process.argv[process.argv.indexOf("--jobs") + 1]) || 3;
if (!carDir || !liveriesPath || !workDir) {
  console.error("usage: node tools/car-renders/render.mjs <car folder> <liveries json> <work dir> [--jobs 3]");
  process.exit(1);
}
// Playwright from wherever it is installed (NODE_PATH=$(npm root -g) for a
// global one).
const require = createRequire(join(root, "frontend/package.json"));
const { chromium } = require("playwright");

const DEG = Math.PI / 180;
const HERO = { cellW: 640, cellH: 275, boxW: 5.6, boxH: 2.4, cy: 0.55, yawFrom: -24 * DEG, yawStep: 3 * DEG, yaws: 79, pitches: [0.21], ss: 2, quality: 0.8 };
const FIELD = { cellW: 128, cellH: 128, boxW: 5.6, boxH: 5.6, cy: 0.55, yaws: 16, pitches: [0.26, 0.96], ss: 2, quality: 0.9 };

const spec = JSON.parse(readFileSync(liveriesPath, "utf8"));
const model = basename(resolve(carDir));
const kn5 = join(carDir, `${model}.kn5`);
mkdirSync(workDir, { recursive: true });

// The repository over HTTP, for the render page and three.js; plus the work
// dir's GLBs under /work/.
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary" };
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = url.startsWith("/work/") ? join(workDir, url.slice(6)) : join(root, url);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function renderOne(l) {
  const hero = join(workDir, `${l.key}.hero.webp`);
  const field = join(workDir, `${l.key}.field.webp`);
  if (existsSync(hero) && existsSync(field)) return console.log(l.key, "already rendered");
  const glb = join(workDir, `${l.key}.glb`);
  const conv = spawnSync("python3", [join(here, "kn5_to_glb.py"), kn5, join(carDir, "skins", l.skin), glb, "--max-tex", "4096"], { stdio: "inherit" });
  if (conv.status !== 0) throw new Error(`${l.key}: conversion failed`);
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/tools/car-renders/render.html`);
    await page.waitForFunction(() => window.ready);
    await page.evaluate((u) => window.loadCar(u), `/work/${l.key}.glb`);
    for (const [file, layout] of [[hero, HERO], [field, FIELD]]) {
      const r = await page.evaluate((x) => window.atlas(x), layout);
      writeFileSync(file, Buffer.from(r.url.split(",")[1], "base64"));
      console.log(l.key, basename(file), `${r.width}x${r.height}`, `${Math.round(statSync(file).size / 1024)} KB`);
    }
  } finally {
    await page.close();
    rmSync(glb, { force: true });
  }
}

const queue = [...spec.liveries];
await Promise.all(
  Array.from({ length: jobs }, async () => {
    for (let l = queue.shift(); l; l = queue.shift()) await renderOne(l);
  })
);
await browser.close();
server.close();
console.log(`done: ${spec.liveries.length} liveries in ${workDir}; next: python3 tools/car-renders/pack.py ${liveriesPath} ${workDir} frontend/public/cars`);
