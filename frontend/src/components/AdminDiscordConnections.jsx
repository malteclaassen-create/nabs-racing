import { useCallback, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardHead, Notice } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";

// ---------------------------------------------------------------------------
// Everything that connects the site to Discord, in one place (System → Discord).
//
// It used to be spread over three tabs, each next to the page that happens to
// use it: the events webhook beside the race calendar, the results webhook under
// the results post, the bot's key among the NABS Tokens settings. Nobody looking
// for "why did nothing arrive in Discord" knows that map. The events webhook is
// edited here; the results webhook stays editable beside the post it sends (you
// set it up the moment you first want to post), and the bot's key stays with
// the points it feeds — both are shown here with their state and a way there.
// ---------------------------------------------------------------------------

function Status({ on, onText, offText }) {
  return on ? (
    <span className="font-semibold text-ok">{onText}</span>
  ) : (
    <span className="font-semibold text-light">{offText}</span>
  );
}

// The webhook every race announcement and RSVP update goes through. Moved here
// from Races & Events, which now only says whether it is connected.
export function EventsWebhookCard() {
  const ask = useAsk();
  const { data: hook, reload } = useApi(useCallback(() => api.getWebhook(), []));
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(fn, done) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function save(e) {
    e.preventDefault();
    run(async () => {
      await api.setWebhook(url);
      setUrl("");
      reload();
    }, "Webhook saved.");
  }

  // Clearing the webhook stops all event posts/updates; the URL itself keeps
  // working in Discord until it's deleted there too, hence the hint.
  async function remove() {
    const ok = await ask({
      title: "Remove the saved webhook?",
      body: "Event posts and RSVP updates to Discord stop until a new one is saved. (To fully revoke the URL, also delete the webhook in Discord.)",
      danger: true,
      confirmLabel: "Remove webhook",
    });
    if (!ok) return;
    run(async () => {
      await api.setWebhook("");
      reload();
    }, "Webhook removed.");
  }

  return (
    <form onSubmit={save} className="card space-y-4 p-5">
      <CardHead eyebrow="Race announcements" title="Events webhook" />
      <p className="text-sm text-light">
        Race and event announcements, and the sign-up list under them, are posted here. Discord channel → Edit
        Channel → Integrations → Webhooks → &quot;New Webhook&quot; → &quot;Copy Webhook URL&quot; and paste it here.
      </p>
      <div className="rounded-lg bg-surface2 p-3 text-sm">
        Status: <Status on={hook?.configured} onText={`connected (${hook?.preview})`} offText="not connected" />
      </div>
      <input
        aria-label="Discord webhook URL"
        className="input"
        placeholder="https://discord.com/api/webhooks/…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy || !url.trim()}>Save</button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy || !hook?.configured}
          onClick={() => run(() => api.testWebhook(), "Test message sent. Check your Discord channel!")}
        >
          Send test
        </button>
        {hook?.configured && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={remove}>
            Remove
          </button>
        )}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {msg && <Notice kind="success">{msg}</Notice>}
    </form>
  );
}

// One line for a connection that is edited elsewhere: its state, and the way
// to the place it is edited.
function ElsewhereRow({ title, text, status, action, onAction }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="font-semibold text-dark">{title}</div>
        <p className="text-sm text-light">{text}</p>
        {status && <div className="mt-1 text-sm">{status}</div>}
      </div>
      <button type="button" className="btn-secondary py-1.5 text-sm" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}

// `onJump(tab, view)` opens another admin tab at one of its views.
export default function AdminDiscordConnections({ onJump }) {
  const results = useApi(useCallback(() => api.getResultsWebhook(), []));
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <EventsWebhookCard />
      <div className="card space-y-3 p-5">
        <CardHead eyebrow="Also connected" title="Results and the bot" />
        <ElsewhereRow
          title="Results webhook"
          text="Where the results post goes. Separate from the events webhook, so results land in their own channel."
          status={
            <>
              Status:{" "}
              <Status
                on={results.data?.configured}
                onText={`connected (${results.data?.preview})`}
                offText="not connected"
              />
            </>
          }
          action="Set up in Content"
          onAction={() => onJump?.("content", "post")}
        />
        <ElsewhereRow
          title="Discord bot"
          text="Counts messages and voice minutes for the NABS Tokens multiplier and reports invites. Its key is kept with the tokens."
          action="Open the bot's key"
          onAction={() => onJump?.("tokens", "bot")}
        />
      </div>
    </div>
  );
}
