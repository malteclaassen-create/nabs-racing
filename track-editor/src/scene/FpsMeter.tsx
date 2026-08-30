import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { stats } from '../store/derived';
import {
  describeLastStall,
  diag,
  onStall,
  runScriptedDrag,
  saveRecording,
  setDiagnostics,
  stallReport,
  startRecording,
} from './stallLog';

/**
 * Frame rate readout for the status bar.
 *
 * Worth having permanently: "it feels slow" is hard to act on, a number that
 * drops from 180 to 20 the moment you drag a control point is not.
 *
 * It also records what the editor was doing during the worst frame. A long
 * frame with zero rebuilds means nothing in this code ran during it, so the
 * pause came from the browser: garbage collection, a shader compile, a texture
 * upload. That distinction is otherwise almost impossible to make from the
 * outside, and it decides where to look next.
 */
const STALL_MS = 60;

const state = {
  fps: 0,
  worstMs: 0,
  calls: 0,
  geometries: 0,
  /** Rebuilds that happened during the worst frame of the last window. */
  stallComputes: 0,
  stallProjectChanges: 0,
  stallCount: 0,
};

const listeners = new Set<() => void>();

export function FpsProbe() {
  const frames = useRef(0);
  const since = useRef(0);
  const worst = useRef(0);
  const worstComputes = useRef(0);
  const worstChanges = useRef(0);
  const lastComputes = useRef(0);
  const lastChanges = useRef(0);

  useFrame((ctx, delta) => {
    const computesThisFrame = stats.computes - lastComputes.current;
    const changesThisFrame = stats.projectChanges - lastChanges.current;
    lastComputes.current = stats.computes;
    lastChanges.current = stats.projectChanges;

    frames.current += 1;
    since.current += delta;
    if (delta > worst.current) {
      worst.current = delta;
      worstComputes.current = computesThisFrame;
      worstChanges.current = changesThisFrame;
    }

    if (since.current >= 0.5) {
      state.fps = frames.current / since.current;
      state.worstMs = worst.current * 1000;
      state.calls = ctx.gl.info.render.calls;
      state.geometries = ctx.gl.info.memory.geometries;
      if (state.worstMs > STALL_MS) {
        state.stallComputes = worstComputes.current;
        state.stallProjectChanges = worstChanges.current;
        state.stallCount += 1;
      }
      frames.current = 0;
      since.current = 0;
      worst.current = 0;
      worstComputes.current = 0;
      worstChanges.current = 0;
      for (const fn of listeners) fn();
    }
  });

  return null;
}

export function FpsReadout() {
  const [, bump] = useState(0);

  useEffect(() => {
    const fn = () => bump((v) => v + 1);
    listeners.add(fn);
    const off = onStall(fn);
    return () => {
      listeners.delete(fn);
      off();
    };
  }, []);

  const fps = Math.round(state.fps);
  const colour = fps >= 50 ? 'var(--good)' : fps >= 28 ? 'var(--warn)' : 'var(--danger)';
  const stalled = state.fps > 0 && state.worstMs > STALL_MS;

  return (
    <>
      {state.fps > 0 && (
        <span
          style={{ color: colour, fontVariantNumeric: 'tabular-nums' }}
          title="Frames per second, averaged over the last half second"
        >
          {fps} fps
        </span>
      )}
      {stalled && (
        <span
          style={{ color: 'var(--danger)', fontVariantNumeric: 'tabular-nums' }}
          title={
            state.stallComputes === 0
              ? 'The longest frame in the last half second. Nothing in the editor ran during it, so the pause came from the browser itself: garbage collection, a shader compile or a texture upload.'
              : 'The longest frame in the last half second, and how many geometry rebuilds happened inside it. Rebuilds during a stall means the editor caused it.'
          }
        >
          stall {state.worstMs.toFixed(0)} ms
          {state.stallComputes === 0 ? ' (idle)' : ` (${state.stallComputes} rebuild${state.stallComputes === 1 ? '' : 's'})`}
        </span>
      )}
      {state.fps > 0 && (
        <span
          style={{ fontVariantNumeric: 'tabular-nums' }}
          title="Draw calls per frame and live geometries. If these climb after an edit, the scene grew rather than the maths getting slower."
        >
          {state.calls} draws / {state.geometries} geo
        </span>
      )}
      <StallDiagnostics />
    </>
  );
}

/**
 * The switch that turns the stall recorder on, and the one line it produces.
 *
 * Off by default: it keeps a 10 ms timer ticking and brackets every frame, and
 * there is no reason to pay for that unless something is actually wrong.
 */
function StallDiagnostics() {
  const [, bump] = useState(0);
  useEffect(() => onStall(() => bump((v) => v + 1)), []);
  const line = diag.on ? describeLastStall() : null;

  return (
    <>
      <button
        className="btn ghost"
        style={{ padding: '1px 7px', fontSize: 11, borderColor: diag.on ? 'var(--accent-line)' : 'transparent' }}
        title="Record what the browser was doing during a long frame: whether our code ran, whether the whole main thread froze, and whether a garbage collection happened. Turn it on, wait for a stall, then read the line next to it."
        onClick={() => {
          setDiagnostics(!diag.on);
          bump((v) => v + 1);
        }}
      >
        {diag.on ? 'Diagnose: on' : 'Diagnose'}
      </button>
      {diag.on && (
        <span
          style={{ color: line ? 'var(--warn)' : 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}
          title={line ? 'Click to copy the full log' : 'Waiting for a long frame'}
          onClick={() => {
            if (line) void navigator.clipboard?.writeText(stallReport());
          }}
        >
          {line ?? 'watching…'}
        </span>
      )}

      {/* The flight recorder: every frame to a file, to be read back offline. */}
      {diag.recording ? (
        <button
          className="btn"
          style={{ padding: '1px 7px', fontSize: 11, borderColor: 'var(--danger)', color: 'var(--danger)' }}
          title="Stop recording and save the trace to a file"
          onClick={() => {
            void saveRecording();
            bump((v) => v + 1);
          }}
        >
          Stop &amp; save ({diag.frames} frames)
        </button>
      ) : (
        <>
          <button
            className="btn ghost"
            style={{ padding: '1px 7px', fontSize: 11 }}
            title="Record every frame while you work. Reproduce the problem, then stop and save: the file has the whole timeline in it."
            onClick={() => {
              startRecording();
              bump((v) => v + 1);
            }}
          >
            Record
          </button>
          <button
            className="btn ghost"
            style={{ padding: '1px 7px', fontSize: 11 }}
            title="Drag a control point back and forth by itself for twelve seconds, recording throughout, then save. Same movement every time, so two runs can be compared."
            onClick={() => {
              runScriptedDrag(12);
              bump((v) => v + 1);
            }}
          >
            Self test
          </button>
        </>
      )}
    </>
  );
}
