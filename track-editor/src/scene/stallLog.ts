import { addAfterEffect, addEffect } from '@react-three/fiber';
import type * as THREE from 'three';
import { stats } from '../store/derived';
import { useEditor } from '../store/store';

/**
 * Why a frame took 376 ms, and a flight recorder for when one line is not
 * enough.
 *
 * A frame rate number tells you a stall happened. It does not tell you who
 * caused it, and that is the only question worth answering. Every frame is
 * split into the time our own code was running and the time the browser spent
 * elsewhere, and then the browser's share is attributed.
 *
 * The decisive measurement is `frozen`. A 10 ms timer chain ticks alongside the
 * frame loop. If those timers stopped too, the whole main thread was blocked,
 * which means garbage collection or another synchronous browser task. If they
 * kept firing happily while the frame took a third of a second, the main thread
 * was free and the frame was held up further down: the compositor, the GPU
 * process, the driver.
 *
 * The recorder keeps all of that per frame in a ring buffer so a whole session
 * can be saved to a file and read back offline, which is the only way to see
 * what leads up to a stall rather than what coincides with it.
 */

const STALL_MS = 60;
const KEEP = 8;
const MAX_FRAMES = 40000;

export interface StallRecord {
  at: number;
  totalMs: number;
  oursMs: number;
  frozenMs: number;
  gc: 'yes' | 'no' | '?';
  dGeo: number;
  dTex: number;
  dProg: number;
  rebuilds: number;
  masks: number;
  terrains: number;
  moves: number;
}

export const stalls: StallRecord[] = [];
export const diag = { on: false, recording: false, frames: 0 };

const listeners = new Set<() => void>();
export function onStall(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const fn of listeners) fn();
}

let renderer: THREE.WebGLRenderer | null = null;
export function attachRenderer(gl: THREE.WebGLRenderer) {
  renderer = gl;
}

/* ---- the ring buffer ---------------------------------------------- */

interface FrameSample {
  /** ms since the recording started. */
  t: number;
  /** frame start to frame start. */
  dt: number;
  /** inside our frame callbacks and the draw submission. */
  ours: number;
  /** worst 10 ms heartbeat gap during the frame. */
  frozen: number;
  draws: number;
  geo: number;
  tex: number;
  prog: number;
  /** deltas within the frame */
  rebuilds: number;
  masks: number;
  terrains: number;
  moves: number;
  /** 1 while a control is being dragged. */
  busy: number;
  /** Ticks arriving from the worker heartbeat, and its own worst gap. */
  wticks: number;
  wgap: number;
  /** Worst long task the browser reported, and what it blamed. */
  task: number;
  taskWho: string;
  /** Worst long animation frame, and the script it names for it. */
  loaf: number;
  loafWho: string;
  /** Worst React subtree render in the frame, and which one. */
  react: number;
  reactWho: string;
  /** How many times the 3D tree rendered in the frame. */
  renders: number;
  /** Time spent in timed effects during the frame, and the worst single one. */
  fx: number;
  fxWorst: number;
  fxWho: string;
  /** JS heap in use, MB. 0 where the browser will not say. */
  heap: number;
  /** Worst input event: total, its name, and the part spent in handlers. */
  ev: number;
  evName: string;
  evWork: number;
}

let samples: FrameSample[] = [];
const marks: Array<{ t: number; label: string }> = [];
let recordStart = 0;

/** Note a discrete event on the recording timeline. */
export function noteEvent(label: string) {
  if (!diag.recording) return;
  marks.push({ t: performance.now() - recordStart, label });
}

/* ---- heartbeat: did the whole main thread stop? -------------------- */

let timerId = 0;
let timerLast = 0;
let timerWorst = 0;

function heartbeat() {
  const now = performance.now();
  if (timerLast) {
    const gap = now - timerLast;
    if (gap > timerWorst) timerWorst = gap;
  }
  timerLast = now;
  timerId = window.setTimeout(heartbeat, 10);
}

/* ---- a heartbeat that survives a blocked main thread ---------------- */

