import { useCallback, useMemo, useState } from "react";
import { api, withApiBase } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { seasonGameParts } from "../utils/seasonGame.js";
import { PageHeader, SectionHeading, ErrorBox, Skeleton, MEDAL } from "../components/ui.jsx";
import { SocialIcon } from "../components/SocialLinks.jsx";
import Icon from "../components/InfoIcon.jsx";
import { RACE_INFO_DEFAULTS } from "../data/raceInfoDefaults.js";

// League default points. Fallback only; seasons can override via pointsTable.
const DEFAULT_POINTS = [35, 30, 25, 22, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1];

// The page text is admin-editable (Admin -> Race Info) and stored as plain
// strings. Two tiny render helpers turn those strings into JSX:
//   fill(...)  resolves {rounds}/{platform}/... placeholders,
//   rich(...)  turns **spans** into the bold highlight.
function fill(s, tokens) {
  return String(s ?? "").replace(/\{(\w+)\}/g, (m, k) => (tokens[k] != null && tokens[k] !== "" ? String(tokens[k]) : m));
}
function rich(s) {
  const parts = String(s ?? "").split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return s;
  return parts.map((p, i) =>
    i % 2 ? <span key={i} className="font-semibold text-dark">{p}</span> : p
  );
}
const text = (s, tokens) => rich(fill(s, tokens));

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

// One collapsible folder of downloads (folders are created in the admin, e.g.
// Tracks / Cars / one folder per event). Same accordion pattern as the rulebook.
function FolderSection({ name, description, items, index = 0, defaultOpen = false }) {
  return (
    <details className="group card overflow-hidden" open={defaultOpen} style={{ "--i": index }}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 transition hover:bg-surface2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-eyebrow">
          <Icon name="folder" className="h-[18px] w-[18px]" />
        </span>
        <span className="flex-1 font-display text-base font-bold uppercase tracking-tight text-dark">
          {name}
        </span>
        <span className="font-mono text-[11px] font-semibold text-faint">
          {items.length} {items.length === 1 ? "file" : "files"}
        </span>
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-eyebrow transition-transform duration-300 group-open:rotate-45" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </summary>
      <div className="border-t border-border bg-bg/50 p-4">
        {description && <p className="mb-3 text-sm leading-relaxed text-medium">{description}</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => <DownloadCard key={it.id} item={it} />)}
        </div>
      </div>
    </details>
  );
}

function Catalogue() {
  const { data, loading, error } = useApi(useCallback(() => api.downloads(), []));

  const groups = useMemo(() => {
    const items = data?.downloads || [];
    const folders = data?.folders || [];
    const known = new Set(folders.map((f) => f.id));
    const out = folders
      .map((f) => ({ key: f.id, name: f.name, description: f.description, items: items.filter((i) => i.folderId === f.id) }))
      .filter((g) => g.items.length > 0);
    const loose = items.filter((i) => !i.folderId || !known.has(i.folderId));
    if (loose.length) out.push({ key: "loose", name: "More files", description: null, items: loose });
    return out;
  }, [data]);

  if (loading)
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
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
    <div className="cascade space-y-3">
      {groups.map((g, i) => (
        <FolderSection
          key={g.key}
          name={g.name}
          description={g.description}
          items={g.items}
          index={Math.min(i, 8)}
          defaultOpen={i === 0}
        />
      ))}
    </div>
  );
}

