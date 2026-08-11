import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Notice, CardHead, EmptyState } from "./ui.jsx";
import VideoEmbed from "./VideoEmbed.jsx";
import { youtubeId } from "../utils/videoLinks.js";
import { fmtStamp } from "../utils/format.js";

// The highlights cut of a finished round: one link per race, which puts the
// Highlights button on that round's results page.
//
// It lives here rather than among the race details in Edit Results, where it
// started: a video is what this tab is for, and the alternative was an admin
// who wants to add the night's media working in two tabs.

const fmtDate = (d) => (d ? fmtStamp(d) : "");

export default function AdminRaceHighlights() {
  const { data: races, reload: reloadRaces } = useApi(useCallback(() => api.races(), []));
  const [raceId, setRaceId] = useState("");
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState(""); // what the server last confirmed
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  // Which rounds already have a cut, so the picker says so on arrival. The race
  // list carries it, so this only holds what THIS session has changed since;
  // a saved round updates its own label without a full reload landing first.
  const [have, setHave] = useState({}); // raceId -> url or ""
  const hasCut = (r) => (r.id in have ? !!have[r.id] : !!r.highlightsUrl);

  const race = (races || []).find((r) => r.id === raceId) || null;
  const dirty = url.trim() !== saved;
  const videoId = youtubeId(url);

  useEffect(() => {
    setError(null);
    setMsg(null);
    if (!raceId) {
      setUrl("");
      setSaved("");
      return;
    }
    let alive = true;
    api
      .raceResults(raceId)
      .then((d) => {
        if (!alive) return;
        const v = d.race?.highlightsUrl || "";
        setUrl(v);
        setSaved(v);
        setHave((h) => ({ ...h, [raceId]: v }));
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [raceId]);

  async function save() {
    if (!race) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const value = url.trim();
      // The track name goes along because the edit route treats a missing one
      // as "leave it", and sending it back unchanged is the honest no-op.
      await api.updateEvent(raceId, { track: race.track, highlightsUrl: value || null });
      setSaved(value);
      setHave((h) => ({ ...h, [raceId]: value }));
      setMsg(
        value
          ? "Saved. The Highlights button is on that round's results now."
          : "Cleared. That round shows no Highlights button."
      );
      reloadRaces();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Completed rounds first: a highlights cut of a race nobody has driven yet
  // does not exist. Everything is still offered, in calendar order.
  const list = [...(races || [])].sort((a, b) => (a.number ?? 999) - (b.number ?? 999));

  return (
    <div className="space-y-5">
      <div className="card space-y-4 p-5">
        <CardHead eyebrow="Races page" title="Race highlights" />
        <p className="text-sm text-light">
          The night's highlights, as a Highlights button on the round's results. A YouTube link plays right there on
          the page; any other link (a Twitch video, a shared folder) opens where it lives. Leave it empty and the
          round simply has no button.
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
            {list.map((r) => (
              <option key={r.id} value={r.id}>
                {r.number != null ? `R${r.number}` : r.type === "TRAINING" ? "Training" : "Event"} · {r.track}
                {r.date ? ` · ${fmtDate(r.date)}` : ""}
                {hasCut(r) ? " · has a cut" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {msg && <Notice kind="success">{msg}</Notice>}

      {!raceId && (
        <EmptyState
          title="Pick a round"
          hint="Choose the round the video belongs to, then paste its link. One cut per round."
        />
      )}

      {raceId && (
        <div className="card space-y-4 p-5">
          <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">
            Highlights of {race?.track || "this round"}
          </div>

          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-60 flex-[2] space-y-2">
              <input
                aria-label="Highlights video link"
                className="input w-full py-1.5 text-sm"
                type="url"
                inputMode="url"
                placeholder="https://youtu.be/…"
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
              />
              {/* Says what the link is about to become before it is saved, so a
                  Twitch VOD that will open in a new tab is not mistaken for one
                  that was supposed to play on the page. */}
              <p className="text-xs text-light">
                {!url.trim()
                  ? "No video. This round shows no Highlights button."
                  : videoId
                    ? "A YouTube video: it plays on the race page itself."
                    : "Not a YouTube link, so the button opens it in a new tab."}
              </p>
            </div>
            <div className="w-64 shrink-0">
              {videoId ? (
                <VideoEmbed videoId={videoId} title="Highlights preview" className="rounded-xl" />
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-border text-center font-mono text-[10px] uppercase tracking-wider text-faint">
                  {url.trim() ? "no preview for this link" : "preview"}
                </div>
              )}
            </div>
          </div>

          {race && !race.isCompleted && (
            <Notice kind="info">
              This round has no result yet, so its page still shows the sign-up panel. The button appears with the
              results.
            </Notice>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={save} disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save"}
            </button>
            {dirty && (
              <button
                type="button"
                className="text-sm font-semibold text-light transition hover:text-dark"
                disabled={busy}
                onClick={() => setUrl(saved)}
              >
                Discard
              </button>
            )}
            {saved && !dirty && (
              <button
                type="button"
                className="text-sm font-semibold text-light transition hover:text-bad"
                disabled={busy}
                onClick={() => setUrl("")}
              >
                Remove the video
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
