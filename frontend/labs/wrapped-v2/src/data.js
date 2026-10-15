// The sample season the lab tells: the same driver and numbers as the first
// test page (test/wrapped), so the two can be compared side by side.
export const DATA = {
  season: { number: 8, label: "Season 8", rounds: 12 },
  driver: { name: "Malte", number: 22, country: "de", team: { name: "Brawn GP", color: "#B6FF00" } },
  championship: {
    position: 3,
    points: 165,
    fieldSize: 28,
    journey: [
      { round: 1, position: 6, points: 8, track: "Imola" },
      { round: 2, position: 4, points: 26, track: "Watkins Glen" },
      { round: 3, position: 4, points: 36, track: "Red Bull Ring" },
      { round: 4, position: 5, points: 40, track: "Most" },
      { round: 5, position: 4, points: 52, track: "Spa" },
      { round: 6, position: 3, points: 67, track: "Baku" },
      { round: 7, position: 2, points: 92, track: "Monza" },
      { round: 8, position: 3, points: 92, track: "Suzuka" },
      { round: 9, position: 3, points: 110, track: "Interlagos" },
      { round: 10, position: 3, points: 135, track: "Silverstone" },
      { round: 11, position: 2, points: 153, track: "Zandvoort" },
      { round: 12, position: 3, points: 165, track: "Abu Dhabi" },
    ],
  },
  stats: { starts: 12, finishes: 11, wins: 2, podiums: 6, poles: 1, fastestLaps: 2, dnf: 1, positionsGained: 22, overtakes: 142, lapsLed: 37, dotd: 2 },
  best: { round: 7, track: "Monza", position: 1, grid: 3, points: 35 },
  climb: { round: 5, track: "Spa", grid: 14, position: 4, gained: 10 },
  wins: [
    { round: 7, track: "Monza" },
    { round: 10, track: "Silverstone" },
  ],
  teammate: { name: "Pizd", ahead: 5, behind: 6, qualiAhead: 4, qualiBehind: 8, points: 178, myPoints: 165 },
  rival: { name: "Pizd", position: 2, points: 178, gap: 13 },
  honours: [
    { key: "third", title: "Third overall", detail: "On the championship podium" },
    { key: "dotd", title: "Driver of the Day ×2", detail: "Voted by the grid, twice" },
  ],
  type: { title: "The Podium Regular", line: "6 podiums from 12 starts." },
};

// The real car, filmed from the league's mod (test/wrapped's films, shared).
const FILMS = "../wrapped/cars/formula_2010/brawn/";
export const FILM = {
  intro: { src: `${FILMS}intro.mp4`, poster: `${FILMS}intro.jpg` },
  climb: { src: `${FILMS}climb.mp4`, poster: `${FILMS}climb.jpg` },
  podium: { src: `${FILMS}podium.mp4`, poster: `${FILMS}podium.jpg` },
};
