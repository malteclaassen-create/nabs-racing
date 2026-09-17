import test from 'node:test';
import assert from 'node:assert/strict';

// A localStorage that behaves like the browser's: strings in, strings out, and
// able to refuse a write (private mode).
function fakeStorage({ refuseWrites = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (refuseWrites) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
  };
}

// The module keeps a per-session memory of its own, so each case gets a fresh
// copy of it alongside a fresh storage.
async function fresh(storage) {
  globalThis.localStorage = storage;
  return import(`../src/utils/pointsSeen.js?${Math.random()}`);
}

const KEY = 'nabs_points_seen_v1';
const stored = (s) => JSON.parse(s.getItem(KEY) || '{}');

test('a first sight announces nothing, but is remembered', async () => {
  const s = fakeStorage();
  const { decideGain } = await fresh(s);
  assert.deepEqual(decideGain('laluch_s5', 209), { from: null, gain: 0, played: false });
  assert.equal(stored(s).laluch_s5.p, 209);
});

test('a total that has risen since the last visit is the gain', async () => {
  const s = fakeStorage();
  s.setItem(KEY, JSON.stringify({ laluch_s5: { p: 209, t: 1 } }));
  const { decideGain } = await fresh(s);
  const d = decideGain('laluch_s5', 234);
  assert.equal(d.gain, 25);
  assert.equal(d.from, 209, 'the climb starts at the number they remember');
  assert.equal(stored(s).laluch_s5.p, 234, 'and the new one is what they have now seen');
});

test('the same total twice says nothing the second time', async () => {
  const s = fakeStorage();
  s.setItem(KEY, JSON.stringify({ laluch_s5: { p: 234, t: 1 } }));
  const { decideGain } = await fresh(s);
  assert.equal(decideGain('laluch_s5', 234).gain, 0);
});

test('a total that has FALLEN is not a negative gain — it just resets the memory', async () => {
  const s = fakeStorage();
  s.setItem(KEY, JSON.stringify({ laluch_s5: { p: 234, t: 1 } }));
  const { decideGain } = await fresh(s);
  assert.deepEqual(decideGain('laluch_s5', 229), { from: null, gain: 0, played: false });
  assert.equal(stored(s).laluch_s5.p, 229);
});

test('one verdict per row per page session, however many copies of the number ask', async () => {
  // The profile scoreboard renders a desktop column AND a phone box; both read
  // the same row and must not talk each other out of the gain.
  const s = fakeStorage();
  s.setItem(KEY, JSON.stringify({ laluch_s5: { p: 209, t: 1 } }));
  const { decideGain, markGainPlayed } = await fresh(s);
  const first = decideGain('laluch_s5', 234);
  const second = decideGain('laluch_s5', 234);
  assert.equal(second, first, 'the second copy gets the very same verdict object');
  assert.equal(second.gain, 25);
  // Once it has played, a later mount in the same visit stays quiet.
  markGainPlayed('laluch_s5');
  assert.equal(decideGain('laluch_s5', 234).played, true);
});

test('seasons and leagues do not bleed into each other', async () => {
  const s = fakeStorage();
  s.setItem(KEY, JSON.stringify({ laluch_s4: { p: 300, t: 1 } }));
  const { decideGain } = await fresh(s);
  assert.equal(decideGain('laluch_s5', 234).gain, 0, 'another season of the same person is another row');
});

test('the store is capped, oldest first', async () => {
  const s = fakeStorage();
  const seed = {};
  for (let i = 0; i < 140; i++) seed[`row_${i}`] = { p: i, t: i + 1 };
  s.setItem(KEY, JSON.stringify(seed));
  const { decideGain, MAX_ENTRIES } = await fresh(s);
  decideGain('row_new', 10);
  const after = stored(s);
  assert.equal(Object.keys(after).length, MAX_ENTRIES);
  assert.ok(after.row_new, 'the row just seen survives');
  assert.ok(after.row_139, 'so does the most recent of the old ones');
  assert.ok(!after.row_0, 'the least recently seen is the one that goes');
});

test('unreadable storage is a first visit, not a crash', async () => {
  const s = fakeStorage();
  s.setItem(KEY, 'not json at all');
  const { decideGain } = await fresh(s);
  assert.equal(decideGain('laluch_s5', 234).gain, 0);
  assert.equal(stored(s).laluch_s5.p, 234);
});

test('an array where an object belongs is ignored', async () => {
  const s = fakeStorage();
  s.setItem(KEY, '[1,2,3]');
  const { decideGain } = await fresh(s);
  assert.equal(decideGain('laluch_s5', 234).gain, 0);
});

test('storage that refuses writes still answers, it just forgets', async () => {
  const s = fakeStorage();
  s.map.set(KEY, JSON.stringify({ laluch_s5: { p: 209, t: 1 } }));
  const refusing = { ...s, setItem: () => { throw new Error('private mode'); } };
  const { decideGain } = await fresh(refusing);
  assert.equal(decideGain('laluch_s5', 234).gain, 25);
});
