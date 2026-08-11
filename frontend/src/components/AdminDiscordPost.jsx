import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardHead, CheckField, ErrorBox, Notice } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import { countryFor } from "../data/driverCountries.js";
import { renderPosterBlob, savedTheme } from "../utils/resultGraphic.js";

// ---------------------------------------------------------------------------
// The "#results" message for a round: the classification with real @mentions
// and the stats block, generated from the saved result, edited if you like,
// then copied or posted straight to the results-channel webhook.
//
// Built from what is STORED. A classification still open in the results editor
// is not in here yet, which is the one thing worth knowing before pressing
// generate.
// ---------------------------------------------------------------------------
export default function AdminDiscordPost({ raceId }) {
  const ask = useAsk();
  const { data: hook, reload: reloadHook } = useApi(useCallback(() => api.getResultsWebhook(), []));
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  // Send the round's poster with the message. On by default: it is the reason
  // the poster exists, and forgetting it means a second post two minutes later.
  const [withGraphic, setWithGraphic] = useState(true);

  // A different round starts from a clean slate.
  useEffect(() => {
    setText("");
    setMsg(null);
    setError(null);
  }, [raceId]);

  // The poster, drawn fresh at the moment of posting, from the design chosen in
  // the Result Graphic tab and whatever artwork is uploaded right now. Nothing
  // is kept between posts, so changing the design later changes what goes out
  // next time — including for a round that ran months ago.
  async function buildGraphic() {
    const [{ race, results }, teamArt] = await Promise.all([api.raceResults(raceId), api.teamArt()]);
    return renderPosterBlob({
      race,
      results,
      teamArt,
      countryOf: (r) => countryFor(r.driverId, r.country),
      logoSrc: "/logo-light.png",
      theme: savedTheme(),
    });
  }

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
      setText(r.text || "");
    });

  const copy = () =>
    run(async () => {
      await navigator.clipboard.writeText(text);
    }, "Copied. Paste it into Discord.");

  const post = async () => {
    if (
      !(await ask({
        title: "Post this message to the results channel?",
        body: withGraphic
          ? "Mentioned drivers get pinged, and the round's graphic goes with it."
          : "Mentioned drivers get pinged.",
        confirmLabel: "Post to Discord",
      }))
    )
      return;
    run(async () => {
      const image = withGraphic ? await buildGraphic() : null;
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
      <p className="text-sm text-light">
        Podium and classification with real @mentions, DNFs, and the stats block (pole, fastest lap, consistency,
        crashes, DOTD). Built from the saved result, so save any open edits in Edit Results first. Tweak the text
        if you like (team emojis, role pings), then post or copy it.
      </p>
      {error && <ErrorBox message={error} />}
      {msg && <Notice kind="success">{msg}</Notice>}

      {!text ? (
        <button className="btn-secondary" disabled={busy} onClick={generate}>
          {busy ? "Building…" : "Generate message"}
        </button>
      ) : (
        <>
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
          <CheckField
            checked={withGraphic}
            onChange={(e) => setWithGraphic(e.target.checked)}
            label="Attach the round's graphic"
            hint="Drawn when you press post, in the design picked under Graphic. Change the design or a car there and the next post follows."
          />
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
