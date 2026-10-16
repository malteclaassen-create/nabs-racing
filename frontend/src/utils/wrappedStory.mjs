// ---------------------------------------------------------------------------
// Season Wrapped as a story: which slides a driver's season gets, in what
// order, and what each one says. The player is components/WrappedStory.jsx;
// the numbers come from GET /api/wrapped/driver/:key (backend
// services/seasonWrappedService.js), the same ones the card page shows.
//
// Pure on purpose (no React, no DOM), so the wording can be tested: a slide
// whose data the season does not have is not there, the same rule the card
// page follows. Only a finished season has a Wrapped (the API answers "not
// over yet" for the one being raced), so the story always tells an ending.
//
// The story talks TO the driver when the viewer is that driver ("You lined
// up...") and ABOUT them otherwise ("Siggsta lined up..."), which is why most
// lines are in the past tense: the verb is the same either way.
// ---------------------------------------------------------------------------

// Each slide's colours. Text is always `ink` (or ink at 85%, which still clears
// 4.5:1 on every background here); the team colour is never a background,
// because it can be any colour an admin picked.
export const STORY_THEMES = {
  night: { bg: "#0B0A12", ink: "#FFFFFF", accent: "#F472B6" },
  pink: { bg: "#F4AFC6", ink: "#1A0A12", accent: "#1A0A12" },
  navy: { bg: "#0D1B2A", ink: "#FFFFFF", accent: "#FFD166" },
  green: { bg: "#0E3B2E", ink: "#FFFFFF", accent: "#7CFFB2" },
  gold: { bg: "#FFC83D", ink: "#1F1400", accent: "#1F1400" },
  purple: { bg: "#24124A", ink: "#FFFFFF", accent: "#C4B5FD" },
  red: { bg: "#B5122B", ink: "#FFFFFF", accent: "#FFE3E8" },
  ocean: { bg: "#06263A", ink: "#FFFFFF", accent: "#5CE1E6" },
  black: { bg: "#050507", ink: "#FFFFFF", accent: "#F472B6" },
  plum: { bg: "#3B0A45", ink: "#FFFFFF", accent: "#FFC83D" },
  lime: { bg: "#C6F432", ink: "#0B0F00", accent: "#0B0F00" },
};

// How long a slide stays before the story moves on by itself, in ms. The
// summary waits for the viewer: it is the one with buttons on it.
export const STORY_DURATIONS = {
  intro: 6500,
  numbers: 7500,
  best: 8000,
  climb: 8500,
  wins: 7000,
  teammate: 7500,
  rival: 7000,
  journey: 9500,
  final: 8000,
  honours: 7000,
  type: 7000,
  summary: null,
};

