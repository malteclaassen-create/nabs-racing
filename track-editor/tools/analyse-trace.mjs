/**
 * Read a trace saved by the editor's flight recorder and say what happened.
 *
 *   node tools/analyse-trace.mjs track-editor-trace-1234.json
 *
 * The editor records every frame: how long it took, how much of that was our
 * own code, whether the main thread kept ticking, what the renderer held, and
 * what the editor rebuilt. This turns that into an answer to the only question
 * that matters when the picture freezes: who stopped it.
 */

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/analyse-trace.mjs <trace.json>');
  process.exit(2);
}

const trace = JSON.parse(readFileSync(path, 'utf8'));
const s = trace.samples ?? [];
if (s.length === 0) {
  console.error('The trace has no frames in it.');
  process.exit(1);
}

const STALL_MS = 60;

/**
 * How long the main thread was blocked during a frame.
 *
 * A blocked thread stops the heartbeat too, so the gap it leaves can only be
 * measured once the timer fires again, which is during the NEXT frame. Traces
 * recorded before that was fixed therefore report the gap one frame late, and
 * reading them naively says "main thread free" about a frame that was in fact
 * blocked the whole time. If the following frame is short but reports a gap as
 * long as this frame took, that gap belongs here.
 */
function blockedMs(i) {
  const f = s[i];
  const next = s[i + 1];
  if (next && next.dt < f.dt * 0.5 && next.frozen > f.dt * 0.8) return next.frozen;
  return f.frozen;
}
const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '?');
const pct = (a, b) => (b === 0 ? '0' : ((a / b) * 100).toFixed(0));

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/* ---------------------------------------------------------------- */

console.log('\n=================== TRACE ===================');
const env = trace.environment ?? {};
console.log(`recorded    ${trace.recordedAt}`);
console.log(`duration    ${num(trace.durationMs / 1000, 1)} s over ${s.length} frames`);
console.log(`gpu         ${env.gpu ?? 'unknown'} (${env.vendor ?? '?'})`);
console.log(`canvas      ${env.canvas ? env.canvas.join(' x ') : '?'} px, device pixel ratio ${env.devicePixelRatio}`);
console.log(`quality     ${env.quality}`);
if (env.track) {
  const t = env.track;
  console.log(
    `track       ${t.points} points, ${t.pitPoints} pit points, ${t.props} objects, ` +
      `terrain ${t.terrainEnabled ? `${t.terrainRes}x${t.terrainRes} over ${t.terrainSize} m` : 'off'}`,
  );
  console.log(`            detail ${t.samplesPerSegment}x, run off ${t.runoffWidth} m, ${t.gridSlots} grid, ${t.pitBoxes} pits`);
}

/* ---------------------------------------------------------------- */

const dts = s.map((f) => f.dt).filter((v) => v > 0).sort((a, b) => a - b);
const fps = 1000 / quantile(dts, 0.5);
console.log('\n--------------- FRAME TIMES ---------------');
console.log(`median      ${num(quantile(dts, 0.5), 2)} ms  (${num(fps, 0)} fps)`);
console.log(`90th        ${num(quantile(dts, 0.9), 2)} ms`);
console.log(`99th        ${num(quantile(dts, 0.99), 2)} ms`);
console.log(`worst       ${num(dts[dts.length - 1], 1)} ms`);

const ours = s.map((f) => f.ours).sort((a, b) => a - b);
console.log(`our code    median ${num(quantile(ours, 0.5), 2)} ms, worst ${num(ours[ours.length - 1], 1)} ms`);

/* ---------------------------------------------------------------- */

const stalls = s.filter((f) => f.dt > STALL_MS);
console.log('\n----------------- STALLS ------------------');
console.log(`${stalls.length} frames over ${STALL_MS} ms out of ${s.length} (${pct(stalls.length, s.length)}%)`);

