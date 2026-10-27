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

// twice a second, so the cars on the map move along smoothly
const BOARD_EVERY_MS = 500;
const IDLE_CLOSE_MS = 60 * 1000;

// The running series with a live server: [{ slug, name, url, origin }]. An
// archived series is left off the live page even when the league's default
// server would cover it.
export async function liveSeries() {
  const [settings, series] = await Promise.all([
    getSettings(),
    prisma.series.findMany({ where: { archived: false }, orderBy: [{ order: "asc" }, { id: "asc" }] }),
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

// https://<host> of a live socket address
const siteOf = (socketUrl) => {
  try {
    const u = new URL(socketUrl);
    return `${u.protocol === "ws:" ? "http" : "https"}://${u.host}`;
  } catch {
    return "";
  }
};

const originOf = (url, origin) => {
  if (origin) return origin;
  try {
    const u = new URL(url);
    return `${u.protocol === "wss:" ? "https" : "http"}://${u.host}`;
  } catch {
    return null;
  }
};

// Whether a server manager answers on `url`, for the admin's Test button:
// connects, waits for the first snapshot and hangs up. Resolves to
// { ok: true, server, session } or { ok: false, error }.
export function probeServer(url, origin, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let ws;
    const done = (out) => {
      clearTimeout(timer);
      try {
        ws?.terminate();
      } catch {
        // already gone
      }
      resolve(out);
    };
    const timer = setTimeout(() => done({ ok: false, error: "No answer within a few seconds." }), timeoutMs);
    try {
      ws = new WebSocket(url, { headers: { Origin: originOf(url, origin) || "" } });
    } catch (e) {
      done({ ok: false, error: e.message });
      return;
    }
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.EventType !== 200) return;
        const info = msg.Message?.SessionInfo || {};
        done({ ok: true, server: info.ServerName || null, session: info.Name || null });
      } catch {
        // not a snapshot; keep waiting
      }
    });
    ws.on("unexpected-response", (_req, res) => done({ ok: false, error: `The server answered ${res.statusCode}.` }));
    ws.on("error", (e) => done({ ok: false, error: e.message }));
  });
}

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

  const board = () => {
    const b = buildBoard({
      status,
      liveByCar,
      progress,
      // live once the first snapshot is in: the server manager sends one as
      // soon as we connect, so an open socket without one is still starting
      connected: upstream?.readyState === WebSocket.OPEN && status !== null,
      snapshotAt,
    });
    // the map's picture comes straight from the server manager
    if (b.session?.map) b.session.map.url = siteOf(url) + b.session.map.path;
    return b;
  };

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
