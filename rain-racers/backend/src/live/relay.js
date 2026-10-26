import { WebSocketServer, WebSocket } from "ws";
import { getSettings } from "../lib/settings.js";
import { buildBoard, createProgress } from "./board.js";

// Live timing relay.
//
// The AC Server Manager's live socket refuses browsers from other sites (it
// checks the Origin header), so the browser cannot connect to it directly.
// This server connects instead, with the right Origin, and passes a cleaned-up
// timing board on to the live page over /api/live/ws.
//
// The upstream connection is only open while somebody is watching: the first
// viewer opens it, and it closes a minute after the last one has left.

const BOARD_EVERY_MS = 1000;
const IDLE_CLOSE_MS = 60 * 1000;

let wss = null;
let upstream = null;
let reconnectTimer = null;
let reconnectDelay = 2000;
let idleTimer = null;
let tickTimer = null;
let connecting = false; // between the settings read and the socket being made

let status = null; // latest snapshot (EventType 200)
let snapshotAt = null;
const liveByCar = new Map(); // CarID -> latest position update (EventType 53)
const guidByCar = new Map();
const progress = createProgress();
let lastBoardJson = "";
let sessionKey = "";

export async function liveConfigured() {
  return !!(await getSettings()).liveWsUrl;
}

function board() {
  return buildBoard({
    status,
    liveByCar,
    progress,
    // live once the first snapshot is in: the server manager sends one as
    // soon as we connect, so an open socket without one is still starting
    connected: upstream?.readyState === WebSocket.OPEN && status !== null,
    snapshotAt,
  });
}

function broadcast(force = false) {
  if (!wss) return;
  const json = JSON.stringify({ type: "board", board: board() });
  if (!force && json === lastBoardJson) return;
  lastBoardJson = json;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(json);
  }
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

async function connectUpstream() {
  clearTimeout(reconnectTimer);
  if (connecting || upstream) return;
  connecting = true;
  let settings;
  try {
    settings = await getSettings();
  } finally {
    connecting = false;
  }
  const { liveWsUrl, liveOrigin } = settings;
  if (!liveWsUrl || !wss || wss.clients.size === 0) return;
  let origin = liveOrigin;
  if (!origin) {
    // the server manager's own address, from the socket address
    try {
      const u = new URL(liveWsUrl);
      origin = `${u.protocol === "wss:" ? "https" : "http"}://${u.host}`;
    } catch {
      return;
    }
  }

  const socket = new WebSocket(liveWsUrl, { headers: { Origin: origin }, perMessageDeflate: false, handshakeTimeout: 15000 });
  upstream = socket;

  socket.on("open", () => {
    reconnectDelay = 2000;
    console.log("live: connected to", liveWsUrl);
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
    }
    else if (msg.EventType === 53) onCarUpdate(msg.Message);
  });
  socket.on("error", (err) => console.warn("live: upstream error:", err.message));
  socket.on("close", () => {
    if (upstream !== socket) return; // replaced on purpose
    upstream = null;
    broadcast(true);
    if (wss && wss.clients.size > 0) {
      reconnectTimer = setTimeout(connectUpstream, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60000);
    }
  });
}

function closeUpstream() {
  clearTimeout(reconnectTimer);
  const socket = upstream;
  upstream = null;
  if (socket) socket.terminate();
  status = null;
  liveByCar.clear();
  progress.clear();
  sessionKey = "";
}

// Called when the admin changes the server address.
export function restartLive() {
  closeUpstream();
  broadcast(true);
  connectUpstream();
}

export function attachLive(httpServer) {
  wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/api/live/ws")) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));
    ws.on("close", () => {
      if (wss.clients.size === 0) idleTimer = setTimeout(closeUpstream, IDLE_CLOSE_MS);
    });
    clearTimeout(idleTimer);
    ws.send(JSON.stringify({ type: "board", board: board() }));
    connectUpstream();
  });

  tickTimer = setInterval(() => {
    if (wss.clients.size > 0) broadcast();
  }, BOARD_EVERY_MS);

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
  tickTimer.unref();
}
