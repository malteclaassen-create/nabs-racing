// Renders the Season Wrapped films of one car (README.md): for each livery,
// four short videos (intro, climb, podium, grid) and a still. Needs Python 3
// with Pillow + numpy, ffmpeg, and Playwright's Chromium.
//
//   NODE_PATH=$(npm root -g) node tools/car-renders/render.mjs <car folder> <liveries json> <work dir> [--jobs 3] [--only key,key] [--gpu]
//
// --gpu: draw on the graphics card (a visible browser window, Direct3D on
// Windows) instead of on the processor; minutes instead of hours.
// render-windows.bat does all of it on a Windows PC.
//
// Liveries with "of" (a driver's own, played with their team's films) are
// not rendered. A film already in the work dir is skipped, so a stopped run
// picks up where it was.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const [carDir, liveriesPath, workDir] = process.argv.slice(2);
const flag = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const jobs = Number(flag("--jobs")) || 3;
const only = flag("--only")?.split(",");
const gpu = process.argv.includes("--gpu");
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
if (!carDir || !liveriesPath || !workDir) {
  console.error("usage: node tools/car-renders/render.mjs <car folder> <liveries json> <work dir> [--jobs 3] [--only key,key]");
  process.exit(1);
}
// Playwright from wherever it is installed (NODE_PATH=$(npm root -g) for a
// global one).
const require = createRequire(join(root, "frontend/package.json"));
const { chromium } = require("playwright");

// Each film on its slide's colour (frontend/src/utils/wrappedStory.mjs
// STORY_THEMES) and as long as the slide (STORY_DURATIONS).
// `version` goes up when a film's scene changes, so it is made again.
const FILMS = {
  intro: { bg: "#0B0A12", secs: 6.5, others: false, moving: false, version: 1 },
  climb: { bg: "#0E3B2E", secs: 8.5, others: true, moving: true, version: 2 },
  podium: { bg: "#050507", secs: 8, others: false, moving: false, version: 1 },
  grid: { bg: "#050507", secs: 8, others: true, moving: false, version: 1 },
};
const SIZE = { w: 720, h: 900, fps: 24 };

const spec = JSON.parse(readFileSync(liveriesPath, "utf8"));
const model = basename(resolve(carDir));
const kn5 = join(carDir, `${model}.kn5`);
// The rest of the field in the lighter model, where the car has one.
const lodB = existsSync(join(carDir, `${model}_LOD_B.kn5`)) ? join(carDir, `${model}_LOD_B.kn5`) : kn5;
const own = spec.liveries.filter((l) => !l.of && (!only || only.includes(l.key)));
mkdirSync(join(workDir, "glb2"), { recursive: true });

function glb(source, skin, out, extra = []) {
  if (existsSync(out)) return;
  const r = spawnSync(python, [join(here, "kn5_to_glb.py"), source, join(carDir, "skins", skin), out, "--max-tex", "4096", ...extra], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`conversion failed: ${out}`);
}
// The rest of the field: three liveries from the list, lighter (LOD B).
const field = spec.liveries.filter((l) => !l.of).slice(0, 4);
for (const l of field) {
  glb(lodB, l.skin, join(workDir, "glb2", `${l.key}-lodb.glb`), ["--textures", kn5]);
  glb(lodB, l.skin, join(workDir, "glb2", `${l.key}-lodb-moving2.glb`), ["--textures", kn5, "--moving"]);
}

const types = { ".html": "text/html", ".js": "text/javascript", ".glb": "model/gltf-binary" };
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
const browser = await chromium.launch(
  gpu
    ? { headless: false, args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", ...(process.platform === "win32" ? ["--use-angle=d3d11"] : [])] }
    : { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }
);

async function page() {
  const p = await browser.newPage();
  p.on("pageerror", (e) => console.log("page error:", e.message));
  await p.goto(`${base}/tools/car-renders/video.html`);
  await p.waitForFunction(() => window.ready);
  return p;
}

// Say what is drawing: a graphics card's name, or SwiftShader (the processor).
{
  const p = await page();
  const name = await p.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  console.log("drawing on:", name);
  await p.close();
}

async function film(l, kind) {
  const dir = join(workDir, l.key);
  const mp4 = join(dir, `${kind}.mp4`);
  // A film made by an older version of its scene is made again.
  const stamp = join(dir, `${kind}.version`);
  const made = existsSync(stamp) ? Number(readFileSync(stamp, "utf8")) : 1;
  if (existsSync(mp4) && made >= FILMS[kind].version) return;
  const f = FILMS[kind];
  const me = `/work/glb2/${l.key}${f.moving ? "-moving2" : ""}.glb`;
  const others = f.others ? field.filter((x) => x.key !== l.key).slice(0, 3).map((x) => `/work/glb2/${x.key}-lodb${f.moving ? "-moving2" : ""}.glb`) : [];
  const frames = join(dir, `frames-${kind}`);
  mkdirSync(frames, { recursive: true });
  const p = await page();
  try {
    await p.evaluate((o) => window.setup(o), { kind, cars: [me, ...others], w: SIZE.w, h: SIZE.h, team: l.colour || "#F4AFC6", bg: f.bg });
    const n = Math.round(f.secs * SIZE.fps);
    for (let i = 0; i < n; i++) {
      const url = await p.evaluate(([t, d]) => window.frameAt(t, d), [i / SIZE.fps, f.secs]);
      writeFileSync(join(frames, `f${String(i).padStart(4, "0")}.jpg`), Buffer.from(url.split(",")[1], "base64"));
    }
  } finally {
    await p.close();
  }
  const enc = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(SIZE.fps), "-i", join(frames, "f%04d.jpg"), "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { stdio: "inherit" });
  if (enc.status !== 0) throw new Error(`encoding failed: ${mp4}`);
  // And as WebM, for the browsers that play no MP4.
  const webm = mp4.replace(/\.mp4$/, ".webm");
  const vp9 = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(SIZE.fps), "-i", join(frames, "f%04d.jpg"), "-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p", webm], { stdio: "inherit" });
  if (vp9.status !== 0) throw new Error(`encoding failed: ${webm}`);
  rmSync(frames, { recursive: true, force: true });
  writeFileSync(stamp, String(FILMS[kind].version));
  console.log(l.key, kind, "done");
}

async function still(l) {
  const png = join(workDir, l.key, "still.png");
  if (existsSync(png)) return;
  mkdirSync(join(workDir, l.key), { recursive: true });
  const p = await page();
  try {
    const url = await p.evaluate((o) => window.stillPng(o), { car: `/work/glb2/${l.key}.glb`, w: 1080, h: 820, team: l.colour || "#F4AFC6" });
    writeFileSync(png, Buffer.from(url.split(",")[1], "base64"));
  } finally {
    await p.close();
  }
}

const tasks = [];
for (const l of own) {
  glb(kn5, l.skin, join(workDir, "glb2", `${l.key}.glb`));
  glb(kn5, l.skin, join(workDir, "glb2", `${l.key}-moving2.glb`), ["--moving"]);
  tasks.push(() => still(l));
  for (const kind of Object.keys(FILMS)) tasks.push(() => film(l, kind));
}
await Promise.all(
  Array.from({ length: jobs }, async () => {
    for (let t = tasks.shift(); t; t = tasks.shift()) await t();
  })
);
await browser.close();
server.close();
console.log(`done: ${own.length} liveries in ${workDir}; next: ${python} tools/car-renders/pack.py ${liveriesPath} ${workDir} frontend/public/cars`);
