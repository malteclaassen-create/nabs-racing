import * as THREE from 'three';
import type { PropInstance } from '../types';
import { propTileBox } from './library';

/**
 * Ready made arrangements of several objects.
 *
 * A pit complex or a run of barriers is a dozen identical clicks, each of which
 * has to line up with the last one. Dropping the whole thing at once is both
 * faster and straighter, and it lands as a single undo step.
 *
 * The offsets are worked out from the measured footprints when this module
 * loads, never typed in. Hard coded spacing is exactly the sort of number that
 * survives a model being reshaped and quietly leaves a gap between every pair.
 */

export interface PrefabPart {
  kind: string;
  /** Offset of the object's own origin from the drop point, prefab frame. */
  x: number;
  z: number;
  /** Heading relative to the prefab, in degrees. */
  rotY: number;
  /**
   * Per axis scale, for the ground patches that are sized in metres rather
   * than tiled. Unstretched when left out, which is every other part.
   */
  scale?: [number, number, number];
}

export interface PrefabDef {
  key: string;
  label: string;
  /** One line for the palette card. */
  hint: string;
  parts: PrefabPart[];
}

/** Rotate a point about +Y by `deg`, matching how three.js turns an object. */
function turn(x: number, z: number, deg: number): { x: number; z: number } {
  const a = THREE.MathUtils.degToRad(deg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}

/**
 * A run of identical modules laid edge to edge, centred on (cx, cz) in the
 * prefab frame. Spacing is the measured footprint, so the modules tile with no
 * gap and no overlap whatever the models look like.
 */
function row(
  kind: string,
  count: number,
  along: 'x' | 'z',
  cx = 0,
  cz = 0,
  rotY = 0,
): PrefabPart[] {
  const f = propTileBox(kind);
  const pitch = (along === 'x' ? f.hx : f.hz) * 2;
  // The body centre is not the origin whenever the walls are not centred on
  // it, and it is the centres that have to be evenly spaced. Spacing by the
  // body rather than by the roof is what makes the walls meet: measured off
  // the roof, a pit complex carried a 0.5 m slot down its whole length.
  const back = turn(f.cx, f.cz, rotY);
  const out: PrefabPart[] = [];
  for (let i = 0; i < count; i++) {
    const step = (i - (count - 1) / 2) * pitch;
    const centreX = cx + (along === 'x' ? step : 0);
    const centreZ = cz + (along === 'z' ? step : 0);
    out.push({ kind, x: centreX - back.x, z: centreZ - back.z, rotY });
  }
  return out;
}

/** Half depth of a kind's body, for stacking one row behind another. */
const depth = (kind: string) => propTileBox(kind).hz;

export const PREFABS: PrefabDef[] = [
  {
    key: 'garage_row',
    label: 'Garage row',
    hint: '3 bays, flush',
    // The bay, not the garage block: its roof is flush with its walls, so a
    // row of them tiles into one continuous building.
    parts: row('garage_bay', 3, 'x'),
  },
  {
    key: 'house_row',
    label: 'Terrace',
    hint: '4 houses',
    parts: row('house', 4, 'x'),
  },
  {
    key: 'pit_complex',
    label: 'Pit complex',
    hint: 'Building + 5 bays',
    parts: [
      ...row('pit_building', 1, 'x'),
      /*
       * The bays open onto the pit lane, tiled along the FRONT of the building
       * -- its own +Z, the side that carries the shuttered band, the canopy and
       * the timing boxes.
       *
       * They used to sit BEHIND it, turned 180 deg, which put the only real
       * garage doors in the whole complex facing the paddock: from the racing
       * line you got a flat dark stripe at ground level and nothing else, and
       * the doors with their yellow markers were round the back where no camera
       * ever looks. The pit_building comment always said these tile "along the
       * front of this"; the prefab was the thing that disagreed.
       */
      ...row('garage_bay', 5, 'x', 0, depth('pit_building') + depth('garage_bay')),
    ],
  },
  {
    key: 'grandstand_pair',
    label: 'Grandstand pair',
    hint: '2 stands, side by side',
    parts: row('grandstand', 2, 'x'),
  },
  {
    key: 'grandstand_block',
    label: 'Grandstand block',
    hint: 'Covered centre, open wings',
    // What a circuit really builds: the expensive covered stand where the
    // action is, cheaper open banks either side of it. All three share the
    // same 24 m module, so the row is continuous.
    parts: [
      ...row('grandstand_roof', 1, 'x'),
      ...row('grandstand', 1, 'x', -24),
      ...row('grandstand', 1, 'x', 24),
    ],
  },
  {
    key: 'pit_complex_tower',
    label: 'Pit complex + tower',
    hint: 'Building, race control, 5 bays',
    parts: [
      ...row('pit_building', 1, 'x'),
      ...row('control_tower', 1, 'x', 24),
      // Along the front, for the reason spelled out on `pit_complex` above.
      ...row('garage_bay', 5, 'x', 0, depth('pit_building') + depth('garage_bay')),
    ],
  },
  {
    key: 'armco_run',
    label: 'Armco run',
    hint: '5 modules, 40 m',
    parts: row('armco', 5, 'z'),
  },
  {
    key: 'tecpro_run',
    label: 'TecPro run',
    hint: '8 modules, 32 m',
    // Eight, not five: TecPro comes in 4 m modules and the stretch it is put
    // down in -- the outside of a fast corner -- is the same length either
    // way, so the run has to cover it in one drag like the armco does.
    parts: row('tecpro', 8, 'z'),
  },
  {
    key: 'fence_run',
    label: 'Catch fence run',
    hint: '5 modules, 40 m',
    parts: row('fence', 5, 'z'),
  },
  {
    key: 'car_park',
    label: 'Car park',
    hint: 'Tarmac + 16 cars',
    /*
     * Two banks of bays nose to nose off a central aisle, which is how every
     * car park at a circuit is laid out. The bay pitch is 2.6 m and the cars
     * are 1.7 to 1.9 m wide, so they stand apart the way parked cars do rather
     * than touching -- `row` would tile them body to body, which is why this
     * one places its parts itself.
     */
    parts: (() => {
      const out: PrefabPart[] = [];
      // 2.8 m bays. A real one is 2.5, but the widest thing parked here is a
      // 2 m van and 2.5 would leave 25 cm to a side -- close enough to touching
      // that the row reads as a scrapyard rather than a car park. No camper in
      // the rows: at 2.2 m wide it belongs in the paddock, not in a bay.
      const BAY = 2.8;
      const kinds = ['car_small', 'car_estate', 'van', 'car_small', 'car_estate', 'car_small', 'car_estate', 'van'];
      for (let i = 0; i < 8; i++) {
        const x = (i - 3.5) * BAY;
        // Facing the aisle from both sides, which puts the noses inward.
        out.push({ kind: kinds[i], x, z: -5.6, rotY: 0 });
        out.push({ kind: kinds[(i + 3) % kinds.length], x, z: 5.6, rotY: 180 });
      }
      // The tarmac first in the list so it is drawn under the cars, 26 x 20 m
      // off the 10 m patch: a surface is stretched, not tiled.
      out.unshift({ kind: 'pad_asphalt', x: 0, z: 0, rotY: 0, scale: [2.6, 1, 2.0] });
      return out;
    })(),
  },
];

export const PREFABS_BY_KEY = new Map(PREFABS.map((d) => [d.key, d]));

/** The place tool's key for a prefab, so one field can hold either sort. */
export const PREFAB_PREFIX = 'prefab:';

export function prefabOf(placeKind: string): PrefabDef | null {
  if (!placeKind.startsWith(PREFAB_PREFIX)) return null;
  return PREFABS_BY_KEY.get(placeKind.slice(PREFAB_PREFIX.length)) ?? null;
}

/**
 * Turn a prefab into the objects it is made of, dropped at `at` and turned as
 * a rigid whole by `rotY`.
 */
export function instantiatePrefab(
  def: PrefabDef,
  at: { x: number; y: number; z: number },
  rotY: number,
  idFor: (index: number) => string,
): PropInstance[] {
  return def.parts.map((part, i) => {
    const p = turn(part.x, part.z, rotY);
    return {
      id: idFor(i),
      kind: part.kind,
      name: `${def.key}_${part.kind}_${i + 1}`,
      p: [at.x + p.x, at.y, at.z + p.z],
      r: [0, (((rotY + part.rotY) % 360) + 360) % 360, 0],
      // Fresh array per instance: sharing one would let an edit to a single
      // dropped object silently resize every other copy of the prefab.
      s: part.scale ? [...part.scale] : [1, 1, 1],
      // Following the ground is what makes a row up a hillside look built
      // rather than floating.
      ground: true,
    } satisfies PropInstance;
  });
}