/*
 * The timer heartbeat above can only say THAT the main thread stopped, never
 * why -- because while it is stopped, nothing on that thread can observe
 * anything. A recorded stall of four seconds with our own code accounting for
 * one millisecond, no frames, no timers and two pointer events in the whole
 * window leaves two very different explanations standing:
 *
 *   1. the main thread is blocked by a task that is not ours (a nested browser
 *      loop, a synchronous driver call), while the rest of the renderer lives;
 *   2. the whole renderer process is suspended, in which case nothing anywhere
 *      is running.
 *
 * A worker tells them apart, because it is on its own thread. It measures its
 * OWN tick gaps and posts them; the messages queue while the main thread is
 * away and arrive in a heap when it comes back. Small gaps plus a heap of
 * queued messages means the worker kept running and only this thread was
 * blocked. Gaps as long as the stall mean everything stopped together.
 */
let workerTicks = 0;
let workerWorstGap = 0;
let beatWorker: Worker | null = null;
let beatUrl = '';

function startWorkerBeat() {
  if (beatWorker || typeof Worker !== 'function') return;
  const src = `let last = performance.now();
    setInterval(() => { const now = performance.now(); postMessage(now - last); last = now; }, 10);`;
  try {
    beatUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    beatWorker = new Worker(beatUrl);
    beatWorker.onmessage = (e: MessageEvent<number>) => {
      workerTicks += 1;
      if (e.data > workerWorstGap) workerWorstGap = e.data;
    };
  } catch {
    beatWorker = null;
  }
}

function stopWorkerBeat() {
  beatWorker?.terminate();
  beatWorker = null;
  if (beatUrl) URL.revokeObjectURL(beatUrl);
  beatUrl = '';
  workerTicks = 0;
  workerWorstGap = 0;
}

/* ---- what the browser says it was doing ----------------------------- */

/*
 * Two observers, for the two things the browser will tell you about time it
 * spent outside our code. A long task names its own origin ('self' for this
 * document, 'unknown' when the browser will not say); an event timing entry
 * splits an input event into how long it waited and how long its handlers ran,
 * which is the difference between "our handler is slow" and "the event was
 * delivered four seconds late".
 */
let longTaskMs = 0;
let longTaskName = '';
let loafMs = 0;
let loafWho = '';
let slowEventMs = 0;
let slowEventName = '';
let slowEventHandlerMs = 0;
const observers: PerformanceObserver[] = [];

function startObservers() {
  if (typeof PerformanceObserver !== 'function') return;
  // `durationThreshold` is part of the Event Timing spec but not of the DOM
  // typings, so the options go in loosely typed rather than being dropped.
  const add = (type: string, opts: Record<string, unknown>, fn: (e: PerformanceEntry) => void) => {
    try {
      const o = new PerformanceObserver((list) => list.getEntries().forEach(fn));
      o.observe({ type, ...opts } as unknown as PerformanceObserverInit);
      observers.push(o);
    } catch {
      /* the browser does not support this entry type; the rest still works */
    }
  };
  add('longtask', {}, (e) => {
    if (e.duration > longTaskMs) {
      longTaskMs = e.duration;
      const attr = (e as PerformanceEntry & { attribution?: Array<{ name?: string; containerType?: string }> })
        .attribution?.[0];
      longTaskName = attr?.containerType ? `${e.name}/${attr.containerType}` : e.name;
    }
  });
  /*
   * The one that names names.
   *
   * A long task says only how long the browser was busy and that the work
   * belonged to this document -- which, on a four second freeze where our own
   * measured code accounted for a millisecond, narrows it down to "somewhere in
   * fifteen hundred lines". A long ANIMATION frame entry carries a `scripts`
   * list instead: for every script that ran in it, the function, the source
   * file, the line, what invoked it, and how long it took. That turns the
   * remaining question into a lookup.
   *
   * Chrome 123 and up. Where it is missing the observer simply never fires and
   * everything else in the trace still works.
   */
  add('long-animation-frame', {}, (e) => {
    const loaf = e as PerformanceEntry & {
      scripts?: Array<{
        duration: number;
        invoker?: string;
        invokerType?: string;
        sourceURL?: string;
        sourceFunctionName?: string;
        sourceCharPosition?: number;
      }>;
    };
    if (e.duration <= loafMs) return;
    loafMs = e.duration;
    const worst = [...(loaf.scripts ?? [])].sort((a, b) => b.duration - a.duration)[0];
    loafWho = worst
      ? `${Math.round(worst.duration)}ms ${worst.sourceFunctionName || worst.invoker || '?'} ` +
        `[${(worst.sourceURL || '').split('/').pop() ?? ''}${worst.sourceCharPosition !== undefined ? `@${worst.sourceCharPosition}` : ''}]` +
        `${worst.invokerType ? ` via ${worst.invokerType}` : ''}`
      : 'no script attributed (the browser itself)';
  });
  add('event', { durationThreshold: 16 }, (e) => {
    if (e.duration > slowEventMs) {
      slowEventMs = e.duration;
      slowEventName = e.name;
      const ev = e as PerformanceEntry & { processingStart?: number; processingEnd?: number };
      slowEventHandlerMs =
        ev.processingEnd !== undefined && ev.processingStart !== undefined
          ? ev.processingEnd - ev.processingStart
          : 0;
    }
  });
}

