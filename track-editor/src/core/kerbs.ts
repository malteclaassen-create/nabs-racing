import type { ApronColour, KerbSpan, KerbStyle, RoadSettings } from '../types';
import type { Frame } from './spline';

/**
 * Kerbs as stretches of their own, and the arithmetic that keeps them tidy.
 *
 * The editor used to carry a kerb as one boolean per control point. That tied
 * every kerb to wherever somebody had clicked while drawing the track: it could
 * not start halfway into a corner, it could not be shorter than a segment, and
 * two kerbs inside one segment were impossible. This module holds the
 * replacement -- a list of spans, each with its own start, end and shape --
 * plus the interval algebra needed to lay one over another without ever
 * producing an overlap.
 *
 * Everything here works on the curve parameter, 0..1, the same number a cross
 * section carries as `t`. A closed circuit is a CIRCLE in that parameter, so a
 * span may run across the seam with `from > to`, and every operation below has
 * to cope with that rather than pretending the lap has an end.
 */

/** Slivers this short are dropped rather than kept as zero length spans. */
const EPS = 1e-6;

export const KERB_STYLES: ReadonlyArray<{ value: KerbStyle; label: string; hint: string }> = [
  { value: 'ramp', label: 'Kerb', hint: 'Chamfer off the tarmac, flat top. The ordinary GP kerb.' },
  { value: 'wave', label: 'Wave', hint: 'Rippled top. Rattles the car without launching it.' },
  { value: 'sausage', label: 'Sausage', hint: 'Separate bumps on a low base. Stops a chicane being cut.' },
  { value: 'flat', label: 'Flat', hint: 'Low tilted strip, forgiving. Fast corner exits.' },
  { value: 'none', label: 'Strip only', hint: 'No kerb, just the coloured tarmac strip.' },
];

export const APRON_COLOURS: ReadonlyArray<{ value: ApronColour; label: string }> = [
  { value: 'grey', label: 'Grey' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'red', label: 'Red' },
];

/** Sensible height for each style, metres. A sausage is not 6 cm tall. */
export const STYLE_HEIGHT: Record<KerbStyle, number> = {
  ramp: 0.07,
  wave: 0.08,
  sausage: 0.13,
  flat: 0.05,
  none: 0,
};

let spanCounter = 0;

export function makeKerbSpan(
  side: -1 | 1,
  from: number,
  to: number,
  template?: Partial<KerbSpan>,
): KerbSpan {
  spanCounter += 1;
  return {
    id: `k${Date.now().toString(36)}${spanCounter.toString(36)}`,
    side,
    from,
    to,
    style: template?.style ?? 'ramp',
    width: template?.width ?? 1.2,
    height: template?.height ?? STYLE_HEIGHT[template?.style ?? 'ramp'],
    // Three metres of wedge at each end. Long enough to read as the triangle a
    // real kerb ends in, short enough not to eat a short span alive.
    taper: template?.taper ?? 3,
    apron: template?.apron ?? 0,
  };
}

