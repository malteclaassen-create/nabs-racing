// ---------------------------------------------------------------------------
// Achievements for the private Cockpit. Like the card editions this is a pure
// catalogue: each entry reads one number out of the precomputed career inputs
// (built in cockpitService.buildAchievementInputs) and unlocks at `target`.
// Progress = value/target, so countable ones ("7/10 podiums") come for free.
// Hidden entries show as "???" until unlocked. Person-wide (linked rows of the
// driver's own series), so milestones survive season and handle changes.
// ---------------------------------------------------------------------------

export const ACHIEVEMENT_CATEGORIES = [
  { key: "milestones", name: "Milestones" },
  { key: "speed", name: "Speed" },
  { key: "racecraft", name: "Racecraft" },
  { key: "consistency", name: "Consistency" },
  { key: "special", name: "Special" },
];

// value: (s) => number — s is the inputs object from buildAchievementInputs.
export const ACHIEVEMENTS = [
  // --- Milestones ------------------------------------------------------------
  { key: "first-start", cat: "milestones", name: "Lights Out", tagline: "Start your first race", target: 1, value: (s) => s.starts },
  { key: "starts-10", cat: "milestones", name: "Regular", tagline: "Start 10 races", target: 10, value: (s) => s.starts },
  { key: "starts-25", cat: "milestones", name: "Seasoned", tagline: "Start 25 races", target: 25, value: (s) => s.starts },
  { key: "starts-50", cat: "milestones", name: "Half Century", tagline: "Start 50 races", target: 50, value: (s) => s.starts },
  { key: "first-points", cat: "milestones", name: "On the Board", tagline: "Score your first points", target: 1, value: (s) => s.pointsFinishes },
  { key: "points-100", cat: "milestones", name: "Century", tagline: "Collect 100 career points", target: 100, value: (s) => s.points },
  { key: "points-500", cat: "milestones", name: "Point Machine", tagline: "Collect 500 career points", target: 500, value: (s) => s.points },
  { key: "first-podium", cat: "milestones", name: "Champagne", tagline: "Finish on the podium", target: 1, value: (s) => s.podiums },
  { key: "podiums-10", cat: "milestones", name: "Trophy Cabinet", tagline: "Take 10 podiums", target: 10, value: (s) => s.podiums },
  { key: "first-win", cat: "milestones", name: "Winner", tagline: "Win a race", target: 1, value: (s) => s.wins },
  { key: "wins-5", cat: "milestones", name: "Serial Winner", tagline: "Win 5 races", target: 5, value: (s) => s.wins },
  { key: "wins-10", cat: "milestones", name: "Dominator", tagline: "Win 10 races", target: 10, value: (s) => s.wins },
  { key: "laps-500", cat: "milestones", name: "Mileage", tagline: "Complete 500 race laps", target: 500, value: (s) => s.laps },
  { key: "laps-1000", cat: "milestones", name: "High Mileage", tagline: "Complete 1000 race laps", target: 1000, value: (s) => s.laps },
  { key: "champion", cat: "milestones", name: "World Champion", tagline: "Win the championship", target: 1, value: (s) => s.titles },
  // Long-haul goals for the league's veterans — some drivers are already deep
  // into three digits, and even they should have something left to chase.
  { key: "starts-100", cat: "milestones", name: "Centurion", tagline: "Start 100 races", target: 100, value: (s) => s.starts },
  { key: "wins-25", cat: "milestones", name: "Living Legend", tagline: "Win 25 races", target: 25, value: (s) => s.wins },
  { key: "podiums-25", cat: "milestones", name: "Silverware Collector", tagline: "Take 25 podiums", target: 25, value: (s) => s.podiums },
  { key: "points-1000", cat: "milestones", name: "Four Digits", tagline: "Collect 1000 career points", target: 1000, value: (s) => s.points },
  { key: "titles-3", cat: "milestones", name: "Dynasty", tagline: "Win 3 championship titles", target: 3, value: (s) => s.titles },

  // --- Speed -----------------------------------------------------------------
  { key: "first-pole", cat: "speed", name: "Pole Sitter", tagline: "Take a pole position", target: 1, value: (s) => s.poles },
  { key: "poles-5", cat: "speed", name: "Saturday Specialist", tagline: "Take 5 pole positions", target: 5, value: (s) => s.poles },
  { key: "first-fastest-lap", cat: "speed", name: "Purple Sector", tagline: "Set a race's fastest lap", target: 1, value: (s) => s.fastestLaps },
  { key: "fastest-laps-5", cat: "speed", name: "Pace Setter", tagline: "Set 5 fastest laps", target: 5, value: (s) => s.fastestLaps },
  { key: "fastest-laps-15", cat: "speed", name: "Purple Reign", tagline: "Set 15 fastest laps", target: 15, value: (s) => s.fastestLaps },
  { key: "front-row-5", cat: "speed", name: "Front Row Club", tagline: "Start from the front row 5 times", target: 5, value: (s) => s.frontRows },
  { key: "hat-trick", cat: "speed", name: "Hat-trick", tagline: "Pole, win and fastest lap in one race", target: 1, hidden: true, value: (s) => s.hatTricks },

  // --- Racecraft -------------------------------------------------------------
  { key: "comeback-10", cat: "racecraft", name: "Comeback", tagline: "Gain 10 places in a single race", target: 1, value: (s) => s.bestComeback >= 10 ? 1 : 0 },
  { key: "overtakes-50", cat: "racecraft", name: "Mover", tagline: "Make 50 on-track passes", target: 50, value: (s) => s.overtakes },
  { key: "overtakes-200", cat: "racecraft", name: "Overtake Artist", tagline: "Make 200 on-track passes", target: 200, value: (s) => s.overtakes },
  { key: "laps-led-100", cat: "racecraft", name: "Out Front", tagline: "Lead 100 laps", target: 100, value: (s) => s.lapsLed },
  { key: "sunday-driver", cat: "racecraft", name: "Sunday Driver", tagline: "Win from outside the top 5 on the grid", target: 1, hidden: true, value: (s) => s.winsFromP6 },

  // --- Consistency -----------------------------------------------------------
  { key: "streak-points-5", cat: "consistency", name: "Metronome", tagline: "Score points in 5 races in a row", target: 5, value: (s) => s.longestPointsStreak },
  { key: "podium-streak-3", cat: "consistency", name: "Rich Vein", tagline: "3 podiums in a row", target: 3, value: (s) => s.longestPodiumStreak },
  { key: "no-dnf-season", cat: "consistency", name: "Ironman", tagline: "Finish a full season without a DNF", target: 1, value: (s) => s.noDnfSeasons },
  { key: "ever-present", cat: "consistency", name: "Ever Present", tagline: "Start every round of a season", target: 1, value: (s) => s.fullSeasons },
  { key: "clean-races-10", cat: "consistency", name: "Clean Hands", tagline: "10 races without a single car contact", target: 10, value: (s) => s.cleanRaces },

  // --- Special ---------------------------------------------------------------
  { key: "globetrotter", cat: "special", name: "Globetrotter", tagline: "Win at 5 different circuits", target: 5, value: (s) => s.distinctWinTracks },
  { key: "last-to-points", cat: "special", name: "Through the Field", tagline: "Score points from the back row", target: 1, hidden: true, value: (s) => s.pointsFromBackRow },
  { key: "photo-finish", cat: "special", name: "Photo Finish", tagline: "Finish within a second of the car ahead", target: 1, hidden: true, value: (s) => s.photoFinishes },
];

// Full state for one driver's inputs: [{ ...meta, unlocked, value, progress }].
// Hidden entries keep their name/tagline server-side until unlocked — the
// route strips them so the client can't peek.
export function achievementStateFor(inputs) {
  return ACHIEVEMENTS.map((a) => {
    const value = Math.max(0, Math.round(a.value(inputs) || 0));
    const unlocked = value >= a.target;
    return {
      key: a.key,
      cat: a.cat,
      name: a.name,
      tagline: a.tagline,
      hidden: !!a.hidden,
      target: a.target,
      value: Math.min(value, a.target),
      unlocked,
    };
  });
}

const BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));
export const isKnownAchievement = (key) => BY_KEY.has(key);
export const achievementMeta = (key) => BY_KEY.get(key) || null;