function stopObservers() {
  observers.forEach((o) => o.disconnect());
  observers.length = 0;
  longTaskMs = 0;
  longTaskName = '';
  loafMs = 0;
  loafWho = '';
  renderWorstMs = 0;
  renderWorstId = '';
  slowEventMs = 0;
  slowEventName = '';
  slowEventHandlerMs = 0;
}

/* ---- how much memory the session is holding ------------------------ */

/**
 * Sampled every frame, because "the tab dies after twenty minutes of editing"
 * is a shape, not a moment: a curve that climbs and never comes back down says
 * something is being kept, and a sawtooth says the collector is doing its job
 * and the peak is simply too high. Neither is visible from a single reading.
 */
function heapMb(): number {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round(m.usedJSHeapSize / 1e6) : 0;
}

/* ---- which part of the interface React spent the time in ----------- */

/*
 * The browser will say "React's scheduler ran for four seconds" and stop there,
 * which is true and useless: React's scheduler is where every render in the app
 * happens. `<Profiler>` is the other half of the answer -- it reports the time
 * for a named subtree, so the panels, the viewport and the 3D scene each own
 * their share and the four seconds land on one of them by name.
 */
let renderWorstMs = 0;
let renderWorstId = '';

export function noteRender(id: string, ms: number) {
  if (!diag.on) return;
  if (id === SCENE_ID) sceneRenders += 1;
  if (ms <= renderWorstMs) return;
  renderWorstMs = ms;
  renderWorstId = id;
}

/**
 * The id the 3D subtree reports under. Its renders are COUNTED as well as
 * timed: one five second render and five hundred fast ones add up the same,
 * and they are completely different faults.
 */
export const SCENE_ID = '3D scene';
let sceneRenders = 0;

/*
 * Effects, which is where the last trace says the time must be.
 *
 * React's Profiler reports the RENDER phase only. Everything a component does
 * afterwards -- the layout effects that push matrices into instanced meshes,
 * upload buffers, rebuild indexes -- happens in the commit, inside the same
 * scheduler task, and is invisible to it. A recorded frame had the whole 3D
 * tree rendering once in seven milliseconds while the browser reported five
 * SECONDS in that task. Whatever is eating it runs here.
 */
let effectWorstMs = 0;
let effectWorstId = '';
let effectTotalMs = 0;

/** Report a span that was measured by the caller. */
export function noteEffect(id: string, ms: number) {
  if (!diag.on) return;
  effectTotalMs += ms;
  if (ms > effectWorstMs) {
    effectWorstMs = ms;
    effectWorstId = id;
  }
}

/** Time one effect and report it. Returns whatever the body returns. */
export function timeEffect<T>(id: string, body: () => T): T {
  if (!diag.on) return body();
  const t0 = performance.now();
  try {
    return body();
  } finally {
    const ms = performance.now() - t0;
    effectTotalMs += ms;
    if (ms > effectWorstMs) {
      effectWorstMs = ms;
      effectWorstId = id;
    }
  }
}

/* ---- sentinel: did a MAJOR collection run? ------------------------- */

let held: object[] = [];
let sentinelId = 0;
let gcCount = 0;

