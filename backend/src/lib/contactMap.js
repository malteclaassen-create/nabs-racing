// ---------------------------------------------------------------------------
// Where the contacts of a race happened, drawn on the circuit.
//
// The race recap already lists a driver's contacts (lap, the other car, how
// hard). The result file says more than that: every event carries the world
// position it happened at, and the circuit's AI line (lib/trackMaps.js) is in
// the same coordinates. Put the two together and the list becomes a map: the
// driver's own contacts and wall hits numbered on the track, and the rest of
// the field's contacts as plain dots, so "lap 1, T1" sits beside where
// everyone else came together tonight.
//
// The field is shown without names on purpose. It is the same stance as the
// admin's incident watch (lib/incidentWatch.js): the car that was hit records
// the same contact as the car that hit it, so a contact is not a verdict, and
// a public "who touched whom" list would read as one. A driver sees their own
// contacts with the other car named, which the recap already did; everybody
// else is a dot.
//
// Corner names come from the circuit's corner list (lib/trackProfile.js), the
// same one the lap comparison's tips use: a position on the AI line is a
// share of the lap, and that is what the list is measured in.
// ---------------------------------------------------------------------------
import { contactSceneForRound } from "./raceContacts.js";
import { liveCentreLine, readTrackRoad } from "./trackMaps.js";
import { readTrackInfo } from "./trackInfo.js";
import { effectiveCorners } from "./trackProfile.js";
import { groupKeyFor, trackKeyFor } from "./trackKeys.js";
import { CONTACT_DEFAULTS } from "../services/telemetryExtractor.js";

// How long the recap waits for a circuit's line the first time it is asked
// for. The line is fetched from the league's servers once and then kept on
// disk; a track nobody serves any more can take a while to give up on, and
// the recap should not hang on it. The fetch carries on in the background and
// the next visitor gets the map.
const LINE_WAIT_MS = 3500;

// A contact this far from the line is not on the circuit (a file with odd
// coordinates, a car in the pit building). Kept in the list, left off the map.
const MAX_OFF_LINE_M = 60;

// The line as something a point can be measured along: the cumulative
// distance at every point, and the length of the whole lap (the line is a
// loop, so the last point joins the first).
export function lapGeometry(line) {
  if (!Array.isArray(line) || line.length < 3) return null;
  const cum = new Array(line.length);
  let s = 0;
  cum[0] = 0;
  for (let i = 1; i < line.length; i++) {
    s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    cum[i] = s;
  }
  const close = Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]);
  const total = s + close;
  return total > 0 ? { line, cum, total } : null;
}

// The point on the line nearest to [x, z]: how far round the lap it is
// (metres from the start line) and how far off the line the point sits.
export function projectOnLine(geom, pos) {
  if (!geom || !pos) return null;
  const [px, pz] = pos;
  const { line, cum } = geom;
  const n = line.length;
  let best = null;
  for (let i = 0; i < n; i++) {
    const a = line[i];
    const b = line[(i + 1) % n];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2)) : 0;
    const qx = a[0] + dx * t;
    const qz = a[1] + dz * t;
    const d = Math.hypot(px - qx, pz - qz);
    if (!best || d < best.d) best = { d, s: cum[i] + Math.sqrt(len2) * t };
  }
  return best;
}

// A corner's name as the site writes it everywhere else: "T4 Roggia", "T7",
// or a name alone where the list gives no number.
export function cornerText(c) {
  if (!c) return null;
  const turn = Number.isInteger(c.turn) ? `T${c.turn}` : "";
  const name = String(c.name || "").trim();
  return [turn, name].filter(Boolean).join(" ") || null;
}

// The corner a point at `s` metres round a lap of `total` metres belongs to,
// or null on a straight. Contact happens on the way into a corner far more
// than on the way out (the braking zone is where cars meet), so the corner
// ahead is looked for further than the one just behind.
const AHEAD_M = 260;
const BEHIND_M = 130;
function cornerFor(corners, s, total) {
  if (!Array.isArray(corners) || !corners.length || !(total > 0) || !Number.isFinite(s)) return null;
  let best = null;
  for (const c of corners) {
    const at = (Number(c?.at) / 100) * total;
    if (!Number.isFinite(at)) continue;
    // Signed distance from the point to the corner, round the shorter way:
    // positive = the corner is still ahead.
    let ahead = at - s;
    if (ahead > total / 2) ahead -= total;
    if (ahead < -total / 2) ahead += total;
    let cost;
    if (ahead >= 0) {
      if (ahead > AHEAD_M) continue;
      cost = ahead;
    } else {
      if (-ahead > BEHIND_M) continue;
      cost = -ahead * (AHEAD_M / BEHIND_M);
    }
    if (!best || cost < best.cost) best = { c, cost };
  }
  return best && cornerText(best.c) ? best.c : null;
}
export function cornerAt(corners, s, total) {
  return cornerText(cornerFor(corners, s, total));
}

