import { useState } from "react";
import { api } from "../api.js";
import { dateTime } from "../format.js";
import { useScope } from "./scope.jsx";
import { useAdminList, useAction, Message, Section, Field, confirmDelete, toLocalInput } from "./common.jsx";

// Combo votes (Sahara Saturdays: a calendar nobody knows). Put a few car and
// track combos up for a round, the members vote on the site, and the combo
// picked here (the winner, or one of a tie) becomes the round's car, track
// and name.
const MAX = 10;
const DAY = 24 * 3600 * 1000;
const emptyRows = (n = 5) => Array.from({ length: n }, () => ({ car: "", track: "", note: "" }));
const filled = (rows) => rows.filter((r) => r.car.trim() || r.track.trim()).length;

// Closes a few days before the round, else a few days from now.
function defaultClose(startsAt) {
  const start = startsAt ? new Date(startsAt).getTime() : 0;
  const at = start - 3 * DAY > Date.now() + DAY ? start - 3 * DAY : Date.now() + 3 * DAY;
  return toLocalInput(new Date(at).toISOString());
}

function ComboRows({ rows, onChange }) {
  const set = (i, key, value) => onChange(rows.map((r, n) => (n === i ? { ...r, [key]: value } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="w-5 shrink-0 pt-2 text-right text-sm font-black text-muted">{i + 1}</span>
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_1fr_0.8fr]">
            <input className="input" placeholder="Car" value={r.car} onChange={(e) => set(i, "car", e.target.value)} aria-label={`Combo ${i + 1} car`} />
            <input className="input" placeholder="Track" value={r.track} onChange={(e) => set(i, "track", e.target.value)} aria-label={`Combo ${i + 1} track`} />
            <input className="input" placeholder="Note (optional)" value={r.note ?? ""} onChange={(e) => set(i, "note", e.target.value)} aria-label={`Combo ${i + 1} note`} />
          </div>
          <button
            type="button"
            className="shrink-0 px-2 pt-2 text-muted hover:text-red-300 disabled:opacity-30"
            disabled={rows.length <= 2}
            onClick={() => onChange(rows.filter((_, n) => n !== i))}
            aria-label={`Remove combo ${i + 1}`}
          >
            ✕
          </button>
        </div>
      ))}
      {rows.length < MAX && (
        <button type="button" className="btn-ghost py-1.5" onClick={() => onChange([...rows, { car: "", track: "", note: "" }])}>
          Add a combo
        </button>
      )}
    </div>
  );
}

function NewVote({ seasonId, races, onSaved }) {
  const { busy, message, run } = useAction();
  // rounds still to race that have no vote yet, or a new one after the last
  const open = races.filter((r) => !r.counts.R1 && !r.hasPoll && new Date(r.startsAt).getTime() > Date.now());
  const last = races[races.length - 1];
  const [raceId, setRaceId] = useState(() => open[0]?.id ?? (last ? "new" : ""));
  const startOf = (rid) => (rid === "new" ? (last ? new Date(new Date(last.startsAt).getTime() + 7 * DAY).toISOString() : null) : races.find((r) => r.id === Number(rid))?.startsAt);
  const [closesAt, setClosesAt] = useState(() => defaultClose(startOf(raceId)));
  const [rows, setRows] = useState(emptyRows);

  if (!races.length) return <p className="text-sm text-muted">Add the season's first round under Races &amp; results, then put a vote up for the next one.</p>;

  async function submit(e) {
    e.preventDefault();
    const saved = await run(
      () => api.post("/admin/polls", { seasonId, raceId: raceId === "new" ? "new" : Number(raceId), closesAt: new Date(closesAt).toISOString(), options: rows }),
      "Vote is up. It shows on the series page and the round's page.",
    );
    if (saved) {
      setRows(emptyRows());
      onSaved();
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="For round">
          <select
            className="input"
            value={raceId}
            onChange={(e) => {
              setRaceId(e.target.value);
              setClosesAt(defaultClose(startOf(e.target.value)));
            }}
          >
            {open.map((r) => (
              <option key={r.id} value={r.id}>
                R{r.round} · {r.name} · {dateTime(r.startsAt)}
              </option>
            ))}
            {last && <option value="new">New round {last.round + 1}, a week after round {last.round}</option>}
          </select>
        </Field>
        <Field label="Voting closes">
          <input className="input" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} required />
        </Field>
      </div>
      <div>
        <span className="label">Combos</span>
        <ComboRows rows={rows} onChange={setRows} />
      </div>
      <button className="btn-accent" disabled={busy || filled(rows) < 2 || !closesAt}>
        Put the vote up
      </button>
      <Message message={message} />
    </form>
  );
}

