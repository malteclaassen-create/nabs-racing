// The story's colours: three for the whole story, the way Wrapped 2025 kept
// to black and white and let colour come only from what mattered. Black and
// white, and the driver's team colour as the one accent; a few slides are
// painted in the team colour itself.
import { readableInkOn, readableAccent } from "../../components/ui.jsx";

const INK = "#0b0b0c";
const PAPER = "#f6f5f1";
const ON_TEAM = new Set(["intro", "best", "led", "journey", "hits", "honours"]);
// A few slides are white with black type, so the story does not sit on black
// the whole way through.
const ON_PAPER = new Set(["training", "passes", "team", "limits"]);
const LEAGUE = "#F4AFC6";

// The colour a driver's story is told in: the team's, or the league's pink
// for a reserve driver (whose "team" is the grey reserve list).
export function storyColour(review) {
  const t = review?.driver?.team;
  if (!t || t.tier === 0 || /^reserve/i.test(t.name || "")) return LEAGUE;
  return t.color || LEAGUE;
}

const alpha = (hex, a) => {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// WCAG contrast between two #rrggbb colours (1 to 21).
function luminance(hex) {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function slideColours(key, teamColor) {
  const team = /^#[0-9a-f]{6}$/i.test(String(teamColor || "")) ? teamColor : LEAGUE;
  return { ...coloursOf(key, team), "--g-mark-paper": onPaper(team) };
}

// The team colour for a figure on white (the summary card): itself, or a
// deeper shade where it all but disappears on white (a lime green).
function onPaper(team) {
  return contrast(team, PAPER) >= 1.5 ? team : readableAccent(team, { target: 3 });
}

function coloursOf(key, team) {
  if (ON_TEAM.has(key)) {
    const fg = readableInkOn(team) === "#fff" ? PAPER : INK;
    // The second colour is the other of black and white, unless it all but
    // disappears on the team colour (white on a lime green): then the lines
    // and marks are drawn in the type's colour too, and a marked word turns
    // to white on black.
    const flip = fg === PAPER ? INK : PAPER;
    const other = contrast(flip, team) >= 1.5 ? flip : fg;
    const otherFg = other === INK ? PAPER : INK;
    return {
      "--g-bg": team,
      "--g-fg": fg,
      "--g-mute": alpha(fg, 0.72),
      "--g-faint": alpha(fg, 0.18),
      "--g-pop": other,
      "--g-pop-fg": other === flip ? fg : otherFg,
      "--g-mark": other,
      "--g-mark-fg": other === flip ? fg : otherFg,
      "--lv-team": team,
    };
  }
  if (ON_PAPER.has(key)) {
    const pop = readableAccent(team);
    return {
      "--g-bg": PAPER,
      "--g-fg": INK,
      "--g-mute": alpha(INK, 0.66),
      "--g-faint": alpha(INK, 0.14),
      "--g-pop": pop,
      "--g-pop-fg": readableInkOn(pop) === "#fff" ? PAPER : INK,
      "--g-mark": team,
      "--g-mark-fg": readableInkOn(team) === "#fff" ? PAPER : INK,
      "--lv-team": team,
    };
  }
  const accent = readableAccent(team, { dark: true });
  const markFg = readableInkOn(team) === "#fff" ? PAPER : INK;
  return {
    "--g-bg": INK,
    "--g-fg": PAPER,
    "--g-mute": alpha(PAPER, 0.66),
    "--g-faint": alpha(PAPER, 0.14),
    "--g-pop": accent,
    "--g-pop-fg": readableInkOn(accent) === "#fff" ? PAPER : INK,
    "--g-mark": team,
    "--g-mark-fg": markFg,
    "--lv-team": team,
  };
}
