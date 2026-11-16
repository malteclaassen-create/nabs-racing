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
function fieldFigures(review) {
  const s = review.stats || {};
  const r = review.ranks || {};
  const all = [
    { k: "overtakes", label: "Overtakes", value: s.overtakes, rank: r.overtakes },
    { k: "lapsLed", label: "Laps led", value: s.lapsLed, rank: r.lapsLed },
    { k: "fastestLaps", label: "Fastest laps", value: s.fastestLaps, rank: r.fastestLaps },
    { k: "poles", label: "Poles", value: s.poles, rank: r.poles },
    { k: "wins", label: "Wins", value: s.wins, rank: r.wins },
  ].filter((f) => f.value > 0 && f.rank);
  return all.sort((a, b) => a.rank.rank / a.rank.of - b.rank.rank / b.rank.of).slice(0, 3);
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

// The team-mate the season is best told against: the one shared the most
// races with.
function mainMate(review) {
  const mates = (review.teammates || []).filter((m) => m.races > 0 || m.starts > 0);
  if (!mates.length) return null;
  return [...mates].sort((a, b) => b.races + b.starts - (a.races + a.starts))[0];
}

export function storySlides(review) {
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

  if (review.best) {
    slides.push({
      key: "best",
      eyebrow: review.best.sprint ? "Best result, sprint" : "Best result",
      value: `P${review.best.position}`,
      title: review.best.track,
      sub: `Round ${review.best.round}`,
      line: bestLine(review.best),
    });
  }

  const climb = review.climb;
  if (climb && climb.gained >= 3 && !(review.best && climb.raceId === review.best.raceId && climb.sprint === review.best.sprint)) {
    slides.push({ key: "climb", eyebrow: "Biggest climb", value: `+${climb.gained}`, title: climb.track, line: climbLine(climb) });
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

  const figures = fieldFigures(review);
  if (figures.length >= 2) {
    slides.push({
      key: "field",
      eyebrow: "Against the field",
      figures: figures.map((f) => ({ ...f, rankText: rankText(f.rank) })),
      line: `Among the drivers who raced in this table.`,
    });
  }

  if ((c?.journey?.length || 0) >= 3) {
    const last = c.journey[c.journey.length - 1];
    slides.push({ key: "journey", eyebrow: "Championship", value: `P${last.position}`, unit: season.complete ? "at the end" : `after round ${last.round}`, line: journeyLine(review) });
  }

  const mate = mainMate(review);
  if (mate) {
    const diff = (mate.myPoints ?? 0) - (mate.points ?? 0);
    const leader = diff >= 0 ? driver.name : mate.name;
    slides.push({
      key: "team",
      eyebrow: `Team-mate · ${driver.team?.name || "the team"}`,
      title: driver.team?.name || "Team-mate",
      mate,
      lines: duelLines(mate),
      line: diff === 0 ? "Level on points." : `${leader} ${season.complete ? "finished" : "is"} ${plural(Math.abs(diff), "point")} ahead.`,
    });
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

  const honours = [
    ...(review.honours || []).map((h) => ({ key: h.key, title: h.title, detail: h.detail || null })),
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
