import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { ErrorBox, Notice, CardHead } from "./ui.jsx";
import SlidingTabs from "./SlidingTabs.jsx";
import { fmtDateShort } from "../utils/format.js";

// ---------------------------------------------------------------------------
// Admin → Content → News: race reports for the news page, for the rounds you
// pick (backend routes/news.js, POST /news/desk/race-reports).
//
// Tick the rounds, choose draft or publish, press the button: the site writes
// each round's report from its results (lib/newsRaceReport.js). A round that
// already has an article is shown with it and cannot be ticked, so nothing is
// written twice. Drafts are finished on the News desk.
// ---------------------------------------------------------------------------

const fmtDate = (d) => (d ? fmtDateShort(d) : "no date");

export default function AdminNewsReports({ rounds, roundOf }) {
  const [byRace, setByRace] = useState({});
  const [picked, setPicked] = useState(() => new Set());
  const [publish, setPublish] = useState("draft");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const ids = useMemo(() => rounds.map((r) => r.id), [rounds]);
  const load = useCallback(() => {
    if (!ids.length) return;
    api
      .newsByRace(ids)
      .then((d) => setByRace(d.byRace || {}))
      .catch((e) => setError(e.message));
  }, [ids]);
  useEffect(load, [load]);

  const open = rounds.filter((r) => !byRace[r.id]?.length);
  const allPicked = open.length > 0 && open.every((r) => picked.has(r.id));

  function toggle(id) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { created, skipped } = await api.createNewsRaceReports([...picked], publish === "publish");
      const live = created.filter((a) => a.status === "PUBLISHED").length;
      const parts = [];
      if (created.length) {
        parts.push(
          `${created.length} ${created.length === 1 ? "article" : "articles"} written` +
            (live ? `, ${live} published` : ", saved as drafts on the News desk")
        );
      }
      for (const s of skipped) {
        const r = rounds.find((x) => x.id === s.raceId);
        parts.push(`${r ? `${roundOf(r)} ${r.track}` : "A round"}: ${s.reason}`);
      }
      setDone(parts.join(". ") + ".");
      setPicked(new Set());
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBox message={error} />}
      {done && <Notice kind="success">{done}</Notice>}

      <div className="card space-y-4 p-5">
        <CardHead eyebrow="News page" title="Race reports from the results" />
        <p className="max-w-2xl text-sm leading-relaxed text-light">
          Pick the rounds and the site writes a report for each one: winner, podium, pole, the biggest climber, fastest
          lap, retirements and the championship. As drafts they wait on the{" "}
          <Link to="/news/desk" className="font-semibold text-link hover:underline">
            News desk
          </Link>{" "}
          for somebody to add the stories; published they go straight onto the news page.
        </p>

        {!rounds.length ? (
          <p className="text-sm text-light">No finished round in the season being edited yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-dark">
                <input
                  type="checkbox"
                  checked={allPicked}
                  disabled={!open.length || busy}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(open.map((r) => r.id)))}
                />
                All rounds without an article
              </label>
              <SlidingTabs
                items={[
                  { key: "draft", label: "As draft" },
                  { key: "publish", label: "Publish now" },
                ]}
                value={publish}
                onChange={setPublish}
                wrapClassName="inline-flex rounded-xl border border-border bg-surface2/60 p-1"
                btnClassName="px-3 py-1.5 text-[13px]"
              />
            </div>

            <ul className="divide-y divide-border rounded-lg border border-border">
              {rounds.map((r) => {
                const articles = byRace[r.id] || [];
                const has = articles.length > 0;
                return (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`${roundOf(r)} ${r.track}`}
                      checked={picked.has(r.id)}
                      disabled={has || busy}
                      onChange={() => toggle(r.id)}
                    />
                    <span className="w-16 shrink-0 font-mono text-xs font-bold text-eyebrow">{roundOf(r)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-dark">{r.track}</span>
                    <span className="hidden text-xs text-light sm:inline">{fmtDate(r.date)}</span>
                    <span className="w-40 shrink-0 text-right text-xs">
                      {has ? (
                        <Link to={`/news/desk/${articles[0].id}`} className="font-semibold text-link hover:underline">
                          {articles[0].status === "PUBLISHED" ? "Published" : "Draft"} · open
                        </Link>
                      ) : (
                        <span className="text-faint">no article yet</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-end gap-3">
              <span className="text-xs text-light">{picked.size ? `${picked.size} selected` : "Nothing selected"}</span>
              <button type="button" className="btn-primary" disabled={!picked.size || busy} onClick={create}>
                {busy ? "Writing…" : publish === "publish" ? "Create and publish" : "Create news"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
