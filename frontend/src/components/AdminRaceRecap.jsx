import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Notice, CardHead } from "./ui.jsx";
import SlidingTabs from "./SlidingTabs.jsx";
import { openRaceRecap } from "./RaceRecap.jsx";
import { fmtStamp } from "../utils/format.js";

// The race recap's switch, and a way to look at it before anybody else does.
//
// The recap is what a member sees the first time they open the site after a
// round has been saved: a few pages about their race, the championship, their
// live rating and the NABS Points it paid (backend lib/raceRecap.js). Off is
// off; "admins only" puts it in front of league admins on the real site so it
// can be checked on a real round first; "everyone" is the launch.

const MODE_TEXT = {
  off: "Off. Nobody sees a recap, and nothing about it shows anywhere on the site.",
  admins: "Admins only. League admins get the recap after a saved round, exactly as members will; members see nothing yet.",
  all: "Everyone. After each saved round, every member with a seat gets their recap once, the next time they open the site.",
};

function ModeSwitch({ mode, onChange, busy }) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <div className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">Race recap</div>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-light">{MODE_TEXT[mode] || MODE_TEXT.off}</p>
      </div>
      <SlidingTabs
        items={[
          { key: "off", label: "Off" },
          { key: "admins", label: "Admins only" },
          { key: "all", label: "Everyone" },
        ]}
        value={mode || "off"}
        onChange={(m) => !busy && m !== mode && onChange(m)}
        wrapClassName="inline-flex rounded-xl border border-border bg-surface2/60 p-1"
        btnClassName="px-3 py-1.5 text-[13px]"
      />
    </div>
  );
}

export default function AdminRaceRecap() {
  const { data, error: loadError, reload } = useApi(useCallback(() => api.adminRaceRecap(), []));
  const { data: races } = useApi(useCallback(() => api.races(), []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // The preview: a finished round, and whose seat to tell it from.
  const [raceId, setRaceId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [drivers, setDrivers] = useState([]);

  const rounds = [...(races || [])]
    .filter((r) => r.isCompleted && r.number != null)
    .sort((a, b) => (b.number ?? 0) - (a.number ?? 0));

  useEffect(() => {
    setDrivers([]);
    setDriverId("");
    if (!raceId) return;
    let alive = true;
    api
      .raceResults(raceId)
      .then((d) => {
        if (!alive) return;
        const list = (d.results || []).map((r) => ({ id: r.driverId, name: r.name, position: r.position, status: r.status }));
        setDrivers(list);
        setDriverId(list[0]?.id || "");
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [raceId]);

  async function setMode(mode) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.setRaceRecapMode(mode);
      setDone(mode === "all" ? "The race recap is on for everyone." : mode === "admins" ? "The race recap is on for admins only." : "The race recap is off.");
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!raceId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.adminRaceRecapPreview(raceId, driverId || null);
      if (r?.recap) openRaceRecap(r.recap, { preview: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <ErrorBox message={loadError} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      {error && <ErrorBox message={error} />}
      {done && <Notice kind="success">{done}</Notice>}

      <ModeSwitch mode={data.mode} busy={busy} onChange={setMode} />

      <div className="card space-y-4 p-5">
        <CardHead eyebrow="What members get" title="How the recap works" />
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-light">
          <li>It opens once, on the first page a member visits after a round was saved, and not over the live page or the admin.</li>
          <li>It is offered for the newest finished round only, and only within ten days of the race. Closing it counts as seen.</li>
          <li>The pages: the podium, the member's own race in numbers, where the championship stands now, the live rating's move, and what the round paid in NABS Points. The rating page only shows once the driver has a rating; the points page only while NABS Points are switched on for that member.</li>
          <li>A member can read it again from the Recap button on that round's results page.</li>
          <li>Everything is worked out from the saved results when the recap opens, so a penalty added later shows the next time it is read.</li>
        </ul>
      </div>

      <div className="card space-y-4 p-5">
        <CardHead eyebrow="See it first" title="Preview a round" />
        <p className="text-sm text-light">
          Open the recap of any finished round from any driver's seat. A preview never counts as seen for anybody.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Round"
            className="input max-w-[22rem] py-1.5 text-sm"
            value={raceId}
            onChange={(e) => setRaceId(e.target.value)}
            disabled={busy}
          >
            <option value="">Choose a round…</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                R{r.number} · {r.track}
                {r.date ? ` · ${fmtStamp(r.date)}` : ""}
              </option>
            ))}
          </select>
          <select
            aria-label="Driver"
            className="input max-w-[18rem] py-1.5 text-sm"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            disabled={busy || !raceId}
          >
            <option value="">Spectator (no seat)</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.status === "FINISHED" && d.position != null ? `P${d.position}` : d.status} · {d.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary" onClick={preview} disabled={busy || !raceId}>
            {busy ? "Opening…" : "Open preview"}
          </button>
        </div>
        {!rounds.length && <p className="text-xs text-light">No finished round in the season being edited yet.</p>}
      </div>
    </div>
  );
}
