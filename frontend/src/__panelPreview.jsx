// TEMPORARY — a harness for looking at AdminResultGraphic without the admin PIN.
// Patches the api object with canned answers, then renders the real component.
import ReactDOM from "react-dom/client";
import { api } from "./api/client.js";
import "./index.css";

const TEAMS = ["ferrari", "mclaren", "redbull", "williams", "lotus", "renault", "honda", "porsche", "bmw", "toyota"];
const NAMES = ["Maltegoat", "13bot", "mtimmis", "Steve", "A. Verylongnameindeed", "Duck", "Pizd", "Takoda", "Nab", "Jonesy"];
const CC = ["de", "gb", "ch", "us", "np", "qa", "fr", "it", "es", null];
const PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const GAPS = [0, 1234, 5678, 12345, 23456, 34567, 45678, 65231, 88999, 0];

const results = NAMES.map((name, i) => ({
  driverId: `d${i}`, name, position: i + 1, status: "FINISHED", points: PTS[i], country: CC[i],
  totalTimeMs: 1_234_567 + GAPS[i], penaltySeconds: i === 3 ? 5 : 0, laps: i === 9 ? 19 : 20,
  team: { id: TEAMS[i], name: TEAMS[i], tier: i > 6 ? 2 : 1, logoUrl: `/teams/${TEAMS[i]}.png` },
}));

let stored = {
  zoom: 1.8, x: -60, y: 20,
  presets: [
    { name: "S8 cars", zoom: 1.8, x: -60, y: 20 },
    { name: "Whole car", zoom: 1, x: 0, y: 0 },
  ],
};

api.teams = async () => TEAMS.map((t) => ({ id: t, name: t, color: "#e10600", logoUrl: `/teams/${t}.png` }));
api.teamArt = async () => Object.fromEntries(TEAMS.slice(0, 3).map((t) => [t, { car: `/teams/${t}.png` }]));
api.posterFraming = async () => stored;
api.setPosterFraming = async (patch) => {
  stored = { ...stored, ...patch };
  return stored;
};
api.raceResults = async () => ({ race: { number: 7, track: "Hockenheim", type: "CHAMPIONSHIP" }, results });
api.updateDriver = async () => ({});

const { default: AdminResultGraphic } = await import("./components/AdminResultGraphic.jsx");

ReactDOM.createRoot(document.getElementById("root")).render(
  <div className="mx-auto max-w-5xl p-6">
    <AdminResultGraphic raceId="r7" />
  </div>
);
