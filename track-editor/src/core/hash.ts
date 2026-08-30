/**
 * Cheap content signatures.
 *
 * The derived data (road meshes, terrain, markers, AI line) is rebuilt from the
 * project on every change. Object identity is useless as a cache key because an
 * edit clones the project, so a signature over the values that actually feed a
 * given computation is what decides whether it has to run again. Renaming the
 * track must not rebuild an 84000 vertex terrain.
 *
 * Two independent 32 bit accumulators, fed the raw bit patterns of every number,
 * so a change of any single float is caught.
 */

const scratch = new DataView(new ArrayBuffer(8));

export class Hasher {
  private a = 0x811c9dc5;
  private b = 0x9e3779b9;

  num(v: number): this {
    scratch.setFloat64(0, v);
    const lo = scratch.getUint32(0);
    const hi = scratch.getUint32(4);
    this.a = (Math.imul(this.a ^ lo, 16777619) + hi) >>> 0;
    this.b = (Math.imul(this.b ^ hi, 2246822519) ^ (this.a >>> 13)) >>> 0;
    return this;
  }

  bool(v: boolean): this {
    return this.num(v ? 1 : 0);
  }

  str(v: string): this {
    this.num(v.length);
    for (let i = 0; i < v.length; i++) this.num(v.charCodeAt(i));
    return this;
  }

  vec3(v: readonly [number, number, number]): this {
    return this.num(v[0]).num(v[1]).num(v[2]);
  }

  get value(): string {
    return `${this.a.toString(36)}.${this.b.toString(36)}`;
  }
}

export function hash(fill: (h: Hasher) => void): string {
  const h = new Hasher();
  fill(h);
  return h.value;
}

/**
 * A one slot memo keyed on a signature string. Returning the previous value
 * unchanged keeps its object identity, which is what stops React and the GPU
 * from redoing work further downstream.
 */
export function memoSlot<T>() {
  let key: string | null = null;
  let value: T;
  return (signature: string, compute: () => T): T => {
    if (key !== signature) {
      key = signature;
      value = compute();
    }
    return value;
  };
}

/** Same, but also hands the previous value to the producer so it can reuse it. */
export function memoSlotReusing<T>() {
  let key: string | null = null;
  let value: T | undefined;
  return (signature: string, compute: (previous: T | undefined) => T): T => {
    if (key !== signature) {
      key = signature;
      value = compute(value);
    }
    return value as T;
  };
}