if (stalls.length > 0) {
  const blocked = stalls.filter((f) => blockedMs(s.indexOf(f)) > STALL_MS);
  const ourFault = stalls.filter((f) => f.ours > f.dt * 0.5);
  const withTerrain = stalls.filter((f) => f.terrains > 0);
  const withMask = stalls.filter((f) => f.masks > 0);
  const withGeoJump = stalls.filter((f) => Math.abs(f.geo - (s[s.indexOf(f) - 1]?.geo ?? f.geo)) > 2);
  const withoutMouse = stalls.filter((f) => f.moves === 0);

  console.log(`  our own code was the time    ${ourFault.length}  (${pct(ourFault.length, stalls.length)}%)`);
  console.log(`  whole main thread blocked    ${blocked.length}  (${pct(blocked.length, stalls.length)}%)`);
  console.log(`  terrain mesh rebuilt         ${withTerrain.length}`);
  console.log(`  corridor rebuilt             ${withMask.length}`);
  console.log(`  geometry count jumped        ${withGeoJump.length}`);
  console.log(`  no pointer activity at all   ${withoutMouse.length}`);

  const gaps = [];
  for (let i = 1; i < stalls.length; i++) gaps.push(stalls[i].t - stalls[i - 1].t);
  if (gaps.length > 1) {
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const median = quantile(sortedGaps, 0.5);
    const spread = (quantile(sortedGaps, 0.9) - quantile(sortedGaps, 0.1)) / Math.max(1, median);
    console.log(`  spacing between stalls       median ${num(median / 1000, 1)} s, spread ${num(spread * 100, 0)}%`);
    if (spread < 0.4) {
      console.log('  -> regular spacing: something periodic, not load dependent');
    } else {
      console.log('  -> irregular spacing: load dependent, not a timer');
    }
  }

  console.log('\n  the ten worst, in order:');
  console.log('    at        total    ours   frozen   draws   geo  rebuild mask terr moves busy');
  for (const f of [...stalls].sort((a, b) => b.dt - a.dt).slice(0, 10)) {
    console.log(
      `    ${num(f.t / 1000, 1).padStart(7)}s ${num(f.dt, 0).padStart(7)} ${num(f.ours, 1).padStart(7)} ` +
        `${num(f.frozen, 0).padStart(7)} ${String(f.draws).padStart(7)} ${String(f.geo).padStart(5)} ` +
        `${String(f.rebuilds).padStart(7)} ${String(f.masks).padStart(4)} ${String(f.terrains).padStart(4)} ` +
        `${String(f.moves).padStart(5)} ${String(f.busy).padStart(4)}`,
    );
  }

  /*
   * Who else was alive.
   *
   * Only present in traces recorded after the worker heartbeat and the browser
   * observers were added. Without them a stall where our code did nothing is a
   * dead end: the main thread cannot report on the time it was not running.
   */
  if (stalls.some((f) => f.wticks !== undefined)) {
    /*
     * The script the browser blames, when it will say. This is the line that
     * ends an investigation: everything else narrows a four second freeze down
     * to "somewhere in this document", and this names the function.
     */
    const named = [...stalls, ...s.filter((f) => f.loaf > 200)]
      .filter((f) => f.loafWho)
      .sort((a, b) => b.loaf - a.loaf)
      .slice(0, 5);
    if (named.length > 0) {
      console.log('\n  what the browser blames, by name:');
      for (const f of named) {
        console.log(`    ${num(f.t / 1000, 1).padStart(7)}s  ${String(f.loaf).padStart(5)} ms frame -> ${f.loafWho}`);
      }
    }

    // React's scheduler owns every render in the app, so "the scheduler ran for
    // four seconds" narrows nothing down. The Profiler around each area does.
    const reacted = [...stalls, ...s.filter((f) => (f.react ?? 0) > 200)]
      .filter((f) => f.reactWho)
      .sort((a, b) => b.react - a.react)
      .slice(0, 5);
    if (reacted.length > 0) {
      console.log('\n  and which part of the interface React was rendering:');
      for (const f of reacted) {
        const loops = f.renders !== undefined ? `, ${f.renders} render${f.renders === 1 ? '' : 's'} of the 3D tree` : '';
        console.log(`    ${num(f.t / 1000, 1).padStart(7)}s  ${String(f.react).padStart(5)} ms in "${f.reactWho}"${loops}`);
      }
      const worstFrame = [...stalls].sort((a, b) => b.dt - a.dt)[0];
      if (worstFrame.fx !== undefined) {
        console.log('\n  and what its effects cost (the commit, which the profiler above cannot see):');
        for (const f of [...stalls].sort((a, b) => b.dt - a.dt).slice(0, 5)) {
          console.log(
            `    ${num(f.t / 1000, 1).padStart(7)}s  ${String(f.fx).padStart(5)} ms in effects` +
              (f.fxWho ? `, worst ${f.fxWorst} ms in "${f.fxWho}"` : ''),
          );
        }
        if (worstFrame.fx > worstFrame.dt * 0.5) {
          console.log(`\n    There it is: "${worstFrame.fxWho}" owns the frame.`);
        } else if (worstFrame.fx < worstFrame.dt * 0.1 && (worstFrame.react ?? 0) < worstFrame.dt * 0.1) {
          console.log('\n    Neither the render nor the effects account for it. The time is inside');
          console.log('    React itself or in something it calls that is not instrumented -- the next');
          console.log("    place to look is Chrome's own profiler, which shows the call stack.");
        }
      }
      if (worstFrame.renders > 50) {
        console.log(`\n    ${worstFrame.renders} renders inside one frame: this is a LOOP, not a slow render.`);
        console.log('    Something asks React to render again as a result of rendering.');
      } else if ((worstFrame.react ?? 0) < worstFrame.dt * 0.2 && worstFrame.loafWho) {
        console.log('\n    None of the measured subtrees accounts for the time, so the work is');
        console.log('    outside them: an effect, an event handler, or a tree with no Profiler.');
      }
    }

    console.log('\n  and what was alive during those frames:');
    console.log('    at       worker ticks  worker gap   longest task (who)        slowest event');
    for (const f of [...stalls].sort((a, b) => b.dt - a.dt).slice(0, 10)) {
      const ev = f.ev ? `${f.ev} ms ${f.evName ?? ''} (${f.evWork ?? 0} ms in handlers)` : '-';
      const task = f.task ? `${f.task} ms ${f.taskWho ? `(${f.taskWho})` : ''}` : '-';
      console.log(
        `    ${num(f.t / 1000, 1).padStart(7)}s ${String(f.wticks ?? 0).padStart(12)} ` +
          `${num(f.wgap ?? 0, 0).padStart(11)} ${task.padEnd(25)} ${ev}`,
      );
    }
    console.log('');
    const worst = [...stalls].sort((a, b) => b.dt - a.dt)[0];
    const expected = Math.round(worst.dt / 10);
    /*
     * The worker's ticks are counted in the frame they ARRIVE in, and while
     * the main thread is blocked nothing arrives anywhere. They land in a heap
     * in the frames just after it, which is where the answer is -- reading the
     * stall frame alone says "zero ticks" about a worker that never missed a
     * beat, and points at the whole process having stopped when it had not.
     */
    const i = s.indexOf(worst);
    const after = s.slice(i, i + 8);
    const delivered = after.reduce((a, f) => a + (f.wticks ?? 0), 0);
    const ownGap = Math.max(...after.map((f) => f.wgap ?? 0));
    if (delivered > expected * 0.5 && ownGap < worst.dt * 0.25) {
      console.log(`    The worker never stopped: ${delivered} ticks arrived in a heap once the thread`);
      console.log(`    came back, and its own worst gap was ${num(ownGap, 0)} ms. So the renderer was alive`);
      console.log('    and THIS thread alone was blocked -- by a task in this document, not by the');
      console.log('    GPU, the driver or the browser suspending the page.');
    } else if ((worst.wgap ?? 0) > worst.dt * 0.5) {
      console.log(`    The worker stalled too (${num(worst.wgap, 0)} ms of its own gap): the whole renderer`);
      console.log('    process stopped, not just the main thread. That is the browser, the GPU');
      console.log('    process or the driver, and no amount of editor code will move it.');
    } else {
      console.log(`    The worker only managed ${worst.wticks ?? 0} ticks where about ${expected} were due, without`);
      console.log('    a large gap of its own: it was starved rather than blocked, which points at');
      console.log('    the process being descheduled as a whole.');
    }
  }
}

