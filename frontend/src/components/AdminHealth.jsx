import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { ErrorBox, Notice, CardHead } from "./ui.jsx";

// Admin "Health" tab: one-click season integrity check, database backups, and
// the recent admin activity log.

const SEVERITY_META = {
  error: { label: "Error", cls: "bg-red-500/15 text-red-500 border-red-500/30" },
  warning: { label: "Warning", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
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

function fmtSize(bytes) {
  if (bytes == null) return "";
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

  const backups = useApi(useCallback(() => api.backups(), [backupDone]));
  const activity = useApi(useCallback(() => api.activity(), []));

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
          <button className="btn-secondary" onClick={makeBackup} disabled={backupBusy}>
            {backupBusy ? "Backing up…" : "Create backup now"}
          </button>
        </CardHead>
        <p className="-mt-2 mb-4 text-sm text-light">
          A backup is created automatically before race results are saved. To restore: stop the server,
          copy the backup file from <span className="font-mono">backend/backups/</span> over{" "}
          <span className="font-mono">backend/prisma/dev.db</span>, then start the server again.
        </p>
        <div className="mt-4">
          {(backups.data?.backups || []).length === 0 ? (
            <p className="text-sm text-light">No backups yet.</p>
          ) : (
            <ul className="divide-y divide-border font-mono text-xs">
              {(backups.data?.backups || []).slice(0, 12).map((b) => (
                <li key={b.file} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-medium">{b.file}</span>
                  <span className="shrink-0 text-light">
                    {fmtSize(b.size)} · {fmtTime(b.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* --- Activity log ------------------------------------------------------ */}
      <section className="card p-5">
        <CardHead title="Recent admin activity" />
        <p className="-mt-2 mb-4 text-sm text-light">What changed in the admin panel and when (logged automatically).</p>
        <div className="mt-4">
          {(activity.data?.entries || []).length === 0 ? (
            <p className="text-sm text-light">No logged actions yet.</p>
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
