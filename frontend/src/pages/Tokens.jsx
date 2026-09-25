import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { TOKENS_CHANGED_EVENT } from "../hooks/useTokenBalance.js";
import { usePracticeWeek } from "../hooks/usePracticeWeek.js";
import { Spinner, ErrorBox, EmptyState, Notice, DriverAvatar, MEDAL_TEXT } from "../components/ui.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";
import { Modal, useAsk } from "../components/overlay.jsx";
import TokenIcon from "../components/TokenIcon.jsx";
import TrainingBar from "../components/TrainingBar.jsx";
import RatingCard, { CardBack } from "../components/RatingCard.jsx";
import { shrinkImage } from "../utils/imageResize.js";

// ---------------------------------------------------------------------------
// NABS Tokens: the member's own page. What they have, how it got there, how to
// get more, and what it buys. Lives as a tab of the Personal Area next to My
// Rating, because it is the same kind of thing: yours and nobody else's.
// ---------------------------------------------------------------------------

// The site's own numbers read better grouped: 1 250 rather than 1250.
const fmt = (n) => new Intl.NumberFormat(undefined, { useGrouping: true }).format(n || 0);

// The flair that is not on the list. Same string as CUSTOM_FLAIR_KEY in
// backend/src/lib/tokens.js, which is what the server matches on.
const CUSTOM_FLAIR = "custom";

function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

// The line at the top of every block on this page. One component so the four
// cards of the grid below start the same way and line up with each other.
function Heading({ children }) {
  return (
    <div className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-eyebrow">{children}</div>
  );
}

// ---------------------------------------------------------------------------
// The balance as a number that MOVES: after a purchase it counts down from
// what you had to what you have, after a race it counts up. Same off-switches
// as CountUp (reduced motion, Performance Lite).
// ---------------------------------------------------------------------------
function reduceMotion() {
  if (typeof window === "undefined") return true;
  const html = document.documentElement.classList;
  return (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) || html.contains("fx-lite");
}

// `fromZero`: the first time it shows, it counts up from nothing, so opening
// the page is a little moment rather than a number that was simply there.
function MovingNumber({ value, className = "", fromZero = false }) {
  const target = Number(value) || 0;
  const start0 = fromZero && !reduceMotion() ? 0 : target;
  const [shown, setShown] = useState(start0);
  const from = useRef(start0);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    if (reduceMotion()) {
      from.current = target;
      setShown(target);
      return;
    }
    const t0 = performance.now();
    const dur = start === 0 ? 1300 : 900;
    let raf = 0;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (target - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return <span className={className}>{fmt(shown)}</span>;
}

// A bar that grows from nothing to its width when it first shows, and glides
// when the width changes later. With motion off it simply has its width.
function GrowBar({ share, className = "", trackClassName = "h-2 bg-surface2" }) {
  const [grown, setGrown] = useState(reduceMotion);
  useEffect(() => {
    if (grown) return;
    // Two frames: the first paints the empty bar, the second starts the growth.
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setGrown(true));
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [grown]);
  const w = Math.max(0, Math.min(1, share || 0)) * 100;
  return (
    <div className={`overflow-hidden rounded-full ${trackClassName}`}>
      <div className={`token-grow h-full rounded-full ${className}`} style={{ width: grown ? `${w}%` : 0 }} />
    </div>
  );
}

// The balance card's coin: pops in, then catches the light now and then.
function Coin({ className }) {
  return (
    <span className="token-coin" style={{ "--coin-mask": "url(/nabs-star.webp)" }}>
      <TokenIcon className={className} />
    </span>
  );
}

// A handful of coins flying out of the button that just spent tokens. Mounted
// once per purchase; the numbers are fixed per coin so it looks the same every
// time rather than random.
const BURST = Array.from({ length: 12 }, (_, i) => {
  const angle = (-90 + (i - 5.5) * 17) * (Math.PI / 180);
  const dist = 70 + (i % 3) * 22;
  return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, r: (i % 2 ? 1 : -1) * (90 + i * 20), d: (i % 4) * 40 };
});
function CoinBurst() {
  return (
    <span className="token-burst" aria-hidden="true">
      {BURST.map((c, i) => (
        <span key={i} style={{ "--dx": `${c.dx}px`, "--dy": `${c.dy}px`, "--r": `${c.r}deg`, "--d": `${c.d}ms` }}>
          <TokenIcon className="h-full w-full" />
        </span>
      ))}
    </span>
  );
}

// "Saving for": the one thing in the shop you are working towards. Kept in
// this browser only; it is a note to yourself, not a fact about the account.
const GOAL_KEY = "nabs_token_goal";
function readGoal() {
  try {
    return localStorage.getItem(GOAL_KEY) || null;
  } catch {
    return null;
  }
}
function writeGoal(key) {
  try {
    if (key) localStorage.setItem(GOAL_KEY, key);
    else localStorage.removeItem(GOAL_KEY);
  } catch {
    /* private window, whatever: the page works without it */
  }
}

function Goal({ item, balance, onClear }) {
  if (!item) return null;
  const share = Math.max(0, Math.min(1, balance / item.cost));
  const left = item.cost - balance;
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-light">
          Saving for <span className="font-semibold text-dark">{item.name}</span>
        </span>
        <span className="font-mono tabular-nums text-medium">
          {left > 0 ? (
            <>
              {fmt(left)} <span className="text-light">to go</span>
            </>
          ) : (
            <span className="font-bold text-ok">You can get it now</span>
          )}
        </span>
      </div>
      <GrowBar
        share={share}
        trackClassName={`mt-2 h-2 bg-surface2 ${left > 0 ? "" : "token-goal-done"}`}
        className={left > 0 ? "bg-brand" : "bg-ok"}
      />
      <button type="button" onClick={onClear} className="mt-1.5 text-[11px] text-light underline-offset-2 hover:underline">
        stop saving for this
      </button>
    </div>
  );
}

