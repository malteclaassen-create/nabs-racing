import { WebSocketServer, WebSocket } from "ws";
import prisma from "../db.js";
import { getSettings } from "../lib/settings.js";
import { buildBoard, createProgress } from "./board.js";

// Live timing relay.
//
// The AC Server Manager's live socket refuses browsers from other sites (it
// checks the Origin header), so the browser cannot connect to it directly.
// This server connects instead, with the right Origin, and passes a cleaned-up
// timing board on to the live page over /api/live/ws?series=<slug>.
//
// Each series can run on its own server (Series.liveWsUrl, else the league's
// address from the settings). There is one relay per server address, shared by
// every series pointing at it. A relay's upstream connection is only open
// while somebody is watching: the first viewer opens it, and it closes a
// minute after the last one has left.

const BOARD_EVERY_MS = 1000;
const IDLE_CLOSE_MS = 60 * 1000;

// The series with a live server: [{ slug, name, url, origin }].
export async function liveSeries() {
  const [settings, series] = await Promise.all([
    getSettings(),
    prisma.series.findMany({ orderBy: [{ order: "asc" }, { id: "asc" }] }),
  ]);
  return series
    .map((s) => ({
      slug: s.slug,
      name: s.name,
      url: s.liveWsUrl || settings.liveWsUrl || "",
      origin: s.liveWsUrl ? s.liveOrigin || "" : settings.liveOrigin || "",
    }))
    .filter((s) => s.url);
}

const originOf = (url, origin) => {
  if (origin) return origin;
  try {
    const u = new URL(url);
    return `${u.protocol === "wss:" ? "https" : "http"}://${u.host}`;
  } catch {
    return null;
  }
};

function createRelay(url, origin) {
  const clients = new Set();
  let upstream = null;
  let reconnectTimer = null;
  let reconnectDelay = 2000;
  let idleTimer = null;
  let status = null; // latest snapshot (EventType 200)
  let snapshotAt = null;
  const liveByCar = new Map(); // CarID -> latest position update (EventType 53)
  const guidByCar = new Map();
  const progress = createProgress();
  let lastBoardJson = "";
  let sessionKey = "";

  const board = () =>
    buildBoard({
      status,
      liveByCar,
      progress,
      // live once the first snapshot is in: the server manager sends one as
      // soon as we connect, so an open socket without one is still starting
      connected: upstream?.readyState === WebSocket.OPEN && status !== null,
      snapshotAt,
    });

  function broadcast(force = false) {
    const json = JSON.stringify({ type: "board", board: board() });
    if (!force && json === lastBoardJson) return;
    lastBoardJson = json;
    for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(json);
  }

  function onSnapshot(msg) {
    const si = msg?.SessionInfo || {};
    const key = [si.Track, si.TrackConfig, si.Type, si.Name, si.CurrentSessionIndex].join("|");
    if (key !== sessionKey) {
      // a new session: forget the old one's positions
      sessionKey = key;
      liveByCar.clear();
      progress.clear();
    }
    status = msg;
    snapshotAt = Date.now();
    guidByCar.clear();
    for (const [guid, d] of Object.entries(msg?.ConnectedDrivers?.Drivers || {})) {
      const ci = d?.CarInfo || {};
      if (typeof ci.CarID === "number") guidByCar.set(ci.CarID, guid);
      const car = (d.Cars && d.Cars[ci.CarModel]) || null;
      progress.snapshot(guid, Number(car?.NumLaps ?? d.TotalNumLaps ?? 0) || 0);
    }
  }

  function onCarUpdate(msg) {
    if (typeof msg?.CarID !== "number") return;
    liveByCar.set(msg.CarID, msg);
    const guid = guidByCar.get(msg.CarID);
    if (guid) progress.update(guid, Number(msg.NormalisedSplinePos));
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (upstream || clients.size === 0) return;
    const socket = new WebSocket(url, { headers: { Origin: originOf(url, origin) }, perMessageDeflate: false, handshakeTimeout: 15000 });
    upstream = socket;
    socket.on("open", () => {
      reconnectDelay = 2000;
      console.log("live: connected to", url);
      // no broadcast yet: until the first snapshot there is nothing to show,
      // and an empty board would read as "no session running"
    });
    socket.on("message", (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (msg.EventType === 200) {
        onSnapshot(msg.Message);
        broadcast(); // show a new snapshot at once, not on the next tick
      } else if (msg.EventType === 53) onCarUpdate(msg.Message);
    });
    socket.on("error", (err) => console.warn("live: upstream error:", err.message));
    socket.on("close", () => {
      if (upstream !== socket) return; // replaced on purpose
      upstream = null;
      broadcast(true);
      if (clients.size > 0) {
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 60000);
      }
    });
  }

  function close() {
    clearTimeout(reconnectTimer);
    const socket = upstream;
    upstream = null;
    if (socket) socket.terminate();
    status = null;
    liveByCar.clear();
    progress.clear();
    sessionKey = "";
  }

  return {
    add(ws) {
      clients.add(ws);
      clearTimeout(idleTimer);
      ws.send(JSON.stringify({ type: "board", board: board() }));
      connect();
      ws.on("close", () => {
        clients.delete(ws);
        if (clients.size === 0) idleTimer = setTimeout(close, IDLE_CLOSE_MS);
      });
    },
    tick() {
      if (clients.size > 0) broadcast();
    },
    stop() {
      close();
      for (const ws of clients) ws.close();
    },
  };
}

const relays = new Map(); // "url|origin" -> relay

// Called when an admin changes a server address: every viewer reconnects
// and lands on the relay for the new address.
export function restartLive() {
  for (const relay of relays.values()) relay.stop();
  relays.clear();
}

export function attachLive(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/api/live/ws")) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", async (ws, req) => {
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));
    const slug = new URL(req.url, "http://x").searchParams.get("series");
    const list = await liveSeries();
    const target = list.find((s) => s.slug === slug) || list[0];
    if (!target) {
      ws.send(JSON.stringify({ type: "board", board: buildBoard({ status: null, connected: false }) }));
      return;
    }
    const key = `${target.url}|${target.origin}`;
    if (!relays.has(key)) relays.set(key, createRelay(target.url, target.origin));
    if (ws.readyState === WebSocket.OPEN) relays.get(key).add(ws);
  });

  setInterval(() => {
    for (const relay of relays.values()) relay.tick();
  }, BOARD_EVERY_MS).unref();

  // drop viewers whose connection died without saying so
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000).unref();
}