const registry =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry(() => {
        gcCount += 1;
        noteEvent('major garbage collection');
        const now = performance.now();
        for (let i = stalls.length - 1; i >= 0; i--) {
          if (now - stalls[i].at > 2000) break;
          if (stalls[i].gc === '?') {
            stalls[i].gc = 'yes';
            notify();
          }
        }
      })
    : null;

function dropSentinel() {
  // Held for a few seconds so it is tenured by the time it is dropped. Its
  // collection therefore indicates a major collection, not a cheap nursery one.
  const o = { pad: new Uint8Array(64) };
  registry?.register(o, 0);
  held.push(o);
  if (held.length > 6) held.shift();
  sentinelId = window.setTimeout(dropSentinel, 500);
}

/* ---- pointer activity --------------------------------------------- */

let moves = 0;
const onMove = () => {
  moves += 1;
};
/*
 * The pointer TYPE goes into the timeline on purpose. A mouse, a pen and a
 * touch contact are three different input paths through the browser, and only
 * one of them ever waits to find out whether a press was meant as a gesture --
 * which is indistinguishable from a freeze unless the trace says which device
 * was in your hand.
 */
const onDown = (e: PointerEvent) => noteEvent(`pointer down (${e.pointerType}, button ${e.button})`);
const onUp = (e: PointerEvent) => noteEvent(`pointer up (${e.pointerType})`);

/* ---- the frame bracket -------------------------------------------- */

let frameStart = 0;
let lastFrameStart = 0;
let lastGeo = 0;
let lastTex = 0;
let lastProg = 0;
let lastComputes = 0;
let lastMasks = 0;
let lastTerrains = 0;
let stopBefore: (() => void) | null = null;
let stopAfter: (() => void) | null = null;

function before() {
  frameStart = performance.now();
}

function after() {
  const end = performance.now();
  const oursMs = end - frameStart;

  // Include the gap that is still open.
  //
  // A blocked main thread stops the heartbeat as well, so the gap it leaves
  // cannot be measured until the timer fires again, which is after the long
  // frame has already been recorded. Reading only completed gaps therefore
  // reported the stalled frame as "main thread free" and blamed the browser's
  // compositor, when the thread had in fact been blocked the whole time.
  const openGap = timerLast ? end - timerLast : 0;
  if (openGap > timerWorst) timerWorst = openGap;
  const totalMs = lastFrameStart ? frameStart - lastFrameStart : 0;
  lastFrameStart = frameStart;

  const info = renderer?.info;
  const geo = info?.memory.geometries ?? 0;
  const tex = info?.memory.textures ?? 0;
  const prog = info?.programs?.length ?? 0;
  const draws = info?.render.calls ?? 0;

  const rebuilds = stats.computes - lastComputes;
  const masks = stats.maskBuilds - lastMasks;
  const terrains = stats.terrainBuilds - lastTerrains;

  if (totalMs > STALL_MS) {
    stalls.push({
      at: end,
      totalMs,
      oursMs,
      frozenMs: timerWorst,
      gc: '?',
      dGeo: geo - lastGeo,
      dTex: tex - lastTex,
      dProg: prog - lastProg,
      rebuilds,
      masks,
      terrains,
      moves,
    });
    if (stalls.length > KEEP) stalls.shift();
    notify();
  }

  if (diag.recording && samples.length < MAX_FRAMES) {
    samples.push({
      t: Math.round((frameStart - recordStart) * 10) / 10,
      dt: Math.round(totalMs * 100) / 100,
      ours: Math.round(oursMs * 100) / 100,
      frozen: Math.round(timerWorst * 10) / 10,
      draws,
      geo,
      tex,
      prog,
      rebuilds,
      masks,
      terrains,
      moves,
      busy: useEditor.getState().interacting ? 1 : 0,
      // Was anything alive while this thread was not?
      wticks: workerTicks,
      wgap: Math.round(workerWorstGap * 10) / 10,
      task: Math.round(longTaskMs),
      taskWho: longTaskName,
      loaf: Math.round(loafMs),
      loafWho,
      react: Math.round(renderWorstMs),
      reactWho: renderWorstId,
      renders: sceneRenders,
      fx: Math.round(effectTotalMs),
      fxWorst: Math.round(effectWorstMs),
      fxWho: effectWorstId,
      // The one number that says whether a session is heading for "Out of
      // memory". Chrome only exposes it on its own engine; elsewhere it is 0.
      heap: heapMb(),
      ev: Math.round(slowEventMs),
      evName: slowEventName,
      evWork: Math.round(slowEventHandlerMs),
    });
    diag.frames = samples.length;
  }

  lastGeo = geo;
  lastTex = tex;
  lastProg = prog;
  lastComputes = stats.computes;
  lastMasks = stats.maskBuilds;
  lastTerrains = stats.terrainBuilds;
  timerWorst = 0;
  moves = 0;
  workerTicks = 0;
  workerWorstGap = 0;
  longTaskMs = 0;
  longTaskName = '';
  loafMs = 0;
  loafWho = '';
  renderWorstMs = 0;
  renderWorstId = '';
  sceneRenders = 0;
  effectWorstMs = 0;
  effectWorstId = '';
  effectTotalMs = 0;
  slowEventMs = 0;
  slowEventName = '';
  slowEventHandlerMs = 0;
}

