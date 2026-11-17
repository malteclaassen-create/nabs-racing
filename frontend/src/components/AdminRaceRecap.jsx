import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Notice, CardHead } from "./ui.jsx";
import SlidingTabs from "./SlidingTabs.jsx";
import { fmtStamp } from "../utils/format.js";
import { useSeriesPath } from "../context/SeriesContext.jsx";
import { useSharedRound } from "../hooks/useSharedRound.js";
import { latestPastRace } from "../utils/sharedRound.js";

// The race recap's switch, and a way to look at it before anybody else does.
//
// The recap is where a member lands the first time they open the site after a
// round has been saved: a page of cards about their race, the championship,
// their live rating and the NABS Tokens it paid (backend lib/raceRecap.js). Off is
// off; "admins only" puts it in front of league admins on the real site so it
// can be checked on a real round first; "everyone" is the launch.

const MODE_TEXT = {
  off: "Off. Nobody sees a recap, and nothing about it shows anywhere on the site.",
  admins: "Admins only. League admins get the recap after a saved round, exactly as members will; members see nothing yet.",
  all: "Everyone. After each saved round, every member with a seat gets their recap once, the next time they open the site.",
};

// The season review (pages/SeasonReview.jsx): a driver's whole season in the
// recap's chapters, opened from the driver page. Public figures only, so once
// it is on it is there for anyone who can see the driver.
const REVIEW_TEXT = {
  off: "Off. No driver page offers the season review.",
  admins: "Admins only. League admins see the Season in review link on every driver page; members see nothing yet.",
  all: "Everyone. Every driver page with two or more rounds run offers its season review.",
};

function ModeSwitch({ mode, onChange, busy, title = "Race recap", texts = MODE_TEXT }) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <div className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">{title}</div>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-light">{texts[mode] || texts.off}</p>
      </div>
      <SlidingTabs
        items={[
          { key: "off", label: "Off" },
          { key: "admins", label: "Admins only" },
          { key: "all", label: "Everyone" },
        ]}
        value={mode || "off"}
        onChange={(m) => !busy && m !== mode && onChange(m)}
        wrapClassName="inline-flex rounded-xl border border-border bg-surface2/60 p-1"
        btnClassName="px-3 py-1.5 text-[13px]"
      />
    </div>
  );
}

export default function AdminRaceRecap() {
  const { data, error: loadError, reload } = useApi(useCallback(() => api.adminRaceRecap(), []));
  const { data: review, reload: reloadReview } = useApi(useCallback(() => api.adminSeasonReview(), []));
  const { data: races } = useApi(useCallback(() => api.races(), []));
  const { seriesPath } = useSeriesPath();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // The preview: a finished round, and whose seat to tell it from.
  const rounds = [...(races || [])]
    .filter((r) => r.isCompleted && r.number != null)
    .sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
  // Opens on the round the other race-weekend tabs were last on, or else the
  // latest one that has been run (hooks/useSharedRound.js).
  const [raceId, setRaceId] = useSharedRound(
    races ? rounds.map((r) => r.id) : null,
    latestPastRace(rounds, { completedOnly: true })?.id
  );
  const [driverId, setDriverId] = useState("");
  const [drivers, setDrivers] = useState([]);

  useEffect(() => {
    setDrivers([]);
    setDriverId("");
    if (!raceId) return;
    let alive = true;
    api
      .raceResults(raceId)
      .then((d) => {
        if (!alive) return;
        const list = (d.results || []).map((r) => ({ id: r.driverId, name: r.name, position: r.position, status: r.status }));
        setDrivers(list);
        setDriverId(list[0]?.id || "");
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [raceId]);

  async function setMode(mode) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.setRaceRecapMode(mode);
      setDone(mode === "all" ? "The race recap is on for everyone." : mode === "admins" ? "The race recap is on for admins only." : "The race recap is off.");
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setReviewMode(mode) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.setSeasonReviewMode(mode);
      setDone(mode === "all" ? "The season review is on for everyone." : mode === "admins" ? "The season review is on for admins only." : "The season review is off.");
      reloadReview();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // The page itself, in a new tab, from that driver's seat (?seat= with no
  // driver is the spectator's version). The admin's own session carries the
  // rights the preview route asks for.
  const previewHref = raceId ? seriesPath(`/recap/${raceId}?seat=${encodeURIComponent(driverId || "")}`) : null;

  if (loadError) return <ErrorBox message={loadError} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      {error && <ErrorBox message={error} />}
      {done && <Notice kind="success">{done}</Notice>}

      <ModeSwitch mode={data.mode} busy={busy} onChange={setMode} />
      {review && <ModeSwitch mode={review.mode} busy={busy} onChange={setReviewMode} title="Season review" texts={REVIEW_TEXT} />}

      <div className="card space-y-4 p-5">
        <CardHead eyebrow="What members get" title="How the recap works" />
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-light">
          <li>A member is taken to it once, on their first visit after a round was saved, and not from the live page or the admin.</li>
          <li>It is offered for the newest finished round only, and only within ten days of the race. Arriving on it counts as seen.</li>
          <li>The cards: where they finished and what that meant, what it paid, their pace against the field, tyres and stints, their incidents, the lap-by-lap trace, the rating's move, the season curve and their place in the championship, the season and career around it, the NABS Tokens, the team-mate head to head, and the night's honours. Cards whose data a round does not have (no archived result file, no rating yet, NABS Tokens off) simply stay away.</li>
          <li>A member can read it again from the Recap button on that round's results page.</li>
          <li>Everything is worked out from the saved results when the recap opens, so a penalty added later shows the next time it is read.</li>
        </ul>
      </div>

      <div className="card space-y-4 p-5">
        <CardHead eyebrow="See it first" title="Preview a round" />
        <p className="text-sm text-light">
          Open the recap of any finished round from any driver's seat, in a new tab. A preview never counts as seen for anybody.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Round"
            className="input max-w-[22rem] py-1.5 text-sm"
            value={raceId}
            onChange={(e) => setRaceId(e.target.value)}
            disabled={busy}
          >
            <option value="">Choose a round…</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                R{r.number} · {r.track}
                {r.date ? ` · ${fmtStamp(r.date)}` : ""}
              </option>
            ))}
          </select>
          <select
            aria-label="Driver"
            className="input max-w-[18rem] py-1.5 text-sm"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            disabled={busy || !raceId}
          >
            <option value="">Spectator (no seat)</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.status === "FINISHED" && d.position != null ? `P${d.position}` : d.status} · {d.name}
              </option>
            ))}
          </select>
          {previewHref ? (
            <a href={previewHref} target="_blank" rel="noreferrer" className="btn-primary">
              Open preview
            </a>
          ) : (
            <span className="btn-primary pointer-events-none opacity-50">Open preview</span>
          )}
          {/* That driver's season review, while it is not off. */}
          {driverId && review && review.mode !== "off" && (
            <a href={seriesPath(`/drivers/${encodeURIComponent(driverId)}/review`)} target="_blank" rel="noreferrer" className="btn-secondary">
              Season review
            </a>
          )}
        </div>
        {!rounds.length && <p className="text-xs text-light">No finished round in the season being edited yet.</p>}
      </div>
    </div>
  );
}
