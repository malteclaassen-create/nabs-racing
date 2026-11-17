// Which slides a driver's season story has, in order, and what each one says
// (review/Story.jsx draws them). One moment per slide, the way a Wrapped
// story runs, built from the same review object as the full page
// (SeasonReview.jsx) so a slide and the page can never disagree. A slide whose
// moment the season does not have (no podium, no team-mate, no contact on
// file) is simply not in the list: nothing is padded.
//
// The words follow the rest of the review (review/copy.mjs): plain, a number
// always next to what it is measured against, nobody called "you", no "he" or
// "she", no labels, no praise.
import { rankText, roundName, bestLine, climbLine, journeyLine, contactLine, duelLines, resultLine, nth } from "./copy.mjs";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The figures worth a line on the "against the field" slide, best ranked
// first, at most three; only figures the season has and a rank to set them
// against.
function fieldFigures(review, skip = new Set()) {
  const s = review.stats || {};
  const r = review.ranks || {};
  const all = [
    { k: "overtakes", label: "Overtakes", value: s.overtakes, rank: r.overtakes },
    { k: "lapsLed", label: "Laps led", value: s.lapsLed, rank: r.lapsLed },
    { k: "fastestLaps", label: "Fastest laps", value: s.fastestLaps, rank: r.fastestLaps },
    { k: "poles", label: "Poles", value: s.poles, rank: r.poles },
    { k: "wins", label: "Wins", value: s.wins, rank: r.wins },
  ].filter((f) => f.value > 0 && f.rank && !skip.has(f.k));
  return all.sort((a, b) => a.rank.rank / a.rank.of - b.rank.rank / b.rank.of).slice(0, 3);
}