function VoteCard({ poll, onSaved }) {
  const { busy, message, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState([]);
  const [closesAt, setClosesAt] = useState(toLocalInput(poll.closesAt));
  const state = poll.applied ? "Combo picked" : poll.open ? "Open" : "Closed: pick the combo";

  async function save() {
    const saved = await run(() => api.put(`/admin/polls/${poll.id}`, { closesAt: new Date(closesAt).toISOString(), ...(editing ? { options: rows } : {}) }), "Saved.");
    if (saved) {
      setEditing(false);
      onSaved();
    }
  }

  return (
    <Section
      title={`R${poll.race.round} · ${poll.race.name}`}
      actions={
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${poll.open ? "bg-emerald-500/15 text-emerald-300" : poll.applied ? "bg-white/5 text-muted" : "bg-amber-400/15 text-amber-300"}`}>
          {state} · {poll.total} {poll.total === 1 ? "vote" : "votes"}
        </span>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Round on {dateTime(poll.race.startsAt)} · voting {poll.open ? "closes" : "closed"} {dateTime(poll.closesAt)}
      </p>

      {editing ? (
        <div className="mb-4">
          <p className="mb-3 text-sm text-amber-300">A combo you take out takes its votes with it.</p>
          <ComboRows rows={rows} onChange={setRows} />
        </div>
      ) : (
        <ul className="mb-4 divide-y divide-line">
          {poll.options.map((o, i) => {
            const leading = poll.leaders.includes(o.id);
            const picked = poll.applied && poll.winnerId === o.id;
            return (
              <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 text-sm">
                <span className="w-5 text-right font-black text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{o.car || "Any car"}</span>
                  <span className="text-muted"> at {o.track || "any track"}</span>
                  {o.note && <span className="block text-xs text-muted">{o.note}</span>}
                </span>
                <span className="tabular">
                  <b>{o.votes}</b> <span className="text-muted">{o.votes === 1 ? "vote" : "votes"}</span>
                  {leading && !poll.applied && <span className="ml-2 text-xs font-bold text-amber-300">{poll.leaders.length > 1 ? "tied" : "leads"}</span>}
                </span>
                {picked ? (
                  <span className="text-xs font-bold text-emerald-400">Raced ✓</span>
                ) : (
                  <button
                    type="button"
                    className={poll.open || !leading ? "btn-ghost py-1" : "btn-accent py-1"}
                    disabled={busy}
                    onClick={async () => {
                      if (poll.open && !window.confirm("The vote is still open. Close it and race this combo?")) return;
                      if (await run(() => api.post(`/admin/polls/${poll.id}/apply`, { optionId: o.id }), `Round ${poll.race.round} races this combo.`)) onSaved();
                    }}
                  >
                    Race this
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Voting closes">
          <input className="input w-auto" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
        </Field>
        <button type="button" className="btn-accent" disabled={busy || !closesAt} onClick={save}>
          Save
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setRows(poll.options.map(({ id, car, track, note }) => ({ id, car, track, note: note ?? "" })));
            setEditing((x) => !x);
          }}
        >
          {editing ? "Cancel" : "Change combos"}
        </button>
        <button
          type="button"
          className="btn-danger ml-auto"
          disabled={busy}
          onClick={async () => confirmDelete(`the vote for round ${poll.race.round}`) && (await run(() => api.del(`/admin/polls/${poll.id}`))) && onSaved()}
        >
          Delete vote
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">“Race this” gives the round the combo's car and track, names it “car at track” and takes away the mystery track. Change the round afterwards under Races &amp; results.</p>
      <div className="mt-2">
        <Message message={message} />
      </div>
    </Section>
  );
}

export default function VotesAdmin() {
  const { currentSeason } = useScope();
  const polls = useAdminList(currentSeason ? `/admin/polls?season=${currentSeason.id}` : null);
  const races = useAdminList(currentSeason ? `/admin/races?season=${currentSeason.id}` : null);
  if (!currentSeason) return <Section title="Combo votes">Pick a season first.</Section>;
  if (!polls.data || !races.data) return null;
  const withPoll = new Set(polls.data.map((p) => p.race.id));
  const rounds = races.data.map((r) => ({ ...r, hasPoll: withPoll.has(r.id) }));
  const reload = () => {
    polls.reload();
    races.reload();
  };

  return (
    <div className="space-y-6">
      <Section title={`New combo vote · ${currentSeason.name}`}>
        <p className="mb-4 text-sm text-muted">
          Put up the combos for a round nobody knows yet. Members signed in with Discord vote on the series page and the round's page, one vote each. Once voting
          closes, race the winner below.
        </p>
        <NewVote key={`${currentSeason.id}-${polls.data.length}`} seasonId={currentSeason.id} races={rounds} onSaved={reload} />
      </Section>
      {polls.data.map((p) => (
        <VoteCard key={`${p.id}-${p.closesAt}-${p.options.map((o) => o.id).join(".")}`} poll={p} onSaved={reload} />
      ))}
    </div>
  );
}