export function setDiagnostics(on: boolean) {
  if (on === diag.on) return;
  diag.on = on;

  if (!on) {
    diag.recording = false;
    stopBefore?.();
    stopAfter?.();
    stopBefore = null;
    stopAfter = null;
    window.clearTimeout(timerId);
    window.clearTimeout(sentinelId);
    stopWorkerBeat();
    stopObservers();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    held = [];
    timerLast = 0;
    timerWorst = 0;
    lastFrameStart = 0;
    stalls.length = 0;
    notify();
    return;
  }

  lastComputes = stats.computes;
  lastMasks = stats.maskBuilds;
  lastTerrains = stats.terrainBuilds;
  const info = renderer?.info;
  lastGeo = info?.memory.geometries ?? 0;
  lastTex = info?.memory.textures ?? 0;
  lastProg = info?.programs?.length ?? 0;

  stopBefore = addEffect(before);
  stopAfter = addAfterEffect(after);
  heartbeat();
  dropSentinel();
  startWorkerBeat();
  startObservers();
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  notify();
}

/* ---- recording ----------------------------------------------------- */

export function startRecording() {
  setDiagnostics(true);
  samples = [];
  marks.length = 0;
  gcCount = 0;
  recordStart = performance.now();
  diag.recording = true;
  diag.frames = 0;
  startProfiler();
  noteEvent('recording started');
  notify();
}

export function stopRecording() {
  if (!diag.recording) return;
  noteEvent('recording stopped');
  diag.recording = false;
  notify();
}

function environment() {
  const gl = renderer?.getContext();
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  const p = useEditor.getState().project;
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    screen: [window.screen.width, window.screen.height],
    canvas: renderer ? [renderer.domElement.width, renderer.domElement.height] : null,
    gpu: dbg && gl ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
    vendor: dbg && gl ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
    quality: useEditor.getState().quality,
    view: useEditor.getState().view,
    track: {
      points: p.track.nodes.length,
      pitPoints: p.pit.nodes.length,
      props: p.props.length,
      terrainEnabled: p.terrain.enabled,
      terrainRes: p.terrain.res,
      terrainSize: p.terrain.size,
      samplesPerSegment: p.road.samplesPerSegment,
      runoffWidth: p.road.runoffWidth,
      gridSlots: p.grid.count,
      pitBoxes: p.pitCfg.boxCount,
    },
  };
}

/* ---- the call stack, from the browser's own sampling profiler ------- */

/*
 * Six recordings now agree on where the four seconds are NOT. Our own frame
 * work is one millisecond, the scene renders once, the effects cost twelve,
 * autosave twelve, the worker keeps ticking -- and the thread is still blocked
 * from the moment the button goes down until it comes back up. Everything that
 * can be blamed by name has been cleared, which means the culprit has no name
 * yet: it is inside a library, or inside the browser, on a path nothing here
 * wraps.
 *
 * So stop guessing and take the stack. Chrome exposes the same sampling
 * profiler its developer tools use, and it needs no developer tools open: it
 * interrupts the thread every few milliseconds and writes down what is running,
 * which is exactly what a frozen thread cannot be asked any other way. The
 * samples that fall inside a stall are the answer, whoever it turns out to be.
 *
 * It needs the `Document-Policy: js-profiling` header, which the dev server
 * sends. Where it is missing, everything else in the recording still works.
 */
