import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardHead, ErrorBox, Notice } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import { countryFor } from "../data/driverCountries.js";
import SlidingTabs from "./SlidingTabs.jsx";
import DiscordPreview from "./DiscordPreview.jsx";
import { renderPosterBlob, savedTheme, THEMES, THEME_KEYS } from "../utils/resultGraphic.js";

// ---------------------------------------------------------------------------
// The "#results" message for a round: generated from the saved result, edited
// if you like, then copied or posted straight to the results-channel webhook.
//
// Two lengths, because the week the poster goes with it is a different message
// from the week it does not:
//
//   Full   every driver, the DNFs, and the stats block. What the channel got
//          before there was a picture.
//   Short  the round, the podium, a link. The poster underneath already lists
//          the top ten, so the long version prints the same table twice.
//
// Both are kept and edited independently, so flipping between them to compare
// does not cost you whichever one you had been writing.
//
// Built from what is STORED. A classification still open in the results editor
// is not in here yet, which is the one thing worth knowing before pressing
// generate.
// ---------------------------------------------------------------------------

const LENGTHS = [
  { key: "short", label: "Short" },
  { key: "full", label: "Full" },
];

// The poster designs, plus the option of not sending one. "none" is a real
// choice rather than an unticked box: it sits in the same control as the two
// designs because it is the same decision — which picture goes out.
const GRAPHICS = [...THEME_KEYS.map((k) => ({ key: k, label: THEMES[k].label })), { key: "none", label: "No image" }];

