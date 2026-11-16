// The story's colours, the way a Wrapped is coloured: every slide one flat,
// full colour with one strong colour on it, a different pairing per slide.
// The first and the last slide are the driver's own: the team colour.
import { readableInkOn } from "../../components/ui.jsx";

const INK = "#121212";
const PAPER = "#FFFFFF";

const PAIRS = {
  rounds: ["#1E3264", "#FFC864"],
  top: ["#AF2896", "#CDF564"],
  best: [INK, PAPER],
  climb: ["#E91429", "#FFF3E3"],
  podiums: ["#27856A", PAPER],
  field: ["#B49BC8", INK],
  journey: ["#509BF5", INK],
  team: [INK, PAPER],
  contact: ["#FFC864", "#1E3264"],
  honours: ["#E8115B", PAPER],
};

const alpha = (hex, a) => {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export function slideColours(key, teamColor) {
  const team = /^#[0-9a-f]{6}$/i.test(String(teamColor || "")) ? teamColor : "#F4AFC6";
  const [bg, fg] = PAIRS[key] || [team, readableInkOn(team) === "#fff" ? PAPER : INK];
  // The second colour of a dark slide is the team's, so the driver's colour
  // runs through the story.
  const pop = bg === INK ? team : fg;
  return {
    "--g-bg": bg,
    "--g-fg": fg,
    "--g-mute": alpha(fg, 0.72),
    "--g-faint": alpha(fg, 0.16),
    "--g-pop": pop,
    "--g-pop-fg": readableInkOn(pop) === "#fff" ? PAPER : INK,
    "--lv-team": team,
  };
}
