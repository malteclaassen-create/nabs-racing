import { useCallback, useMemo, useState } from "react";
import { api, withApiBase } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { PageHeader, ErrorBox, Skeleton } from "../components/ui.jsx";
import { SocialIcon } from "../components/SocialLinks.jsx";

// --- tiny inline icons (stroke = currentColor) ---------------------------
const I = {
  download: "M12 3v12m0 0l-4-4m4 4l4-4M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4",
  lock: "M6 10V8a6 6 0 1112 0v2M5 10h14a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1v-9a1 1 0 011-1z",
  info: "M12 8h.01M11 12h1v4h1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  box: "M21 8l-9-5-9 5m18 0l-9 5m9-5v8l-9 5m0-13L3 8m9 5v8m0-8L3 8m0 0v8l9 5",
  external: "M14 5h5v5M19 5l-8 8M12 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-5",
};
function Icon({ name, className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={I[name]} />
    </svg>
  );
}

// Members-only gate: same Discord sign-in flow as the profile page.
function LoginGate() {
  const discord = useApi(useCallback(() => api.discordConfig(), []));
  const enabled = discord.data?.enabled;
  const start = () => { if (discord.data?.url) window.location.href = discord.data.url; };
  return (
    <div className="mx-auto max-w-md">
      <div className="card flex flex-col items-center gap-5 p-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5865F2]/15 text-[#5865F2]">
          <Icon name="lock" className="h-7 w-7" />
        </span>
        <div>
          <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark">
            Members only
          </h2>
          <p className="mt-1.5 text-sm text-light">
            The downloads are for logged-in members. Sign in with Discord to get the tracks,
            safety car, Custom Shaders Patch, Real Penalty and more.
          </p>
        </div>
        {discord.loading ? (
          <span className="text-sm text-light">…</span>
        ) : enabled ? (
          <button
            onClick={start}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#4752c4]"
          >
            <SocialIcon name="discord" className="h-5 w-5" />
            Continue with Discord
          </button>
        ) : (
          <p className="text-sm text-medium">Discord login is not configured yet.</p>
        )}
      </div>
    </div>
  );
}

function DownloadCard({ item }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const { url, external } = await api.downloadTicket(item.id);
      if (external) window.open(url, "_blank", "noopener,noreferrer");
      else window.location.href = withApiBase(url); // browser download (resumable), API-origin aware
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">{item.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
            {item.version && <span>v{item.version}</span>}
            {item.version && (item.sizeText || item.external) && <span className="text-faint">·</span>}
            {item.external ? <span>External link</span> : item.sizeText && <span>{item.sizeText}</span>}
          </div>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface2 text-medium">
          <Icon name={item.external ? "external" : "box"} className="h-5 w-5" />
        </span>
      </div>

      {item.description && <p className="mt-3 text-sm leading-relaxed text-medium">{item.description}</p>}

      {item.installNote && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{item.installNote}</span>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3 pt-1">
        <button
          onClick={go}
          disabled={busy || !item.available}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name={item.external ? "external" : "download"} className="h-4 w-4" />
          {busy ? "Preparing…" : item.available ? (item.external ? "Open link" : "Download") : "Coming soon"}
        </button>
        {!item.available && !item.external && (
          <span className="text-xs text-light">Not uploaded yet</span>
        )}
      </div>

      {err && <p className="mt-2 text-xs font-medium text-red-500">{err}</p>}
    </div>
  );
}

function Catalogue() {
  const { data, loading, error } = useApi(useCallback(() => api.downloads(), []));

  const groups = useMemo(() => {
    const items = data?.downloads || [];
    const by = new Map();
    for (const it of items) {
      if (!by.has(it.category)) by.set(it.category, []);
      by.get(it.category).push(it);
    }
    return [...by.entries()];
  }, [data]);

  if (loading)
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  if (error) return <ErrorBox message={error} />;

  if (!groups.length)
    return (
      <div className="card p-10 text-center text-medium">
        <Icon name="box" className="mx-auto h-8 w-8 text-faint" />
        <p className="mt-3 text-sm">No downloads have been added yet.</p>
      </div>
    );

  return (
    <div className="space-y-9">
      {groups.map(([category, list]) => (
        <section key={category}>
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.16em] text-light">
            {category}
            <span className="font-mono text-[11px] font-semibold text-faint">{list.length}</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((it) => <DownloadCard key={it.id} item={it} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function Downloads() {
  const { isLoggedIn } = useAuth();
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Members"
        title="Downloads"
        subtitle="Everything you need for our Assetto Corsa server — tracks, safety car, Custom Shaders Patch, Real Penalty and the car pack, all in one place."
      />
      {isLoggedIn ? <Catalogue /> : <LoginGate />}
    </div>
  );
}
