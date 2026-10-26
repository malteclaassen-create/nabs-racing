// A stand-in for an AC Server Manager's live socket, for trying the live page
// without a real server. Six cars drive laps of Spa; a snapshot goes out every
// few seconds and position updates ten times a second, like the real thing.
//
//   npm run fake-live                      (race)
//   npm run fake-live -- practice          (practice: sorted by best lap)
// then set Live timing to ws://localhost:4100/api/race-control in the admin.
import { WebSocketServer } from "ws";

const PORT = Number(process.env.FAKE_PORT) || 4100;
const RACE = process.argv[2] !== "practice";
const names = ["Alex Storm", "Mia Drizzle", "Jonas Puddle", "Lena Mist", "Tom Gale", "Sara Hail"];
const baseLapMs = [118000, 118300, 118600, 119000, 119400, 120000];
const NS = 1e6;

const cars = names.map((name, i) => ({
  id: i,
  guid: `7656119000000${String(i).padStart(4, "0")}`,
  name,
  lapMs: baseLapMs[i],
  spline: 0.98 - i * 0.004,
  laps: 0,
  best: null,
  last: null,
  lapStart: Date.now(),
  pits: false,
}));
const started = Date.now();

function tick(dt) {
  for (const c of cars) {
    c.spline += dt / c.lapMs;
    if (c.spline >= 1) {
      c.spline -= 1;
      const lap = Date.now() - c.lapStart + Math.round(Math.random() * 800);
      c.lapStart = Date.now();
      if (c.laps > 0 || !RACE) {
        c.last = lap;
        if (!c.best || lap < c.best) c.best = lap;
      }
      c.laps++;
    }
  }
}

function snapshot() {
  const drivers = {};
  for (const c of cars) {
    const split = c.best ? { 0: { SplitIndex: 0, SplitTime: (c.best / 3) * NS }, 1: { SplitIndex: 1, SplitTime: (c.best / 3) * NS }, 2: { SplitIndex: 2, SplitTime: (c.best / 3) * NS } } : null;
    drivers[c.guid] = {
      CarInfo: { DriverName: c.name, CarID: c.id, CarModel: "ks_porsche_911_gt3_r_2016", CarName: "Porsche 911 GT3 R", RaceNumber: 10 + c.id },
      TotalNumLaps: c.laps,
      Cars: {
        ks_porsche_911_gt3_r_2016: {
          NumLaps: c.laps,
          BestLap: c.best ? c.best * NS : 0,
          LastLap: c.last ? c.last * NS : 0,
          BestLapSplits: split,
        },
      },
    };
  }
  return {
    EventType: 200,
    Message: {
      SessionInfo: { Type: RACE ? 3 : 1, Name: RACE ? "Race" : "Practice", Track: "spa", TrackConfig: "", Laps: RACE ? 20 : 0, Time: RACE ? 0 : 60, ElapsedMilliseconds: Date.now() - started, AmbientTemp: 14, RoadTemp: 17, CurrentSessionIndex: 0 },
      ConnectedDrivers: { Drivers: drivers },
      DisconnectedDrivers: { Drivers: {} },
    },
  };
}

const wss = new WebSocketServer({ port: PORT, path: "/api/race-control" });
wss.on("connection", (ws, req) => {
  console.log("viewer connected, Origin:", req.headers.origin);
  ws.send(JSON.stringify(snapshot()));
});

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  tick(now - last);
  last = now;
  const order = [...cars].sort((a, b) => b.laps + b.spline - (a.laps + a.spline));
  for (const c of cars) {
    const msg = JSON.stringify({ EventType: 53, Message: { CarID: c.id, NormalisedSplinePos: c.spline, RacePosition: order.indexOf(c) + 1, IsInPits: c.pits } });
    for (const ws of wss.clients) ws.send(msg);
  }
}, 100);
setInterval(() => {
  const msg = JSON.stringify(snapshot());
  for (const ws of wss.clients) ws.send(msg);
}, 3000);

console.log(`Fake server manager on ws://localhost:${PORT}/api/race-control (${RACE ? "race" : "practice"})`);
