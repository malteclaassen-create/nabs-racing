import { useEffect, useRef, useState } from "react";

// Connects to the backend live-timing relay (/api/live/ws, proxied by Vite to
// the backend, which in turn holds the upstream AC Server Manager socket).
// Auto-reconnects with backoff and exposes the latest board + a status flag.
export function useLiveTiming() {
  const [board, setBoard] = useState(null);
  const [socketState, setSocketState] = useState("connecting"); // connecting | open | closed
  const wsRef = useRef(null);
  const retryRef = useRef(1000);
  const timerRef = useRef(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    function connect() {
      if (!aliveRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const base = import.meta.env.VITE_API_BASE || `${proto}//${window.location.host}`;
      const url = base.replace(/^http/, "ws") + "/api/live/ws";

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
      };
      ws.onmessage = (ev) => {
        try {
          setBoard(JSON.parse(ev.data));
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

  return { board, socketState };
}
