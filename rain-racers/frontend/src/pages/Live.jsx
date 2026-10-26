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
        <a
          href={links.join}
          target="_blank"
          rel="noopener noreferrer"
          className="btn bg-emerald-500 py-1.5 text-black hover:bg-emerald-400"
          title="Opens Content Manager and joins the server"
        >
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

// A colour per driver, the same on the map and in the table.
const DRIVER_COLORS = ["#f43f5e", "#38bdf8", "#facc15", "#4ade80", "#c084fc", "#fb923c", "#2dd4bf", "#f472b6", "#a3e635", "#818cf8", "#fbbf24", "#e879f9"];
function colorOf(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DRIVER_COLORS[h % DRIVER_COLORS.length];
}

// The track from above, as the server manager draws it, with every car on
// it: a dot in the driver's colour with their place. Pointing at a driver in
// the table (or at a dot) names them. The board comes twice a second; the
// dots glide between.
function TrackMap({ map, rows, hover, setHover }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const at = (p) => ({
    left: `${(((p.x + map.offsetX) / map.scale + map.padding) / map.width) * 100}%`,
    top: `${(((p.z + map.offsetZ) / map.scale + map.padding) / map.height) * 100}%`,
  });
  const cars = rows.filter((r) => r.pos);
  return (
    <section className="card relative flex items-center justify-center p-4 sm:p-6">
      <div className="relative w-full" style={{ aspectRatio: `${map.width} / ${map.height}`, maxHeight: "70vh", maxWidth: `calc(70vh * ${map.width / map.height})` }}>
        <img src={map.url} alt="" className="absolute inset-0 h-full w-full select-none object-contain opacity-90" onError={() => setFailed(true)} draggable="false" />
        {cars
          .slice()
          .reverse()
          .map((r) => {
            const on = hover === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onMouseEnter={() => setHover(r.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setHover(on ? null : r.id)}
                className="absolute -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-500 ease-linear"
                style={{ ...at(r.pos), zIndex: on ? 30 : 20 - Math.min(r.position, 19) }}
                aria-label={`${r.position}. ${r.name}`}
              >
                <span
                  className={`flex items-center justify-center rounded-full font-black text-black shadow-[0_0_0_2px_rgba(0,0,0,0.85)] transition-all ${on ? "h-8 w-8 text-sm" : "h-6 w-6 text-[11px]"} ${r.inPits ? "opacity-50" : ""}`}
                  style={{ background: colorOf(r.id) }}
                >
                  {r.position}
                </span>
                {on && (
                  <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/85 px-2 py-0.5 text-xs font-bold text-white">
                    {r.name}
                  </span>
                )}
              </button>
            );
          })}
      </div>
    </section>
  );
}

export default function Live() {
  const { settings, seriesList, series } = useSite();
  const live = seriesList.filter((s) => s.live);
  const [picked, setPicked] = useState(null);
  const slug = picked || (live.some((s) => s.slug === series?.slug) ? series.slug : live[0]?.slug) || null;
  const { board, online } = useLiveBoard(!!settings.liveEnabled, slug);
  const links = useApi(settings.liveEnabled && slug ? `/live/links?series=${slug}` : null).data;
  const [hover, setHover] = useState(null);

  if (!settings.liveEnabled) return <Empty>{seriesList.some((s) => !s.archived) ? "Live timing is not set up yet." : "No series is running right now."}</Empty>;

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
            <button key={s.slug} onClick={() => setPicked(s.slug)} className={`btn border py-1.5 ${s.slug === slug ? "border-ink" : "border-line text-muted"}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color || "rgb(var(--ink))" }} />
              {s.name}
            </button>
          ))}
        </div>
      )}

      <ServerLinks links={links} />

      {!session ? (
        <Empty>{!online ? "Connecting to the live timing…" : board?.connected ? "No session is running on the server right now." : "Connecting to the race server…"}</Empty>
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
            <>
              {session.map && <TrackMap map={session.map} rows={[]} hover={hover} setHover={setHover} />}
              <Empty>Nobody is on the server.</Empty>
            </>
          ) : (
            <div className={session.map ? "grid items-start gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" : ""}>
              {session.map && <TrackMap map={session.map} rows={board.rows} hover={hover} setHover={setHover} />}
              <div className="card overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-12 pl-5">Pos</th>
                      <th>Driver</th>
                      <th className="hidden sm:table-cell">Car</th>
                      <th className="hidden text-right sm:table-cell">Laps</th>
                      <th className="text-right">Gap</th>
                      <th className="pr-5 text-right sm:pr-3">Best</th>
                      <th className="hidden pr-5 text-right sm:table-cell">Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.rows.map((r) => (
                      <tr
                        key={r.id}
                        className={`${r.online ? "" : "opacity-50"} ${hover === r.id ? "bg-white/[0.06]" : ""}`}
                        onMouseEnter={() => setHover(r.id)}
                        onMouseLeave={() => setHover(null)}
                      >
                        <td className="pl-5 font-black tabular">{r.position}</td>
                        <td>
                          <span className="inline-flex items-center gap-2">
                            {r.pos && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(r.id) }} />}
                            {r.number && <span className="hidden font-mono text-xs text-muted sm:inline">#{r.number}</span>}
                            <span className="font-semibold">{r.name}</span>
                            {r.inPits && <span className="rounded bg-amber-400 px-1.5 text-[10px] font-black text-bg">PIT</span>}
                            {!r.online && <span className="hidden text-[10px] font-bold uppercase text-muted sm:inline">left</span>}
                          </span>
                        </td>
                        <td className="hidden text-muted sm:table-cell">{r.car}</td>
                        <td className="hidden text-right tabular sm:table-cell">{r.laps}</td>
                        <td className="text-right font-mono text-xs tabular lg:text-sm">
                          {r.gap?.laps ? `+${r.gap.laps} L` : r.gap?.ms != null ? `${isRace ? "≈" : ""}${gapText(r.gap.ms)}` : ""}
                        </td>
                        <td
                          className={`pr-5 text-right font-mono text-xs tabular sm:pr-3 lg:text-sm ${r.bestLapMs && r.bestLapMs === board.fastestLapMs ? "font-bold text-fuchsia-400" : ""}`}
                        >
                          {lapTime(r.bestLapMs)}
                        </td>
                        <td className="hidden pr-5 text-right font-mono text-xs tabular text-muted sm:table-cell lg:text-sm">{lapTime(r.lastLapMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