// The paint for the driver's car and the story's accents when the driver has
// no team (a reserve) or the team no colour.
export const FALLBACK_PAINT = "#EC4899";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// A team colour as #rrggbb, or null. The story appends alpha to it ("#rrggbb"
// + "99") for glows, which only works on the six-digit form.
export function hexColor(c) {
  const s = String(c || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${[...s.slice(1)].map((x) => x + x).join("")}`.toUpperCase();
  return null;
}

// "You" / "Siggsta", "Your" / "Siggsta's".
export function voiceFor(name, mine) {
  return mine
    ? { mine: true, S: "You", s: "you", Poss: "Your", poss: "your" }
    : { mine: false, S: name, s: name, Poss: `${name}'s`, poss: `${name}'s` };
}

// The six numbers on the summary card, most telling first. Points and starts
// always; the rest only where there is something to show, so a quiet season
// fills its grid with finishes and best results instead of a row of zeros.
export function summaryStats(data) {
  const s = data.stats || {};
  const c = data.championship || {};
  const out = [{ key: "points", label: "Points", value: c.points ?? 0 }];
  const add = (key, label, value, prefix = "") => {
    if (out.length < 6 && value != null && value > 0) out.push({ key, label, value, prefix });
  };
  add("wins", s.wins === 1 ? "Win" : "Wins", s.wins);
  add("podiums", s.podiums === 1 ? "Podium" : "Podiums", s.podiums);
  add("poles", s.poles === 1 ? "Pole" : "Poles", s.poles);
  add("fastestLaps", s.fastestLaps === 1 ? "Fastest lap" : "Fastest laps", s.fastestLaps);
  add("best", "Best finish", s.bestFinish, "P");
  add("gained", "Places gained", s.positionsGained);
  add("top10", "Top tens", s.top10);
  add("finishes", s.finishes === 1 ? "Finish" : "Finishes", s.finishes);
  // Starts go last, but always make it onto the card.
  if (out.length === 6) out.pop();
  out.push({ key: "starts", label: s.starts === 1 ? "Start" : "Starts", value: s.starts || 0, prefix: "" });
  return out;
}

// The slides, in order. `fmtTrack` turns a stored track name into the one
// people say ("monza" -> "Monza"); the player passes the site's prettyTrack.
export function buildStory(data, { mine = false, fmtTrack = (t) => t } = {}) {
  if (!data || data.empty || !data.driver || !data.season) return [];
  const { driver, season, championship: c = {}, stats: st = {} } = data;
  const v = voiceFor(driver.name, mine);
  const paint = hexColor(driver.team?.color) || FALLBACK_PAINT;
  const where = (r) => [fmtTrack(r.track || ""), r.round != null ? `Round ${r.round}` : null, r.sprint ? "Sprint" : null].filter(Boolean).join(" · ");
  const slides = [];
  const push = (key, theme, body) =>
    slides.push({ key, kind: key, theme, colors: STORY_THEMES[theme], duration: STORY_DURATIONS[key], ...body });

  // 1. Who and when.
  push("intro", "night", {
    eyebrow: `${season.label} Wrapped`,
    title: mine ? `Your ${season.label}, wrapped.` : `${driver.name}'s ${season.label}, wrapped.`,
    sub: `${plural(season.roundsRun || season.totalRounds || 0, "round")}, every result: the whole season in a few taps.`,
    scene: { kind: "intro", paint, number: driver.number ?? null },
  });

  // 2. The season in numbers: starts, finishes, points.
  const starts = st.starts || 0;
  const finishes = st.finishes || 0;
  push("numbers", "pink", {
    eyebrow: "The season in numbers",
    lead: `${v.S} lined up on the grid`,
    count: starts,
    unit: starts === 1 ? "time." : "times.",
    then:
      finishes === starts
        ? starts === 1
          ? "And saw the chequered flag."
          : "And saw the chequered flag every single time."
        : finishes === 0
          ? "The chequered flag? Not this time."
          : `And took the chequered flag ${plural(finishes, "time")}.`,
    points: c.points ?? 0,
    pointsLine: `${plural(c.points ?? 0, "point")} in the end.`,
  });

  // 3. The best night.
  if (data.best) {
    const b = data.best;
    push("best", "navy", {
      eyebrow: "Best result",
      title: b.position === 1 ? "The night it all came together" : b.position <= 3 ? "Up on the podium" : "The best night of the season",
      big: `P${b.position}`,
      medal: b.position <= 3 ? b.position : null,
      place: where(b),
      sub: [b.grid ? `Started P${b.grid}` : null, b.points ? plural(b.points, "point") : null].filter(Boolean).join(" · ") || null,
      scene: { kind: "circuit", paint, track: b.track || "", position: b.position },
    });
  }

  // 4. The biggest climb from the grid.
  if (data.climb) {
    const k = data.climb;
    push("climb", "green", {
      eyebrow: "Biggest climb",
      title: `Started P${k.grid}. Finished P${k.position}.`,
      big: `+${k.gained}`,
      unit: k.gained === 1 ? "place" : "places",
      place: where(k),
      scene: { kind: "climb", paint, from: k.grid, to: k.position },
    });
  }

  // 5. The wins, or failing those the podiums.
  const wins = data.wins || [];
  if (wins.length) {
    push("wins", "gold", {
      eyebrow: wins.length === 1 ? "The win" : "Winner",
      title: wins.length === 1 ? "One race. Nobody ahead." : `${wins.length} times, nobody ahead.`,
      big: String(wins.length),
      unit: wins.length === 1 ? "win" : "wins",
      list: wins.map((w) => where(w)),
      sub: st.podiums > wins.length ? `${plural(st.podiums, "podium")} in all` : null,
      scene: { kind: "trophies", paint, tones: wins.slice(0, 6).map(() => "gold") },
    });
  } else if (st.podiums > 0) {
    push("wins", "gold", {
      eyebrow: "Podiums",
      title: st.podiums === 1 ? "Up on the box once." : `Up on the box ${st.podiums} times.`,
      big: String(st.podiums),
      unit: st.podiums === 1 ? "podium" : "podiums",
      list: [],
      sub: data.best?.position ? `Best of them: P${data.best.position} at ${fmtTrack(data.best.track || "")}` : null,
      // The best of them leads in its own metal; with a third the best, every
      // one of them was a third.
      scene: {
        kind: "trophies",
        paint,
        tones: Array.from({ length: Math.min(6, st.podiums) }, (_, i) =>
          data.best?.position === 3 ? "bronze" : i === 0 ? "silver" : i % 2 ? "bronze" : "silver"
        ),
      },
    });
  }

  // 6. The team-mate battle (the first team-mate they actually raced).
  const mate = (data.teammates || []).find((m) => m.races || m.qualiAhead || m.qualiBehind);
  if (mate) {
    const rows = [];
    if (mate.races) rows.push({ label: "Finished ahead", a: mate.ahead, b: mate.behind });
    if (mate.qualiAhead + mate.qualiBehind) rows.push({ label: "Started ahead", a: mate.qualiAhead, b: mate.qualiBehind });
    rows.push({ label: "Points", a: mate.myPoints, b: mate.points });
    // Who came out on top: the races, then the grids, then the points.
    const lead = Math.sign(mate.ahead - mate.behind) || Math.sign(mate.qualiAhead - mate.qualiBehind) || Math.sign(mate.myPoints - mate.points);
    push("teammate", "purple", {
      eyebrow: "Team-mate battle",
      title: lead > 0 ? `${v.S} had the upper hand.` : lead < 0 ? `${mate.name} had the upper hand.` : "Dead even.",
      me: { name: driver.name, photoUrl: driver.photoUrl || null },
      other: { name: mate.name, photoUrl: mate.photoUrl || null, driverId: mate.driverId },
      rows,
      paint,
    });
  }

  // 7. The rival: whoever finished next to them in the table.
  const r = data.rival;
  if (r && !(data.teammates || []).some((m) => m.driverId === r.driverId)) {
    const gap = r.gap || 0;
    push("rival", "red", {
      eyebrow: "The rival",
      title: c.position === 1 ? `The one who chased ${v.s} all season.` : "The one to beat next season.",
      name: r.name,
      photoUrl: r.photoUrl || null,
      driverId: r.driverId,
      detail: `P${r.position}, ${gap === 0 ? "level on points" : `${plural(Math.abs(gap), "point")} ${gap > 0 ? "ahead" : "behind"}`}`,
      h2h: r.races ? `${v.S} finished ahead in ${r.ahead} of ${plural(r.races, "race")} against them.` : null,
      color: hexColor(r.team?.color),
    });
  }

  // 8. The championship, round by round.
  const journey = c.journey || [];
  if (journey.length > 1) {
    const first = journey[0];
    const last = journey[journey.length - 1];
    const peak = c.peak || null;
    push("journey", "ocean", {
      eyebrow: "Round by round",
      title:
        c.roundsLed > 0
          ? `Top of the table after ${plural(c.roundsLed, "round")}.`
          : peak
            ? `As high as P${peak.position}, after Round ${peak.round}.`
            : "Every round, a new table.",
      sub: `P${first.position} after Round ${first.round}, P${last.position} at the end.`,
      scene: {
        kind: "journey",
        paint,
        journey: journey.map((j) => ({ round: j.round, position: j.position })),
        fieldSize: c.fieldSize || Math.max(...journey.map((j) => j.position)),
      },
    });
  }

  // 9. The reveal: where the championship put them.
  if (c.position != null) {
    const p = c.position;
    push("final", "black", {
      eyebrow: "The final table",
      lead: "And the championship says…",
      big: `P${p}`,
      medal: p <= 3 ? p : null,
      title: p === 1 ? "Champion." : p === 2 ? "Runner-up." : p === 3 ? "Third overall." : null,
      sub: `${plural(c.points ?? 0, "point")} · ${plural(c.fieldSize || 0, "driver")}`,
      scene: p <= 3 ? { kind: "podium", paint, position: p } : { kind: "grid", paint, position: p, fieldSize: c.fieldSize || p },
    });
  }

  // 10. Honours (a finished season's).
  const honours = data.honours || [];
  if (honours.length) {
    const tone = (h) => (h.key === "champion" ? "gold" : h.key === "vice" ? "silver" : h.key === "third" ? "bronze" : "paint");
    push("honours", "plum", {
      eyebrow: "Honours",
      title: honours.length === 1 ? "One for the cabinet." : `${honours.length} for the cabinet.`,
      items: honours.map((h) => ({ key: h.key, title: h.title, detail: h.detail || null, ms: h.ms ?? null })),
      scene: { kind: "trophies", paint, tones: honours.slice(0, 6).map(tone) },
    });
  }

  // 11. The one-line verdict.
  if (data.type) {
    push("type", "lime", {
      eyebrow: mine ? "Your racing type" : `${driver.name}'s racing type`,
      big: data.type.title,
      line: data.type.line,
    });
  }

  // 12. The card to keep.
  push("summary", "night", {
    eyebrow: `${season.label} Wrapped`,
    stats: summaryStats(data),
    position: c.position ?? null,
    fieldSize: c.fieldSize || null,
    type: data.type?.title || null,
    paint,
  });

  return slides;
}