interface ProfilerFrame {
  name: string;
  resourceId?: number;
  line?: number;
}
interface ProfilerTrace {
  resources: string[];
  frames: ProfilerFrame[];
  stacks: { frameId: number; parentId?: number }[];
  samples: { timestamp: number; stackId?: number }[];
}

type ProfilerLike = {
  stop(): Promise<ProfilerTrace>;
  addEventListener(type: string, fn: () => void): void;
};

let profiler: ProfilerLike | null = null;
let profileParts: ProfilerTrace[] = [];
let profilerBroken = '';

function newProfiler(): ProfilerLike | null {
  const Ctor = (window as unknown as { Profiler?: new (o: object) => ProfilerLike }).Profiler;
  if (typeof Ctor !== 'function') {
    profilerBroken = 'this browser has no js self profiler';
    return null;
  }
  try {
    // Ten milliseconds is plenty to place a four second stall, and a five
    // minute session at that rate still fits in the buffer.
    const p = new Ctor({ sampleInterval: 10, maxBufferSize: 200_000 });
    p.addEventListener('samplebufferfull', () => {
      // Roll over rather than lose the rest of the session.
      void rollProfiler();
    });
    return p;
  } catch (e) {
    profilerBroken = e instanceof Error ? e.message : 'the profiler was refused';
    return null;
  }
}

async function rollProfiler() {
  const old = profiler;
  profiler = newProfiler();
  if (old) profileParts.push(await old.stop());
}

function startProfiler() {
  profileParts = [];
  profilerBroken = '';
  profiler = newProfiler();
}

async function stopProfiler(): Promise<ProfilerTrace[]> {
  if (profiler) {
    const p = profiler;
    profiler = null;
    try {
      profileParts.push(await p.stop());
    } catch {
      /* Already stopped by a roll over. */
    }
  }
  return profileParts;
}

/**
 * The hottest stacks inside each stall.
 *
 * A sample is a list of function names, innermost first. Two numbers matter per
 * function: how often it was the one actually running (self), and how often it
 * was anywhere on the stack (total). A four second stall in a single call shows
 * up as one name with a total of nearly every sample -- and the name right
 * below it in the stack is who called it.
 */
function stacksInStalls(parts: ProfilerTrace[]) {
  const windows = samples
    .filter((s) => s.dt > STALL_MS)
    .map((s) => ({ at: s.t, dt: s.dt, from: recordStart + s.t - s.dt, to: recordStart + s.t }));
  if (!windows.length) return [];

  return windows.map((w) => {
    const self = new Map<string, number>();
    const total = new Map<string, number>();
    const chains = new Map<string, number>();
    let n = 0;

    for (const part of parts) {
      for (const smp of part.samples) {
        if (smp.timestamp < w.from || smp.timestamp > w.to || smp.stackId === undefined) continue;
        n += 1;
        const names: string[] = [];
        for (let id: number | undefined = smp.stackId; id !== undefined; ) {
          const node: { frameId: number; parentId?: number } | undefined = part.stacks[id];
          if (!node) break;
          const f = part.frames[node.frameId];
          const where = f?.resourceId !== undefined ? part.resources[f.resourceId] : '';
          const file = where ? where.split('/').pop()!.split('?')[0] : '';
          names.push(`${f?.name || '(anonymous)'}${file ? ` [${file}]` : ''}`);
          id = node.parentId;
        }
        if (!names.length) continue;
        self.set(names[0], (self.get(names[0]) ?? 0) + 1);
        for (const name of new Set(names)) total.set(name, (total.get(name) ?? 0) + 1);
        const chain = names.slice(0, 8).join(' < ');
        chains.set(chain, (chains.get(chain) ?? 0) + 1);
      }
    }

    const top = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, hits]) => ({ name, hits }));

    return { at: w.at, dt: Math.round(w.dt), samples: n, self: top(self), total: top(total), chains: top(chains) };
  });
}