/** Fill in what an older project file, or a hand edited one, does not have. */
export function normalizeKerbSpan(raw: Partial<KerbSpan>): KerbSpan | null {
  const from = Number(raw.from);
  const to = Number(raw.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const style: KerbStyle = KERB_STYLES.some((s) => s.value === raw.style)
    ? (raw.style as KerbStyle)
    : 'ramp';
  spanCounter += 1;
  return {
    id: raw.id ?? `k${Date.now().toString(36)}${spanCounter.toString(36)}`,
    side: raw.side === -1 ? -1 : 1,
    from: wrap01(from),
    to: to >= 1 - EPS && from <= EPS ? 1 : wrap01(to),
    style,
    width: Math.max(0, Number(raw.width) || 0),
    height: Math.max(0, Number(raw.height) || 0),
    taper: Math.max(0, Number(raw.taper) || 0),
    apron: Math.max(0, Number(raw.apron) || 0),
  };
}

function wrap01(t: number): number {
  const v = t % 1;
  return v < 0 ? v + 1 : v;
}

/* ------------------------------------------------------------------ */
/* Intervals on the circle                                             */
/* ------------------------------------------------------------------ */

/** A stretch that does not cross the seam: 0 <= a < b <= 1. */
export type Piece = [number, number];

/**
 * The one or two seam free stretches a span is made of.
 *
 * Every calculation below is done on these rather than on `from`/`to`, because
 * a wrapping span breaks the ordinary comparisons: `from > to` is not empty,
 * it is the long way round.
 */
export function piecesOf(from: number, to: number, closed: boolean): Piece[] {
  const a = wrap01(from);
  // Exactly the whole lap. Stored as 0..1 rather than 0..0 so it is not empty.
  if (to >= 1 - EPS && a <= EPS) return [[0, 1]];
  const b = wrap01(to);
  if (b > a + EPS) return [[a, b]];
  if (!closed) return [];
  if (b <= EPS) return [[a, 1]];
  return [
    [a, 1],
    [0, b],
  ];
}

export function spanPieces(span: KerbSpan, closed: boolean): Piece[] {
  return piecesOf(span.from, span.to, closed);
}

/** Does this span cover the cross section at curve parameter `t`? */
export function spanCovers(span: KerbSpan, t: number, closed: boolean): boolean {
  for (const [a, b] of spanPieces(span, closed)) if (t >= a - EPS && t <= b + EPS) return true;
  return false;
}

/** The span of `side` covering `t`, or null. First match wins; they never overlap. */
export function kerbAt(
  spans: readonly KerbSpan[],
  side: -1 | 1,
  t: number,
  closed: boolean,
): KerbSpan | null {
  for (const s of spans) if (s.side === side && spanCovers(s, t, closed)) return s;
  return null;
}

/** Total curve parameter a span covers, 0..1. */
export function spanExtent(span: KerbSpan, closed: boolean): number {
  let sum = 0;
  for (const [a, b] of spanPieces(span, closed)) sum += b - a;
  return sum;
}

/** Everything in `keep` that is not also in `cut`. Both seam free. */
function subtractPieces(keep: Piece[], cut: Piece[]): Piece[] {
  let out = keep;
  for (const [ca, cb] of cut) {
    const next: Piece[] = [];
    for (const [a, b] of out) {
      if (cb <= a + EPS || ca >= b - EPS) {
        next.push([a, b]); // no overlap
        continue;
      }
      if (ca > a + EPS) next.push([a, Math.min(ca, b)]);
      if (cb < b - EPS) next.push([Math.max(cb, a), b]);
    }
    out = next;
  }
  return out.filter(([a, b]) => b - a > EPS);
}

/**
 * Turn seam free stretches back into spans.
 *
 * The join at the end is the whole point: after cutting a hole in the middle of
 * a span that ran across the start/finish line, what is left is a stretch
 * ending at 1 and one starting at 0. Those are one span on a circle, and
 * leaving them as two would put a hairline gap and two wedge shaped ends at the
 * one place on the circuit where the author drew no end at all.
 */
function spansFromPieces(template: KerbSpan, out: Piece[], closed: boolean): KerbSpan[] {
  let list = out;
  if (closed && list.length > 1) {
    const firstAtZero = list.findIndex(([a]) => a <= EPS);
    const lastAtOne = list.findIndex(([, b]) => b >= 1 - EPS);
    if (firstAtZero >= 0 && lastAtOne >= 0 && firstAtZero !== lastAtOne) {
      const head = list[firstAtZero];
      const tail = list[lastAtOne];
      list = list.filter((_, i) => i !== firstAtZero && i !== lastAtOne);
      list.push([tail[0], head[1] + 1]); // to > 1 marks the wrap, undone below
    }
  }
  return list.map((piece, i) => {
    const [a, b] = piece;
    const wraps = b > 1 + EPS;
    return {
      ...template,
      // The first survivor keeps the id, so selecting a span and then trimming
      // its far end does not drop the selection.
      id: i === 0 ? template.id : makeKerbSpan(template.side, 0, 0).id,
      from: a,
      to: wraps ? wrap01(b - 1) : b,
    };
  });
}

/** `span` with everything between `from` and `to` taken out of it. */
export function subtractFromSpan(
  span: KerbSpan,
  from: number,
  to: number,
  closed: boolean,
): KerbSpan[] {
  const cut = piecesOf(from, to, closed);
  if (cut.length === 0) return [span];
  return spansFromPieces(span, subtractPieces(spanPieces(span, closed), cut), closed);
}

/** Remove a stretch of one side from the whole list, splitting spans as needed. */
export function eraseKerbRange(
  spans: readonly KerbSpan[],
  side: -1 | 1,
  from: number,
  to: number,
  closed: boolean,
): KerbSpan[] {
  const out: KerbSpan[] = [];
  for (const s of spans) {
    if (s.side !== side) {
      out.push(s);
      continue;
    }
    out.push(...subtractFromSpan(s, from, to, closed));
  }
  return out;
}

/**
 * Add a span, taking its footprint out of whatever was there before.
 *
 * Overlapping kerbs would each build their own strip through the same space,
 * so the newest one wins outright: it is the one the author just drew.
 */
export function insertKerbSpan(
  spans: readonly KerbSpan[],
  span: KerbSpan,
  closed: boolean,
): KerbSpan[] {
  if (spanExtent(span, closed) <= EPS) return [...spans];
  return [...eraseKerbRange(spans, span.side, span.from, span.to, closed), span];
}

/* ------------------------------------------------------------------ */
/* Metres                                                              */
/* ------------------------------------------------------------------ */

/**
 * Arc length at a curve parameter, in metres.
 *
 * Cross sections are evenly spaced in `t` by construction (`computeFrames`
 * walks i / steps), so the index is the parameter scaled -- no search needed.
 */
export function distAtT(frames: Frame[], closed: boolean, total: number, t: number): number {
  const n = frames.length;
  if (n === 0) return 0;
  if (n === 1) return frames[0].dist;
  const steps = closed ? n : n - 1;
  const x = Math.min(Math.max(t, 0), 1) * steps;
  const i = Math.min(Math.floor(x), steps - 1);
  const w = x - i;
  const a = frames[i % n].dist;
  // Past the last cross section of a loop lies the seam, at the full length.
  const b = i + 1 >= n ? total : frames[i + 1].dist;
  return a + (b - a) * w;
}

/** The curve parameter at an arc length. The inverse of `distAtT`. */
export function tAtDist(frames: Frame[], closed: boolean, total: number, dist: number): number {
  const n = frames.length;
  if (n < 2 || total <= 0) return 0;
  let d = dist;
  if (closed) d = ((d % total) + total) % total;
  else d = Math.min(Math.max(d, 0), total);
  const steps = closed ? n : n - 1;
  let i = 0;
  while (i < steps - 1 && frames[i + 1].dist <= d) i++;
  const a = frames[i].dist;
  const b = i + 1 >= n ? total : frames[i + 1].dist;
  const w = b - a > 1e-9 ? (d - a) / (b - a) : 0;
  return Math.min(1, (i + w) / steps);
}

/** Where a span starts and ends in metres, and how long it is. */
export function spanMetres(
  span: KerbSpan,
  frames: Frame[],
  closed: boolean,
  total: number,
): { start: number; end: number; length: number } {
  const start = distAtT(frames, closed, total, span.from);
  const end = distAtT(frames, closed, total, span.to);
  const length = end >= start ? end - start : total - start + end;
  return { start, end, length: spanExtent(span, closed) >= 1 - EPS ? total : length };
}

/**
 * Put a span somewhere else along the track, in metres.
 *
 * The one way to move or resize a kerb, so the viewport's grips and the typed
 * in numbers cannot disagree: it goes back in through `insertKerbSpan`, which
 * means a kerb pushed into its neighbour trims the neighbour rather than
 * growing a second surface through the same space.
 */
export function moveKerbSpan(
  list: readonly KerbSpan[],
  span: KerbSpan,
  startM: number,
  lengthM: number,
  frames: Frame[],
  closed: boolean,
  total: number,
): KerbSpan[] {
  if (total <= 0) return [...list];
  const length = Math.max(1, Math.min(lengthM, total));
  const rest = list.filter((s) => s.id !== span.id);
  return insertKerbSpan(
    rest,
    {
      ...span,
      from: tAtDist(frames, closed, total, startM),
      to: tAtDist(frames, closed, total, startM + length),
    },
    closed,
  );
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

/** A kerb down both sides of the whole lap, which is what a new track gets. */
export function fullLapKerbs(road: Pick<RoadSettings, 'kerbWidth' | 'kerbHeight'>): KerbSpan[] {
  return ([-1, 1] as const).map((side) =>
    makeKerbSpan(side, 0, 1, { style: 'ramp', width: road.kerbWidth, height: road.kerbHeight }),
  );
}

/**
 * The spans an older project turns into.
 *
 * Before kerbs were spans they were a flag per control point, handed to a cross
 * section by `nearestBool`: point i owned the parameter range from i/segCount
 * to (i+1)/segCount. Reading the same ranges back out is what makes an old file
 * open looking exactly as it was saved.
 */
export function kerbsFromNodeFlags(
  nodes: ReadonlyArray<{ kerbL?: boolean; kerbR?: boolean }>,
  closed: boolean,
  road: Pick<RoadSettings, 'kerbWidth' | 'kerbHeight'>,
): KerbSpan[] {
  const count = nodes.length;
  if (count === 0) return [];
  const segCount = closed && count >= 3 ? count : count - 1;
  if (segCount < 1) return [];

  const out: KerbSpan[] = [];
  for (const side of [-1, 1] as const) {
    const on = nodes.map((n) => Boolean(side < 0 ? n.kerbL : n.kerbR));
    if (on.every(Boolean)) {
      out.push(makeKerbSpan(side, 0, 1, { width: road.kerbWidth, height: road.kerbHeight }));
      continue;
    }
    let start = -1;
    const close = (endExclusive: number) => {
      if (start < 0) return;
      out.push(
        makeKerbSpan(side, start / segCount, Math.min(endExclusive, segCount) / segCount, {
          width: road.kerbWidth,
          height: road.kerbHeight,
        }),
      );
      start = -1;
    };
    for (let i = 0; i < segCount; i++) {
      if (on[i]) {
        if (start < 0) start = i;
      } else close(i);
    }
    close(segCount);

    // A loop whose flags ran across the seam comes back as two spans meeting at
    // 0 and 1. Same fix as after a cut: on a circle that is one span.
    if (closed && out.length >= 2) {
      const head = out.findIndex((s) => s.side === side && s.from <= EPS && s.to < 1 - EPS);
      const tail = out.findIndex((s) => s.side === side && s.to >= 1 - EPS && s.from > EPS);
      if (head >= 0 && tail >= 0 && head !== tail) {
        out[tail] = { ...out[tail], to: out[head].to };
        out.splice(head, 1);
      }
    }
  }
  return out;
}
