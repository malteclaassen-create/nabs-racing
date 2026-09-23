// ---------------------------------------------------------------------------
// Driving tips: the lap comparison's section numbers, turned into sentences.
//
// telemetryAnalysis.js measures, per slow section, who brakes later, who
// carries more speed through the slowest point, who is back on full throttle
// first. It deliberately stops at numbers. This file takes the next step for
// one reader: the driver of the SLOWER lap. For every section where that lap
// loses time it picks the one input that differs most from the quicker lap
// and says it plainly — "you brake 15 m earlier than Neesh" — with a
// suggestion that is nothing more than what the quicker lap did there. It
// never claims to know WHY a lap was slow: a difference in the inputs is what
// it can see, and that is what it reports.
//
// Pure, so it can be tested without a browser.
// ---------------------------------------------------------------------------
import { BRAKE_ON } from "./telemetryAnalysis.js";

// A section has to be worth this much before it earns a tip: below it the
// difference is inside what two laps of the same driver vary by anyway.
export const TIP_MIN_MS = 30;
// How near (in percent of the lap) a slow section's apex has to be to a named
// corner to carry its name.
const NAME_WITHIN_PCT = 4;

const round = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v));
const secs = (ms) => (Math.abs(ms) / 1000).toFixed(2);

// "T4 Roggia", "Roggia", "T4" or null: the admin-named corner nearest to the
// section's apex, when there is one close enough. Round the lap both ways, so
// a corner at 99% names a section at 1%.
export function cornerName(apexPct, corners) {
  let best = null;
  for (const c of corners || []) {
    const d = Math.min(Math.abs(c.at - apexPct), 100 - Math.abs(c.at - apexPct));
    if (d <= NAME_WITHIN_PCT && (!best || d < best.d)) best = { d, c };
  }
  if (!best) return null;
  const { turn, name } = best.c;
  if (turn != null && name) return { label: `T${turn} ${name}`, turn, name };
  if (name) return { label: name, turn: null, name };
  return { label: `T${turn}`, turn, name: "" };
}

// The hardest the pedal went down on the way into the apex.
function peakBrake(lap, from, to) {
  let peak = 0;
  for (let i = Math.max(0, from); i <= to && i < lap.brake.length; i++) peak = Math.max(peak, lap.brake[i]);
  return peak;
}

const KIND_LABEL = { braking: "Braking", entry: "Entry", speed: "Corner speed", exit: "Exit", line: "Line" };

