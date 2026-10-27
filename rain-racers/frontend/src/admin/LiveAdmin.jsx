import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAction, useAdminList, Message, Section, LiveTestButton } from "./common.jsx";
import SettingsAdmin from "./SettingsAdmin.jsx";

// Which server each running series follows on the Live page. A league can
// have several AC Server Managers (Rain Racers has two: the Wednesday series
// on one, Sahara Saturdays on the other), so every series has its own
// address; one left empty follows the default server below, and a series
// with neither is not on the Live page.
export default function LiveAdmin() {
  const { data: series, reload } = useAdminList("/admin/series");
  const [defaults, setDefaults] = useState(null);
  useEffect(() => {
    api.get("/admin/settings").then(setDefaults);
  }, []);
  const running = (series || []).filter((s) => !s.archived);
  // the addresses in use, offered in every field
  const known = [...new Set([...(series || []).map((s) => s.liveWsUrl), defaults?.liveWsUrl].filter(Boolean))];

  return (
    <div className="space-y-6">
      <Section title="Servers by series">
        <p className="mb-4 text-sm text-muted">
          The AC Server Manager each series races on: paste its address (<code className="text-ink">rain.emperorservers.com</code>) or its live timing page, and it is saved as the live
          socket (<code className="text-ink">wss://…/api/race-control</code>). Empty: the series follows the default server below. Archived series are not on the Live page.
        </p>
        <datalist id="live-servers">
          {known.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <ul className="divide-y divide-line">
          {running.map((s) => (
            <SeriesServer key={s.id} series={s} fallback={defaults?.liveWsUrl} onSaved={reload} />
          ))}
        </ul>
      </Section>
      <SettingsAdmin part="live" />
    </div>
  );
}

function SeriesServer({ series, fallback, onSaved }) {
  const [url, setUrl] = useState(series.liveWsUrl || "");
  const [origin, setOrigin] = useState(series.liveOrigin || "");
  const [more, setMore] = useState(!!series.liveOrigin);
  const { busy, message, run } = useAction();
  const [savedUrl, setSavedUrl] = useState(series.liveWsUrl || "");
  const [savedOrigin, setSavedOrigin] = useState(series.liveOrigin || "");
  const changed = url !== savedUrl || origin !== savedOrigin;
  async function save(e) {
    e.preventDefault();
    const saved = await run(() => api.put(`/admin/series/${series.id}`, { liveWsUrl: url, liveOrigin: origin }), "Saved.");
    if (saved) {
      // what was kept: a pasted page address comes back as the live socket
      setUrl(saved.liveWsUrl || "");
      setOrigin(saved.liveOrigin || "");
      setSavedUrl(saved.liveWsUrl || "");
      setSavedOrigin(saved.liveOrigin || "");
      onSaved();
    }
  }
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <form onSubmit={save} className="space-y-2">
        <div className="flex items-center gap-2 font-bold">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: series.color || "rgb(var(--ink))" }} />
          {series.name}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input min-w-0 flex-1 basis-72 font-mono text-xs"
            list="live-servers"
            placeholder={fallback ? `Default: ${fallback}` : "No server: not on the Live page"}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label={`Live server of ${series.name}`}
          />
          <button className="btn-accent py-1.5" disabled={busy || !changed}>
            Save
          </button>
          <LiveTestButton url={url || fallback} origin={url ? origin : undefined} />
        </div>
        {more ? (
          <input className="input font-mono text-xs" placeholder="Origin (optional, else taken from the address)" value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Origin" />
        ) : (
          <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => setMore(true)}>
            Origin…
          </button>
        )}
        <Message message={message} />
      </form>
    </li>
  );
}
