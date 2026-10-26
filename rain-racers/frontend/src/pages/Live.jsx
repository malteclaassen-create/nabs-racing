import { useEffect, useRef, useState } from "react";
import { useSite, useApi } from "../site.jsx";
import { Empty, PageHeader } from "../components/ui.jsx";
import { lapTime, gapText } from "../format.js";

// Follows /api/live/ws. The server sends the whole board about once a second
// while something changes; a dropped connection is retried with a growing wait.
function useLiveBoard(enabled, slug) {
  const [board, setBoard] = useState(null);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let ws;
    let stopped = false;
    let delay = 1000;
    let timer;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/live/ws${slug ? `?series=${encodeURIComponent(slug)}` : ""}`);
      ws.onopen = () => {
        delay = 1000;
        setOnline(true);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "board") setBoard(msg.board);
        } catch {
          // ignore anything that is not a board
        }
      };
      ws.onclose = () => {
        setOnline(false);
        if (stopped) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [enabled, slug]);
  return { board, online };
}

// Session clock: counts on from the last snapshot so it ticks every second.
function SessionClock({ session }) {
  const ref = useRef({ at: Date.now(), snap: null });
  if (ref.current.snap !== session.snapshotAt) ref.current = { at: Date.now(), snap: session.snapshotAt };
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = session.elapsedMs + (Date.now() - ref.current.at);
  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  if (session.durationMin > 0) {
    return (
      <span>
        <span className="text-muted">Remaining</span> <b className="tabular">{fmt(session.durationMin * 60000 - elapsed)}</b>
      </span>
    );
  }
  return (
    <span>
      <span className="text-muted">Elapsed</span> <b className="tabular">{fmt(elapsed)}</b>
    </span>
  );
}

// The race server's own pages: joining it in Content Manager (the server
// manager's green Join button) and its full live timing, with the track map
// and every lap.
function ServerLinks({ links }) {
  if (!links?.join && !links?.liveTiming) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {links.join && (
        <a href={links.join} target="_blank" rel="noopener noreferrer" className="btn bg-emerald-500 py-1.5 text-black hover:bg-emerald-400" title="Opens Content Manager and joins the server">
          Join server
        </a>
      )}
      {links.liveTiming && (
        <a href={links.liveTiming} target="_blank" rel="noopener noreferrer" className="btn border border-line py-1.5 hover:border-ink">
          Full live timing ↗
        </a>
      )}
      {links.join && <span className="text-xs text-muted">Join opens Content Manager on your computer.</span>}
    </div>
  );
}

export default function Live() {
  const { settings, seriesList, series } = useSite();
  const live = seriesList.filter((s) => s.live);
  const [picked, setPicked] = useState(null);
  const slug = picked || (live.some((s) => s.slug === series?.slug) ? series.slug : live[0]?.slug) || null;
  const { board, online } = useLiveBoard(!!settings.liveEnabled, slug);
  const links = useApi(settings.liveEnabled && slug ? `/live/links?series=${slug}` : null).data;

  if (!settings.liveEnabled) return <Empty>Live timing is not set up yet.</Empty>;

  const session = board?.session;
  const isRace = session?.type === "Race";
  const leaderLaps = board?.rows?.[0]?.laps ?? 0;

  return (
    <div>
      <PageHeader eyebrow="Live timing" title={session ? session.name : "Live"}>
        <span className={`inline-flex items-center gap-2 text-sm font-bold ${board?.connected ? "text-emerald-400" : "text-muted"}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${board?.connected ? "live-dot bg-emerald-400 text-emerald-400" : "bg-muted"}`} />
          {!online ? "Connecting…" : board?.connected ? "Live" : "Waiting for the server"}
        </span>
      </PageHeader>

      {live.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {live.map((s) => (
            <button
              key={s.slug}
              onClick={() => setPicked(s.slug)}
              className={`btn border py-1.5 ${s.slug === slug ? "border-ink" : "border-line text-muted"}`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color || "rgb(var(--ink))" }} />
              {s.name}
            </button>
          ))}
        </div>
      )}

      <ServerLinks links={links} />

      {!session ? (
        <Empty>
          {!online ? "Connecting to the live timing…" : board?.connected ? "No session is running on the server right now." : "Connecting to the race server…"}
        </Empty>
      ) : (
        <>
          <div className="card mb-4 flex flex-wrap gap-x-6 gap-y-2 px-5 py-3 text-sm">
            <span>
              <span className="text-muted">Track</span> <b>{session.track}</b>
            </span>
            {isRace && session.laps > 0 && (
              <span>
                <span className="text-muted">Lap</span>{" "}
                <b className="tabular">
                  {Math.min(leaderLaps + 1, session.laps)} / {session.laps}
                </b>
              </span>
            )}
            <SessionClock session={session} />
            {session.ambientC != null && (
              <span>
                <span className="text-muted">Air</span> <b>{session.ambientC}°C</b>
              </span>
            )}
            {session.roadC != null && (
              <span>
                <span className="text-muted">Track</span> <b>{session.roadC}°C</b>
              </span>
            )}
          </div>

          {board.rows.length === 0 ? (
            <Empty>Nobody is on the server.</Empty>
          ) : (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-12 pl-5">Pos</th>
                    <th>Driver</th>
                    <th className="hidden sm:table-cell">Car</th>
                    <th className="text-right">Laps</th>
                    <th className="text-right">Gap</th>
                    <th className="text-right">Best</th>
                    <th className="pr-5 text-right">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((r) => (
                    <tr key={r.id} className={r.online ? "" : "opacity-50"}>
                      <td className="pl-5 font-black tabular">{r.position}</td>
                      <td>
                        <span className="inline-flex items-center gap-2">
                          {r.number && <span className="font-mono text-xs text-muted">#{r.number}</span>}
                          <span className="font-semibold">{r.name}</span>
                          {r.inPits && <span className="rounded bg-amber-400 px-1.5 text-[10px] font-black text-bg">PIT</span>}
                          {!r.online && <span className="text-[10px] font-bold uppercase text-muted">left</span>}
                        </span>
                      </td>
                      <td className="hidden text-muted sm:table-cell">{r.car}</td>
                      <td className="text-right tabular">{r.laps}</td>
                      <td className="text-right font-mono text-xs tabular">
                        {r.gap?.laps ? `+${r.gap.laps} L` : r.gap?.ms != null ? `${isRace ? "≈" : ""}${gapText(r.gap.ms)}` : ""}
                      </td>
                      <td
                        className={`text-right font-mono text-xs tabular ${r.bestLapMs && r.bestLapMs === board.fastestLapMs ? "font-bold text-fuchsia-400" : ""}`}
                      >
                        {lapTime(r.bestLapMs)}
                      </td>
                      <td className="pr-5 text-right font-mono text-xs tabular text-muted">{lapTime(r.lastLapMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
