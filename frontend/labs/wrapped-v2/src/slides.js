// The story, slide by slide: its colours, how long it plays, the film under
// it (if any), its 3D and its words.
import { view, words, count, fade, pop, slam, marquee, hint } from "./ui.js";
import intro from "./scenes/intro.js";
import numbers from "./scenes/numbers.js";
import best from "./scenes/best.js";
import climb from "./scenes/climb.js";
import wins from "./scenes/wins.js";
import teammate from "./scenes/teammate.js";
import rival from "./scenes/rival.js";
import rounds from "./scenes/rounds.js";
import final from "./scenes/final.js";
import honours from "./scenes/honours.js";
import type from "./scenes/type.js";
import summary from "./scenes/summary.js";

const ordinal = (n) => ["First", "Second", "Third"][n - 1] || `P${n}`;

export const SLIDES = [
  {
    id: "intro",
    dur: 7,
    bg: "#050507",
    ink: "#ffffff",
    film: "intro",
    scene: intro,
    say: (d) => `Your ${d.season.label}, wrapped.`,
    ui: (d) =>
      view(`
        <div class="grow"></div>
        <h1 class="h1">${words(`Your ${d.season.label}, wrapped.`, 0.3, 0.12)}</h1>
        ${fade(`<p class="sub">Your season in ${d.season.rounds} rounds.</p>`, 1)}
        ${fade(`<div class="chips"><span class="chip hot">#${d.driver.number}</span><span class="chip">${d.driver.team.name}</span></div>`, 1.2)}
        ${hint("Tap to go on · drag the 3D", 1.8)}`),
  },
  {
    id: "numbers",
    dur: 8.5,
    bg: "#0038ff",
    ink: "#ffffff",
    scene: numbers,
    say: (d) => `You started ${d.stats.starts} races and finished ${d.stats.finishes}.`,
    ui: (d) =>
      view(`
        ${marquee("The season in numbers", "38%")}
        <div class="eyebrow fade">The season in numbers</div>
        <div class="grow"></div>
        <h2 class="h2">${words("You started", 0.2)}</h2>
        ${slam(`<div class="big">${count(d.stats.starts, { at: 0.4, dur: 1 })}</div>`, 0.35)}
        <div class="unit">${words("races.", 0.9)}</div>
        ${fade(`<p class="sub">And finished ${d.stats.finishes} of them.</p>`, 1.6)}
        ${fade(
          `<div class="chips"><span class="chip">${count(d.stats.overtakes, { at: 2, dur: 1.4 })} overtakes</span><span class="chip">${count(d.stats.lapsLed, { at: 2.2, dur: 1.2 })} laps led</span></div>`,
          1.9
        )}
        ${hint("Tap a block · drag the 12", 2.6)}`),
  },
  {
    id: "best",
    dur: 8.5,
    bg: "#0b1220",
    ink: "#ffffff",
    accent: "#ffc83d",
    scene: best,
    say: (d) => `Best result: P${d.best.position} at ${d.best.track}.`,
    ui: (d) =>
      view(`
        <div class="eyebrow fade">Best result</div>
        <h1 class="h1">${words("Your best race.", 0.2)}</h1>
        <div class="grow"></div>
        ${slam(`<div class="big" style="color:#ffc83d">P${d.best.position}</div>`, 0.9)}
        <h2 class="h2">${words(`${d.best.track} · Round ${d.best.round}`, 1.3)}</h2>
        ${fade(`<div class="mono" style="margin-top:10px">Started P${d.best.grid} · ${d.best.points} points</div>`, 1.7)}
        ${hint("Drag to turn the track", 2.4)}`),
  },
  {
    id: "climb",
    dur: 8.5,
    bg: "#06140a",
    ink: "#ffffff",
    film: "climb",
    scene: climb,
    when: (d) => d.climb?.gained > 0,
    say: (d) => `Biggest climb: ${d.climb.gained} places at ${d.climb.track}.`,
    ui: (d) =>
      view(`
        <div class="eyebrow fade">Biggest climb</div>
        <h1 class="h1">${words("Through the field.", 0.2)}</h1>
        <div class="grow"></div>
        ${slam(`<div class="big" style="color:#39ff14">${count(d.climb.gained, { at: 1, dur: 1.6, prefix: "+" })}</div>`, 0.8)}
        <div class="unit">${words("places", 1.3)}</div>
        ${fade(`<div class="mono" style="margin-top:12px">P${d.climb.grid} → P${d.climb.position} · ${d.climb.track} · Round ${d.climb.round}</div>`, 1.8)}`),
  },
  {
    id: "wins",
    dur: 8.5,
    bg: "#ff6a00",
    ink: "#170800",
    accent: "#170800",
    scene: wins,
    when: (d) => d.stats.wins > 0,
    say: (d) => `${d.stats.wins} wins this season.`,
    ui: (d) =>
      view(`
        ${marquee("Winner Winner", "30%", true)}
        <div class="eyebrow fade">Winner</div>
        <h1 class="h1">${words(`${d.stats.wins} wins this season.`, 0.2)}</h1>
        <div class="grow"></div>
        <div class="row">${slam(`<div class="big">${count(d.stats.wins, { at: 0.8, dur: 0.6 })}</div>`, 0.7)}<div class="unit">${words("wins", 1)}</div></div>
        ${fade(`<div class="chips">${d.wins.map((w) => `<span class="chip">${w.track} · R${w.round}</span>`).join("")}</div>`, 1.4)}
        ${fade(`<div class="mono" style="margin-top:12px">${d.stats.podiums} podiums in all</div>`, 1.7)}
        ${hint("Tap a trophy", 2.2)}`),
  },
  {
    id: "teammate",
    dur: 8.5,
    bg: "#5b21f5",
    ink: "#ffffff",
    scene: teammate,
    when: (d) => !!d.teammate,
    say: (d) => `Team-mate battle against ${d.teammate.name}: races ${d.teammate.ahead} to ${d.teammate.behind}, qualifying ${d.teammate.qualiAhead} to ${d.teammate.qualiBehind}.`,
    ui: (d) =>
      view(`
        <div class="eyebrow fade">Team-mate battle</div>
        <h1 class="h1">${words(`You vs ${d.teammate.name}.`, 0.2)}</h1>
        <div class="grow"></div>
        ${fade(
          `<div class="row" style="justify-content:space-between;align-items:flex-end">
            <div><div class="mono">Races</div><div class="big" style="font-size:clamp(60px,20vw,110px)">${count(d.teammate.ahead, { at: 1.2, dur: 1 })}<span style="opacity:.45">–${count(d.teammate.behind, { at: 1.2, dur: 1 })}</span></div></div>
            <div style="text-align:right"><div class="mono">Quali</div><div class="big" style="font-size:clamp(60px,20vw,110px)">${count(d.teammate.qualiAhead, { at: 1.6, dur: 1 })}<span style="opacity:.45">–${count(d.teammate.qualiBehind, { at: 1.6, dur: 1 })}</span></div></div>
          </div>`,
          0.9
        )}
        ${fade(`<p class="sub">${d.teammate.name} took the points battle, ${d.teammate.points} to ${d.teammate.myPoints}.</p>`, 2.2)}`),
  },
  {
    id: "rival",
    dur: 8,
    bg: "#00b3a4",
    ink: "#00201c",
    accent: "#00201c",
    scene: rival,
    when: (d) => !!d.rival,
    say: (d) => `Your rival: ${d.rival.name}, ${d.rival.gap} points ahead.`,
    ui: (d) =>
      view(`
        ${marquee(d.rival.name, "44%")}
        <div class="eyebrow fade">Your closest rival</div>
        <h1 class="h1">${words(`${d.rival.name}.`, 0.2)}</h1>
        <div class="grow"></div>
        <div class="row">${slam(`<div class="big">${count(d.rival.gap, { at: 1, dur: 1.2 })}</div>`, 0.9)}<div class="unit">${words("points apart", 1.3)}</div></div>
        ${fade(`<div class="mono" style="margin-top:12px">${d.rival.name}: P${d.rival.position} · ${d.rival.points} pts</div>`, 1.8)}
        ${hint("Drag to spin them", 2.4)}`),
  },
  {
    id: "rounds",
    dur: 9.5,
    bg: "#08080c",
    ink: "#ffffff",
    scene: rounds,
    say: (d) => `Round by round: best spot in the table P${Math.min(...d.championship.journey.map((j) => j.position))}.`,
    ui: (d) => {
      const best = d.championship.journey.reduce((a, b) => (b.position < a.position ? b : a));
      return view(`
        <div class="eyebrow fade">Round by round</div>
        <h1 class="h1">${words(`Up to P${best.position} at ${best.track}.`, 0.2)}</h1>
        <div class="grow"></div>
        ${fade(`<div class="mono">${d.season.rounds} rounds · ${d.championship.points} points</div>`, 1.2)}
        ${hint("Drag to look around", 2.2)}`);
    },
  },
  {
    id: "final",
    dur: 8.5,
    bg: "#050507",
    ink: "#ffffff",
    film: "podium",
    scene: final,
    say: (d) => `The final table: P${d.championship.position}.`,
    ui: (d) => {
      const p = d.championship.position;
      const c = p === 1 ? "#ffd84d" : p === 2 ? "#dfe3ea" : p === 3 ? "#e39a5f" : "#ffffff";
      return view(`
        <div class="eyebrow fade">The final table</div>
        <h2 class="h2">${words("You finished the season", 0.2)}</h2>
        <div class="grow"></div>
        ${slam(`<div class="big" style="color:${c}">P${p}</div>`, 1.2)}
        <div class="unit" style="color:${c}">${words(p <= 3 ? `${ordinal(p)} overall.` : "in the table.", 1.6)}</div>
        ${fade(`<div class="mono" style="margin-top:10px">${count(d.championship.points, { at: 2, dur: 1.2 })} points · ${d.championship.fieldSize} drivers</div>`, 1.9)}`);
    },
  },
  {
    id: "honours",
    dur: 8.5,
    bg: "#1b0a3d",
    ink: "#ffffff",
    scene: honours,
    when: (d) => d.honours?.length > 0,
    say: (d) => `${d.honours.length} awards: ${d.honours.map((h) => h.title).join(", ")}.`,
    ui: (d) =>
      view(`
        <div class="eyebrow fade">Honours</div>
        <h1 class="h1">${words(`${d.honours.length} awards.`, 0.2)}</h1>
        <div class="grow"></div>
        ${d.honours
          .map(
            (h, i) =>
              fade(`<div style="margin-top:12px"><div class="h2" style="font-size:24px;text-transform:uppercase">${h.title}</div>${h.detail ? `<div class="sub" style="margin-top:2px">${h.detail}</div>` : ""}</div>`, 1 + i * 0.3)
          )
          .join("")}
        ${hint("Tap a medal to flip it", 2.2)}`),
  },
  {
    id: "type",
    dur: 9,
    bg: "#00c8f0",
    ink: "#00141a",
    accent: "#00141a",
    scene: type,
    say: (d) => `Your racing type: ${d.type.title}`,
    ui: (d) =>
      view(`
        <div class="eyebrow fade">Your racing type</div>
        <div class="grow"></div>
        <h1 class="h1">${words(d.type.title, 1.2, 0.12)}</h1>
        ${fade(`<p class="sub">${d.type.line}</p>`, 1.9)}
        ${hint("Tilt or drag the card", 2.4)}`),
  },
  {
    id: "summary",
    dur: 0,
    bg: "#050507",
    ink: "#ffffff",
    scene: summary,
    say: (d) => `Summary: P${d.championship.position}, ${d.championship.points} points, ${d.stats.wins} wins.`,
    ui: (d) =>
      view(`
        <div class="eyebrow fade">${d.season.label} · ${d.driver.team.name}</div>
        <h1 class="h1">${words(`${d.driver.name}, that was your season.`, 0.2, 0.07)}</h1>
        ${pop(
          `<div class="card">
            <div class="row" style="justify-content:space-between;align-items:center">
              <div class="big" style="font-size:72px;color:#e39a5f">P${d.championship.position}</div>
              <div style="text-align:right"><div class="mono" style="opacity:.75">Racing type</div><div class="h2" style="font-size:20px;margin-top:4px">${d.type.title}</div></div>
            </div>
            <div class="grid3">
              <div class="stat"><b>${d.championship.points}</b><span>Points</span></div>
              <div class="stat"><b>${d.stats.wins}</b><span>Wins</span></div>
              <div class="stat"><b>${d.stats.podiums}</b><span>Podiums</span></div>
              <div class="stat"><b>${d.stats.overtakes}</b><span>Overtakes</span></div>
              <div class="stat"><b>${d.stats.lapsLed}</b><span>Laps led</span></div>
              <div class="stat"><b>+${d.climb.gained}</b><span>Best climb</span></div>
            </div>
            <div class="btns"><button class="btn hot" type="button" data-act="share">Share</button><button class="btn" type="button" data-act="again">Watch again</button></div>
          </div>`,
          0.8,
          "push"
        )}`),
  },
];