export default function AdminDiscordPost({ raceId }) {
  const ask = useAsk();
  const { data: hook, reload: reloadHook } = useApi(useCallback(() => api.getResultsWebhook(), []));
  // Both drafts, edited separately. `null` until generated.
  const [drafts, setDrafts] = useState(null);
  const [mentions, setMentions] = useState({});
  const [length, setLength] = useState("short");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  // Which poster goes with it. Starts on whatever design is showing under
  // Graphic, so the two halves of the tab agree the moment you arrive.
  const [graphic, setGraphic] = useState(savedTheme);
  // Everything the poster is drawn from, loaded once per round so the preview
  // can redraw on a design change without going back to the network.
  const [source, setSource] = useState(null);

  const text = drafts?.[length] ?? "";
  const setText = (v) => setDrafts((d) => ({ ...d, [length]: v }));

  // A different round starts from a clean slate.
  useEffect(() => {
    setDrafts(null);
    setMentions({});
    setMsg(null);
    setError(null);
  }, [raceId]);

  useEffect(() => {
    if (!raceId) return;
    let alive = true;
    Promise.all([api.raceResults(raceId), api.teamArt()])
      .then(([r, teamArt]) => alive && setSource({ race: r.race, results: r.results, teamArt }))
      .catch(() => alive && setSource(null));
    return () => {
      alive = false;
    };
  }, [raceId]);

  // What renderPosterTo / renderPosterBlob need. One object, used by the
  // preview and by the post, so the picture in the preview and the picture in
  // the channel cannot be drawn from different things.
  const poster = useMemo(() => {
    if (graphic === "none" || !source) return null;
    return {
      race: source.race,
      results: source.results,
      teamArt: source.teamArt,
      countryOf: (r) => countryFor(r.driverId, r.country),
      logoSrc: "/logo-light.png",
      theme: graphic,
    };
  }, [graphic, source]);

  async function run(fn, doneMsg) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (doneMsg) setMsg(doneMsg);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const generate = () =>
    run(async () => {
      const r = await api.getResultsPost(raceId);
      setDrafts({ full: r.text || "", short: r.short || "" });
      setMentions(r.mentions || {});
    });

  const copy = () =>
    run(async () => {
      await navigator.clipboard.writeText(text);
    }, "Copied. Paste it into Discord.");

  const post = async () => {
    if (
      !(await ask({
        title: "Post this message to the results channel?",
        body: poster
          ? "Mentioned drivers get pinged, and the graphic below goes with it."
          : "Mentioned drivers get pinged. No graphic is attached.",
        confirmLabel: "Post to Discord",
      }))
    )
      return;
    run(async () => {
      const image = poster ? await renderPosterBlob(poster) : null;
      const r = await api.sendResultsPost(raceId, text, image);
      const how = r.messages > 1 ? `as ${r.messages} messages (Discord length limit)` : "";
      setMsg(`Posted to Discord${how ? ` ${how}` : ""}${r.attached ? ", graphic attached." : "."}`);
    });
  };

  const saveHook = () =>
    run(async () => {
      await api.setResultsWebhook(url.trim());
      setUrl("");
      reloadHook();
    }, "Results webhook saved.");

  // Clearing only stops the "Post to Discord" button; Copy keeps working. The
  // URL itself stays usable in Discord until it's deleted there too.
  const removeHook = async () => {
    if (
      !(await ask({
        title: "Remove the saved results webhook?",
        body: "Posting from here stops until a new one is saved. (To fully revoke the URL, also delete the webhook in Discord.)",
        danger: true,
        confirmLabel: "Remove webhook",
      }))
    )
      return;
    run(async () => {
      await api.setResultsWebhook("");
      reloadHook();
    }, "Results webhook removed.");
  };

  return (
    <div className="card space-y-3 p-4">
      <CardHead eyebrow="Discord" title="Results post" />
      {error && <ErrorBox message={error} />}
      {msg && <Notice kind="success">{msg}</Notice>}

      {!drafts ? (
        <>
          <p className="text-sm text-light">
            Built from the saved result, so save any open edits in Edit Results first. You get both lengths and a
            preview of the message as the channel will see it.
          </p>
          <button className="btn-secondary" disabled={busy} onClick={generate}>
            {busy ? "Building…" : "Generate message"}
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2.5">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Length</span>
              <SlidingTabs items={LENGTHS} value={length} onChange={setLength} btnClassName="px-3.5 py-1.5 text-xs" />
            </label>
            <label className="flex items-center gap-2.5">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Image</span>
              <SlidingTabs items={GRAPHICS} value={graphic} onChange={setGraphic} btnClassName="px-3.5 py-1.5 text-xs" />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <textarea
                aria-label="Results message"
                className="input min-h-72 w-full font-mono text-xs leading-relaxed"
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
              />
              <p className="text-xs text-light">
                The &lt;@…&gt; codes turn into real @mentions once the message lands in Discord. Custom server emojis
                can be added as :emoji_name: if the webhook&rsquo;s server has them.
              </p>
            </div>
            <DiscordPreview text={text} mentions={mentions} poster={poster} when="Today" />
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || !hook?.configured || !text.trim()} onClick={post}>
              {busy ? "Posting…" : "Post to Discord"}
            </button>
            <button className="btn-secondary" disabled={busy || !text.trim()} onClick={copy}>
              Copy
            </button>
            <button className="btn-secondary" disabled={busy} onClick={generate}>
              Regenerate
            </button>
          </div>
        </>
      )}

      <div className="rounded-lg bg-surface2 p-3">
        <div className="text-sm">
          Results channel webhook:{" "}
          {hook?.configured ? (
            <span className="font-semibold text-ok">connected ({hook.preview})</span>
          ) : (
            <span className="font-semibold text-light">not connected (copy still works)</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label="Results channel webhook URL"
            className="input max-w-md flex-1"
            placeholder="https://discord.com/api/webhooks/… (the #results channel)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="btn-secondary" disabled={busy || !url.trim()} onClick={saveHook}>
            Save webhook
          </button>
          {hook?.configured && (
            <button className="btn-secondary" disabled={busy} onClick={removeHook}>
              Remove
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-light">
          Separate from the events webhook, so results land in their own channel. Discord channel &rarr; Edit
          Channel &rarr; Integrations &rarr; Webhooks.
        </p>
      </div>
    </div>
  );
}
