import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, myDiscordId } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useDiscordLogin } from "../hooks/useDiscordLogin.js";
import { SocialIcon } from "../components/SocialLinks.jsx";
import { PageHeader, ErrorBox, EmptyState, Spinner } from "../components/ui.jsx";
import { REPORTS_OPEN_TO_MEMBERS } from "../reportsAccess.js";
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

// Filing one. It used to be the top half of a corner panel; a report is worth
// a page, and putting it here means one place to look for the whole thing
// rather than a window for writing and a page for reading.
function NewReport({ races, presetRaceId, onFiled }) {
  const [form, setForm] = useState({ raceId: presetRaceId || "", lap: "", accusedDriverId: "", body: "" });
  const [drivers, setDrivers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);
  const [unreachable, setUnreachable] = useState(null);

  useEffect(() => {
    api
      .teams()
      .then((t) => setDrivers((t || []).flatMap((x) => (x.drivers || []).map((d) => ({ ...d, team: x.name })))))
      .catch(() => {});
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const accused = drivers.find((d) => d.id === form.accusedDriverId);
      const res = await api.createReport({
        raceId: form.raceId || null,
        lap: form.lap === "" ? null : Number(form.lap),
        accusedDriverId: form.accusedDriverId || null,
        accusedName: accused?.name || null,
        body: form.body,
      });
      // Three outcomes, and only one of them is "the other driver can see it".
      setSent(!form.accusedDriverId ? "nobody" : res?.accusedReachable === false ? "unreachable" : "ok");
      setUnreachable(res?.accusedReachable === false ? accused?.name || "That driver" : null);
      setForm({ raceId: "", lap: "", accusedDriverId: "", body: "" });
      onFiled?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card space-y-3 p-5">
        <p className="text-sm leading-relaxed text-ok">
          {sent === "ok"
            ? "Sent. The stewards can see it now, and so can the driver you named."
            : "Sent. The stewards can see it now."}
        </p>
        {sent === "nobody" && (
          <p className="text-sm leading-relaxed text-light">
            You did not name a driver, so for now only the stewards can read it. If they work out who it was
            about, that driver joins the thread and can answer.
          </p>
        )}
        {sent === "unreachable" && (
          <p className="text-sm leading-relaxed text-light">
            {unreachable} has never signed in with Discord, so they cannot be told about this or answer it. The
            stewards will have to reach them another way.
          </p>
        )}
        <button className="btn-secondary" onClick={() => setSent(null)}>
          File another
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-3 p-5">
      <div className="grid gap-3 sm:grid-cols-[2fr,1fr,2fr]">
        <select
          aria-label="Which race"
          className="input"
          value={form.raceId}
          onChange={(e) => setForm({ ...form, raceId: e.target.value })}
        >
          <option value="">Which race?</option>
          {races.map((r) => (
            <option key={r.id} value={r.id}>
              {r.number != null ? `R${r.number}` : "Session"} {r.track}
            </option>
          ))}
        </select>
        <input
          aria-label="Lap"
          type="number"
          min="1"
          className="input"
          placeholder="Lap"
          value={form.lap}
          onChange={(e) => setForm({ ...form, lap: e.target.value })}
        />
        <select
          aria-label="Which driver"
          className="input"
          value={form.accusedDriverId}
          onChange={(e) => setForm({ ...form, accusedDriverId: e.target.value })}
        >
          <option value="">Who?</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="input h-28 resize-none"
        placeholder="What happened? Where on the track, and what did it cost you?"
        value={form.body}
        onChange={(e) => setForm({ ...form, body: e.target.value })}
      />
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={busy || form.body.trim().length < 5} onClick={submit}>
          {busy ? "Sending…" : "Send to the stewards"}
        </button>
        <p className="text-xs leading-relaxed text-light">
          Only you, the driver you name and the stewards can read this. You can add pictures once it is filed.
        </p>
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
  // ?new=1 (optionally &race=) opens the form straight away -- that is what the
  // Report buttons around the site link to, with the round already chosen.
  const filing = params.get("new") === "1";
  const presetRace = params.get("race") || "";

  // Three sections, because "why can I see this" is the first thing you want to
  // know. Yours is the argument you are IN; shown-to-you is a thread an admin
  // let you read; everything else is what an appointed steward sees, and only
  // they ever have one.
  const mine = list.filter((r) => r.myRole === "REPORTER" || r.myRole === "ACCUSED");
  const addedTo = list.filter((r) => r.myRole === "VIEWER");
  const asSteward = list.filter((r) => r.myRole === "STEWARD");

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
          REPORTS_OPEN_TO_MEMBERS && !openId && !filing ? (
            <button className="btn-primary" onClick={() => setParams({ new: "1" })}>
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
      ) : (
        <div className="space-y-8">
          {filing && (
            <NewReport
              races={raceList.filter((r) => r.isCompleted || (r.date && new Date(r.date) <= new Date()))}
              presetRaceId={presetRace}
              onFiled={reload}
            />
          )}

          <Section
            title="Yours"
            hint="Reports you filed, and reports that name you."
            rows={mine}
            races={raceList}
            onOpen={openThread}
            empty="You are not part of any report. That is the good outcome."
          />
          {addedTo.length > 0 && (
            <Section
              title="Shown to you"
              hint="Threads the stewards let you read, because you saw what happened."
              rows={addedTo}
              races={raceList}
              onOpen={openThread}
            />
          )}
          {asSteward.length > 0 && (
            <Section
              title="Everything else"
              hint="You are a steward, so you can read and answer every report in the league."
              rows={asSteward}
              races={raceList}
              onOpen={openThread}
            />
          )}
        </div>
      )}
    </>
  );
}

// One list of reports under a heading that says why they are in it.
function Section({ title, hint, rows, races, onOpen, empty }) {
  return (
    <section>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3">
        <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">{title}</h2>
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">{rows.length}</span>
      </div>
      <p className="mb-3 text-sm text-light">{hint}</p>
      {rows.length === 0 ? (
        empty ? <EmptyState title="Nothing here" hint={empty} /> : null
      ) : (
        <ul className="card divide-y divide-border overflow-hidden">
          {rows.map((r) => {
            const s = STATUS_META[r.status] || STATUS_META.NEW;
            const race = races.find((x) => x.id === r.raceId);
            return (
              <li key={r.id}>
                <button
                  className="flex w-full flex-col gap-1.5 px-5 py-4 text-left transition hover:bg-surface2/60"
                  onClick={() => onOpen(r.id)}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`pill ${s.cls}`}>{s.label}</span>
                    {race && (
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">
                        {race.number != null ? `R${race.number} ` : ""}
                        {race.track}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-dark">
                      {r.reporterName || "Someone"}
                      {r.accusedName ? ` → ${r.accusedName}` : ""}
                    </span>
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
    </section>
  );
}
