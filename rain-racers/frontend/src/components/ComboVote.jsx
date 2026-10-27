import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useSite } from "../site.jsx";
import DiscordButton from "./DiscordButton.jsx";
import Countdown from "./Countdown.jsx";
import { dayShort, clock, inkOn } from "../format.js";

// A combo vote: the car and track combos put up for a round, each with its
// share of the votes. A member picks one (picking it again takes it back)
// and can change their mind until the vote closes; then the winner stands
// out. `onChange` gets the vote as it is after a pick.
export default function ComboVote({ poll: initial, color = null, onChange, linkRound = true }) {
  const { me } = useSite();
  const [poll, setPoll] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // a new vote from the page (another season, a reload) replaces the local one
  const [from, setFrom] = useState(initial);
  if (initial !== from) {
    setFrom(initial);
    setPoll(initial);
  }
  const accent = color || "#ffffff";
  const canVote = poll.open && !!me.user;

  async function pick(optionId) {
    setBusy(true);
    setError(null);
    try {
      const next = await api.put(`/polls/${poll.id}/vote`, { optionId: optionId === poll.myVote ? null : optionId });
      setPoll(next);
      onChange?.(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const winner = poll.options.find((o) => o.id === poll.winnerId);
  const round = poll.race && (
    <>
      Round {poll.race.round} · {dayShort(poll.race.startsAt)} · {clock(poll.race.startsAt)}
    </>
  );

  return (
    <section className="card overflow-hidden">
      <div className="h-1" style={{ background: accent }} />
      <div className="p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <div className="eyebrow mb-1">
              Combo vote
              {round && (
                <>
                  {" · "}
                  {linkRound ? (
                    <Link to={`/races/${poll.race.id}`} className="hover:text-ink">
                      {round}
                    </Link>
                  ) : (
                    round
                  )}
                </>
              )}
            </div>
            <h2 className="display text-3xl sm:text-4xl">{poll.open ? "Pick the next combo" : winner ? "The combo is in" : "Voting closed"}</h2>
          </div>
          <p className="text-sm text-muted">
            {poll.open ? (
              <>
                Closes in <Countdown to={poll.closesAt} className="text-ink" />
                {" · "}
              </>
            ) : null}
            <b className="text-ink">{poll.total}</b> {poll.total === 1 ? "vote" : "votes"}
          </p>
        </div>

        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Combos">
          {poll.options.map((o, i) => {
            const share = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
            const mine = poll.myVote === o.id;
            const won = poll.winnerId === o.id;
            const tied = !poll.open && !winner && poll.leaders.includes(o.id);
            const faded = !poll.open && winner && !won;
            const body = (
              <>
                <span className="flex items-start gap-3">
                  <span
                    className="round-block h-8 w-8 text-lg"
                    style={mine || won ? { background: accent, color: inkOn(accent) } : { background: "rgb(var(--line))" }}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="display block text-xl [overflow-wrap:anywhere]">{o.car || "Any car"}</span>
                    <span className="block text-sm text-muted [overflow-wrap:anywhere]">{o.track || "Any track"}</span>
                    {o.note && <span className="mt-1 block text-xs text-muted">{o.note}</span>}
                  </span>
                  {(mine || won || tied) && (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase italic tracking-wider"
                      style={won ? { background: accent, color: inkOn(accent) } : { border: `1px solid ${accent}` }}
                    >
                      {won ? "Winner" : tied ? "Tied" : "Your vote"}
                    </span>
                  )}
                </span>
                <span className="mt-4 flex items-center gap-3">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                    <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${share}%`, background: accent }} />
                  </span>
                  <span className="w-16 text-right text-xs tabular text-muted">
                    <b className="text-ink">{share}%</b> · {o.votes}
                  </span>
                </span>
              </>
            );
            const look = `block h-full w-full rounded-2xl border bg-bg p-4 text-left transition ${faded ? "opacity-50" : ""}`;
            const ring = mine || won ? { borderColor: accent } : undefined;
            return (
              <li key={o.id}>
                {canVote ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => pick(o.id)}
                    aria-pressed={mine}
                    className={`${look} lift border-line hover:border-ink disabled:cursor-wait`}
                    style={ring}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={`${look} border-line`} style={ring}>
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted">
          {poll.open && !me.user && <DiscordButton>Sign in to vote</DiscordButton>}
          {poll.open && me.user && <span>{poll.myVote ? "Changed your mind? Pick another combo, or yours again to take it back." : "One vote per member. Pick your favourite."}</span>}
          {!poll.open && winner && poll.race && <span>Round {poll.race.round} races this combo.</span>}
          {!poll.open && !winner && poll.leaders.length > 1 && <span>A tie: the league picks the combo.</span>}
          {!poll.open && !winner && poll.total === 0 && <span>Nobody voted. The league picks the combo.</span>}
        </div>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </div>
    </section>
  );
}