// The point `s` metres round the lap, on the line.
export function pointAt(geom, s) {
  const { line, cum, total } = geom;
  const at = ((s % total) + total) % total;
  let i = 1;
  while (i < line.length && cum[i] < at) i++;
  const a = line[i - 1];
  const b = i < line.length ? line[i] : line[0];
  const from = cum[i - 1];
  const to = i < line.length ? cum[i] : total;
  const t = to > from ? (at - from) / (to - from) : 0;
  return [Math.round((a[0] + (b[0] - a[0]) * t) * 10) / 10, Math.round((a[1] + (b[1] - a[1]) * t) * 10) / 10];
}

// What a corner is called on the map itself, where there is room for little:
// its number, or a short name where it has none.
const shortCorner = (c) => (Number.isInteger(c?.turn) ? `T${c.turn}` : String(c?.name || "").trim().slice(0, 14) || null);

// How many corners the whole-field tally lists.
const TALLY_MAX = 5;

// The map of one race for one driver, from the round's events (raceContacts
// contactSceneForRound), the circuit's line and its corners. Pure: everything
// it needs is handed in.
//
//   line     [[x, z], ...] world metres, starting at the start line.
//   field    [[x, z, kph], ...] every other car-to-car contact of the race
//            from the counted impact speed up (the same floor as the
//            published contact figures), the pace car's left out.
//   mine     the driver's own contacts and wall hits, oldest first, numbered
//            as the map numbers them. `other` is the other car's Steam id and
//            name for the caller to turn into a league name; it never goes
//            out to a browser as it is.
//   byCorner the whole field's contacts by corner, most first (up to five).
//   busiest  the first of those, when two or more happened there.
//   labels   corner names to write on the map: the corners above and the
//            ones the driver's own contacts were at.
export function buildContactMap({ scene, guid, line, corners = [] }) {
  const geom = lapGeometry(line);
  if (!scene || !geom) return null;
  const me = guid ? String(guid) : null;
  const pace = scene.paceCars || new Set();
  const floor = CONTACT_DEFAULTS.impactThreshold;

  const place = (pos) => {
    if (!pos) return { pos: null, corner: null, c: null };
    const p = projectOnLine(geom, pos);
    if (!p || p.d > MAX_OFF_LINE_M) return { pos: null, corner: null, c: null };
    const c = cornerFor(corners, p.s, geom.total);
    return { pos, corner: cornerText(c), c };
  };

  const field = [];
  const counted = []; // every counted contact of the night, by the corner it was at (or null)
  const mine = [];
  for (const c of scene.contacts || []) {
    const isMine = me && (c.a.guid === me || c.b.guid === me);
    // The pace car is not part of the race: off the field's map and out of
    // the tally. A driver who touched it still sees that in their own list.
    const paceCar = pace.has(c.a.guid) || pace.has(c.b.guid);
    if (paceCar && !isMine) continue;
    const at = place(c.pos);
    if (isMine) {
      const other = c.a.guid === me ? c.b : c.a;
      const lap = (c.a.guid === me ? c.a.lap : c.b.lap) ?? c.lap ?? null;
      // Light taps stay in the driver's own list, as they always have in the
      // recap: it is their race and they may well remember that one.
      // `counted`: at or over the impact speed the stored contact figures count
      // from. A lighter tap stays in the list, marked as such, so the recap's
      // count and the season's figures agree.
      mine.push({ kind: "car", at: c.at, lap, kph: c.kph ?? null, counted: (c.kph ?? 0) >= floor && !paceCar, pos: at.pos, corner: at.corner, other: { guid: other.guid, name: other.name }, c: at.c });
      if ((c.kph ?? 0) >= floor && !paceCar) counted.push(at.c);
      continue;
    }
    if ((c.kph ?? 0) < floor) continue;
    counted.push(at.c);
    if (at.pos) field.push([at.pos[0], at.pos[1], c.kph ?? 0]);
  }
  if (me) {
    for (const w of scene.walls || []) {
      if (w.guid !== me) continue;
      const at = place(w.pos);
      mine.push({ kind: "wall", at: w.at, lap: w.lap ?? null, kph: w.kph ?? null, counted: true, pos: at.pos, corner: at.corner, other: null, c: at.c });
    }
  }
  mine.sort((x, y) => x.at - y.at);
  mine.forEach((m, i) => {
    m.n = i + 1;
  });

  // A file that carries no positions at all draws an empty circuit, which
  // says nothing; the recap keeps its plain list then.
  const anyPlaced = field.length > 0 || mine.some((m) => m.pos);
  const anyContact = counted.length > 0 || mine.length > 0;
  if (anyContact && !anyPlaced) return null;

  // The whole field's contacts by corner, most first (round the lap where two
  // are level), and where each of those corners sits for its label on the
  // map. The corners of the driver's own contacts are labelled too.
  const tally = new Map();
  for (const c of counted) if (c) tally.set(c, (tally.get(c) || 0) + 1);
  const byCorner = [...tally]
    .sort((x, y) => y[1] - x[1] || x[0].at - y[0].at)
    .slice(0, TALLY_MAX)
    .map(([c, count]) => ({ corner: cornerText(c), count }));
  const busiest = byCorner[0] && byCorner[0].count >= 2 ? byCorner[0] : null;
  const labelled = new Set([...tally.keys()].filter((c) => byCorner.some((b) => b.corner === cornerText(c))));
  for (const m of mine) if (m.c && m.pos) labelled.add(m.c);
  const labels = [...labelled]
    .map((c) => ({ text: shortCorner(c), pos: pointAt(geom, (Number(c.at) / 100) * geom.total) }))
    .filter((l) => l.text);
  for (const m of mine) delete m.c;

  // Contacts away from any named corner (a straight, or a circuit with no
  // corner list), so the table under the list adds up to the total.
  const elsewhere = counted.filter((c) => !c).length;
  return { line: geom.line, lapM: Math.round(geom.total), field, mine, busiest, byCorner, elsewhere, labels, fieldCount: counted.length };
}