// Who is ahead. Three lists: points earned (spending does not count against
// you), time in voice and messages written. Voice and chat are their own boards
// rather than one added together, because an hour is sixty and a good evening
// of typing is twenty, so the sum was a voice board wearing a disguise.
// Your own row is marked so you do not have to hunt for it.
function Leaderboard() {
  const board = useApi(useCallback(() => api.tokenLeaderboard(), []));
  const [tab, setTab] = useState("earned");
  const d = board.data;
  if (!d || d.enabled === false) return null;
  const rows = tab === "earned" ? d.earned : tab === "voice" ? d.voice : d.chat;
  const hours = (m) => Math.round((m || 0) / 6) / 10;
  // The one number that makes a board worth coming back to: how far it is to
  // the next name up.
  const myIndex = rows ? rows.findIndex((r) => r.mine) : -1;
  const ahead = myIndex > 0 ? rows[myIndex - 1] : null;
  let chase = null;
  if (ahead) {
    const me = rows[myIndex];
    if (tab === "earned") chase = `${fmt(ahead.earned - me.earned + 1)} tokens`;
    else if (tab === "voice") chase = hm(Math.max(1, (ahead.minutes || 0) - (me.minutes || 0) + 1));
    else chase = `${fmt((ahead.messages || 0) - (me.messages || 0) + 1)} messages`;
  }
  return (
    <div className="card reveal p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Heading>Who is ahead</Heading>
          {tab !== "earned" && (
            <div className="mt-0.5 text-[11px] text-light">Last {d.windowDays || 30} days</div>
          )}
        </div>
        <SlidingTabs
          items={[
            { key: "earned", label: "Tokens earned" },
            { key: "voice", label: "Time in voice" },
            { key: "chat", label: "Messages" },
          ]}
          value={tab}
          onChange={setTab}
          wrapClassName="inline-flex rounded-xl border border-border bg-surface2/60 p-1"
          btnClassName="px-3 py-1 text-[12px]"
        />
      </div>
      {rows?.length > 0 && (myIndex === 0 || chase) && (
        <div key={`chase-${tab}`} className="pop-in mt-3 text-xs text-medium">
          {myIndex === 0 ? (
            <span className="font-semibold text-ok">You are top of this board.</span>
          ) : (
            <>
              <span className="font-mono font-bold tabular-nums text-dark">{chase}</span> to pass{" "}
              <span className="font-semibold text-dark">{ahead.name}</span> for P{myIndex}.
            </>
          )}
        </div>
      )}
      {rows?.length ? (
        // keyed on the tab so the rows deal in again when you switch boards.
        <ol key={tab} className="cascade mt-3 divide-y divide-border">
          {rows.map((r, i) => {
            const mine = !!r.mine;
            return (
              <li
                key={r.id || i}
                style={{ "--i": i }}
                className={`flex items-center gap-3 py-2 ${mine ? "-mx-2 rounded-lg bg-brand/10 px-2" : ""}`}
              >
                <span
                  className={`w-6 shrink-0 text-center font-mono text-sm font-bold tabular-nums ${i < 3 ? "" : "text-light"}`}
                  style={i < 3 ? { color: MEDAL_TEXT[i] } : undefined}
                >
                  {i + 1}
                </span>
                <DriverAvatar name={r.name} photoUrl={r.avatarUrl} size={28} />
                <span className={`min-w-0 flex-1 truncate text-sm ${mine ? "font-bold text-dark" : "font-semibold text-dark"}`}>
                  {r.name}
                  {mine && <span className="ml-1.5 text-[11px] font-normal text-light">you</span>}
                </span>
                {tab === "earned" ? (
                  <span className="inline-flex items-center gap-1 font-mono text-sm font-bold tabular-nums text-medium">
                    <TokenIcon className="h-3.5 w-3.5 text-brand" />
                    {fmt(r.earned)}
                  </span>
                ) : (
                  // The number the list is ranked on leads, the other one
                  // follows in grey. Otherwise a voice board and a message
                  // board look identical and you cannot tell which you are on.
                  <span className="font-mono text-xs tabular-nums text-medium">
                    {/* Two fixed columns, so the ranked number lines up down
                        the list instead of moving with the grey one after it. */}
                    {tab === "voice" ? (
                      <>
                        <span className="inline-block w-14 text-right font-bold text-dark">{hours(r.minutes)} h</span>
                        <span className="inline-block w-24 text-right text-light">{fmt(r.messages)} msgs</span>
                      </>
                    ) : (
                      <>
                        <span className="inline-block w-24 text-right font-bold text-dark">{fmt(r.messages)} msgs</span>
                        <span className="inline-block w-14 text-right text-light">{hours(r.minutes)} h</span>
                      </>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-light">
          {tab === "earned"
            ? "Nobody has earned anything yet. The first race night decides."
            : "Nothing counted yet. This fills up once the league's Discord bot is running."}
        </p>
      )}
    </div>
  );
}

function Balance({ data, goal, onClearGoal }) {
  const s = data.stats || {};
  const tile = (value, label) => (
    <div>
      <div className="font-mono text-lg font-bold tabular-nums text-dark">{fmt(value)}</div>
      <div className="text-[11px] uppercase leading-tight tracking-wider text-light">{label}</div>
    </div>
  );
  return (
    // h-full + the space pushed between the two halves: the card fills whatever
    // height the row has (see the grid in the page below) instead of leaving a
    // gap under itself next to a taller neighbour.
    <div className="card reveal flex h-full flex-col justify-between p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <Coin className="h-12 w-12" />
        <div>
          <div className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-eyebrow">Your balance</div>
          <div className="font-display text-3xl font-extrabold tabular-nums leading-none text-dark">
            <MovingNumber value={data.balance} fromZero />{" "}
            <span className="font-display text-base font-bold uppercase tracking-tight text-light">tokens</span>
          </div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
        {tile(s.races, s.races === 1 ? "race finished" : "races finished")}
        {tile(s.invited, s.invited === 1 ? "person invited" : "people invited")}
        {tile(s.invitedRacing, "of them racing")}
        <div>
          <div className="font-mono text-lg font-bold tabular-nums text-dark">
            {(s.multiplier || 1).toFixed(1)}x
          </div>
          <div className="text-[11px] uppercase leading-tight tracking-wider text-light">multiplier</div>
        </div>
      </div>
      {s.activity && <MultiplierBar a={s.activity} />}
      <Goal item={goal} balance={data.balance} onClear={onClearGoal} />
    </div>
  );
}

// How far the activity multiplier is filled up, and out of what. One bar for
// the whole thing, two thin ones for the halves it is made of.
function MultiplierBar({ a }) {
  const max = a.max || 3;
  const share = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const hours = Math.round((a.vcMinutes || 0) / 6) / 10;
  const x = (v) => `x${(Number(v) || 1).toFixed(1)}`;
  const rows = [
    { key: "total", big: true, label: "Total", value: x(a.total), note: `of ${x(max)}`, fill: share(a.total || 1, 1, max) },
    {
      key: "chat",
      label: "Chat",
      value: fmt(a.chatMessages || 0),
      note: a.chatRange ? `/ ${fmt(a.chatRange.max)}` : "",
      chip: x(a.chat),
      fill: a.chatRange ? share(a.chatMessages || 0, 0, a.chatRange.max) : 0,
    },
    {
      key: "voice",
      label: "Voice",
      value: `${hours} h`,
      note: a.voiceRange ? `/ ${Math.round(a.voiceRange.max / 60)} h` : "",
      chip: x(a.voice),
      fill: a.voiceRange ? share(a.vcMinutes || 0, 0, a.voiceRange.max) : 0,
    },
  ];
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-2 text-xs text-light">
        {/* Counted from the last briefing; the seven days only before the first one. */}
        {a.since ? "Discord activity since the last briefing" : `Discord activity, last ${a.windowDays || 7} days`}
      </div>
      {/* ONE grid for all three rows, fixed row height, same bar thickness:
          the bars line up left and right and sit the same distance apart. */}
      <div className="grid grid-cols-[3rem_1fr_auto] auto-rows-[1.25rem] items-center gap-x-3 gap-y-2 text-xs">
        {rows.map((r) => (
          <Fragment key={r.key}>
            <span className={r.big ? "font-semibold text-dark" : "text-light"}>{r.label}</span>
            <GrowBar share={r.fill} className={r.big ? "bg-brand" : "bg-brand/60"} />
            <span className="flex items-center justify-end gap-2 font-mono tabular-nums">
              <span className={r.big ? "font-bold text-dark" : "text-medium"}>
                {r.value}
                {r.note && <span className="font-normal text-light"> {r.note}</span>}
              </span>
              {r.chip && <span className="rounded bg-ok/15 px-1 text-[10px] font-bold leading-4 text-ok">{r.chip}</span>}
            </span>
          </Fragment>
        ))}
      </div>
      <NextStep a={a} />
      <p className="mt-2 text-[11px] leading-relaxed text-light">
        Recounted every day. Chat starts counting at {fmt(a.chatRange?.min || 50)} messages, voice at{" "}
        {Math.round((a.voiceRange?.min || 300) / 60)} hours. The two halves add up: total = chat + voice, minus one.
      </p>
    </div>
  );
}

// What it takes to get the multiplier one step (0.1) higher, from chat OR
// from voice. The same straight line the server draws (lib/tokenRules.js):
// a half is 1.1 at its lower threshold and 2.0 at its upper one.
const HALF_FLOOR = 1.1;
const HALF_CEILING = 2;
function amountFor(half, range) {
  if (half <= 1) return 0;
  if (half <= HALF_FLOOR) return range.min;
  if (half > HALF_CEILING) return Infinity;
  return range.min + ((half - HALF_FLOOR) / (HALF_CEILING - HALF_FLOOR)) * (range.max - range.min);
}
function nextStep(a) {
  const max = a.max || 3;
  const total = a.total || 1;
  if (total >= max - 1e-9 || !a.chatRange || !a.voiceRange) return null;
  // One step above the number the card SHOWS (rounded to a tenth), or a 1.55
  // shown as "1.6x" would get "next step x1.6" under it.
  const next = Math.min(max, Math.round(total * 10) / 10 + 0.1);
  const gap = next - total;
  const msgs = Math.ceil(amountFor((a.chat || 1) + gap, a.chatRange) - (a.chatMessages || 0));
  const mins = Math.ceil(amountFor((a.voice || 1) + gap, a.voiceRange) - (a.vcMinutes || 0));
  return { next, msgs: Number.isFinite(msgs) ? Math.max(1, msgs) : null, mins: Number.isFinite(mins) ? Math.max(1, mins) : null };
}
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

function NextStep({ a }) {
  const max = a.max || 3;
  if ((a.total || 1) >= max - 1e-9) {
    return (
      <div className="mt-3 rounded-lg bg-ok/10 px-3 py-2 text-xs font-semibold text-ok">
        Maxed out. Every race you finish pays x{max.toFixed(1)}.
      </div>
    );
  }
  const s = nextStep(a);
  if (!s || (!s.msgs && !s.mins)) return null;
  return (
    <div className="mt-3 rounded-lg border border-border px-3 py-2 text-xs text-medium">
      <span className="font-semibold text-dark">Next step x{s.next.toFixed(1)}:</span>{" "}
      {s.msgs && (
        <>
          <span className="font-mono tabular-nums">{fmt(s.msgs)}</span> more {s.msgs === 1 ? "message" : "messages"}
        </>
      )}
      {s.msgs && s.mins && " or "}
      {s.mins && (
        <>
          <span className="font-mono tabular-nums">{hm(s.mins)}</span> more in voice
        </>
      )}
      .
    </div>
  );
}

// The training week, in the card the points page gives it: one line per race
// server, because each server carries its own milestones (nineteen laps on
// each of them is nothing), stacked so the bars sit exactly under one another.
// The rule itself is written once, underneath, rather than repeated beside
// every bar.
//
// The series a server is counting for only gets named when the servers are
// counting for DIFFERENT ones, which is the only time it tells you anything.
function PracticeCard({ week }) {
  if (!week) return null;
  const weeks = week.weeks?.length ? week.weeks : [week];
  const manySeries = new Set(weeks.map((w) => w.series)).size > 1;
  const tiers = weeks[0]?.tiers || [];
  return (
    <div className="card reveal px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading>Training</Heading>
        <div className="text-xs text-light">This week</div>
      </div>
      <div className="mt-3 space-y-3">
        {weeks.map((w) => (
          <TrainingBar
            key={w.server}
            week={{ ...w, paying: week.paying }}
            variant="stacked"
            label={manySeries ? `${w.serverName} · ${w.seriesName}` : w.serverName}
          />
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-light">
        {tiers.map((t, i) => (
          <span key={t.laps}>
            {i > 0 && ", "}
            <span className="font-mono tabular-nums">{t.laps}</span> laps +{t.points}
          </span>
        ))}
        {", per server."}
      </p>
    </div>
  );
}

// How to bring somebody in. There is no link to share any more: a click on a
// link used to count, and the league wants the newcomer to say it themselves.
// So this card tells the member what the newcomer types in when signing in.
function InviteCard({ code, name, earning = true }) {
  return (
    <div className="card reveal flex h-full flex-col gap-3 p-5">
      <div>
        <Heading>Bring someone in</Heading>
        <p className="mt-1 text-sm leading-relaxed text-light">
          When somebody new signs in with Discord, the sign-in page asks who invited them. If they type your name
          or your code, the league knows they came from you. It pays once they have finished their first race, and
          then for each race after that{earning ? "" : ", once the counting starts"}.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-medium">
        {name && (
          <span>
            Your name: <span className="font-semibold text-dark">{name}</span>
          </span>
        )}
        <span>
          Your code: <span className="font-mono font-bold text-dark">{code}</span>
        </span>
      </div>
      <p className="mt-auto text-xs text-light">One inviter per person, and only for somebody who has never raced.</p>
    </div>
  );
}

// What earns tokens. A quiet list rather than a grid of cards: it is a price
// list, and a price list is read down the left and across to the right.
function EarnList({ rules, multiplier = 1, startDay = null, earning = true }) {
  const boosted = rules.some((r) => r.boosted);
  return (
    <div className="card reveal px-5 py-4">
      <Heading>Earning tokens</Heading>
      {boosted && (
        <p className="mb-1 mt-1 text-xs leading-relaxed text-light">
          The marked lines are multiplied by how active you are on Discord, chat and voice together, up to 3x.
          Yours is {(multiplier || 1).toFixed(1)}x right now.
        </p>
      )}
      {earning && startDay && (
        <p className="mb-1 mt-1 text-xs leading-relaxed text-light">
          Counting since{" "}
          {new Date(`${startDay}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.
          Races before that are not paid.
        </p>
      )}
      <ul className="divide-y divide-border">
      {rules.map((r) => (
        <li key={r.key} className="flex items-baseline justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className={`flex items-center gap-1.5 text-sm font-semibold ${r.active ? "text-dark" : "text-light"}`}>
              {r.label}
              {r.boosted && (
                <span
                  className="rounded bg-ok/15 px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-ok"
                  title="Multiplied by your Discord activity"
                >
                  x{(multiplier || 1).toFixed(1)}
                </span>
              )}
            </div>
            <div className="text-xs leading-relaxed text-light">{r.hint}</div>
          </div>
          <div className="shrink-0 text-right">
            {r.active ? (
              <>
                <div className="font-mono text-sm font-bold tabular-nums text-brand">+{fmt(r.points)}</div>
                <div className="text-[11px] uppercase tracking-wider text-light">{r.unit}</div>
              </>
            ) : (
              <div className="text-[11px] uppercase tracking-wider text-light">{r.unit}</div>
            )}
          </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The shop's artwork.
//
// A real picture wins whenever there is one: drop <key>.jpg (or .png/.webp)
// into frontend/public/shop and the tile picks it up, no code involved. See
// that folder's README.
//
// Until then this draws the placeholder, and the placeholder has NO COLOUR of
// its own: a grid of tiles each tinted its own shade is exactly the look this
// site does not want, and six different gradients say nothing about six
// different things anyway. The same quiet panel for all of them.
// ---------------------------------------------------------------------------
const ART_EXTENSIONS = ["jpg", "png", "webp"];

// Which picture an entry has, worked out ONCE per key and remembered for the
// rest of the visit: null while we are still looking, false for "there is none",
// or the address of the one that loaded.
//
// Probed with an Image object rather than by putting a guessed address in the
// page and waiting for it to fail. A missing file does not 404 here: both the
// dev server and the real one answer an unknown path with the site's own HTML,
// so an <img> pointed at a design that has no picture renders the browser's
// broken-image icon in the middle of the shop instead of quietly stepping to
// the next extension. This way nothing reaches the page until it has decoded.
const artCache = new Map();

function probeArt(key) {
  if (artCache.has(key)) return artCache.get(key);
  const found = (async () => {
    for (const ext of ART_EXTENSIONS) {
      const url = `/shop/${key}.${ext}`;
      const ok = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => resolve(false);
        img.src = url;
      });
      if (ok) return url;
    }
    return false;
  })();
  artCache.set(key, found);
  return found;
}

function ShopArt({ item, className = "", children }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let gone = false;
    Promise.resolve(probeArt(item.key)).then((url) => {
      if (!gone && url) setSrc(url);
    });
    return () => {
      gone = true;
    };
  }, [item.key]);

  return (
    <div className={`relative isolate overflow-hidden rounded-xl border border-border bg-surface2 ${className}`}>
      {src ? (
        // `contain`, not `cover`: the league's pictures are cut-out renders on a
        // transparent background (a helmet, a trophy, a badge), and cropping one
        // to fill a 3:2 box takes the top off the helmet. The padding keeps it
        // off the border, and the transparent background is why these are PNGs
        // and why the tile's own surface shows through in both themes.
        <img src={src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain p-2" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-light" aria-hidden="true">
          <TokenIcon className="h-9 w-9 opacity-25" />
        </div>
      )}
      {children}
    </div>
  );
}

// The price as it is written on an entry. An entry that holds a catalogue costs
// what its cheapest thing costs, so the league puts a word in front of the
// number ("from 1,200"); the word is theirs, set per entry in the admin.
const withPrefix = (item) => (item.pricePrefix ? `${item.pricePrefix} ${fmt(item.cost)}` : fmt(item.cost));

// What the button on an entry says, in one place: the price, or how far off it
// is.
function buyLabel(item, balance) {
  const short = item.cost - balance;
  return short > 0 ? `${fmt(short)} short` : item.instant ? "Buy" : "Redeem";
}

// One entry in the shop. Two shapes, one markup:
//
//   phone   a ROW: the picture on the left, the words beside it. A 150px wide
//           tile turned "Hall of fame entry" into three cut-off lines and every
//           tile a different height, which is what a two-column grid on a phone
//           always does to real words.
//   sm+     the tile it was: picture on top, words under it.
//
// Either way the price sits at the BOTTOM of the entry and the description is
// held to two lines, so a row of tiles lines up instead of stepping up and down
// with the length of the text.
//
// The whole thing opens the window rather than buying on the spot: every entry
// has more to say than fits here, and nothing should be bought by a stray click.
function ShopTile({ item, balance, onOpen, index = 0 }) {
  const short = item.cost - balance;
  return (
    <li className="h-full" style={{ "--i": index }}>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={`lift shine token-tile flex h-full w-full gap-3 rounded-xl border bg-card p-2 text-left transition hover:border-brand/40 sm:flex-col sm:gap-0 ${
          short > 0 ? "border-border" : "token-ready border-ok/40"
        }`}
      >
        <ShopArt item={item} className="token-tile-art h-[72px] w-[104px] shrink-0 sm:aspect-[3/2] sm:h-auto sm:w-full" />
        <div className="flex min-w-0 flex-1 flex-col px-1 pb-0.5 sm:pt-2.5">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-light">
            {item.category}
          </div>
          <div className="text-sm font-semibold leading-snug text-dark">{item.name}</div>
          <div className="line-clamp-2 text-xs leading-snug text-light">{item.description}</div>
          <span
            className={`mt-auto flex items-center gap-1 pt-1.5 font-mono text-sm font-bold tabular-nums ${
              short > 0 ? "text-light" : "text-ok"
            }`}
          >
            <TokenIcon className="h-3.5 w-3.5" />
            {withPrefix(item)}
            {short <= 0 && (
              <span className="ml-auto hidden whitespace-nowrap font-sans text-[10px] font-bold uppercase tracking-wider sm:inline">You can buy this</span>
            )}
          </span>
          {/* How close you are, for the ones you cannot buy yet. */}
          {short > 0 && item.cost > 0 && (
            <GrowBar share={balance / item.cost} trackClassName="mt-1.5 h-1 bg-surface2" className="bg-brand/70" />
          )}
        </div>
      </button>
    </li>
  );
}

// The window behind a tile: the big picture, the long version of what the entry
// is, and the button that spends the tokens.
function ItemWindow({ item, data, onClose, onChanged, goal, onGoal }) {
  const ask = useAsk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ordered, setOrdered] = useState(false);
  const [choice, setChoice] = useState(null);
  const [ownText, setOwnText] = useState("");
  const flairs = item.key === "profile_flair" ? data.flairs || [] : null;
  // The one flair that is not on the list: your own wording. It is the only
  // thing in the shop that puts words a member chose on a public page, so it
  // goes to the league office first and is not worn until they say yes.
  const ownFlair = !!flairs && choice === CUSTOM_FLAIR;
  const maxFlair = data.customFlairMax || 24;
  const ownReady = ownText.trim().length > 0;
  // Both of these move while the window is open, so they are read from the
  // freshly reloaded data every render rather than frozen at the moment the
  // tile was clicked.
  const balance = data.balance;
  const live = data.shop.find((i) => i.key === item.key) || item;
  const short = live.cost - balance;
  // "Instant" is a property of the entry EXCEPT for a flair you wrote: that
  // one waits for a person, so every line that says "yours right away" has to
  // read this and not live.instant.
  const instant = !!live.instant && !ownFlair;

  // A lock that is true the instant the button is pressed, rather than on the
  // next render the way `busy` is. This spends tokens: two clicks landing in
  // the same tick would both get past a state flag and order twice, and the
  // second one is a charge nobody asked for.
  const running = useRef(false);

  async function act() {
    if (running.current) return;
    // Points are spent here and there is no undo, so the last step is a
    // deliberate second click rather than the first one landing in the wrong
    // place.
    const ok = await ask({
      title: `${instant ? "Buy" : "Order"} ${live.name}?`,
      body: `${fmt(live.cost)} tokens come off your balance. You have ${fmt(balance)}.${
        ownFlair
          ? `\n\nAn admin reads "${ownText.trim()}" before it goes up, and can decline it, which puts the tokens back.`
          : instant
            ? ""
            : "\n\nThe league office fills this by hand and can decline it, which puts the tokens back."
      }`,
      confirmLabel: `${instant ? "Buy" : "Order"} for ${fmt(live.cost)}`,
    });
    if (!ok) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.redeemToken(live.key, choice, ownFlair ? ownText.trim() : null);
      setOrdered(true);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  // The window is a column: a body that scrolls and a footer that does not, so
  // the button that spends the tokens is never below the bottom of the screen.
  return (
    <Modal open onClose={onClose} title={live.name} size="lg">
      <div className="flex max-h-[70vh] flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-slim pr-1">
          <ShopArt item={live} className="h-40 w-full sm:h-48" />

          {error && <ErrorBox message={error} />}
          {ordered && (
            <div className="token-done-pop"><Notice kind="success">
              {ownFlair
                ? "Sent to the admins. They read your wording first, and it goes up on your profile once they say yes. If they turn it down you get the tokens back."
                : instant
                  ? "Done. It is live on the site right now."
                  : "Ordered. The league office picks it up from here and will come back to you on Discord."}
            </Notice></div>
          )}

          <p className="text-sm leading-relaxed text-medium">{live.blurb || live.description}</p>

          {flairs && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {flairs.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    disabled={ordered}
                    onClick={() => setChoice(f.key)}
                    className={`pill border px-3 py-1.5 text-xs transition ${
                      choice === f.key ? "border-ok bg-ok/15 text-ok" : "border-border bg-surface2 text-medium hover:text-dark"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={ordered}
                  onClick={() => setChoice(CUSTOM_FLAIR)}
                  className={`pill border border-dashed px-3 py-1.5 text-xs transition ${
                    ownFlair ? "border-ok bg-ok/15 text-ok" : "border-border bg-surface2 text-medium hover:text-dark"
                  }`}
                >
                  Write your own
                </button>
              </div>

              {ownFlair && (
                <div className="space-y-2">
                  <input
                    className="input w-full"
                    autoFocus
                    disabled={ordered}
                    maxLength={maxFlair}
                    placeholder="Your wording"
                    value={ownText}
                    onChange={(e) => setOwnText(e.target.value)}
                  />
                  <div className="text-right font-mono text-[11px] text-light">
                    {ownText.length} / {maxFlair}
                  </div>
                  <Notice kind="info">
                    This one does not go up by itself. An admin reads it first and puts it on your profile if it is
                    fine. Turn it down and your tokens come straight back.
                  </Notice>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <span className="inline-flex items-center gap-1.5 font-mono text-sm font-bold tabular-nums text-medium">
            <TokenIcon className="h-4 w-4 text-brand" />
            {withPrefix(live)}
            <span className="ml-2 font-sans text-xs font-normal text-light">you have {fmt(balance)}</span>
          </span>
          <div className="flex items-center gap-2">
            {short > 0 && onGoal && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onGoal(goal === live.key ? null : live.key)}
              >
                {goal === live.key ? "Saving for this" : "Save for this"}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={onClose}>
              {ordered ? "Done" : "Not now"}
            </button>
            <span className="relative">
              {ordered && <CoinBurst />}
              <button
                type="button"
                className="btn-primary"
                disabled={busy || ordered || short > 0 || (flairs && (!choice || (ownFlair && !ownReady)))}
                onClick={act}
              >
                {busy ? "…" : ordered ? (instant ? "Yours" : "Ordered") : buyLabel({ ...live, instant }, balance)}
              </button>
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The card-design window: the one shop entry that is a catalogue rather than a
// single thing.
//
// Four collector series, nineteen designs, and the one you click is shown as a
// REAL card at the top — the same component the site draws everywhere, on a
// sample driver, so what you are buying is what you will wear. Buying completes
// itself: the design is on your picker the moment the answer comes back, which
// is why this window says "yours right away" and the others say the league
// office will be in touch.
//
// The designs you EARN are not in here and never will be. Starts, wins, poles
// and titles are the price of those.
// ---------------------------------------------------------------------------
const CARD_SAMPLE_DRIVER = {
  id: "sample",
  name: "Sample Driver",
  number: 1,
  country: "de",
  tier: 1,
  photoUrl: null,
  seasonNumber: 8,
  team: { id: "mclaren", name: "McLaren", color: "#ff8000", logoUrl: "/teams/mclaren.png" },
};
const CARD_SAMPLE_RATING = { ratings: { overall: 91, exp: 88, rac: 90, aha: 86, pac: 93 } };

// The little material chip beside a design's name. The look lives in
// components/collectibleThemes.css and keys off the series on the PARENT, which
// is why the wrapper carries data-series and the chip itself is bare.
function DesignSwatch({ collection }) {
  return (
    <span data-series={collection}>
      <span className="card-collection-swatch" />
    </span>
  );
}

function CardDesignWindow({ data, onClose, onChanged }) {
  const ask = useAsk();
  const collections = data.cardDesigns || [];
  // Your own card, not a sample one: the point of the window is what the
  // design looks like on YOUR name, number and picture. Falls back to the
  // sample for a login with no driver row (a new member, the dev login).
  const me = useApi(useCallback(() => api.me().catch(() => null), []));
  const mine = me.data?.isLinked ? me.data : null;
  const rating = useApi(
    useCallback(() => (mine?.driverId ? api.driverRating(mine.driverId).catch(() => null) : Promise.resolve(null)), [mine?.driverId])
  );
  const all = collections.flatMap((c) => c.designs);
  const firstUnowned = all.find((d) => !d.owned) || all[0];
  const [picked, setPicked] = useState(firstUnowned?.key || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [bought, setBought] = useState(null);
  const [flipped, setFlipped] = useState(false);
  // A picture to try the design on, chosen from this machine and never sent
  // anywhere: it lives as a data URL in this window and is gone when it closes.
  // Nobody should have to buy a design to find out how it sits behind their own
  // face, and nobody should have to upload a photo to the league to try one.
  const [tryPhoto, setTryPhoto] = useState(null);
  const photoInput = useRef(null);
  const running = useRef(false);

  async function pickPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    try {
      // The same shrink every upload on this site goes through, so a 12
      // megapixel phone picture does not sit in memory at full size for a
      // preview 300 pixels wide.
      // keepAlpha: a driver cut out of their background is exactly the kind of
      // picture somebody tries a card design with, and flattening it onto black
      // would answer their question with a black box.
      const small = await shrinkImage(file, { maxSide: 900, keepAlpha: true });
      const reader = new FileReader();
      reader.onload = () => setTryPhoto(String(reader.result));
      reader.readAsDataURL(small);
    } catch {
      setError("That file could not be read as a picture.");
    }
  }

  const design = all.find((d) => d.key === picked) || null;
  const balance = data.balance;
  // The driver the preview wears. Everything but the design itself is the
  // member's own: name, number, flag, team, picture, season.
  const previewDriver = mine
    ? {
        id: mine.driverId,
        name: mine.name,
        number: mine.number ?? null,
        country: mine.country || "",
        tier: mine.tier,
        role: mine.role ?? null,
        team: mine.team,
        photoPos: mine.photoPos,
        seasonNumber: mine.seasonNumber ?? null,
      }
    : CARD_SAMPLE_DRIVER;
  const previewRating = (mine && rating.data?.ratings ? rating.data : null) || CARD_SAMPLE_RATING;
  const ownPhoto = mine ? mine.cardPhotoUrl || mine.photoUrl : null;
  const short = design ? design.cost - balance : 0;

  async function buy() {
    if (running.current || !design || design.owned) return;
    const ok = await ask({
      title: `Buy ${design.name}?`,
      body: `${fmt(design.cost)} tokens come off your balance. You have ${fmt(balance)}.\n\nThe design is yours right away and you can switch back to any design you own at any time.`,
      confirmLabel: `Buy for ${fmt(design.cost)}`,
    });
    if (!ok) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.buyCardDesign(design.key);
      setBought(design.name);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Card designs" size="xl">
      {/* Two panes from `lg` up, and only the RIGHT one scrolls.
          A turning card leans out of its own box, and a scrolling box clips
          whatever leans out of it — which took the top edge off the card the
          moment it was mid-turn. So the card sits outside the scroller
          entirely; on a phone, where there is only one column, the whole thing
          scrolls and the card gets room above it instead. */}
      <div className="flex max-h-[74vh] flex-col">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto scrollbar-slim pr-1 lg:grid-cols-[300px_1fr] lg:overflow-visible lg:pr-0">
            {/* `card-preview-fit` shrinks the whole preview on a short screen
                (see index.css). A rating card has a fixed height, so making it
                narrower does not make it shorter — without this it simply hung
                out through the bottom of the dialog on a laptop. */}
            <div className="card-preview-fit mx-auto w-full max-w-[300px] pt-4 lg:pt-2">
              {design ? (
                <div className={`cardflip ${flipped ? "is-flipped" : ""}`}>
                  <div className="cardflip-inner">
                    <div
                      className="cardflip-front cursor-pointer"
                      role="button"
                      tabIndex={flipped ? -1 : 0}
                      aria-label="Turn the card over"
                      onClick={() => setFlipped(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setFlipped(true);
                        }
                      }}
                      title="Turn the card over"
                    >
                      {/* keyed on the design so React swaps the card rather
                          than re-dressing it: that is what makes the fade
                          below run on every pick (see .card-swap). */}
                      <div key={design.key} className="card-swap">
                        <RatingCard
                          driver={{
                            ...previewDriver,
                            cardStyle: design.key,
                            cardPhotoUrl: tryPhoto || ownPhoto,
                            photoUrl: tryPhoto || ownPhoto,
                          }}
                          rating={previewRating}
                        />
                      </div>
                    </div>
                    <div
                      className="cardflip-back"
                      role="button"
                      tabIndex={flipped ? 0 : -1}
                      aria-label="Turn the card back"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setFlipped(false);
                        }
                      }}
                    >
                      <CardBack
                        driver={previewDriver}
                        seasonLabel={previewDriver.seasonNumber ? `SEASON ${previewDriver.seasonNumber}` : ""}
                        edition={design.key}
                        onClick={() => setFlipped(false)}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <button type="button" className="btn-secondary" onClick={() => photoInput.current?.click()}>
                  {tryPhoto ? "Another picture" : ownPhoto ? "Try another picture" : "Try your own picture"}
                </button>
                <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
                {tryPhoto && (
                  <button type="button" className="btn-secondary" onClick={() => setTryPhoto(null)}>
                    Remove
                  </button>
                )}
              </div>
              <p className="mt-2 text-center text-xs leading-relaxed text-light">
                Move the pointer across the card, and click it to turn it over. A picture you pick here stays on
                your machine, just for this preview.
              </p>
            </div>

            <div className="space-y-4 lg:max-h-[62vh] lg:overflow-y-auto lg:scrollbar-slim lg:pr-1">
              {error && <ErrorBox message={error} />}
              {bought && (
                <div className="token-done-pop">
                  <Notice kind="success">
                    {bought} is yours. Pick it on your card under Personal Area, Edit card.
                  </Notice>
                </div>
              )}
              {collections.map((c) => (
                <div key={c.key}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-light">
                      {c.name}
                    </div>
                    <div className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-light">
                      <TokenIcon className="h-3 w-3" />
                      {fmt(c.cost)} each
                    </div>
                  </div>
                  <p className="mb-2 text-xs text-light">{c.blurb}</p>
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {c.designs.map((d) => {
                      const on = d.key === picked;
                      return (
                        <li key={d.key}>
                          <button
                            type="button"
                            onClick={() => setPicked(d.key)}
                            aria-pressed={on}
                            className={`flex w-full items-center gap-2 rounded-xl border p-2 text-left transition ${
                              on ? "border-brand ring-2 ring-brand/40" : "border-border hover:border-brand/50"
                            }`}
                          >
                            <DesignSwatch collection={c.key} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold text-dark">{d.name}</span>
                              <span className="block font-mono text-[10px] uppercase tracking-wider text-light">
                                {d.owned ? "Yours" : `${fmt(d.cost)} tokens`}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <span className="inline-flex items-center gap-1.5 font-mono text-sm font-bold tabular-nums text-medium">
            <TokenIcon className="h-4 w-4 text-brand" />
            {design ? fmt(design.cost) : "0"}
            <span className="ml-2 font-sans text-xs font-normal text-light">you have {fmt(balance)}</span>
          </span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {bought ? "Done" : "Not now"}
            </button>
            <span className="relative">
            {/* keyed on the name so a second purchase in the same window
                throws a fresh handful. */}
            {bought && <CoinBurst key={bought} />}
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !design || design.owned || short > 0}
              onClick={buy}
            >
              {busy
                ? "…"
                : !design
                  ? "Pick one"
                  : design.owned
                    ? "Already yours"
                    : short > 0
                      ? `${fmt(short)} short`
                      : `Buy ${design.name}`}
            </button>
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// How many columns the tiles stand in on a wide screen. It follows the NUMBER
// of entries, because the league switches entries on and off: eight tiles in
// five columns is a row of five and a row of three, which reads like something
// fell off the end. Of 5, 4 and 3 columns the one that leaves the last row
// fullest wins, the widest one on a tie, so eight tiles stand 4 and 4.
const WIDE_COLS = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" };
function wideCols(n) {
  let best = 5;
  let smallestGap = Infinity;
  for (const cols of [5, 4, 3]) {
    const gap = (cols - (n % cols)) % cols; // empty places in the last row
    if (gap < smallestGap) {
      smallestGap = gap;
      best = cols;
    }
  }
  return WIDE_COLS[best];
}

function Shop({ data, onChanged, goal, onGoal }) {
  const [open, setOpen] = useState(null);
  const navigate = useNavigate();

  // One flat grid across the full width, rather than a little grid per
  // category: with a handful of entries and four columns, grouping meant four rows of
  // one or two tiles each and a lot of empty space to the right of every
  // heading. Each tile says which category it is in instead.
  return (
    <div className="card reveal space-y-3 p-5">
      <Heading>The shop</Heading>
      <ul className={`cascade grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 ${wideCols(data.shop.length)}`}>
        {data.shop.map((item, i) => (
          <ShopTile key={item.key} index={i} item={item} balance={data.balance} onOpen={(i) => (i.link ? navigate(i.link) : setOpen(i))} />
        ))}
      </ul>
      {/* The card entry opens the catalogue; everything else opens the plain
          window that orders one thing. */}
      {open?.key === "card_background" ? (
        <CardDesignWindow data={data} onClose={() => setOpen(null)} onChanged={onChanged} />
      ) : open ? (
        <ItemWindow item={open} data={data} onClose={() => setOpen(null)} onChanged={onChanged} goal={goal} onGoal={onGoal} />
      ) : null}
    </div>
  );
}

const ORDER_STATUS = {
  NEW: { label: "Waiting", cls: "bg-surface2 text-light" },
  DONE: { label: "Filled", cls: "bg-emerald-500/15 text-ok" },
  DECLINED: { label: "Refunded", cls: "bg-surface2 text-light" },
};

// Everything this member has ordered, and where the league office has got to
// with it. Rows rather than pictures: what matters about an order is whether it
// has been filled yet.
function Collection({ orders }) {
  if (!orders.length) return null;
  return (
    <div className="card reveal space-y-3 p-5">
      <Heading>Your orders</Heading>
      <ul className="divide-y divide-border">
        {orders.map((o) => {
          const s = ORDER_STATUS[o.status] || ORDER_STATUS.NEW;
          return (
            // No wrap: a long detail line used to drop the status pill under
            // the text, at the left, while shorter orders kept it right.
            <li key={o.id} className="flex items-baseline justify-between gap-x-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-dark">{o.itemName}</div>
                <div className="text-xs text-light">
                  {fmtWhen(o.createdAt)}
                  {o.detail ? `. ${o.detail}` : o.note && o.itemKey !== "profile_flair" ? `. ${o.note}` : ""}
                </div>
              </div>
              <span className={`pill shrink-0 ${s.cls}`}>{s.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Where every token came from and went. Plain rows, newest first: this is the
// page a member opens when they think the number is wrong.
function History({ ledger }) {
  if (!ledger.length) {
    return (
      <EmptyState
        title="Nothing earned yet"
        hint="Race a round, or send your invite link to somebody who will."
      />
    );
  }
  // Capped and scrolling rather than however tall a career happens to be: a
  // driver with seventy races had a page whose last two thirds were one list.
  return (
    <div className="card reveal px-5 py-4">
      <Heading>Your history</Heading>
      <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto scrollbar-slim">
      {ledger.map((e) => (
        <li key={e.id} className="flex items-baseline justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm text-dark">{e.title}</div>
            <div className="truncate text-xs text-light">
              {[e.detail, fmtWhen(e.createdAt)].filter(Boolean).join(" . ")}
            </div>
          </div>
          <span
            className={`shrink-0 font-mono text-sm font-bold tabular-nums ${
              e.delta >= 0 ? "text-brand" : "text-light"
            }`}
          >
            {e.delta >= 0 ? "+" : ""}
            {fmt(e.delta)}
          </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A new member names who brought them in: the one way besides the link. Shown
// only while it can still be done (nobody named yet, never raced), and gone
// again the moment it is saved.
function WhoInvitedYou({ onSaved }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.nameInviter(name.trim());
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3 p-5">
      <div>
        <Heading>Who invited you?</Heading>
        <p className="mt-1 text-sm leading-relaxed text-light">
          If a member brought you into the league, type their name or their invite code, and they get the credit.
          Nobody? Just leave it empty.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-0 flex-1"
          placeholder="Their name or code"
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={busy || !name.trim()} className="btn-primary whitespace-nowrap">
          Save
        </button>
      </div>
      {error && <ErrorBox message={error} />}
    </form>
  );
}

export default function Tokens() {
  const tokens = useApi(useCallback(() => api.tokens(), []));
  const reload = tokens.reload;

  // Buying changes the number in the nav bar too, so the bar is told rather
  // than left to find out on the next page load.
  const changed = useCallback(() => {
    reload();
    window.dispatchEvent(new Event(TOKENS_CHANGED_EVENT));
  }, [reload]);

  // The training week comes from the shared store (the cue at the bottom of
  // the site and the live page read the same one), asked for briskly while
  // this page is open: somebody driving on a second screen watches it fill.
  const week = usePracticeWeek(30000);

  // The one shop entry you are saving for, if any. This browser only.
  const [goal, setGoalState] = useState(readGoal);
  const setGoal = (key) => {
    writeGoal(key);
    setGoalState(key);
  };

  if (tokens.loading && !tokens.data) return <Spinner label="Loading your tokens…" />;
  if (tokens.error) return <ErrorBox message={tokens.error} onRetry={reload} />;
  const data = tokens.data;
  if (!data?.enabled) {
    return (
      <EmptyState
        title="Not switched on"
        hint="NABS Tokens are being tried out. The league will say when they go live."
      />
    );
  }

  const orders = data.orders || [];
  const goalItem = goal ? data.shop.find((i) => i.key === goal) || null : null;

  // Rows, not columns: each block gets the width its content wants. The two
  // cards you read first share the top row at equal height, the shop and the
  // collection are pictures and take the whole width, and the two lists sit
  // side by side where a half-width row still reads as one line.
  const earning = data.earning !== false;
  return (
    <div className="space-y-5">
      {!earning && (
        <Notice kind="warn">
          Not counting yet. Have a look around and see what things cost. Nothing you do is being paid for until
          the league starts the counting.
        </Notice>
      )}

      {/* Balance and invite link. `items-stretch` is the default and the point:
          the two cards hold different amounts of text, and two cards of
          different heights side by side is the thing that looks unfinished. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Balance data={data} goal={goalItem} onClearGoal={() => setGoal(null)} />
        <InviteCard code={data.code} name={data.name} earning={earning} />
      </div>

      {data.canNameInviter && <WhoInvitedYou onSaved={changed} />}

      <PracticeCard week={week ?? data.practice} />

      <Shop data={data} onChanged={changed} goal={goal} onGoal={setGoal} />

      <Leaderboard />

      {orders.length > 0 && <Collection orders={orders} />}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <EarnList rules={data.rules} multiplier={data.stats?.multiplier} startDay={data.startDay} earning={earning} />
        <History ledger={data.ledger || []} />
      </div>
    </div>
  );
}