/** Save the recording as a file to send on. */
export async function saveRecording() {
  stopRecording();
  const parts = await stopProfiler();
  const payload = {
    format: 'ac-track-editor-trace/1',
    recordedAt: new Date().toISOString(),
    durationMs: samples.length ? samples[samples.length - 1].t : 0,
    majorCollections: gcCount,
    environment: environment(),
    marks,
    samples,
    stacks: stacksInStalls(parts),
    profiler: profilerBroken || `${parts.reduce((n, p) => n + p.samples.length, 0)} samples`,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `track-editor-trace-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---- a scripted drag, so every run is comparable -------------------- */

let scriptId = 0;

/**
 * Drag a control point back and forth by itself for a few seconds.
 *
 * Doing it from code rather than by hand takes the mouse out of the
 * measurement: the same movement, the same rate, every time, so two recordings
 * can actually be compared. This is the exact path a real drag takes, through
 * markBusy and live.
 */
export function runScriptedDrag(seconds = 12) {
  const store = useEditor.getState();
  const nodes = store.project.track.nodes;
  if (nodes.length < 3) return;
  const index = Math.floor(nodes.length / 2);
  const origin = [...nodes[index].p] as [number, number, number];

  startRecording();
  noteEvent(`scripted drag of track point ${index + 1} for ${seconds}s`);

  const t0 = performance.now();
  window.cancelAnimationFrame(scriptId);

  const step = () => {
    const elapsed = (performance.now() - t0) / 1000;
    if (elapsed >= seconds) {
      useEditor.getState().commit((p) => {
        p.track.nodes[index].p = [...origin] as [number, number, number];
      });
      noteEvent('scripted drag finished');
      stopRecording();
      saveRecording();
      return;
    }
    const swing = Math.sin(elapsed * 2.2) * 45;
    useEditor.getState().markBusy();
    useEditor.getState().live((p) => {
      const n = p.track.nodes[index];
      if (n) n.p = [origin[0] + swing, origin[1], origin[2] + swing * 0.4];
    });
    scriptId = window.requestAnimationFrame(step);
  };

  scriptId = window.requestAnimationFrame(step);
}

/* ---- the live one line summary -------------------------------------- */

export function describeLastStall(): string | null {
  const s = stalls[stalls.length - 1];
  if (!s) return null;
  return [
    `${s.totalMs.toFixed(0)}ms`,
    `ours ${s.oursMs.toFixed(0)}`,
    s.frozenMs > STALL_MS ? `main thread froze ${s.frozenMs.toFixed(0)}` : 'main thread free',
    s.gc === 'yes' ? 'GC' : '',
    s.terrains > 0 ? `${s.terrains} TERRAIN` : '',
    s.masks > 0 ? `${s.masks} corridor` : '',
    s.rebuilds > 0 ? `${s.rebuilds} rebuild${s.rebuilds === 1 ? '' : 's'}` : '',
    s.dGeo !== 0 ? `geo ${s.dGeo > 0 ? '+' : ''}${s.dGeo}` : '',
    s.dTex !== 0 ? `tex ${s.dTex > 0 ? '+' : ''}${s.dTex}` : '',
    s.dProg !== 0 ? `shader ${s.dProg > 0 ? '+' : ''}${s.dProg}` : '',
    s.moves === 0 ? 'no mouse' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function stallReport(): string {
  if (stalls.length === 0) return 'No stalls recorded yet.';
  return stalls
    .map((s, i) =>
      [
        `#${i + 1}`,
        `total ${s.totalMs.toFixed(0)}ms`,
        `ours ${s.oursMs.toFixed(1)}ms`,
        `frozen ${s.frozenMs.toFixed(0)}ms`,
        `gc ${s.gc}`,
        `rebuilds ${s.rebuilds}`,
        `masks ${s.masks}`,
        `terrain ${s.terrains}`,
        `geo ${s.dGeo >= 0 ? '+' : ''}${s.dGeo}`,
        `tex ${s.dTex >= 0 ? '+' : ''}${s.dTex}`,
        `shaders ${s.dProg >= 0 ? '+' : ''}${s.dProg}`,
        `moves ${s.moves}`,
      ].join('  '),
    )
    .join('\n');
}