// The middle of the road's two edges (kept on disk by the lap comparison):
// the same points in the same order as the line, so as good as the line.
function lineFromRoad(track) {
  const road = readTrackRoad(track.name, track.layout || "");
  const l = road?.track?.left;
  const r = road?.track?.right;
  if (!Array.isArray(l) || !Array.isArray(r) || l.length !== r.length || l.length < 3) return null;
  return l.map((p, i) => [Math.round(((p[0] + r[i][0]) / 2) * 10) / 10, Math.round(((p[1] + r[i][1]) / 2) * 10) / 10]);
}

// The circuit's line: from memory or disk when it is there (the live page
// keeps it), else from the league's servers, waiting only so long. With the
// road's edges on disk there is no need to wait at all. One wait per circuit
// however many maps ask at once: a sprint weekend's two races, two members
// opening their recap together.
const waits = new Map(); // "track|layout" -> Promise<line | null>
function lineFor(track) {
  if (!track?.name) return Promise.resolve(null);
  const key = `${track.name}|${track.layout || ""}`;
  const pending = waits.get(key);
  if (pending) return pending;
  const job = liveCentreLine(track.name, track.layout || "").catch(() => null);
  const road = lineFromRoad(track);
  const wait = road ? 250 : LINE_WAIT_MS;
  const p = Promise.race([job, new Promise((ok) => setTimeout(() => ok(null), wait))]).then((line) => line || road || null);
  waits.set(key, p);
  // Forgotten a minute later: by then the line is in memory or on disk, or
  // the miss is remembered by lib/trackMaps.js.
  p.finally(() => setTimeout(() => waits.delete(key), 60_000).unref?.());
  return p;
}

// The corner names the site knows for this circuit and layout.
async function cornersFor(prisma, track) {
  try {
    const key = groupKeyFor(track.name);
    const info = await readTrackInfo(prisma, key);
    const known = trackKeyFor(track.name) ? key : null;
    return effectiveCorners(info, known, track.layout || "").corners || [];
  } catch {
    return [];
  }
}

// The map for one driver in one race, or null when the round has no archived
// file, the file names no circuit, or the circuit's line cannot be had.
// `race` carries season and number the way the recap files it (a sprint is
// asked for under its round's number with `sprint`).
export async function contactMapForRace(prisma, race, { steamId, sprint = false } = {}) {
  const scene = contactSceneForRound(race.season, race.number, sprint);
  if (!scene?.track) return null;
  const [line, corners] = await Promise.all([lineFor(scene.track), cornersFor(prisma, scene.track)]);
  if (!line) return null;
  return buildContactMap({ scene, guid: steamId, line, corners });
}
