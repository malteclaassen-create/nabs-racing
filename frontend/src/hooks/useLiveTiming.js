import { useCallback, useEffect, useRef, useState } from "react";

// Connects to the backend live-timing relay (/api/live/ws, proxied by Vite to
// the backend, which in turn holds the upstream AC Server Manager socket).
// Auto-reconnects with backoff and exposes the latest board + a status flag.
//
// Besides the 700ms board there is a FOLLOW fast-lane: `follow(guid)` tells the
// backend which car this viewer watches on the map, and that car's cockpit
// numbers (speed/gear/revs) arrive as tiny `{car: …}` frames the moment the
// race server sends them. Those frames deliberately do NOT go through React
// state here — they fire several times a second and would re-render the whole
// live page; instead `onCarTelemetry(cb)` hands them to whoever subscribed
// (the map's readout chip), and only that component re-renders.
export function useLiveTiming() {
  const [board, setBoard] = useState(null);
  const [socketState, setSocketState] = useState("connecting"); // connecting | open | closed
  const wsRef = useRef(null);
  const retryRef = useRef(1000);
  const timerRef = useRef(null);
  const aliveRef = useRef(true);
  const followRef = useRef(null); // survives reconnects: re-announced on open
  // The race server this viewer switched to, or null for their series' own.
  // Like followRef it outlives a reconnect, and for the same reason: a dropped
  // socket must not quietly move somebody back to a different board.
  const serverRef = useRef(null);
  const [serverKey, setServerKey] = useState(null);
  const telListeners = useRef(new Set());

  useEffect(() => {
    aliveRef.current = true;

    function connect() {
      if (!aliveRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const base = import.meta.env.VITE_API_BASE || `${proto}//${window.location.host}`;
      // Forward the page's ?demo=1 so the backend can send the fabricated demo
      // board (dev/opt-in only there — a real visitor's plain URL never gets it).
      // The series slug from the /s/<slug> URL rides along too, so the backend
      // relays the race server ASSIGNED to this series (admin Live tab); no
      // slug = the default series on the first server.
      const params = new URLSearchParams();
      if (new URLSearchParams(window.location.search).has("demo")) params.set("demo", "1");
      const slug = /^\/s\/([^/]+)/.exec(window.location.pathname)?.[1];
      if (slug) params.set("series", slug);
      // Carried on the URL as well as re-sent on open, so the very first board
      // of a reconnect is already the right one rather than the series default
      // for a beat.
      if (serverRef.current) params.set("server", serverRef.current);
      const qs = params.toString();
      const url = base.replace(/^http/, "ws") + "/api/live/ws" + (qs ? `?${qs}` : "");

      let ws;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      setSocketState("connecting");

      ws.onopen = () => {
        retryRef.current = 1000;
        setSocketState("open");
        // A reconnect must not silently drop the follow — re-announce it.
        if (serverRef.current) {
          try {
            ws.send(JSON.stringify({ server: serverRef.current }));
          } catch {
            /* the URL parameter above already carried it */
          }
        }
        if (followRef.current) {
          try {
            ws.send(JSON.stringify({ follow: followRef.current }));
          } catch {
            /* the next follow() call repeats it */
          }
        }
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.car) {
            telListeners.current.forEach((cb) => cb(data.car));
            return; // fast-lane frame, not a board
          }
          setBoard(data);
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onclose = () => {
        setSocketState("closed");
        scheduleReconnect();
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      };
    }

    function scheduleReconnect() {
      if (!aliveRef.current || timerRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        retryRef.current = Math.min(retryRef.current * 2, 10000);
        connect();
      }, retryRef.current);
    }

    connect();

    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // don't trigger reconnect on unmount
        try {
          wsRef.current.close();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  // Which car this viewer follows on the map (null = none).
  const follow = useCallback((guid) => {
    followRef.current = guid || null;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ follow: followRef.current }));
      } catch {
        /* reconnect re-announces */
      }
    }
  }, []);

  // Switch which race server this viewer is watching. null hands them back to
  // the server their series is assigned to.
  const setServer = useCallback((key) => {
    serverRef.current = key || null;
    setServerKey(serverRef.current);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ server: serverRef.current }));
        return;
      } catch {
        /* fall through to the reconnect below */
      }
    }
    // Socket down: the next connect carries the key on its URL, so nothing is
    // lost by simply waiting for the backoff to come round.
  }, []);

  // Subscribe to fast-lane car telemetry; returns the unsubscribe.
  const onCarTelemetry = useCallback((cb) => {
    telListeners.current.add(cb);
    return () => telListeners.current.delete(cb);
  }, []);

  return { board, socketState, follow, onCarTelemetry, setServer, serverKey };
}
