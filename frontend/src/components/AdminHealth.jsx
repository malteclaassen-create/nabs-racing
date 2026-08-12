import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { ErrorBox, Notice, CardHead } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";

// Admin "Health" tab: one-click season integrity check, database backups, and
// the recent admin activity log.

const SEVERITY_META = {
  error: { label: "Error", cls: "bg-red-500/15 text-bad border-red-500/30" },
  warning: { label: "Warning", cls: "bg-amber-500/15 text-warn border-amber-500/30" },
  info: { label: "Note", cls: "bg-sky-500/15 text-sky-500 border-sky-500/30" },
};

function SeverityBadge({ severity }) {
  const m = SEVERITY_META[severity] || SEVERITY_META.info;
  return (
    <span className={`pill shrink-0 border font-mono text-[10px] font-bold uppercase tracking-wider ${m.cls}`}>
      {m.label}
    </span>
  );
}

// The two shipped defaults that must not survive going public: the built-in
// admin PIN, and an unset JWT_SECRET.
//
// This used to be a red banner across the top of EVERY admin tab, which is the
// loudest a warning can be and therefore the fastest one to stop being read.
// It lives here instead, with the rest of the "is this server healthy" answers,
// and says so either way — a check you can only see when it fails is a check
// nobody can confirm ran.
function SecurityCheck() {
  const { data } = useApi(useCallback(() => api.adminSecurity(), []));
  if (!data) return null;
  const clean = !data.pinIsDefault && !data.jwtIsDefault;
  return (
    <section className="card p-5">
      <CardHead title="Passwords and secrets" />
      <div className="-mt-2 space-y-2">
        {clean && (
          <Notice kind="success">
            The admin PIN has been changed and <span className="font-mono">JWT_SECRET</span> is set. Nothing here is
            still on its shipped default.
          </Notice>
        )}
        {data.pinIsDefault && (
          <Notice kind="error">
            The admin PIN is still the built-in default (<span className="font-mono">nabs2026</span>), so anyone who has
            seen the project files can log in here. Change it in the <b>Change PIN</b> tab before sharing the site.
          </Notice>
        )}
        {data.jwtIsDefault && (
          <Notice kind="error">
            <span className="font-mono">JWT_SECRET</span> is not set, so sessions are signed with a publicly known
            default. Set a long random <span className="font-mono">JWT_SECRET</span> in{" "}
            <span className="font-mono">backend/.env</span> and restart the backend.
          </Notice>
        )}
      </div>
    </section>
  );
}