/* ---------------------------------------------------------------- */

/* ---------------------------------------------------------------- */
/* Memory                                                            */
/* ---------------------------------------------------------------- */

if (s.some((f) => f.heap > 0)) {
  const heap = s.filter((f) => f.heap > 0);
  const first = heap[0];
  const last = heap[heap.length - 1];
  const peak = heap.reduce((a, f) => (f.heap > a.heap ? f : a), heap[0]);
  const low = heap.reduce((a, f) => (f.heap < a.heap ? f : a), heap[0]);
  const minutes = Math.max(0.001, (last.t - first.t) / 60000);
  const perMin = (last.heap - first.heap) / minutes;
  console.log('\n--------------- MEMORY --------------------');
  console.log(`heap        ${first.heap} MB -> ${last.heap} MB   (low ${low.heap}, peak ${peak.heap} at ${num(peak.t / 1000, 1)}s)`);
  console.log(`trend       ${perMin >= 0 ? '+' : ''}${Math.round(perMin)} MB per minute of this recording`);
  // A collector doing its job leaves a sawtooth: the floor stays put while the
  // peak comes and goes. A floor that climbs is something being kept.
  const half = Math.floor(heap.length / 2);
  const floorEarly = Math.min(...heap.slice(0, half).map((f) => f.heap));
  const floorLate = Math.min(...heap.slice(half).map((f) => f.heap));
  if (floorLate > floorEarly + 50) {
    console.log(`  -> the FLOOR climbed ${floorEarly} -> ${floorLate} MB: something is being kept,`);
    console.log('     not merely allocated. That is the shape that ends in "Out of memory".');
  } else if (peak.heap > 1500) {
    console.log('  -> the floor is steady, so nothing is leaking, but the peak is high enough');
    console.log('     that one more spike could still run the tab out of memory.');
  } else {
    console.log('  -> the floor is steady: allocation churn, collected as it goes.');
  }
}

