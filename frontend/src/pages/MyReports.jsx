import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, myDiscordId } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useDiscordLogin } from "../hooks/useDiscordLogin.js";
import { SocialIcon } from "../components/SocialLinks.jsx";
import { PageHeader, ErrorBox, EmptyState, Spinner } from "../components/ui.jsx";
import { openReport, REPORTS_OPEN_TO_MEMBERS } from "../components/ReportWidget.jsx";
import { fmtStamp } from "../utils/format.js";
import ReportChat, { ReportComposer } from "../components/ReportChat.jsx";

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

  async function send(body, files) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.replyToReport(id, body, files);
      setData((d) => ({ ...d, messages: r.messages, attachments: r.attachments }));
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

      {/* The round, the lap and where it got to. Everything that was SAID is
          in the thread below, including what was reported — that is the first
          message, not a box above the conversation. */}
      <div className="card p-4">
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
        {r.verdict && (
          <p className="mt-3 border-t border-border pt-3 text-sm leading-relaxed text-medium">
            <span className="font-semibold text-dark">The stewards: </span>
            {r.verdict}
            {r.penaltySeconds != null && ` (${r.penaltySeconds}s)`}
          </p>
        )}
      </div>

      <ReportChat
        report={r}
        messages={data.messages}
        attachments={data.attachments}
        mineIsReporter={!!myDiscordId() && r.reporterDiscordId === myDiscordId()}
      />

      <ReportComposer onSend={send} busy={busy} full />
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