// Everything the Tips panel draws, out of the section insights of one
// comparison (telemetryAnalysis.cornerInsights). null when there is nothing to
// compare. `corners` are the circuit's named corners (lib/trackProfile.js on
// the backend), `dist` the metres along lap A (null for laps recorded before
// positions — the tips then say less, but still work).
export function buildTips(insights, lapA, lapB, { corners = [], dist = null, n } = {}) {
  if (!lapA || !lapB || !insights?.length) return null;
  const size = n || lapA.n || lapA.speed.length;
  const student = lapB.lapTimeMs >= lapA.lapTimeMs ? "B" : "A";
  const me = student === "B" ? lapB : lapA;
  const ref = student === "B" ? lapA : lapB;
  // Every insight is written from B's side (+ = B lost, + = B brakes later …).
  // One sign turns it into the slower lap's side.
  const sign = student === "B" ? 1 : -1;
  const sameDriver = !!me.steamId && me.steamId === ref.steamId;
  const refName = sameDriver ? "your quicker lap" : ref.name || "the quicker lap";
  const metresBefore = (idx, apex) => (idx != null && dist ? round(dist[apex] - dist[idx]) : null);
  const metresAfter = (idx, apex) => (idx != null && dist ? round(dist[idx] - dist[apex]) : null);

  const rows = insights.map((c) => {
    const apexPct = (c.apex / (size - 1)) * 100;
    const named = cornerName(apexPct, corners);
    const lostMs = sign * c.gainMs;
    const minMe = round(student === "B" ? c.minB : c.minA);
    const minRef = round(student === "B" ? c.minA : c.minB);
    const exitMe = round(student === "B" ? c.exitB : c.exitA);
    const exitRef = round(student === "B" ? c.exitA : c.exitB);
    const brakeMe = student === "B" ? c.brakeB : c.brakeA;
    const brakeRef = student === "B" ? c.brakeA : c.brakeB;
    const gasMe = student === "B" ? c.gasB : c.gasA;
    const gasRef = student === "B" ? c.gasA : c.gasB;
    return {
      n: c.n,
      start: c.start,
      end: c.end,
      apex: c.apex,
      apexPct,
      atM: c.atM ?? null,
      place: named?.label || `Section ${c.n}`,
      named: !!named,
      lostMs,
      // + = the slower lap brakes later / is back on the throttle later.
      brakeLaterM: c.brakeDeltaM == null ? null : sign * c.brakeDeltaM,
      throttleLaterM: c.throttleDeltaM == null ? null : sign * c.throttleDeltaM,
      minMe,
      minRef,
      exitMe,
      exitRef,
      brakeAtMe: metresBefore(brakeMe, c.apex),
      brakeAtRef: metresBefore(brakeRef, c.apex),
      gasAtMe: metresAfter(gasMe, c.apex),
      gasAtRef: metresAfter(gasRef, c.apex),
      peakMe: round(peakBrake(me, c.start, c.apex)),
      peakRef: round(peakBrake(ref, c.start, c.apex)),
      // Slice indices, for drawing the section.
      brakeIdxMe: brakeMe ?? null,
      brakeIdxRef: brakeRef ?? null,
    };
  });

  const tips = rows
    .filter((r) => r.lostMs >= TIP_MIN_MS)
    .sort((a, b) => b.lostMs - a.lostMs)
    .map((r) => ({ ...r, ...explain(r, refName) }));
  const strengths = rows
    .filter((r) => r.lostMs <= -TIP_MIN_MS)
    .sort((a, b) => a.lostMs - b.lostMs)
    .map((r) => ({ ...r, ...praise(r, refName) }));

  const gapMs = me.lapTimeMs - ref.lapTimeMs;
  const inSections = rows.reduce((s, r) => s + r.lostMs, 0);
  const top3Ms = tips.slice(0, 3).reduce((s, t) => s + t.lostMs, 0);

  // One habit behind several of the biggest losses is worth one sentence of
  // its own: "most of it is braking" says more than three separate cards.
  let pattern = null;
  const lostInTips = tips.reduce((s, t) => s + t.lostMs, 0);
  const byKind = new Map();
  for (const t of tips) {
    if (!byKind.has(t.kind)) byKind.set(t.kind, { ms: 0, count: 0, places: [] });
    const k = byKind.get(t.kind);
    k.ms += t.lostMs;
    k.count += 1;
    k.places.push(t.place);
  }
  for (const [kind, k] of byKind) {
    if (kind !== "line" && k.count >= 2 && lostInTips > 0 && k.ms / lostInTips >= 0.5 && (!pattern || k.ms > pattern.ms)) {
      pattern = { kind, label: KIND_LABEL[kind], ...k };
    }
  }

  return {
    student,
    studentName: me.name || (student === "A" ? "Lap A" : "Lap B"),
    refName,
    sameDriver,
    gapMs,
    top3Ms,
    // What the slow sections do not account for: the straights, and the
    // stretches between one section's window and the next.
    restMs: gapMs - inSections,
    namedCorners: (corners || []).length > 0,
    rows,
    tips,
    strengths,
    pattern,
  };
}

