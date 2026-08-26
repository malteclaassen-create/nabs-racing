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
      // Forward the VALUE, not a hardcoded 1: ?demo=practice asks the backend
      // for a practice board, which is the only way to see the half of the page
      // that shows a lap being built (see DEMO_MODES in the backend relay).
      const demo = new URLSearchParams(window.location.search).get("demo");
      if (demo != null) params.set("demo", demo || "1");
      const slug = /^\/s\/([^/]+)/.exec(window.location.pathname)?.[1];
      if (slug) params.set("series", slug);
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

  // Subscribe to fast-lane car telemetry; returns the unsubscribe.
  const onCarTelemetry = useCallback((cb) => {
    telListeners.current.add(cb);
    return () => telListeners.current.delete(cb);
  }, []);

  return { board, socketState, follow, onCarTelemetry };
}
