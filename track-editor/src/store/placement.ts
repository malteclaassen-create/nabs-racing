import { PointIndex } from '../core/spatial';
import { alignedHeading, clearanceAt, padScale, pathHeadingAt, type PathHeading } from '../core/propSnap';
import { LIBRARY_BY_KEY } from '../core/library';
import type { Frame } from '../core/spline';
import { getDerived } from './derived';
import { useEditor } from './store';

/**
 * Turning the thing you are about to place onto the road it belongs beside.
 *
 * Aiming concrete along a pit lane by eye is the job the heading control cannot
 * do: the lane runs at whatever angle the spline came out at -- 9.454° on the
 * project this was written against -- and no amount of nudging a slider lands
 * on that. The path already knows its own heading at every cross section, so
 * the honest answer is to read it off rather than to have the user guess.
 *
 * Lives here rather than in the store because it needs the derived geometry,
 * and `derived` reads the store: putting it the other way round would close the
 * import cycle.
 */

/* Where the pointer last was over the ground. The align action needs a place to
   ask about, and the preview follows the cursor; keeping it on the module
   rather than in the store means a mouse move does not re-render the panels. */
let lastGround: { x: number; z: number } | null = null;

/** Called from the viewport on every move of the place tool. */
export function noteGroundPoint(x: number, z: number): void {
  lastGround = { x, z };
}

export function lastGroundPoint(): { x: number; z: number } | null {
  return lastGround;
}

/* One index per frame array, rebuilt only when the geometry actually changes.
   `trackFrames` is a fresh array on every drag frame, so memoising on identity
   is what keeps this from building a spatial index sixty times a second. */
interface FrameIndex {
  frames: Frame[];
  index: PointIndex;
  /** Sampled positions, see below. */
  stamp: string;
}
let trackCache: FrameIndex | null = null;
let pitCache: FrameIndex | null = null;

/**
 * A cheap fingerprint of where the ribbon actually IS.
 *
 * Identity alone is not enough. The geometry reuses its frame objects between
 * rebuilds, so the same array can come back with every position inside it moved
 * -- and a PointIndex has already copied those positions into its own buckets.
 * The result is an index that answers questions about where the road used to
 * be, which is a very hard bug to see: everything looks right until you move
 * the track and then ask something about it.
 *
 * Three samples rather than all of them, because this runs on every mouse move
 * over the ground. Ends and middle catch a drag, a nudge, a whole path being
 * translated -- anything that moves a road without changing how many cross
 * sections it has.
 */
function stampOf(frames: Frame[]): string {
  const n = frames.length;
  if (n === 0) return '0';
  const a = frames[0].pos;
  const b = frames[n >> 1].pos;
  const c = frames[n - 1].pos;
  return `${n}|${a.x},${a.z}|${b.x},${b.z}|${c.x},${c.z}`;
}

function indexFor(frames: Frame[], cache: FrameIndex | null): FrameIndex {
  const stamp = stampOf(frames);
  if (cache && cache.frames === frames && cache.stamp === stamp) return cache;
  return { frames, stamp, index: new PointIndex(frames.map((f) => f.pos), 25) };
}

export interface Alignment {
  /** Heading the object should be turned to, degrees. */
  rotY: number;
  /** Which path it was taken from, so the status line can say. */
  path: 'track' | 'pit';
  /** How far that path is from the point asked about, metres. */
  dist: number;
}

/**
 * The heading that lays the object being placed along the nearest stretch of
 * track or pit lane, or null when neither has any geometry.
 *
 * `at` defaults to wherever the pointer last was over the ground, which is
 * where the preview is standing.
 */
export function alignmentAt(at?: { x: number; z: number }): Alignment | null {
  const point = at ?? lastGround;
  if (!point) return null;

  const s = useEditor.getState();
  const derived = getDerived(s.project);

  trackCache = indexFor(derived.trackFrames, trackCache);
  pitCache = indexFor(derived.pitFrames, pitCache);

  const onTrack = pathHeadingAt(point.x, point.z, trackCache.frames, trackCache.index);
  const onPit = pathHeadingAt(point.x, point.z, pitCache.frames, pitCache.index);

  let best: PathHeading | null = null;
  let path: 'track' | 'pit' = 'track';
  if (onTrack) best = onTrack;
  // The pit lane wins ties and near ties: it is the shorter of the two and the
  // one somebody standing next to it is far more likely to mean.
  if (onPit && (!best || onPit.dist <= best.dist)) {
    best = onPit;
    path = 'pit';
  }
  if (!best) return null;

  const scale = padScale(s.placeKind, s.padSize.w, s.padSize.l);
  return { rotY: alignedHeading(s.placeKind, scale, best.heading), path, dist: best.dist };
}

