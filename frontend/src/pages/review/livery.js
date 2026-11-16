// The story's colours: the driver's livery. The team colour is the one
// colour of the whole story; between it come black and white grounds, the
// way a car is painted. What sits on each ground is worked out so it always
// reads: ink on a pale team colour, white on a dark one, and the team colour
// itself darkened or lightened only as far as it has to be to show on white
// or black.
import { readableInkOn, readableAccent } from "../../components/ui.jsx";

export const BLACK = "#0c0d10";
export const WHITE = "#f4f3ef";
// No team (a reserve): the league's own pink.
const NO_TEAM = "#F4AFC6";

const withAlpha = (hex, a) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Which ground each slide is painted on: a rhythm, not a colour per slide.
export const GROUND_OF = {
  intro: "team",
  rounds: "black",
  best: "team",
  climb: "white",
  podiums: "black",
  field: "white",
  journey: "team",
  team: "black",
  contact: "white",
  honours: "black",
  final: "team",
};

export function livery(teamColor) {
  const team = /^#[0-9a-f]{3,6}$/i.test(String(teamColor || "")) ? teamColor : NO_TEAM;
  const onTeam = readableInkOn(team) === "#fff" ? WHITE : BLACK;
  return {
    team,
    grounds: {
      team: { bg: team, fg: onTeam, mute: withAlpha(onTeam, 0.66), accent: onTeam },
      black: { bg: BLACK, fg: WHITE, mute: withAlpha(WHITE, 0.58), accent: readableAccent(team, { dark: true }) },
      white: { bg: WHITE, fg: BLACK, mute: withAlpha(BLACK, 0.58), accent: readableAccent(team) },
    },
  };
}

export const groundVars = (g) => ({ "--g-bg": g.bg, "--g-fg": g.fg, "--g-mute": g.mute, "--g-accent": g.accent });