function fmtSize(bytes) {
  if (bytes == null) return "";
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Turn a raw activity log path into something an admin can read.
function describeActivity(e) {
  const p = e.path.split("?")[0];
  const rules = [
    [/^\/races\/commit/, "Race results imported"],
    [/^\/races\/.+\/results/, "Race results edited"],
    [/^\/backups/, "Backup created"],
    [/^\/drivers\/(.+)/, (m) => `Driver updated: ${m[1]}`],
    [/^\/drivers$/, "Driver created"],
    [/^\/teams\/(.+)\/logo/, (m) => `Team logo uploaded: ${m[1]}`],
    [/^\/teams\/(.+)/, (m) => `Team updated: ${m[1]}`],
    [/^\/teams$/, "Team created"],
    [/^\/seasons\/.+\/activate/, "Season activated"],
    [/^\/seasons\/.+\/clone-roster/, "Roster cloned from another season"],
    [/^\/seasons\/.+\/clone-teams/, "Teams cloned from another season"],
    [/^\/seasons/, "Season created/updated"],
    [/^\/events\/.+\/announce/, "Event posted to Discord"],
    [/^\/events/, e.method === "DELETE" ? "Event deleted" : "Event created"],
    [/^\/market/, "Driver Market updated"],
    [/^\/settings\/pin/, "Admin PIN changed"],
    [/^\/discord/, "Discord settings updated"],
    [/^\/social/, "Social links updated"],
    [/^\/downloads/, "Downloads updated"],
  ];
  for (const [re, out] of rules) {
    const m = re.exec(p);
    if (m) return typeof out === "function" ? out(m) : out;
  }
  return `${e.method} ${p}`;
}

export default function AdminHealth() {
  const { current } = useSeason();
  const [report, setReport] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupDone, setBackupDone] = useState(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const ask = useAsk();

  const backups = useApi(useCallback(() => api.backups(), [backupDone]));
  const activity = useApi(useCallback(() => api.activity(), []));
  // Live memory breakdown. Loaded once on open; the Refresh button re-reads it,
  // which is how you watch a suspicious climb without leaving the tab.
  const memory = useApi(useCallback(() => api.memory(), []));
  const [snapBusy, setSnapBusy] = useState(false);

  // Full heap snapshot download. The confirm is not decoration: writing the
  // snapshot freezes the whole site for a few seconds.
  async function downloadMemorySnapshot() {
    const ok = await ask({
      title: "Writing the memory snapshot freezes the site for a few seconds (longer when memory is high).",
      body: "Visitors simply wait a moment. Continue?",
      confirmLabel: "Continue",
    });
    if (!ok) return;
    setError(null);
    setSnapBusy(true);
    try {
      const { blob, name } = await api.downloadHeapSnapshot();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setSnapBusy(false);
    }
  }
  // Disk usage per area. Reloaded together with the backup list: creating a
  // backup is the one admin action on this page that visibly moves the number.
  const storage = useApi(useCallback(() => api.storage(), [backupDone]));

  // Deleting snapshots (one, or everything but the newest few). Both reload
  // the list AND the disk-usage card — the number moving is the whole point.
  const [pruneBusy, setPruneBusy] = useState(false);
  async function removeBackup(file) {
    const ok = await ask({
      title: `Delete the backup ${file}?`,
      body: "This cannot be undone.",
      danger: true,
      confirmLabel: "Delete backup",
    });
    if (!ok) return;
    setError(null);
    setPruneBusy(true);
    try {
      await api.deleteBackup(file);
      setBackupDone(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setPruneBusy(false);
    }
  }
  async function pruneOldBackups() {
    const total = (backups.data?.backups || []).length;
    if (total <= 5) return;
    const ok = await ask({
      title: `Delete the ${total - 5} oldest backups and keep the newest 5?`,
      danger: true,
      confirmLabel: "Delete old backups",
    });
    if (!ok) return;
    setError(null);
    setPruneBusy(true);
    try {
      await api.pruneBackups(5);
      setBackupDone(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setPruneBusy(false);
    }
  }

  async function runCheck() {
    setError(null);
    setChecking(true);
    try {
      setReport(await api.integrity());
    } catch (e) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  }

  // Fetches the full-backup zip (DB + uploaded images) and hands it to the
  // browser as a normal file download.
  async function downloadBackup() {
    setError(null);
    setDownloadBusy(true);
    try {
      const { blob, name } = await api.downloadBackupZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setBackupDone(name); // the zip also leaves a fresh snapshot in the list
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloadBusy(false);
    }
  }

  async function makeBackup() {
    setError(null);
    setBackupBusy(true);
    try {
      const r = await api.createBackup();
      setBackupDone(r.backup?.file || Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {error && <ErrorBox message={error} />}

      <SecurityCheck />

      {/* --- Integrity check ------------------------------------------------ */}
      <section className="card p-5">
        <CardHead title="Data check">
          <button className="btn-primary" onClick={runCheck} disabled={checking}>
            {checking ? "Checking…" : "Check season"}
          </button>
        </CardHead>
        <p className="-mt-2 mb-4 text-sm text-light">
          Checks {current?.name || "the selected season"} for inconsistencies: round points, positions,
          assignments, season references, team colours.
        </p>

        {report && (
          <div className="mt-4">
            {report.issues.length === 0 ? (
              <Notice kind="success">
                All clear. No issues found in {report.season || "this season"}.
              </Notice>
            ) : (
              <>
                <div className="mb-3 flex gap-2 font-mono text-xs text-light">
                  {["error", "warning", "info"].map((s) =>
                    report.counts[s] ? (
                      <span key={s} className="flex items-center gap-1.5">
                        <SeverityBadge severity={s} /> × {report.counts[s]}
                      </span>
                    ) : null
                  )}
                </div>
                <ul className="divide-y divide-border">
                  {report.issues.map((i, idx) => (
                    <li key={idx} className="flex items-start gap-3 py-2.5 text-sm">
                      <SeverityBadge severity={i.severity} />
                      <span className="text-medium">
                        <span className="mr-2 font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                          {i.area}
                        </span>
                        {i.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      {/* --- Backups ---------------------------------------------------------- */}
      <section className="card p-5">
        <CardHead title="Database backups">
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={downloadBackup} disabled={downloadBusy}>
              {downloadBusy ? "Preparing zip…" : "Download full backup"}
            </button>
            <button className="btn-secondary" onClick={makeBackup} disabled={backupBusy}>
              {backupBusy ? "Backing up…" : "Create backup now"}
            </button>
          </div>
        </CardHead>
        <p className="-mt-2 mb-4 text-sm text-light">
          A backup is created automatically before race results are saved. To restore: stop the server,
          copy the backup file from <span className="font-mono">backend/backups/</span> over{" "}
          <span className="font-mono">backend/prisma/dev.db</span>, then start the server again.
        </p>
        <Notice kind="info">
          The snapshots below live on the same disk as the live database. Use{" "}
          <strong>Download full backup</strong> (database + all uploaded images as one zip) regularly
          and keep the file somewhere else: another computer, a USB stick or a cloud drive. If this
          machine ever dies, that zip is the whole league.
        </Notice>
        <div className="mt-4">
          {/* "No backups yet" on a failed read is the worst possible wording on
              this particular panel: it tells the admin their safety net is empty
              when the truth is that we could not look. */}
          {backups.error ? (
            <ErrorBox message={backups.error} onRetry={backups.reload} title="Couldn't read the backup list" />
          ) : (backups.data?.backups || []).length === 0 ? (
            <p className="text-sm text-light">{backups.loading ? "Reading the backup list…" : "No backups yet."}</p>
          ) : (
            <>
              <ul className="divide-y divide-border font-mono text-xs">
                {(backups.data?.backups || []).slice(0, 12).map((b) => (
                  <li key={b.file} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate text-medium">{b.file}</span>
                    <span className="flex shrink-0 items-center gap-3 text-light">
                      {fmtSize(b.size)} · {fmtTime(b.createdAt)}
                      <button
                        type="button"
                        className="font-sans font-semibold transition hover:text-rose-500 disabled:opacity-50"
                        disabled={pruneBusy}
                        onClick={() => removeBackup(b.file)}
                        title="Delete this snapshot"
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              {(backups.data?.backups || []).length > 5 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <span className="text-xs text-light">
                    {(backups.data?.backups || []).length} snapshots on disk
                    {(backups.data?.backups || []).length > 12 && " (newest 12 listed)"}
                    . New ones keep arriving before every results save.
                  </span>
                  <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={pruneBusy}
                    onClick={pruneOldBackups}>
                    {pruneBusy ? "Deleting…" : "Delete old backups (keep newest 5)"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* --- Storage ----------------------------------------------------------- */}
      <section className="card p-5">
        <CardHead title="Disk usage" />
        <p className="-mt-2 mb-4 text-sm text-light">
          What the league keeps on disk, area by area. Race photos are shrunk in the browser before they
          are uploaded (long side 1920px, JPEG), so a full gallery costs a few megabytes, not hundreds.
        </p>
        {storage.error ? (
          <ErrorBox message={storage.error} onRetry={storage.reload} title="Couldn't read the disk usage" />
        ) : !storage.data ? (
          <p className="text-sm text-light">Measuring…</p>
        ) : (
          (() => {
            const areas = [...(storage.data.areas || [])]
              .filter((a) => a.files > 0 || a.bytes > 0)
              .sort((a, b) => b.bytes - a.bytes);
            const db = storage.data.databaseBytes;
            const total = areas.reduce((s, a) => s + a.bytes, 0) + (db || 0);
            const max = Math.max(1, ...areas.map((a) => a.bytes), db || 0);
            const Row = ({ label, bytes, files }) => (
              <li className="py-2">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-medium">{label}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-light">
                    {files != null && `${files} file${files === 1 ? "" : "s"} · `}
                    <span className="font-bold text-dark">{fmtSize(bytes)}</span>
                  </span>
                </div>
                {/* One shared scale, so the bar answers "what is the big one?"
                    at a glance without reading a single number. */}
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface2">
                  <div className="h-full rounded-full bg-brand/70" style={{ width: `${Math.max(1, (bytes / max) * 100)}%` }} />
                </div>
              </li>
            );
            return (
              <>
                <div className="mb-3 flex items-baseline justify-between border-b border-border pb-3">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Total</span>
                  <span className="font-display text-xl font-black tabular-nums text-dark">{fmtSize(total)}</span>
                </div>
                <ul className="divide-y divide-border">
                  {db != null && <Row label="Database" bytes={db} />}
                  {areas.map((a) => (
                    <Row key={a.key} label={a.label} bytes={a.bytes} files={a.files} />
                  ))}
                </ul>
              </>
            );
          })()
        )}
      </section>

      {/* --- Server memory ----------------------------------------------------- */}
      <section className="card p-5">
        <CardHead title="Server memory">
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={memory.reload} disabled={memory.loading}>
              {memory.loading ? "Reading…" : "Refresh"}
            </button>
            <button className="btn-secondary" onClick={downloadMemorySnapshot} disabled={snapBusy}>
              {snapBusy ? "Writing snapshot…" : "Download memory snapshot"}
            </button>
          </div>
        </CardHead>
        <p className="-mt-2 mb-4 text-sm text-light">
          What the server keeps in working memory right now. Total is the number the hosting
          dashboard charts. If Total climbs while JS data stays small, the growth sits in
          connections and buffers rather than in the site's own data. The same reading is written
          to the server logs every 5 minutes.
        </p>
        {memory.error ? (
          <ErrorBox message={memory.error} onRetry={memory.reload} title="Couldn't read the memory usage" />
        ) : !memory.data ? (
          <p className="text-sm text-light">Measuring…</p>
        ) : (
          (() => {
            const m = memory.data;
            const MemRow = ({ label, value, hint }) => (
              <li className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="text-medium">
                  {label}
                  {hint && <span className="ml-2 text-xs text-light">{hint}</span>}
                </span>
                <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-dark">{value}</span>
              </li>
            );
            const servers = Object.entries(m.live?.servers || {});
            return (
              <ul className="divide-y divide-border">
                <MemRow label="Total" hint="the whole process" value={`${m.rssMb} MB`} />
                <MemRow label="JS data" hint="the site's own structures" value={`${m.heapUsedMb} MB`} />
                <MemRow
                  label="Buffers"
                  hint="connections, sockets, file reads"
                  value={`${Math.round((m.externalMb + m.arrayBuffersMb) * 10) / 10} MB`}
                />
                <MemRow label="Running for" value={`${m.uptimeHours} h`} />
                <MemRow label="Live timing viewers" value={m.live?.viewers ?? 0} />
                {servers.map(([key, s]) => (
                  <MemRow
                    key={key}
                    label={`Race server ${key}`}
                    value={
                      s.connected
                        ? `connected, ${s.cars} car${s.cars === 1 ? "" : "s"} on track`
                        : "not connected"
                    }
                  />
                ))}
              </ul>
            );
          })()
        )}
      </section>

      {/* --- Activity log ------------------------------------------------------ */}
      <section className="card p-5">
        <CardHead title="Recent admin activity" />
        <p className="-mt-2 mb-4 text-sm text-light">What changed in the admin panel and when (logged automatically).</p>
        <div className="mt-4">
          {activity.error ? (
            <ErrorBox message={activity.error} onRetry={activity.reload} title="Couldn't read the activity log" />
          ) : (activity.data?.entries || []).length === 0 ? (
            <p className="text-sm text-light">{activity.loading ? "Reading the activity log…" : "No logged actions yet."}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {(activity.data?.entries || []).slice(0, 25).map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-medium">{describeActivity(e)}</span>
                  <span className="shrink-0 font-mono text-xs text-light">{fmtTime(e.t)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