console.log('\n--------------- THE SCENE -----------------');
const geo = s.map((f) => f.geo);
const draws = s.map((f) => f.draws);
console.log(`geometries  ${Math.min(...geo)} .. ${Math.max(...geo)}   (first ${geo[0]}, last ${geo[geo.length - 1]})`);
console.log(`draw calls  ${Math.min(...draws)} .. ${Math.max(...draws)}`);
console.log(`textures    ${Math.min(...s.map((f) => f.tex))} .. ${Math.max(...s.map((f) => f.tex))}`);
console.log(`shaders     ${Math.min(...s.map((f) => f.prog))} .. ${Math.max(...s.map((f) => f.prog))}`);

// A leak keeps climbing. Resources created once as features get used climb to a
// plateau and stop, which looks identical if you only compare first and last.
const geoGrowth = geo[geo.length - 1] - geo[0];
const half = Math.floor(geo.length / 2);
const growthLate = geo[geo.length - 1] - geo[half];
let geoDrops = 0;
for (let i = 1; i < geo.length; i++) if (geo[i] < geo[i - 1]) geoDrops++;
const leaking = growthLate > 5 && geoDrops === 0;

if (leaking) {
  console.log(`  -> LEAK: still climbing in the second half (+${growthLate}), never falls`);
} else if (geoGrowth > 5) {
  console.log(
    `  -> grew by ${geoGrowth} early then settled (+${growthLate} in the second half, fell ${geoDrops} times)`,
  );
  console.log('     that is resources created the first time a feature is used, not a leak');
} else {
  console.log('  -> geometry count is stable, no leak');
}

const busy = s.filter((f) => f.busy === 1);
if (busy.length > 0) {
  const rebuiltWhileBusy = busy.filter((f) => f.terrains > 0).length;
  console.log(
    `\ndragging    ${busy.length} frames (${pct(busy.length, s.length)}%), ` +
      `terrain rebuilt in ${rebuiltWhileBusy} of them`,
  );
  if (rebuiltWhileBusy > 0) {
    console.log('  -> BUG: the heavy work is not being deferred during a drag');
  }
}

/* ---------------------------------------------------------------- */