// The quickest lap honour carries only the circuit; it reads "At Most,
// 1:02.673" in the story.
function honourDetail(h) {
  if (h.key !== "fastest-lap" || !h.detail) return h.detail || null;
  if (!(h.ms > 0)) return `At ${h.detail}`;
  const m = Math.floor(h.ms / 60000);
  const sec = ((h.ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `At ${h.detail}, ${m ? `${m}:${sec}` : sec}`;
}

// A race photo that fits a slide (review.photos, tagged by what is on them in
// the backend's lib/racePhotoTags.js). Only a picture with the driver's own
// team in it is ever chosen, so a slide never shows somebody else's car as
// theirs. Best first: a "hero" shot over an "ok" one, the subject car over a
// car in the background. Each photo is used once per story.
export function pickPhoto(review, used, { rounds = null, kinds = null, pair = false } = {}) {
  const team = review.driver?.team?.id;
  if (!team || !Array.isArray(review.photos)) return null;
  const fits = review.photos.filter(
    (p) =>
      !used.has(p.url) &&
      (rounds == null || rounds.includes(p.round)) &&
      (kinds == null || kinds.includes(p.kind)) &&
      (pair ? p.pair === team : p.focus === team || p.pair === team || (p.teams || []).includes(team)),
  );
  if (!fits.length) return null;
  const score = (p) => (p.quality === "hero" ? 4 : 0) + (p.focus === team ? 2 : 0) + (p.pair === team ? 1 : 0);
  const best = [...fits].sort((a, b) => score(b) - score(a))[0];
  used.add(best.url);
  return { url: best.url, round: best.round, kind: best.kind, track: review.rounds?.find((x) => x.round === best.round)?.track || null };
}

// Every podium of the season, feature races and sprints, in round order.
export function podiumsOf(rounds) {
  const out = [];
  for (const r of rounds || []) {
    if (r.status === "FINISHED" && r.position != null && r.position <= 3) out.push({ round: r.round, track: r.track, position: r.position, sprint: false });
    if (r.sprint && r.sprint.status === "FINISHED" && r.sprint.position != null && r.sprint.position <= 3) {
      out.push({ round: r.round, track: r.track, position: r.sprint.position, sprint: true });
    }
  }
  return out;
}

// The season's five best results, feature races and sprints, as a Wrapped
// ranks its top five: best place first, then the most points, then the
// earlier round.
export function topResults(rounds, n = 5) {
  const all = [];
  for (const r of rounds || []) {
    if (r.status === "FINISHED" && r.position != null) all.push({ round: r.round, track: r.track, position: r.position, points: (r.points || 0) - (r.sprint?.points || 0), sprint: false });
    if (r.sprint && r.sprint.status === "FINISHED" && r.sprint.position != null) all.push({ round: r.round, track: r.track, position: r.sprint.position, points: r.sprint.points || 0, sprint: true });
  }
  return all.sort((a, b) => a.position - b.position || b.points - a.points || a.round - b.round).slice(0, n);
}

// The four circuits of the "guess the best race" question: the best one and
// up to three other circuits finished on, spread over the season, in an order
// set by the names so the answer is not always in the same place.
export function quizOptions(review) {
  const best = review.best;
  if (!best?.track) return null;
  const others = [];
  for (const r of review.rounds || []) {
    if (r.status === "FINISHED" && r.track && r.track !== best.track && !others.includes(r.track)) others.push(r.track);
  }
  if (others.length < 2) return null;
  const n = Math.min(3, others.length);
  const pick = Array.from({ length: n }, (_, k) => others[Math.floor((k * others.length) / n)]);
  const key = (t) => [...`${t}${review.season?.label || ""}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return [best.track, ...pick].sort((a, b) => key(a) - key(b));
}

// The team-mate the season is best told against: the one shared the most
// races with.
function mainMate(review) {
  const mates = (review.teammates || []).filter((m) => m.races > 0 || m.starts > 0);
  if (!mates.length) return null;
  return [...mates].sort((a, b) => b.races + b.starts - (a.races + a.starts))[0];
}

// The longest run of rounds in a row that scored points, or failing that
// (fewer than three), the longest run that saw the flag (at least four).
// Rounds the driver did not start break a run.
export function bestRun(rounds) {
  const list = [...(rounds || [])].sort((a, b) => a.round - b.round);
  const longest = (ok) => {
    let best = null;
    let cur = [];
    for (const r of list) {
      if (ok(r)) {
        cur.push(r);
        if (!best || cur.length > best.length) best = [...cur];
      } else cur = [];
    }
    return best || [];
  };
  const pts = longest((r) => (r.points || 0) > 0);
  if (pts.length >= 3) return { kind: "points", n: pts.length, rounds: pts.map((r) => r.round), from: pts[0], to: pts[pts.length - 1] };
  const fin = longest((r) => r.status === "FINISHED" && r.position != null);
  if (fin.length >= 4) return { kind: "finishes", n: fin.length, rounds: fin.map((r) => r.round), from: fin[0], to: fin[fin.length - 1] };
  return null;
}

export function storySlides(review) {
  const usedPhotos = new Set();
  // A Tier 2 driver is measured against Tier 2 (review.tier, from the
  // backend): their ranks and leaderboards come from there when they exist.
  const T = review.tier || null;
  const scope = T ? `Tier ${T.tier}` : null;
  // Whichever says more: the place in the whole league when it is the better
  // share (the most passes in the league beats the most in Tier 2), else the
  // place in Tier 2.
  const share = (x) => (x ? x.rank / x.of : 1);
  const pick = (k) => {
    const all = review.ranks?.[k] || null;
    const mine = T?.ranks?.[k] || null;
    if (!mine) return { rank: all, scope: null };
    if (all && share(all) <= share(mine)) return { rank: all, scope: null };
    return { rank: mine, scope };
  };
  const rankOf = (k) => pick(k).rank;
  const scopeOf = (k) => pick(k).scope;
  const boardOf = (k) => (T ? T.boards?.[k] : null) || review.boards?.[k] || null;
  // A picture of both team cars is rare: it is kept for the team-mate slide
  // before any other slide can take it.
  const pairPhoto = mainMate(review) ? pickPhoto(review, usedPhotos, { pair: true }) : null;
  if (!review?.season || !review?.driver || !review?.stats) return [];
  const { season, driver, stats, championship: c } = review;
  const rounds = review.rounds || [];
  const slides = [];

  slides.push({
    key: "intro",
    eyebrow: `Season review · ${season.label}${season.complete ? "" : " so far"}`,
    title: driver.name,
    line: [driver.team?.name, season.complete ? `${season.roundsRun} rounds` : `${season.roundsRun} of ${season.totalRounds} rounds run`].filter(Boolean).join(" · "),
  });

  const missed = rounds.filter((r) => r.status === "DNS").length;
  slides.push({
    key: "rounds",
    eyebrow: "On the grid",
    value: stats.starts,
    unit: `of ${plural(rounds.length, "round")}`,
    line: [`${stats.finishes} finished`, stats.dnf ? `${stats.dnf} retired` : null, missed ? `${missed} missed` : null].filter(Boolean).join(", ") + ".",
  });

  if (review.training?.laps > 0) {
    slides.push({ key: "training", value: review.training.laps, weeks: review.training.weeks, rank: review.training.rank, board: review.boards?.training || null });
  }

  // The guess comes before the list that would give it away.
  const quiz = quizOptions(review);
  if (quiz) slides.push({ key: "quiz", answer: review.best.track, position: review.best.position, options: quiz });

  const top = topResults(rounds);
  if (top.length >= 3) slides.push({ key: "top", eyebrow: "Top results", list: top });

  if (review.best) {
    slides.push({
      key: "best",
      eyebrow: review.best.sprint ? "Best result, sprint" : "Best result",
      value: `P${review.best.position}`,
      title: review.best.track,
      sub: `Round ${review.best.round}`,
      line: bestLine(review.best),
      // A shot of that race with the driver's own car in it.
      photo: pickPhoto(review, usedPhotos, { rounds: [review.best.round], kinds: ["solo", "battle", "pack", "start", "podium"] }),
    });
  }

  const climb = review.climb;
  if (climb && climb.gained >= 3 && !(review.best && climb.raceId === review.best.raceId && climb.sprint === review.best.sprint)) {
    slides.push({
      key: "climb",
      eyebrow: "Biggest climb",
      value: `+${climb.gained}`,
      title: climb.track,
      line: climbLine(climb),
      photo: pickPhoto(review, usedPhotos, { rounds: [climb.round], kinds: ["battle", "pack", "solo", "start"] }),
    });
  }

  // No "quickest lap" slide: the quickest lap of a season is on the shortest
  // circuit for nearly everyone, so it said the same thing in every story.

  // Passes made on track, round by round, where the race server counted them.
  if (stats.overtakes >= 5) {
    slides.push({
      key: "passes",
      value: stats.overtakes,
      rank: rankOf("overtakes"),
      scope: scopeOf("overtakes"),
      perRound: rounds.map((r) => ({ round: r.round, track: r.track, n: r.overtakes ?? null })),
    });
  }

  const podiums = podiumsOf(rounds);
  if (podiums.length) {
    const rank = rankText(review.ranks?.podiums);
    slides.push({
      key: "podiums",
      eyebrow: "Podiums",
      value: podiums.length,
      unit: `from ${plural(stats.starts, "start")}`,
      podiums,
      line: rank ? `${rank} in the field.` : null,
    });
  }

  // Laps in the lead, and where they were led.
  if (stats.lapsLed > 0) {
    slides.push({
      key: "led",
      value: stats.lapsLed,
      rank: rankOf("lapsLed"),
      scope: scopeOf("lapsLed"),
      where: rounds.filter((r) => r.lapsLed > 0).map((r) => ({ round: r.round, track: r.track, laps: r.lapsLed })).sort((a, b) => b.laps - a.laps),
    });
  }

  // The figures that have a slide of their own stay out of this one.
  const own = new Set(slides.map((x) => x.key));
  const keys = ["overtakes", "lapsLed", "fastestLaps", "poles", "wins"];
  const rv = T ? { ...review, ranks: { ...review.ranks, ...Object.fromEntries(keys.map((k) => [k, rankOf(k)])) } } : review;
  const figures = fieldFigures(rv, new Set([own.has("passes") && "overtakes", own.has("led") && "lapsLed"].filter(Boolean)));
  if (figures.length >= 2) {
    slides.push({
      key: "field",
      eyebrow: "Against the field",
      figures: figures.map((f) => ({ ...f, rankText: rankText(f.rank) })),
      board: scopeOf(figures[0].k) ? boardOf(figures[0].k) : review.boards?.[figures[0].k] || null,
      scope: scopeOf(figures[0].k),
      line: `Among the drivers who raced in this table.`,
    });
  }

  if (review.tyres?.length) slides.push({ key: "tyres", tyres: review.tyres });

  if ((c?.journey?.length || 0) >= 3) {
    const last = c.journey[c.journey.length - 1];
    slides.push({ key: "journey", eyebrow: "Championship", value: `P${last.position}`, unit: season.complete ? "at the end" : `after round ${last.round}`, line: journeyLine(review) });
  }

  // Tier 2 on its own: the place among Tier 2 and the rounds as Tier 2 ranks.
  if (T && T.position) slides.push({ key: "tier", ...T });

  const mate = mainMate(review);
  if (mate) {
    const diff = (mate.myPoints ?? 0) - (mate.points ?? 0);
    const leader = diff >= 0 ? "You" : mate.name;
    slides.push({
      key: "team",
      eyebrow: `Team-mate · ${driver.team?.name || "the team"}`,
      title: driver.team?.name || "Team-mate",
      mate,
      lines: duelLines(mate),
      line: diff === 0 ? "Level on points." : `${leader} ${season.complete ? "finished" : "is"} ${plural(Math.abs(diff), "point")} ahead.`,
      // Both cars of the team in one picture.
      photo: pairPhoto,
    });
  }

  // The best run of the season, for every kind of season.
  const run = bestRun(rounds);
  if (run) slides.push({ key: "streak", ...run });

  // How often the car touched another one, and the scenery, against the field.
  if (review.contact && review.contact.races >= 2 && review.contact.cars > 0) {
    const k = review.contact;
    // A crash with the driver's car in it: from the race with the most contact
    // if there is one, else from any race.
    const worst = [...rounds].filter((r) => r.contacts > 0).sort((a, b) => b.contacts - a.contacts)[0];
    const crash = (worst && pickPhoto(review, usedPhotos, { rounds: [worst.round], kinds: ["crash"] })) || pickPhoto(review, usedPhotos, { kinds: ["crash"] });
    slides.push({ key: "hits", cars: k.cars, scenery: k.scenery || 0, perRace: k.perRace, fieldPerRace: k.fieldPerRace, races: k.races, photo: crash, worstRound: worst?.round ?? null });
  }

  if (review.contact && review.contact.races >= 2) {
    const k = review.contact;
    slides.push({
      key: "contact",
      eyebrow: "Contact",
      value: k.clean,
      unit: `without touching a car, of ${plural(k.rounds ?? k.races, "round")} on file`,
      line: contactLine(k, rounds),
    });
  }

  if (review.limits && review.limits.races >= 2) slides.push({ key: "limits", ...review.limits });

  const honours = [
    ...(review.honours || []).map((h) => ({ key: h.key, title: h.title, detail: honourDetail(h) })),
    ...(review.awards || []).map((a, i) => ({ key: `award-${i}`, title: a.title, detail: a.note || null })),
    ...(stats.dotd > 0 ? [{ key: "dotd", title: "Driver of the Day", detail: `${stats.dotd} time${stats.dotd === 1 ? "" : "s"}` }] : []),
  ];
  if (honours.length) slides.push({ key: "honours", eyebrow: "Honours", honours });

  slides.push({
    key: "final",
    eyebrow: `${season.label}${season.complete ? "" : " so far"}`,
    title: driver.name,
    value: c?.position ? `P${c.position}` : null,
    unit: c?.position ? `of ${c.fieldSize} who raced` : null,
    points: c?.points ?? 0,
    line: resultLine(review),
    grid: summaryGrid(review, mate),
    top,
  });
  return slides;
}

// The six numbers of the last slide and the share picture. A figure the
// season does not have makes room for the next one, so the grid never shows
// a hole.
export function summaryGrid(review, mate = mainMate(review), { skip = [] } = {}) {
  const s = review.stats || {};
  const best = review.best;
  const cells = [
    { k: "wins", label: "Wins", value: String(s.wins ?? 0) },
    { k: "podiums", label: "Podiums", value: String(s.podiums ?? 0) },
    s.poles > 0 ? { k: "poles", label: "Poles", value: String(s.poles) } : null,
    s.fastestLaps > 0 ? { k: "fl", label: "Fastest laps", value: String(s.fastestLaps) } : null,
    best ? { k: "best", label: "Best result", value: `P${best.position}`, sub: best.track } : null,
    mate && mate.races > 0 ? { k: "mate", label: `v ${mate.name}`, value: `${mate.ahead}-${mate.behind}`, sub: "races" } : null,
    { k: "finishes", label: "Finishes", value: `${s.finishes ?? 0}/${s.starts ?? 0}` },
    s.overtakes > 0 ? { k: "ot", label: "Overtakes", value: String(s.overtakes) } : null,
    s.avgFinish != null ? { k: "avg", label: "Average finish", value: `P${String(s.avgFinish).replace(/\.0$/, "")}` } : null,
  ].filter((c) => c && !skip.includes(c.k));
  return cells.slice(0, 6);
}

export { nth, roundName };

// The season column of the summary card: the figure and its word, in the
// singular where it is one.
export function seasonList(slide, review) {
  const s = review.stats;
  const one = (n, a, b) => (n === 1 ? a : b);
  const out = [
    { k: "wins", value: s.wins, label: one(s.wins, "win", "wins") },
    { k: "podiums", value: s.podiums, label: one(s.podiums, "podium", "podiums") },
    s.poles > 0 ? { k: "poles", value: s.poles, label: one(s.poles, "pole", "poles") } : null,
    s.fastestLaps > 0 ? { k: "fl", value: s.fastestLaps, label: one(s.fastestLaps, "fastest lap", "fastest laps") } : null,
    s.overtakes > 0 ? { k: "ot", value: s.overtakes, label: one(s.overtakes, "overtake", "overtakes") } : null,
    s.lapsLed > 0 ? { k: "led", value: s.lapsLed, label: one(s.lapsLed, "lap led", "laps led") } : null,
    { k: "fin", value: `${s.finishes}/${s.starts}`, label: "finished" },
  ].filter(Boolean);
  return out.slice(0, 5);
}