/**
 * Square the place tool up with the road it is next to, and return the line to
 * put on the status bar -- including when it could not, since "nothing
 * happened" is the one outcome a user has no way of telling apart from a bug.
 */
export function alignPlacementToPath(at?: { x: number; z: number }): string {
  if (!at && !lastGround) return 'Point at the ground first, then align';
  const hit = alignmentAt(at);
  if (!hit) return 'There is no track or pit lane to align with';
  const s = useEditor.getState();
  const name = hit.path === 'pit' ? 'pit lane' : 'track';

  /*
   * Already square: turn it round instead.
   *
   * "Along the road" has two answers 180° apart, and which one was meant is
   * not knowable from geometry -- a garage faces the lane it serves, a
   * grandstand faces away from the ground it stands on. One press gives one
   * answer; when that is the wrong way round, the same key gives the other,
   * which beats explaining to anyone why F chose the side it did.
   */
  const current = ((s.placeRotation % 360) + 360) % 360;
  const apart = Math.abs((((current - hit.rotY + 180) % 360) + 360) % 360 - 180);
  if (apart < 0.05) {
    const flipped = (hit.rotY + 180) % 360;
    s.setPlaceRotation(flipped);
    return `Turned round — facing the other way along the ${name} (${flipped.toFixed(1)}°)`;
  }

  s.setPlaceRotation(hit.rotY);
  return `Aligned with the ${name} at ${hit.rotY.toFixed(1)}°`;
}

/* ------------------------------------------------------------------ */
/* Keeping the planting off the road                                   */
/* ------------------------------------------------------------------ */

/**
 * Remove every plant that is standing on the built road surface.
 *
 * Vegetation is painted onto the ground as it is at the time, and then the
 * track moves: widen a corner, drag a control point, redraw the pit lane, and
 * what was a verge is now tarmac with a hedge growing out of it. Nothing in the
 * plants themselves knows that -- they are objects at fixed coordinates -- so
 * somebody has to look, and it should not have to be the user with a mouse.
 *
 * The test is the HARD surface only: tarmac, kerb and the coloured strip. The
 * run off is grass and gravel, and things standing in it are the author's
 * business -- clearing those too would rub out a whole verge every time a
 * control point moved a metre.
 *
 * Lives here for the same reason as everything else in this file: it needs the
 * derived geometry, and derived reads the store.
 */
export function clearPlantsOffTrack(): number {
  const s = useEditor.getState();
  const plants = s.project.props.filter(
    (p) => LIBRARY_BY_KEY.get(p.kind)?.category === 'Nature',
  );
  if (plants.length === 0) return 0;

  const derived = getDerived(s.project);
  /*
   * Fresh indices, deliberately not the cached ones above.
   *
   * That cache is keyed on the IDENTITY of the frame array, which is the right
   * trade for something that runs on every mouse move -- and wrong here. The
   * geometry reuses its frame objects between rebuilds, so the array can be the
   * same one while the positions inside it have moved, and a PointIndex holds
   * its own copy of those positions. Asking a stale index where the road is
   * gets an answer about where the road used to be, which for this function is
   * precisely the question it must not ask: it runs BECAUSE the road moved.
   */
  const trackIndex = new PointIndex(derived.trackFrames.map((f) => f.pos), 50);
  const pitIndex = new PointIndex(derived.pitFrames.map((f) => f.pos), 50);

  const doomed = new Set<string>();
  for (const plant of plants) {
    const clear = clearanceAt(
      plant.p[0], plant.p[2],
      derived.trackFrames, trackIndex, derived.profile,
      derived.pitFrames, pitIndex,
      60,
      false,
      s.project.track.closed,
    );
    if (clear < 0) doomed.add(plant.id);
  }
  if (doomed.size === 0) return 0;

  s.commit((p) => {
    p.props = p.props.filter((x) => !doomed.has(x.id));
  });
  return doomed.size;
}