console.log('\n---------------- VERDICT ------------------');
if (leaking) {
  console.log(`A GEOMETRY LEAK, whatever else is going on: +${growthLate} in the second half alone.`);
  console.log('That is buffers being created faster than they are freed. It will eventually');
  console.log('stall the browser on its own, so fix it before reading anything else here.');
  console.log('');
}
if (stalls.length === 0) {
  console.log('No stalls in this recording. Whatever caused them was not reproduced here.');
} else {
  const blocked = stalls.filter((f) => blockedMs(s.indexOf(f)) > STALL_MS).length;
  const ourFault = stalls.filter((f) => f.ours > f.dt * 0.5).length;
  const terrain = stalls.filter((f) => f.terrains > 0).length;

  if (ourFault > stalls.length * 0.5) {
    console.log('OUR CODE. Most long frames were spent inside the editor. Look at what');
    console.log('was rebuilt in the table above: terrain and corridor are the expensive two.');
  } else if (terrain > stalls.length * 0.3 && stalls.some((f) => f.ours > f.dt * 0.2)) {
    // A rebuild that COINCIDES with a stall is not the cause of it. Blaming the
    // terrain while our own code accounted for one millisecond of four seconds
    // sent a whole afternoon looking in the wrong place.
    console.log('THE TERRAIN REBUILD. It runs during stalls far too often. The deferral');
    console.log('during dragging is not working.');
  } else if (blocked > stalls.length * 0.5) {
    console.log('THE BROWSER PAUSED EVERYTHING. The main thread stopped, including timers.');
    console.log('That is garbage collection or another synchronous browser task. Look at');
    console.log('what allocates per frame; the editor itself was not running.');
    console.log(`Major collections seen during the recording: ${trace.majorCollections}`);
  } else {
    console.log('NOT THE MAIN THREAD. Our code was fast, the main thread kept ticking, yet');
    console.log('frames did not arrive. The hold up is below the page: the compositor, the');
    console.log('GPU process or the driver.');
    console.log('Things worth trying, in order of how much they cut GPU work:');
    console.log('  1. quality Draft, 2. terrain off, 3. a smaller browser window.');
    console.log('If none of them changes the picture, it is not the scene at all.');
  }
}

console.log('');

/* ---------------------------------------------------------------- */

/*
 * The call stack of the stall, if the recording carries one.
 *
 * Everything above this point measures our own code, so it can only ever say
 * "not us". This section says who instead: the browser's sampling profiler
 * interrupts the thread every ten milliseconds and writes down what is on it,
 * so a stall with a single cause shows one name on nearly every sample.
 */
if (trace.stacks?.length) {
  console.log('--------------- CALL STACKS ---------------');
  console.log(`  from the browser's own profiler (${trace.profiler})\n`);
  for (const s of trace.stacks) {
    console.log(`  stall at ${num(s.at / 1000, 1)}s, ${s.dt} ms, ${s.samples} samples`);
    if (!s.samples) {
      console.log('    no samples landed in it -- the profiler was not running\n');
      continue;
    }
    const pct = (h) => `${String(Math.round((h / s.samples) * 100)).padStart(3)}%`;
    console.log('    running (the innermost function):');
    for (const f of s.self.slice(0, 6)) console.log(`      ${pct(f.hits)}  ${f.name}`);
    console.log('    anywhere on the stack:');
    for (const f of s.total.slice(0, 8)) console.log(`      ${pct(f.hits)}  ${f.name}`);
    if (s.chains?.length) {
      console.log('    hottest single stack, innermost first:');
      for (const part of s.chains[0].name.split(' < ')) console.log(`      ${part}`);
      console.log(`      (${pct(s.chains[0].hits)} of the stall)`);
    }
    console.log('');
  }
} else if (trace.profiler) {
  console.log('--------------- CALL STACKS ---------------');
  console.log(`  none: ${trace.profiler}\n`);
}

if (trace.marks?.length) {
  console.log('---------------- TIMELINE -----------------');
  for (const m of trace.marks.slice(0, 40)) {
    console.log(`  ${num(m.t / 1000, 2).padStart(8)}s  ${m.label}`);
  }
  if (trace.marks.length > 40) console.log(`  ... ${trace.marks.length - 40} more`);
  console.log('');
}