// The biggest difference in the inputs, in words, for a section the slower
// lap loses time in. `say` marks the numbers with **…** for the page to set
// in bold; `try` is what the quicker lap did, as a suggestion.
export function explain(r, refName) {
  const early = r.brakeLaterM != null && r.brakeLaterM <= -5 ? -r.brakeLaterM : 0;
  const late = r.brakeLaterM != null && r.brakeLaterM >= 5 ? r.brakeLaterM : 0;
  const midLoss = r.minMe != null && r.minRef != null ? r.minRef - r.minMe : 0;
  const exitLoss = r.exitMe != null && r.exitRef != null ? r.exitRef - r.exitMe : 0;
  const throttleLate = r.throttleLaterM != null && r.throttleLaterM >= 8 ? r.throttleLaterM : 0;
  const softer = r.peakRef >= 50 && r.peakRef - r.peakMe >= 12;

  const weights = {
    braking: early / 5,
    entry: late && midLoss >= 3 ? 1.2 * ((late / 5 + midLoss / 3) / 2) : 0,
    speed: midLoss >= 3 ? midLoss / 3 : 0,
    exit: Math.max(throttleLate / 8, exitLoss >= 3 ? (exitLoss / 4) * 0.8 : 0),
  };
  let kind = "line";
  let top = 0.99;
  for (const [k, w] of Object.entries(weights)) if (w > top) { kind = k; top = w; }

  const mid = r.minMe != null && r.minRef != null ? ` (${r.minMe} vs ${r.minRef} km/h)` : "";
  const exitNote = exitLoss >= 3 ? `, and you leave the corner **${exitLoss} km/h slower**` : "";
  let say;
  let tryText;
  if (kind === "braking") {
    say = `You brake **${early} m earlier** than ${refName}`
      + (midLoss >= 3 ? ` and still carry **${midLoss} km/h less** through the slowest point${mid}.` : ".");
    tryText = `Brake later: ${refName} starts braking ${early} m after you do`
      + (softer ? `, and presses the pedal harder at first (peak ${r.peakRef}% against your ${r.peakMe}%).` : ".");
  } else if (kind === "entry") {
    say = `You brake **${late} m later** than ${refName}, but the corner is **${midLoss} km/h slower** at its slowest point${mid}. The late braking does not pay off here.`;
    tryText = `Brake a touch earlier and come off the brake more gently, so the car rolls more speed to the apex, as ${refName} does.`;
  } else if (kind === "speed") {
    // Only speak about the braking when it was measured: a lap recorded
    // before positions has no brake point in metres to compare.
    const lead = r.brakeLaterM == null ? "You are" : `Braking is ${early || late ? "close" : "about the same"}, but you are`;
    say = `${lead} **${midLoss} km/h slower** at the slowest point of the corner${mid}${exitNote}.`;
    tryText = `Release the brake earlier and let the car carry more speed into the corner: ${refName} keeps ${midLoss} km/h more through it.`;
  } else if (kind === "exit") {
    if (throttleLate) {
      say = `Your speed through the corner is ${midLoss >= 3 ? `${midLoss} km/h down` : "fine"}, but you are back on **full throttle ${throttleLate} m later**${exitNote}. That costs you all the way down the next straight.`;
      tryText = `Get the car straight sooner so you can go to full throttle earlier: ${refName} is flat out ${throttleLate} m before you.`;
    } else {
      say = `You leave the corner **${exitLoss} km/h slower** than ${refName}, and that speed is missing all the way down the next straight.`;
      tryText = `Give up a little entry speed for a better exit: a later apex lets you go to full throttle earlier.`;
    }
  } else {
    say = `You lose time here, but none of braking point, corner speed or throttle differs by much. The difference is most likely in the line.`;
    tryText = `Open the replay zoomed in on this corner and compare the two lines: where ${refName} turns in and how close they get to the apex.`;
  }

  const facts = [];
  if (r.brakeAtMe != null && r.brakeAtRef != null) facts.push({ label: "Brakes before apex", me: `${r.brakeAtMe} m`, ref: `${r.brakeAtRef} m` });
  else if (r.brakeLaterM != null && Math.abs(r.brakeLaterM) >= 3) facts.push({ label: "Brake point", me: `${Math.abs(r.brakeLaterM)} m ${r.brakeLaterM < 0 ? "earlier" : "later"}`, ref: null });
  if (r.minMe != null && r.minRef != null) facts.push({ label: "Min speed", me: `${r.minMe} km/h`, ref: `${r.minRef} km/h` });
  if (kind === "exit" && r.gasAtMe != null && r.gasAtRef != null) facts.push({ label: "Full throttle after apex", me: `${r.gasAtMe} m`, ref: `${r.gasAtRef} m` });
  else if (r.exitMe != null && r.exitRef != null) facts.push({ label: "Exit speed", me: `${r.exitMe} km/h`, ref: `${r.exitRef} km/h` });
  if (kind === "braking" && r.peakMe >= BRAKE_ON && r.peakRef >= BRAKE_ON) facts.push({ label: "Peak brake", me: `${r.peakMe}%`, ref: `${r.peakRef}%` });

  return { kind, kindLabel: KIND_LABEL[kind], say, try: tryText, facts: facts.slice(0, 3) };
}

// A section the slower lap is QUICKER in: worth saying, briefly, with the one
// input that made it.
export function praise(r, refName) {
  let why = "";
  if (r.brakeLaterM != null && r.brakeLaterM >= 5) why = `you brake ${r.brakeLaterM} m later`;
  else if (r.minMe != null && r.minRef != null && r.minMe - r.minRef >= 3) why = `you carry ${r.minMe - r.minRef} km/h more through the apex`;
  else if (r.throttleLaterM != null && r.throttleLaterM <= -8) why = `you are on full throttle ${-r.throttleLaterM} m sooner`;
  else if (r.exitMe != null && r.exitRef != null && r.exitMe - r.exitRef >= 3) why = `you leave it ${r.exitMe - r.exitRef} km/h faster`;
  return {
    kind: "strength",
    kindLabel: "Your strength",
    say: `You gain ${secs(r.lostMs)} s on ${refName} here${why ? `: ${why}` : ""}. Keep it.`,
  };
}
