import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useDiscordLogin } from "../hooks/useDiscordLogin.js";
import { SocialIcon } from "../components/SocialLinks.jsx";
import { PageHeader, ErrorBox, EmptyState, Spinner } from "../components/ui.jsx";
import { openReport, REPORTS_OPEN_TO_MEMBERS } from "../components/ReportWidget.jsx";
import { fmtStamp } from "../utils/format.js";

// ---------------------------------------------------------------------------
// A driver's side of the stewarding conversation: the incident reports they
// filed, the ones that name them, and anything the stewards wrote back.
//
// It exists because an answer needs somewhere to land. Every report
// notification links here (/reports?id=…) — before this page there was such a
// link and no such route, so the one message that closes the whole loop, "your
// report has been decided", arrived and then dropped the driver on the 404
// page. It is also the way in on a phone, where a floating corner button is not
// something a design can rely on.
//
// Only threads this account is party to are ever loaded: the API decides that,
// per report, on every read. Nothing here can widen it.
// ---------------------------------------------------------------------------

const STATUS_META = {
  NEW: { label: "Waiting", cls: "bg-surface2 text-light" },
  REVIEWING: { label: "Being looked at", cls: "bg-sky-500/15 text-link" },
  PENALTY: { label: "Penalty", cls: "bg-red-500/15 text-bad" },
  NO_PENALTY: { label: "No penalty", cls: "bg-emerald-500/15 text-ok" },
  DISMISSED: { label: "Closed", cls: "bg-surface2 text-light" },
};

const when = (iso) => (iso ? fmtStamp(iso) : "");

function Thread({ id, races, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(
    () => api.report(id).then(setData).catch((e) => setError(e.message)),
    [id]
  );
  useEffect(() => {
    load();
  }, [load]);

  // A thread is a conversation with somebody at the other end, so it is worth
  // catching up when the tab comes back to the front. Not a timer: an argument
  // about lap 14 does not move second by second, and a poll running behind a
  // phone in a pocket is a battery cost with nothing to show for it.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.replyToReport(id, text.trim());
      setData((d) => ({ ...d, messages: r.messages }));
      setText("");
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Spinner />;

  const r = data.report;
  const s = STATUS_META[r.status] || STATUS_META.NEW;
  const race = races.find((x) => x.id === r.raceId);

  return (
    <div className="space-y-5">
      <button className="transition text-sm font-semibold text-link hover:underline" onClick={onBack}>
        &larr; All my reports
      </button>

      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`pill ${s.cls}`}>{s.label}</span>
          {/* Which round, in words. A thread that only says "lap 14" is an
              argument about an evening nobody can place. */}
          {race && (
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              {race.number != null ? `R${race.number} ` : ""}
              {race.track}
            </span>
          )}
          {r.lap != null && (
            <span className="font-mono text-[11px] uppercase tracking-wider text-light">Lap {r.lap}</span>
          )}
          {r.accusedName && <span className="text-sm text-light">about {r.accusedName}</span>}
          <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-faint">
            {when(r.createdAt)}
          </span>
        </div>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-dark">{r.body}</p>
        {r.verdict && (
          <p className="mt-3 border-t border-border pt-3 text-sm leading-relaxed text-medium">
            <span className="font-semibold text-dark">The stewards: </span>
            {r.verdict}
            {r.penaltySeconds != null && ` (${r.penaltySeconds}s)`}
          </p>
        )}
      </div>

      <ul className="space-y-2">
        {data.messages.map((m) => (
          <li
            key={m.id}
            className={`rounded-lg border-l-2 px-4 py-3 ${
              m.author === "ADMIN" ? "border-brand/60 bg-brand/5" : "ml-4 border-border bg-surface2/60"
            }`}
          >
            <div className="font-mono text-[10px] uppercase tracking-wider text-light">
              {m.author === "ADMIN" ? "Stewards" : m.authorName || "Driver"} · {when(m.createdAt)}
            </div>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-dark">{m.body}</p>
          </li>
        ))}
        {data.messages.length === 0 && <li className="text-sm text-light">Nothing written yet.</li>}
      </ul>

      <div className="space-y-2">
        <textarea
          aria-label="Write in this report"
          className="input h-24 resize-none"
          placeholder="Add something to this report…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn-primary" disabled={busy || !text.trim()} onClick={send}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

export default function MyReports() {
  const { isLoggedIn } = useAuth();
  const { enabled: loginEnabled, loading: loginLoading, start: startLogin } = useDiscordLogin();
  const [params, setParams] = useSearchParams();
  const openId = params.get("id");

  const { data, loading, error, reload } = useApi(
    useCallback(() => (isLoggedIn ? api.myReports() : Promise.resolve({ reports: [] })), [isLoggedIn])
  );
  const { data: races } = useApi(useCallback(() => api.races().catch(() => []), []));
  const list = useMemo(() => data?.reports || [], [data]);
  const raceList = useMemo(() => races || [], [races]);

  const openThread = (id) => setParams(id ? { id } : {}, { replace: false });

  if (!isLoggedIn) {
    return (
      <>
        <PageHeader eyebrow="Stewarding" title="My reports" />
        <EmptyState
          title="Sign in to see your reports"
          hint="An incident report is a private conversation between you, the driver it names and the stewards, so it needs a Discord login."
        >
          <div className="mt-5 w-full max-w-xs">
            {loginLoading ? (
              <span className="text-sm text-light">…</span>
            ) : loginEnabled ? (
              <button
                onClick={startLogin}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#4752c4]"
              >
                <SocialIcon name="discord" className="h-5 w-5" />
                Continue with Discord
              </button>
            ) : (
              <p className="text-sm text-medium">Discord login is not configured yet.</p>
            )}
          </div>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Stewarding"
        title="My reports"
        right={
          REPORTS_OPEN_TO_MEMBERS && !openId ? (
            <button className="btn-primary" onClick={() => openReport()}>
              Report an incident
            </button>
          ) : null
        }
      />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}

      {openId ? (
        /* keyed by id: switching threads must not show the last one's words
           while the new one loads */
        <Thread key={openId} id={openId} races={raceList} onBack={() => openThread(null)} onChanged={reload} />
      ) : list.length === 0 ? (
        <EmptyState
          title="Nothing here"
          hint="Reports you file, and reports that name you, both show up on this page. Nobody else can read them."
        />
      ) : (
        <ul className="card divide-y divide-border overflow-hidden">
          {list.map((r) => {
            const s = STATUS_META[r.status] || STATUS_META.NEW;
            const race = raceList.find((x) => x.id === r.raceId);
            return (
              <li key={r.id}>
                <button
                  className="flex w-full flex-col gap-1.5 px-5 py-4 text-left transition hover:bg-surface2/60"
                  onClick={() => openThread(r.id)}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`pill ${s.cls}`}>{s.label}</span>
                    {race && (
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">
                        {race.number != null ? `R${race.number} ` : ""}
                        {race.track}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-dark">{r.accusedName || "An incident"}</span>
                    {r.lap != null && (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">lap {r.lap}</span>
                    )}
                    <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-faint">
                      {when(r.createdAt)}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-xs leading-relaxed text-light">{r.body}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
