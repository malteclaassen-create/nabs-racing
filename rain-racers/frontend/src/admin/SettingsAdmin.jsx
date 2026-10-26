import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useSite } from "../site.jsx";
import { useAction, Message, Section, Field } from "./common.jsx";

export default function SettingsAdmin() {
  const { reload: reloadSite } = useSite();
  const [f, setF] = useState(null);
  const { busy, message, run } = useAction();
  useEffect(() => {
    api.get("/admin/settings").then((s) => setF({ ...s, pointsTable: s.pointsTable.join(", ") }));
  }, []);
  if (!f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    const saved = await run(() => api.put("/admin/settings", f), "Settings saved.");
    if (saved) {
      setF({ ...saved, pointsTable: saved.pointsTable.join(", ") });
      reloadSite();
    }
  }

  async function uploadLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const saved = await run(() => api.post("/admin/logo", form), "Logo uploaded.");
    if (saved) {
      setF({ ...f, logoUrl: saved.logoUrl });
      reloadSite();
    }
    e.target.value = "";
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Section title="League">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="League name">
            <input className="input" value={f.leagueName} onChange={set("leagueName")} />
          </Field>
          <Field label="Tagline">
            <input className="input" value={f.tagline} onChange={set("tagline")} />
          </Field>
          <Field label="Discord invite link">
            <input className="input" placeholder="https://discord.gg/…" value={f.discordInvite} onChange={set("discordInvite")} />
          </Field>
          <Field label="YouTube channel">
            <input className="input" placeholder="https://www.youtube.com/@…" value={f.youtubeUrl} onChange={set("youtubeUrl")} />
          </Field>
          <Field label="League colour (white like the logo, or a series colour)">
            <div className="flex items-center gap-3">
              <input type="color" className="h-9 w-11 cursor-pointer rounded border border-line bg-bg" value={f.accentColor} onChange={set("accentColor")} />
              <input className="input w-32 font-mono" value={f.accentColor} onChange={set("accentColor")} />
            </div>
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          {f.logoUrl ? <img src={f.logoUrl} alt="Logo" className="h-12 w-auto rounded" /> : <span className="flex items-center gap-3 text-sm text-muted">
              <img src="/brand/logo-256.png" alt="" className="h-12 w-12 rounded-full ring-1 ring-white/25" />
              No logo uploaded: the Rain Racers logo is used.
            </span>}
          <label className="btn-ghost cursor-pointer">
            Upload logo
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadLogo} />
          </label>
          {f.logoUrl && (
            <button
              type="button"
              className="btn-danger"
              onClick={async () => {
                const saved = await run(() => api.del("/admin/logo"), "Logo removed.");
                if (saved) {
                  setF({ ...f, logoUrl: null });
                  reloadSite();
                }
              }}
            >
              Remove logo
            </button>
          )}
        </div>
      </Section>

      <Section title="Points">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Points for P1, P2, P3, …" className="sm:col-span-2">
            <input className="input font-mono" value={f.pointsTable} onChange={set("pointsTable")} />
          </Field>
          <Field label="Fastest lap points">
            <input className="input" type="number" min="0" step="0.5" value={f.fastestLapPoints} onChange={set("fastestLapPoints")} />
          </Field>
          <Field label="…only for finishers in the top">
            <input className="input" type="number" min="0" value={f.fastestLapTopN} onChange={set("fastestLapTopN")} />
          </Field>
          <Field label="Classified with at least this share of the winner's laps (import)">
            <input className="input" type="number" min="0" max="1" step="0.05" value={f.classifiedLapShare} onChange={set("classifiedLapShare")} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={!!f.dnfScores} onChange={set("dnfScores")} />
            A DNF still scores the points of its position
          </label>
        </div>
        <p className="mt-3 text-xs text-muted">Changes apply to every race at once: the standings are always worked out from the results.</p>
      </Section>

      <Section title="Live timing">
        <p className="mb-4 text-sm text-muted">
          The live socket of your AC Server Manager, usually <code className="text-ink">wss://&lt;your-server&gt;/api/race-control</code>. Leave it empty to hide the Live page.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Live socket address">
            <input className="input font-mono text-xs" placeholder="wss://…/api/race-control" value={f.liveWsUrl} onChange={set("liveWsUrl")} />
          </Field>
          <Field label="Origin (optional, else taken from the address)">
            <input className="input font-mono text-xs" placeholder="https://…" value={f.liveOrigin} onChange={set("liveOrigin")} />
          </Field>
        </div>
      </Section>

      <Section title="Race Info text">
        <p className="mb-3 text-sm text-muted">
          <code className="text-ink"># </code> heading, <code className="text-ink">## </code> subheading, <code className="text-ink">- </code> list item, an empty line starts a new paragraph.
        </p>
        <textarea className="input min-h-[280px] font-mono text-xs leading-relaxed" value={f.rules} onChange={set("rules")} />
      </Section>

      <div className="sticky bottom-4 flex items-center gap-4">
        <button className="btn-accent shadow-lg" disabled={busy}>
          Save settings
        </button>
        <Message message={message} />
      </div>
    </form>
  );
}