// One collapsible subject in the rulebook (same accordion pattern as the
// Welcome-page FAQ, so the two read as one design family).
function RuleGroup({ icon, subject, rules, defaultOpen = false, index = 0 }) {
  return (
    <details className="group card overflow-hidden" open={defaultOpen} style={{ "--i": index }}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 transition hover:bg-surface2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-eyebrow">
          <Icon name={icon} className="h-[18px] w-[18px]" />
        </span>
        <span className="flex-1 font-display text-base font-bold uppercase tracking-tight text-dark">
          {subject}
        </span>
        <span className="font-mono text-[11px] font-semibold text-faint">
          {rules.length} {rules.length === 1 ? "rule" : "rules"}
        </span>
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-eyebrow transition-transform duration-300 group-open:rotate-45" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </summary>
      <ul className="space-y-2.5 border-t border-border px-5 py-4">
        {rules.map((r, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-medium">
            <span className="mt-[0.55em] h-px w-3.5 shrink-0 bg-accent/60" aria-hidden="true" />
            <span>{rich(r)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// One rule card in the "how it works" grid.
function RuleCard({ icon, title, children }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-eyebrow">
          <Icon name={icon} className="h-[18px] w-[18px]" />
        </span>
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">{title}</h3>
      </div>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-medium">{children}</div>
    </div>
  );
}

// The league rulebook. All wording comes from `content` (admin-edited, or the
// built-in defaults); the numbers behind the {placeholders} and the points
// table come live from the season, so scoring changes need no text edits.
function Rules({ content, tokens }) {
  const { current: season } = useSeason();
  const pointsTable =
    Array.isArray(season?.pointsTable) && season.pointsTable.length ? season.pointsTable : DEFAULT_POINTS;

  return (
    <div className="space-y-10">
      {/* ------------------- the championship format ------------------- */}
      <section className="reveal space-y-4">
        <SectionHeading eyebrow="The rules" title="How the championship works" />
        <div className="cascade grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {content.cards.map((c, i) => (
            <div key={i} style={{ "--i": Math.min(i, 8) }}>
              <RuleCard icon={c.icon} title={fill(c.title, tokens)}>
                <p>{text(c.text, tokens)}</p>
              </RuleCard>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------- points table ------------------------- */}
      <section className="reveal space-y-4">
        <SectionHeading
          eyebrow="Scoring"
          title="Points per finish"
          right={
            <span className="font-mono text-[11px] uppercase tracking-wider text-light">
              P{pointsTable.length + 1}+ &amp; DNF = 0
            </span>
          }
        />
        <div className="card overflow-hidden">
          <div className="grid grid-cols-3 gap-px bg-border sm:grid-cols-6 lg:grid-cols-9">
            {pointsTable.map((pts, i) => {
              const medal = i < 3 ? MEDAL[i] : null;
              return (
                <div key={i} className="flex flex-col items-center justify-center bg-card py-3">
                  <span
                    className="flex h-6 min-w-6 items-center justify-center rounded px-1 font-display text-xs font-black"
                    style={{ backgroundColor: medal || "transparent", color: medal ? "#0F172A" : "var(--c-text3)" }}
                  >
                    P{i + 1}
                  </span>
                  <span className="mt-1 font-mono text-lg font-bold tabular-nums text-dark">{pts}</span>
                </div>
              );
            })}
          </div>
        </div>
        {content.pointsFootnote && (
          <p className="text-xs leading-relaxed text-light">{text(content.pointsFootnote, tokens)}</p>
        )}
      </section>

      {/* ------------------------- the rulebook ------------------------- */}
      <section className="reveal space-y-4">
        <SectionHeading
          eyebrow="On track"
          title="Sporting Regulations"
          right={
            <span className="font-mono text-[11px] uppercase tracking-wider text-light">
              {content.rulebook.reduce((n, g) => n + g.rules.length, 0)} rules
            </span>
          }
        />
        <div className="cascade space-y-3">
          {content.rulebook.map((g, i) => (
            <RuleGroup key={i} icon={g.icon} subject={g.subject} rules={g.rules} index={Math.min(i, 8)} />
          ))}
        </div>
        {content.rulebookFootnote && (
          <p className="text-xs leading-relaxed text-light">{text(content.rulebookFootnote, tokens)}</p>
        )}
      </section>
    </div>
  );
}

export default function Downloads() {
  const { isLoggedIn } = useAuth();
  const { current: season } = useSeason();
  const races = useApi(useCallback(() => api.races(), []));
  const info = useApi(useCallback(() => api.raceInfo(), []));

  // Admin-saved content wins; the built-in defaults cover a fresh site.
  const content = info.data?.content || RACE_INFO_DEFAULTS;

  // Live numbers the text placeholders can reference.
  const { era, platform } = seasonGameParts(season);
  const champRaces = (races.data || []).filter((r) => !r.isSpecialEvent && r.number != null);
  const totalRounds = champRaces.length;
  const dropWorst = season?.dropWorst ?? 3;
  const counted = dropWorst > 0 && totalRounds > dropWorst ? totalRounds - dropWorst : totalRounds;
  const teamDrop = season?.teamDropWorst ?? null;
  const tokens = {
    rounds: totalRounds || "",
    counted: counted || "",
    drop: dropWorst || "",
    // Team-level drop count when the season uses it, else blank.
    teamDrop: teamDrop != null && teamDrop > 0 ? teamDrop : "",
    platform: platform || "Assetto Corsa",
    era: era || "Formula 1",
  };

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Drivers' handbook"
        title="Race Info"
        subtitle={fill(content.subtitle, tokens)}
      />

      <Rules content={content} tokens={tokens} />

      {/* ------------------------- downloads ------------------------- */}
      <section className="reveal space-y-4">
        <SectionHeading
          eyebrow="Members"
          title="Downloads"
          right={
            <span className="font-mono text-[11px] uppercase tracking-wider text-light">
              Tracks · Mods · Car pack
            </span>
          }
        />
        {isLoggedIn ? <Catalogue /> : <LoginGate />}
      </section>
    </div>
  );
}
