/**
 * Which AC physics surface a mesh is, read off its name.
 *
 * On its own, with no imports, so anything that reads a track folder can use
 * it: the editor (src/ac/acScene.ts) and the website's 3D lap view
 * (frontend/src/utils/acTrackScene.js), which has no reason to pull in the
 * editor's scene code.
 */

/**
 * The surface a mesh belongs to, from its name.
 *
 * AC's rule: strip the LEADING DIGITS -- a priority number of any length --
 * then match a surfaces.ini KEY as a case-insensitive PREFIX of what is left.
 * No separator required, and the author may put whatever they like after it.
 *
 * Every clause of that cost a wrong version first, and each one was found by
 * measuring against the installed content rather than by reading a spec:
 *
 *   Key + underscore + capitals -- the way this editor writes its OWN tracks
 *   -- classified exactly ZERO meshes on the first real circuit tried. That
 *   track's road is `1road_astro`, its kerbs `1kerb04`, its gravel `1sand`.
 *
 *   ONE leading digit then classified zero meshes on all three Kunos tracks
 *   checked next, because Kunos number their priorities to two digits:
 *   `01KERB0051`, `22TARMSIL_A_007`, `15PIT-SILV`.
 *
 *   A separator may sit BETWEEN the priority and the key: `1_roada`,
 *   `1_curba`, `1_pitlane` on a circuit whose surfaces.ini declares exactly
 *   ROADA, CURBA and PITLANE.
 *
 *   And the key itself may CONTAIN the digit: one mod declares `KEY=1ROAD` and
 *   `KEY=1TRACK` in one layout and plain `KEY=ROAD` in another layout of the
 *   same track.
 *
 * Longest key wins, which matters more than it sounds: Silverstone's
 * surfaces.ini defines KERB, KURB and CURB, and TARMSIL_A_ alongside
 * TARMSIL_B_.
 *
 * Measured over the installed content after all four: 90 of 98 tracks find
 * their road and 81 find their kerbs. Of the rest, three have a main model too
 * large to open, and the others are a drag strip, a drift map and two hill
 * climbs -- none of which have kerbs to find.
 */
export function surfaceOfMesh(name: string, keys: readonly string[]): string | null {
  let at = 0;
  while (at < name.length && name[at] >= '0' && name[at] <= '9') at += 1;
  // No priority digits at all means it is not in the physics namespace.
  if (at === 0 || at >= name.length) return null;

  const stripped = name.slice(at).toLowerCase();
  // The priority is sometimes separated from the key: `1_roada`, `1_curba`,
  // `1_pitlane` on one installed circuit, whose surfaces.ini declares exactly
  // ROADA, CURBA and PITLANE. Without allowing for the underscore that track
  // classifies nothing at all.
  const afterSeparator = /^[_\-. ]/.test(stripped) ? stripped.slice(1) : null;
  // And some authors put the priority digit INSIDE the key: one installed mod
  // has `KEY=1ROAD` and `KEY=1TRACK` in one layout's surfaces.ini and plain
  // `KEY=ROAD` in another layout of the same track.
  const whole = name.toLowerCase();

  let best: string | null = null;
  for (const key of keys) {
    if (key.length === 0) continue;
    const lower = key.toLowerCase();
    const hit = stripped.startsWith(lower)
      || whole.startsWith(lower)
      || (afterSeparator !== null && afterSeparator.startsWith(lower));
    if (!hit) continue;
    if (!best || key.length > best.length) best = key;
  }
  if (best) return best;

  // WALL is AC's own, and is not declared in surfaces.ini -- a track can have
  // `03WALL02` colliders with no WALL entry anywhere, and one installed track
  // does exactly that.
  return stripped.startsWith('wall') || (afterSeparator?.startsWith('wall') ?? false) ? 'WALL' : null;
}

/**
 * Fallback for a track with no surfaces.ini, where there are no keys to match
 * against. These are AC's standard ones.
 */
export const STANDARD_SURFACE_KEYS: readonly string[] = [
  'PITLANE', 'ROAD', 'CURB', 'KERB', 'GRASS', 'SAND', 'DIRT', 'CONCRETE', 'ASPHALT', 'WALL', 'OLD',
];
