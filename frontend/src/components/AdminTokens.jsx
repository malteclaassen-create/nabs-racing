import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { TOKENS_CHANGED_EVENT } from "../hooks/useTokenBalance.js";
import { ErrorBox, Notice, EmptyState } from "./ui.jsx";
import SlidingTabs from "./SlidingTabs.jsx";
import { useJumpView } from "../hooks/useJumpView.js";
import TokenIcon from "./TokenIcon.jsx";
import { useAsk } from "./overlay.jsx";

// ---------------------------------------------------------------------------
// The league office's side of the server tokens.
//
// Three jobs, and the first one is the important one: the SWITCH. The whole
// feature is a trial, off on the live site until somebody here turns it on, and
// this is where that decision is made and unmade. With it off, members see no
// tokens, no shop and no count in the nav bar; nothing is lost, and turning it
// back on finds every balance exactly where it was.
//
// The other two are the work: filling the orders people place (the shop hands
// out nothing by itself, a person does), and handing out tokens by hand for the
// things no rule can measure.
//
// Plain rows like the Feedback tab, for the same reason: this is a working list.
// ---------------------------------------------------------------------------

const fmt = (n) => new Intl.NumberFormat(undefined, { useGrouping: true }).format(n || 0);

// Same ceiling as CUSTOM_FLAIR_MAX in backend/src/lib/tokens.js, which is what
// actually enforces it.
const CUSTOM_FLAIR_MAX = 24;

const ORDER_STATUS = [
  { key: "NEW", label: "Waiting", cls: "bg-brand/20 text-dark" },
  { key: "DONE", label: "Filled", cls: "bg-emerald-500/15 text-ok" },
  { key: "DECLINED", label: "Declined", cls: "bg-surface2 text-light" },
];

function statusMeta(key) {
  return ORDER_STATUS.find((s) => s.key === key) || ORDER_STATUS[0];
}

function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// The switch, and what it means in one sentence each way.
const MODE_TEXT = {
  off: "Off. Nobody but this page knows the feature exists. Balances are kept and come back untouched when you switch it on.",
  admins: "Admins only. League admins see the balance, the shop and the studio and can try everything; members see nothing, and nothing shows on public pages.",
  all: "Everyone. Members see their balance in the nav bar, their invite link and the shop; profile designs and the wall are public.",
};

// What a switch of the mode will change, said before it happens. The mode is
// the one control here that members see the result of at once (a balance in
// the nav bar appears or vanishes on their next page), so it asks first, and
// says what the members will see rather than what the setting is called.
function modeQuestion(next, current, earning) {
  if (next === "off")
    return {
      title: "Switch NABS Tokens off?",
      body:
        (current === "all"
          ? "Members stop seeing their balance, their invite link and the shop, and profile designs and the wall go from the public pages. "
          : "Admins stop seeing the balance, the shop and the studio. ") +
        "Nothing is deleted: every balance comes back untouched when you switch it on again.",
      confirmLabel: "Switch off",
    };
  if (next === "admins")
    return {
      title: "NABS Tokens for admins only?",
      body:
        (current === "all"
          ? "Members stop seeing their balance, their invite link and the shop, and profile designs and the wall go from the public pages. "
          : "Members still see nothing. ") +
        "League admins see the balance, the shop and the studio and can try everything.",
      confirmLabel: "Admins only",
    };
  return {
    title: "Show NABS Tokens to everyone?",
    body:
      "Every member sees their balance in the nav bar, their invite link and the shop, and profile designs and the wall become public." +
      (earning
        ? ""
        : "\n\nEarning is paused, so no race pays and every balance stands still until you start counting."),
    confirmLabel: "Show to everyone",
  };
}

function EarningSwitch({ earning, startDay, busy, onChange }) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <div className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-eyebrow">Earning tokens</div>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-light">
          {earning
            ? `Running${startDay ? `, races from ${startDay} count` : ""}. Everyone earns as they go.`
            : "Paused. Members can look around, but no race pays and no balance moves. Switching it on counts races from today, plus this week's training laps and Discord activity."}
        </p>
      </div>
      <button type="button" disabled={busy} onClick={() => onChange(!earning)} className={earning ? "btn-secondary" : "btn-primary"}>
        {earning ? "Pause counting" : "Start counting"}
      </button>
    </div>
  );
}

function TrialSwitch({ mode, onChange, busy }) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <div className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">
          NABS Tokens
        </div>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-light">{MODE_TEXT[mode] || MODE_TEXT.off}</p>
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

// One shop order. Filling it is the admin saying "done, I have made the helmet";
// declining refunds the tokens, which is why it says so on the button.
function OrderRow({ order, onUpdate, busy }) {
  const [note, setNote] = useState(order.note || "");
  // A flair somebody wrote themselves is the one order with words in it that
  // will end up on a public page, so the row shows them and lets the admin
  // fix a typo instead of declining over one.
  const [flairText, setFlairText] = useState(order.flairText || "");
  const s = statusMeta(order.status);
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-dark">{order.itemName}</span>
          {order.detail && <span className="ml-1.5 text-sm text-medium">({order.detail})</span>}
          <span className="ml-2 text-sm text-light">for {order.member || order.discordId}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 font-mono text-[13px] font-bold tabular-nums text-medium">
            <TokenIcon className="h-3.5 w-3.5" />
            {fmt(order.cost)}
          </span>
          <span className={`pill ${s.cls}`}>{s.label}</span>
          <span className="font-mono text-[11px] uppercase tracking-wider text-light">
            {fmtWhen(order.createdAt)}
          </span>
        </div>
      </div>
      {order.flairText != null && order.status === "NEW" && (
        <div className="space-y-1">
          <div className="font-mono text-[11px] uppercase tracking-wider text-light">
            They wrote this, and it goes on their public profile
          </div>
          <input
            className="input w-full font-semibold"
            maxLength={CUSTOM_FLAIR_MAX}
            value={flairText}
            onChange={(e) => setFlairText(e.target.value)}
          />
        </div>
      )}
      {order.status === "NEW" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input min-w-0 flex-1"
            placeholder="A line for them (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || (order.flairText != null && !flairText.trim())}
            className="btn-primary"
            onClick={() => onUpdate(order.id, "DONE", note, flairText)}
          >
            {order.flairText != null ? "Approve and put it up" : "Mark filled"}
          </button>
          <button
            type="button"
            disabled={busy}
            className="btn-secondary"
            onClick={() => onUpdate(order.id, "DECLINED", note)}
          >
            Decline and refund
          </button>
        </div>
      )}
    </li>
  );
}

// Everyone with an account: what they hold, who brought them in, how many they
// have brought in themselves, and the box for a hand-written award.
function MemberRow({ m, onAdjust, onRemoveInviter, busy }) {
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");

  // One amount, two buttons. It used to be a single signed field, where taking
  // points off meant typing a minus in front of the number: nothing said so,
  // and a number field is the last place anybody looks for that.
  const amount = Math.abs(Math.round(Number(delta) || 0));
  const goesNegative = amount > m.balance;

  async function book(sign) {
    const ok = await onAdjust(m.discordId, sign * amount, note);
    if (!ok) return; // the error is on screen; keep what was typed
    setDelta("");
    setNote("");
    setOpen(false);
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          {/* Somebody who was invited into the Discord and has never opened the
              site has no name here until the bot tells us one. An eighteen-digit
              id in the place a name goes reads like a bug, so it says what it
              is and the id moves down to the line that holds the code. */}
          <div className={`truncate text-sm font-semibold ${m.nameKnown === false ? "text-light" : "text-dark"}`}>
            {m.nameKnown === false ? "Not on the site yet" : m.name}
          </div>
          <div className="truncate text-xs text-light">
            Code <span className="font-mono font-bold text-medium">{m.code}</span>
            {m.nameKnown === false ? <span className="font-mono">. {m.discordId}</span> : ""}
            {m.invitedBy ? `. Invited by ${m.invitedBy}` : ""}
            {m.invitedCount ? `. Brought in ${m.invitedCount}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 font-mono text-sm font-bold tabular-nums text-dark">
            <TokenIcon className="h-3.5 w-3.5 text-brand" />
            {fmt(m.balance)}
          </span>
          {m.invitedBy && (
            <button type="button" disabled={busy} className="btn-secondary" onClick={() => onRemoveInviter(m)}>
              Remove inviter
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => setOpen((v) => !v)}>
            {open ? "Cancel" : "Give or take"}
          </button>
        </div>
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min="1"
            className="input w-28"
            placeholder="e.g. 250"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
          />
          <input
            className="input min-w-0 flex-1"
            placeholder="What it is for (they see this)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" disabled={busy || !amount} className="btn-primary" onClick={() => book(1)}>
            Give {amount ? fmt(amount) : ""}
          </button>
          <button type="button" disabled={busy || !amount} className="btn-secondary" onClick={() => book(-1)}>
            Take {amount ? fmt(amount) : ""}
          </button>
          {!!amount && (
            <span className="w-full text-xs text-light">
              {goesNegative
                ? `Taking ${fmt(amount)} leaves ${fmt(m.balance - amount)}, which is below zero. Allowed, in case you are correcting something.`
                : `Giving leaves ${fmt(m.balance + amount)}, taking leaves ${fmt(m.balance - amount)}.`}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// The Discord bot's corner. The site cannot see Discord by itself: it does not
// know who talks, who sits in voice, or whose invite link somebody joined
// through. A bot on the league's server can see all three and tells the site,
// signing with the key below rather than with an admin login, because it runs
// somewhere else under somebody else's hand.
//
// With no bot connected every multiplier is 1.0x and invites are counted the one
// way the site can see for itself: the link on a member's points page.
// ---------------------------------------------------------------------------
function CopyField({ label, value }) {
  return (
    <div className="space-y-1.5">
      <label className="block font-mono text-[11px] font-bold uppercase tracking-wider text-light">{label}</label>
      <input
        readOnly
        aria-label={label}
        className="input w-full font-mono text-xs"
        value={value}
        onFocus={(e) => e.target.select()}
      />
    </div>
  );
}

function BotPanel() {
  const bot = useApi(useCallback(() => api.tokenBotKey(), []));
  if (bot.error) return <ErrorBox message={bot.error} onRetry={bot.reload} />;
  if (!bot.data) return null;
  return (
    <div className="card space-y-4 p-5">
      <div>
        <div className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-eyebrow">The bot&rsquo;s key</div>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-light">
          The bot counts messages and voice minutes for the multiplier and reports who invited whom. This key is
          all it needs from here. Keep it like a password.
        </p>
      </div>
      <CopyField label="Key" value={bot.data.key || ""} />
      <p className="text-xs leading-relaxed text-light">
        Setting the bot up is a handful of steps in Discord, written out in <span className="font-mono">discord-bot/README.md</span>.
        It can run before the tokens are switched on for members, which fills the 30 day window in advance.
      </p>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Rules and prices, editable. Every field is an override of the code's
// default; empty means "use the default". Sent as one blob on Save.
// ---------------------------------------------------------------------------
function NumberField({ value, placeholder, onChange, className = "" }) {
  return (
    <input
      type="number"
      min="0"
      step="1"
      inputMode="numeric"
      className={`input w-24 text-right font-mono tabular-nums ${className}`}
      value={value ?? ""}
      placeholder={placeholder != null ? String(placeholder) : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// The word in front of a price, "from 1,200". Twelve characters, because the
// entry's tile has room for a word and not for a sentence.
function WordField({ value, placeholder, onChange }) {
  return (
    <input
      type="text"
      maxLength={12}
      className="input w-20 text-right"
      value={value ?? ""}
      placeholder={placeholder || "none"}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function OnOff({ checked, onChange, label = "on" }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-light">
      <input type="checkbox" className="h-3.5 w-3.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function TuningPanel({ d, busy, onSave, onReset }) {
  const [t, setT] = useState(() => JSON.parse(JSON.stringify(d.tuning || {})));
  // Follow the server when it changes underneath us: starting the counting
  // stamps a start day, and without this the form would still be holding the
  // old blank one and would wipe it on the next save.
  const seen = useRef(JSON.stringify(d.tuning || {}));
  useEffect(() => {
    const now = JSON.stringify(d.tuning || {});
    if (now === seen.current) return;
    seen.current = now;
    setT(JSON.parse(now));
  }, [d.tuning]);
  const get = (section, key, field) => t?.[section]?.[key]?.[field];
  const set = (section, key, field, value) =>
    setT((prev) => {
      const next = JSON.parse(JSON.stringify(prev || {}));
      next[section] ||= {};
      next[section][key] ||= {};
      if (value === "" || value == null) delete next[section][key][field];
      else next[section][key][field] = value;
      if (!Object.keys(next[section][key]).length) delete next[section][key];
      return next;
    });
  // A series' own numbers sit one level deeper: seriesRules[slug][rule][field].
  const getS = (slug, key, field) => t?.seriesRules?.[slug]?.[key]?.[field];
  const setS = (slug, key, field, value) =>
    setT((prev) => {
      const next = JSON.parse(JSON.stringify(prev || {}));
      next.seriesRules ||= {};
      next.seriesRules[slug] ||= {};
      next.seriesRules[slug][key] ||= {};
      if (value === "" || value == null) delete next.seriesRules[slug][key][field];
      else next.seriesRules[slug][key][field] = value;
      if (!Object.keys(next.seriesRules[slug][key]).length) delete next.seriesRules[slug][key];
      if (!Object.keys(next.seriesRules[slug]).length) delete next.seriesRules[slug];
      if (!Object.keys(next.seriesRules).length) delete next.seriesRules;
      return next;
    });
  const defaults = d.defaults || {};
  const defRule = (key) => defaults.rules?.find((r) => r.key === key) || {};
  // What the whole league pays for a rule as the form stands, which is what a
  // series falls back to for every field it leaves empty.
  const leagueRule = (key) => {
    const r = defRule(key);
    const num = (v, fallback) => (v === "" || v == null ? fallback : Number(v));
    return {
      points: num(get("rules", key, "points"), r.points),
      laps: r.laps == null ? null : num(get("rules", key, "laps"), r.laps),
      active: get("rules", key, "active") ?? r.active,
    };
  };
  const defItem = (key) => defaults.shop?.find((i) => i.key === key) || {};
  const defCard = (key) => defaults.cards?.find((c) => c.key === key) || {};
  const changed = JSON.stringify(t || {}) !== JSON.stringify(d.tuning || {});
  const hours = (min) => (min == null || min === "" ? "" : Math.round(Number(min) / 60));

  const Head = ({ children }) => (
    <div className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-eyebrow">{children}</div>
  );

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <Head>Counting from</Head>
          <p className="mt-1 text-xs leading-relaxed text-light">
            Races before this day pay nothing. Starting the counting sets it to that day, so nothing from before
            pays. Empty means every race ever, back to season 1.
          </p>
        </div>
        <input
          type="date"
          className="input font-mono"
          value={t?.startDay || ""}
          onChange={(e) => setT((prev) => ({ ...prev, startDay: e.target.value || undefined }))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <Head>What earns tokens</Head>
          <ul className="mt-1 divide-y divide-border">
            {(defaults.rules || []).map((r) => {
              const isMult = r.key === "activity";
              const on = get("rules", r.key, "active") ?? r.active;
              return (
                <li key={r.key} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className={`text-sm font-semibold ${on ? "text-dark" : "text-light"}`}>{r.label}</div>
                    <div className="text-xs text-light">{d.rules?.find((x) => x.key === r.key)?.hint || r.hint}</div>
                  </div>
                  {isMult ? (
                    <span className="shrink-0 text-xs text-light">multiplier, see below</span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-3">
                      <OnOff checked={!!on} onChange={(v) => set("rules", r.key, "active", v === r.active ? "" : v)} />
                      {/* A training rule pays at a lap count, and the league
                          can move that as well as the points. */}
                      {r.laps != null && (
                        <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-light">
                          at
                          <NumberField
                            className="!w-16"
                            value={get("rules", r.key, "laps")}
                            placeholder={r.laps}
                            onChange={(v) => set("rules", r.key, "laps", v)}
                          />
                          laps
                        </label>
                      )}
                      <NumberField
                        value={get("rules", r.key, "points")}
                        placeholder={r.points}
                        onChange={(v) => set("rules", r.key, "points", v)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
            {/* Which race servers a training lap counts on. Nothing said
                about a server means it counts, so this is a switch to turn
                one OFF: the race server on a quiet Tuesday is practice like
                any other, until the league decides it is not. */}
            {(defaults.servers || []).length > 0 && (
              <li className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-dark">Training laps count on</div>
                  <div className="text-xs text-light">
                    Which race server a practice lap has to be driven on to count towards the two milestones above.
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
                  {defaults.servers.map((srv) => {
                    const on = t?.practiceServers?.[srv.key] ?? true;
                    return (
                      <label key={srv.key} className="flex items-center gap-2 text-xs text-light">
                        {srv.name}
                        <OnOff
                          checked={!!on}
                          onChange={(v) =>
                            setT((prev) => {
                              const next = JSON.parse(JSON.stringify(prev || {}));
                              next.practiceServers ||= {};
                              // Back to "counts" is the default, and a default
                              // belongs nowhere rather than in the blob.
                              if (v) delete next.practiceServers[srv.key];
                              else next.practiceServers[srv.key] = false;
                              if (!Object.keys(next.practiceServers).length) delete next.practiceServers;
                              return next;
                            })
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              </li>
            )}
            <li className="flex items-center justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-dark">Referral races that pay</div>
                <div className="text-xs text-light">How many of an invited driver's races pay the inviter.</div>
              </div>
              <NumberField
                value={t?.referralRaceLimit}
                placeholder={defaults.referralRaceLimit}
                onChange={(v) => setT((prev) => ({ ...prev, referralRaceLimit: v === "" ? undefined : v }))}
              />
            </li>
          </ul>
        </div>

        <div className="card p-5">
          <Head>What they buy</Head>
          <div className="mt-1 text-xs text-light">
            The small box is the word in front of the price, like "from 1,200". Empty means the number on its own.
          </div>
          <ul className="mt-1 divide-y divide-border">
            {(defaults.shop || []).filter((i) => !i.link).map((i) => {
              const on = get("shop", i.key, "active") ?? true;
              return (
                <li key={i.key} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className={`text-sm font-semibold ${on ? "text-dark" : "text-light"}`}>{i.name}</div>
                    <div className="text-xs text-light">{i.description}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <OnOff label="for sale" checked={!!on} onChange={(v) => set("shop", i.key, "active", v ? "" : false)} />
                    <WordField
                      value={get("shop", i.key, "prefix")}
                      placeholder={i.pricePrefix}
                      onChange={(v) => set("shop", i.key, "prefix", v)}
                    />
                    <NumberField value={get("shop", i.key, "cost")} placeholder={i.cost} onChange={(v) => set("shop", i.key, "cost", v)} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card p-5">
          <Head>Card designs, per series</Head>
          <ul className="mt-1 divide-y divide-border">
            {(defaults.cards || []).map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-dark">{c.name}</div>
                  <div className="text-xs text-light">{c.blurb}</div>
                </div>
                <NumberField value={get("cards", c.key, "cost")} placeholder={c.cost} onChange={(v) => set("cards", c.key, "cost", v)} />
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-5">
          <Head>Profile studio, per type</Head>
          <ul className="mt-1 divide-y divide-border">
            {(d.studio || []).map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-4 py-2.5">
                <div className="text-sm font-semibold capitalize text-dark">{s.key === "nameplate" ? "Name lettering" : s.key}</div>
                <NumberField value={get("studio", s.key, "cost")} placeholder={s.defaultCost} onChange={(v) => set("studio", s.key, "cost", v)} />
              </li>
            ))}
          </ul>
        </div>

        {(defaults.series || []).length > 0 && (defaults.seriesRules || []).length > 0 && (
          <div className="card p-5 lg:col-span-2">
            <Head>Per series</Head>
            <p className="mt-1 text-xs leading-relaxed text-light">
              A series can pay racing and training differently from the rest of the league, the Sunday league at half,
              say. Empty field = what the whole league pays (shown greyed, from "What earns tokens" above). A new series
              shows up here as soon as it is created. Races already paid keep what they were paid.
            </p>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {defaults.series.map((se) => {
                const own = t?.seriesRules?.[se.slug];
                const halve = () =>
                  defaults.seriesRules.forEach((key) => {
                    const league = leagueRule(key);
                    setS(se.slug, key, "points", String(Math.round(league.points / 2)));
                  });
                const clear = () =>
                  setT((prev) => {
                    const next = JSON.parse(JSON.stringify(prev || {}));
                    for (const k of ["seriesRules", "seriesFrom"]) {
                      if (next[k]) delete next[k][se.slug];
                      if (next[k] && !Object.keys(next[k]).length) delete next[k];
                    }
                    return next;
                  });
                const fromOf = (kind) => t?.seriesFrom?.[se.slug]?.[kind] || "";
                const setFrom = (kind, v) =>
                  setT((prev) => {
                    const next = JSON.parse(JSON.stringify(prev || {}));
                    next.seriesFrom ||= {};
                    next.seriesFrom[se.slug] ||= {};
                    if (v) next.seriesFrom[se.slug][kind] = v;
                    else delete next.seriesFrom[se.slug][kind];
                    if (!Object.keys(next.seriesFrom[se.slug]).length) delete next.seriesFrom[se.slug];
                    if (!Object.keys(next.seriesFrom).length) delete next.seriesFrom;
                    return next;
                  });
                return (
                  <div key={se.slug} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-dark">
                          {se.name}
                          {!se.isPublic && <span className="ml-2 text-[11px] font-normal uppercase tracking-wider text-light">hidden</span>}
                        </div>
                        <div className="text-xs text-light">{own ? "Own numbers" : "Same as the league"}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" className="btn-secondary !px-2.5 !py-1 !text-xs" onClick={halve}>
                          Half points
                        </button>
                        {own && (
                          <button type="button" className="btn-secondary !px-2.5 !py-1 !text-xs" onClick={clear}>
                            Same as league
                          </button>
                        )}
                      </div>
                    </div>
                    {/* The days these numbers start, one for racing and one
                        for training. A round before its day keeps the league's
                        numbers, and so does a training week whose round is
                        before the training day: a change made on a Saturday
                        can halve Sunday's race while the week already driven
                        for it keeps its price. */}
                    {own && (
                      <div className="mt-3 space-y-2 text-xs text-light">
                        <div>Starts with the rounds on or after these days. Empty = straight away.</div>
                        {[
                          ["race", "Races from"],
                          ["practice", "Training from the round on"],
                        ].map(([kind, label]) => (
                          <label key={kind} className="flex flex-wrap items-center justify-between gap-2">
                            <span>{label}</span>
                            <input
                              type="date"
                              className="input !w-auto font-mono"
                              value={fromOf(kind)}
                              onChange={(e) => setFrom(kind, e.target.value)}
                            />
                          </label>
                        ))}
                      </div>
                    )}
                    <ul className="mt-2 divide-y divide-border">
                      {defaults.seriesRules.map((key) => {
                        const r = defRule(key);
                        const league = leagueRule(key);
                        const on = getS(se.slug, key, "active") ?? league.active;
                        return (
                          <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-2">
                            <div className={`min-w-0 text-sm font-semibold ${on ? "text-dark" : "text-light"}`}>{r.label}</div>
                            <div className="flex shrink-0 items-center gap-3">
                              <OnOff checked={!!on} onChange={(v) => setS(se.slug, key, "active", v === league.active ? "" : v)} />
                              {league.laps != null && (
                                <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-light">
                                  at
                                  <NumberField
                                    className="!w-16"
                                    value={getS(se.slug, key, "laps")}
                                    placeholder={league.laps}
                                    onChange={(v) => setS(se.slug, key, "laps", v)}
                                  />
                                  laps
                                </label>
                              )}
                              <NumberField
                                value={getS(se.slug, key, "points")}
                                placeholder={league.points}
                                onChange={(v) => setS(se.slug, key, "points", v)}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="card p-5">
          <Head>Activity multiplier</Head>
          <p className="mt-1 text-xs leading-relaxed text-light">
            Each half is worth 1.1x at the lower number and 2.0x at the upper one, both together up to 3x. Counted over
            the last 30 days.
          </p>
          <ul className="mt-1 divide-y divide-border">
            <li className="flex items-center justify-between gap-4 py-2.5">
              <div className="text-sm font-semibold text-dark">Chat, messages</div>
              <div className="flex items-center gap-2 text-xs text-light">
                from
                <NumberField value={get("multiplier", "chat", "min")} placeholder={defaults.multiplier?.chat?.min} onChange={(v) => set("multiplier", "chat", "min", v)} />
                to
                <NumberField value={get("multiplier", "chat", "max")} placeholder={defaults.multiplier?.chat?.max} onChange={(v) => set("multiplier", "chat", "max", v)} />
              </div>
            </li>
            <li className="flex items-center justify-between gap-4 py-2.5">
              <div className="text-sm font-semibold text-dark">Voice, hours</div>
              <div className="flex items-center gap-2 text-xs text-light">
                from
                <NumberField
                  value={hours(get("multiplier", "voice", "min"))}
                  placeholder={hours(defaults.multiplier?.voice?.min)}
                  onChange={(v) => set("multiplier", "voice", "min", v === "" ? "" : Number(v) * 60)}
                />
                to
                <NumberField
                  value={hours(get("multiplier", "voice", "max"))}
                  placeholder={hours(defaults.multiplier?.voice?.max)}
                  onChange={(v) => set("multiplier", "voice", "max", v === "" ? "" : Number(v) * 60)}
                />
              </div>
            </li>
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-relaxed text-light">
          Empty field = the default from the code (shown greyed). Rules pay out backwards, so a number raised today
          also pays for the races already driven. Lowering one leaves what was already paid.
        </p>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onReset}>
            Back to defaults
          </button>
          <button type="button" className="btn-primary" disabled={busy || !changed} onClick={() => onSave(t)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// Everybody's Discord activity in the current window: since the last F1
// briefing, the numbers each member's multiplier is built from. Read only; the
// bot fills it every five minutes, so it reloads on the same beat.
function fmtBriefing(t) {
  if (!t) return null;
  return new Date(t).toLocaleString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ActivityPanel() {
  const data = useApi(useCallback(() => api.tokenActivity(), []));
  const reload = data.reload;
  useEffect(() => {
    const id = setInterval(() => reload(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [reload]);
  const [query, setQuery] = useState("");

  if (data.error) return <ErrorBox message={data.error} onRetry={reload} />;
  if (!data.data) return null;
  const d = data.data;
  const q = query.trim().toLowerCase();
  const members = (d.members || []).filter((m) => !q || m.name.toLowerCase().includes(q));
  const active = (d.members || []).filter((m) => m.chatMessages > 0 || m.vcMinutes > 0).length;
  const x = (n) => `${Number(n || 1).toFixed(2)}x`;
  const hours = (min) => `${(Number(min || 0) / 60).toFixed(1)} h`;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <div className="font-semibold text-dark">
            {d.since ? `Since the briefing on ${fmtBriefing(d.since)}` : `Last ${d.windowDays || 7} days (no briefing yet)`}
          </div>
          <div className="mt-0.5 text-xs text-light">
            {d.next ? `Starts again at the next F1 briefing, ${fmtBriefing(d.next)}. ` : ""}
            {active} of {(d.members || []).length} members active. Updates every five minutes.
          </div>
        </div>
        <button type="button" className="btn-secondary px-3 py-1.5 text-[13px]" onClick={reload}>
          Refresh
        </button>
      </div>

      {!d.botConnected && (
        <Notice kind="warn">The Discord bot has not reported anything yet, so everybody is on 1.00x.</Notice>
      )}

      {(d.members || []).length ? (
        <div className="card overflow-hidden">
          <div className="border-b border-border px-5 py-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a member"
              className="input w-full max-w-xs text-sm"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
                  <th className="px-5 py-2 font-semibold">Member</th>
                  <th className="px-3 py-2 text-right font-semibold">Chat</th>
                  <th className="px-3 py-2 text-right font-semibold">Voice</th>
                  <th className="px-3 py-2 text-right font-semibold">Chat x</th>
                  <th className="px-3 py-2 text-right font-semibold">Voice x</th>
                  <th className="px-5 py-2 text-right font-semibold">Multiplier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => (
                  <tr key={m.discordId}>
                    <td className="px-5 py-2">
                      <span className="flex items-center gap-2">
                        {m.avatarUrl ? (
                          <img src={m.avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-full" />
                        ) : (
                          <span className="h-6 w-6 shrink-0 rounded-full bg-surface2" />
                        )}
                        <span className="truncate text-dark">{m.name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-medium">
                      {m.chatMessages}
                      {d.ranges?.chat ? <span className="text-faint"> / {d.ranges.chat.max}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-medium">
                      {hours(m.vcMinutes)}
                      {d.ranges?.voice ? <span className="text-faint"> / {Math.round(d.ranges.voice.max / 60)} h</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-light">{x(m.multiplier?.chat)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-light">{x(m.multiplier?.voice)}</td>
                    <td className="px-5 py-2 text-right font-mono font-bold tabular-nums text-dark">{x(m.multiplier?.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState title="Nobody has an account yet" hint="Members show up here once they have a points account." />
      )}
    </div>
  );
}

export default function AdminTokens({ jumpView = null, jumpKey = null }) {
  const data = useApi(useCallback(() => api.adminTokens(), []));
  const [view, setView] = useJumpView(jumpView, jumpKey, "orders");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const reload = data.reload;
  const ask = useAsk();

  // Returns whether it worked, because a caller that clears its own fields
  // afterwards has to know: a failed booking used to wipe the amount and the
  // note and leave the admin guessing whether it had gone through.
  async function run(fn, message) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(message);
      reload();
      // Balances and the switches both change what the nav bar shows.
      window.dispatchEvent(new Event(TOKENS_CHANGED_EVENT));
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (data.error) return <ErrorBox message={data.error} onRetry={reload} />;
  if (!data.data) return null;
  const d = data.data;
  const waiting = (d.orders || []).filter((o) => o.status === "NEW").length;
  const manual = (d.orders || []).filter((o) => o.manual);
  const auto = (d.orders || []).filter((o) => !o.manual);
  const mode = d.mode || (d.enabled ? "all" : "off");

  return (
    <div className="space-y-4">
      {error && <ErrorBox message={error} />}
      {done && <Notice kind="success">{done}</Notice>}

      <TrialSwitch
        mode={mode}
        busy={busy}
        onChange={async (m) => {
          // The segmented control is controlled, so a cancelled question leaves
          // it showing the mode that is actually in force.
          if (!(await ask(modeQuestion(m, mode, !!d.earning)))) return;
          run(
            () => api.setTokensMode(m),
            m === "all" ? "NABS Tokens are on for everyone." : m === "admins" ? "NABS Tokens are on for admins only." : "NABS Tokens are off."
          );
        }}
      />

      {/* Members can see the points, but nothing moves them: every race says
          "earns you points" and no balance ever changes. Easy to leave like
          that after trying the mode out, so it is said in the open. */}
      {mode === "all" && !d.earning && (
        <Notice kind="warn">
          Everyone can see NABS Tokens, but earning is paused: members see a balance no race moves. Start counting
          below, or switch to Admins only until you are ready.
        </Notice>
      )}

      <EarningSwitch
        earning={!!d.earning}
        startDay={d.startDay}
        busy={busy}
        onChange={(on) =>
          run(
            () => api.setTokensEarning(on),
            on ? "Counting started. Races from today pay out." : "Counting paused. Balances stand still."
          )
        }
      />

      <SlidingTabs
        items={[
          { key: "orders", label: waiting ? `Orders (${waiting})` : "Orders" },
          { key: "members", label: "Balances" },
          { key: "activity", label: "Activity" },
          { key: "rules", label: "Rules and prices" },
          { key: "bot", label: "Discord bot" },
        ]}
        value={view}
        onChange={setView}
        wrapClassName="inline-flex flex-wrap rounded-xl border border-border bg-card p-1"
        btnClassName="px-3 py-1.5 text-[13px]"
      />

      {view === "orders" && (
        <>
          {manual.length ? (
            <div className="card px-5 py-1">
              <ul className="divide-y divide-border">
                {manual.map((o) => (
                  <OrderRow
                    key={o.id}
                    order={o}
                    busy={busy}
                    onUpdate={(id, status, note, flairText) =>
                      run(
                        () => api.updateTokenOrder(id, { status, note, flairText }),
                        status === "DONE" ? "Marked as filled." : "Declined and refunded."
                      )
                    }
                  />
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState
              title="Nothing to do"
              hint="Helmets, car skins, Discord roles and flairs somebody wrote themselves land here when they order one. Card designs, the fixed flairs and wall entries the site fills by itself."
            />
          )}
          {auto.length > 0 && (
            <details className="card px-5 py-3">
              <summary className="cursor-pointer text-sm text-light">
                Filled by the site ({auto.length}): card designs, flairs, wall entries. Nothing to do here, just the record.
              </summary>
              <ul className="mt-2 divide-y divide-border">
                {auto.map((o) => (
                  <OrderRow key={o.id} order={o} busy={busy} onUpdate={() => {}} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {view === "members" &&
        ((d.members || []).length ? (
          <div className="card px-5 py-1">
            <ul className="divide-y divide-border">
              {d.members.map((m) => (
                <MemberRow
                  key={m.discordId}
                  m={m}
                  busy={busy}
                  onAdjust={(discordId, delta, note) =>
                    run(() => api.adjustTokens(discordId, delta, note), "Booked.")
                  }
                  onRemoveInviter={async (member) => {
                    const ok = await ask({
                      title: `Remove ${member.invitedBy} as inviter of ${member.name}?`,
                      body:
                        `${member.invitedBy} loses the points they were paid for bringing in ${member.name}, and ` +
                        `${member.name} can name the right person on their points page.`,
                      danger: true,
                      confirmLabel: "Remove inviter",
                    });
                    if (ok) run(() => api.removeTokenReferral(member.discordId), "Inviter removed.");
                  }}
                />
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            title="Nobody has an account yet"
            hint="One is created the first time a member signs in while the tokens are switched on."
          />
        ))}

      {view === "activity" && <ActivityPanel />}

      {view === "bot" && <BotPanel />}

      {view === "rules" && (
        <TuningPanel
          key={JSON.stringify(d.tuning || {})}
          d={d}
          busy={busy}
          onSave={(t) => run(() => api.saveTokenTuning(t), "Saved. Members and payouts follow right away.")}
          onReset={async () => {
            const ok = await ask({
              title: "Put every rule and price back to the defaults?",
              body:
                "Everything typed on this page goes back to the default from the code: what earns tokens, the " +
                "shop, card and studio prices, the referral limit, the activity multiplier and which servers count. " +
                "Changes not saved yet go too. The counting start day stays.\n\n" +
                "Rules pay out backwards: a default above today's number also pays for the races already driven, " +
                "and a lower one takes nothing back.",
              danger: true,
              confirmLabel: "Back to defaults",
            });
            if (ok) run(() => api.resetTokenTuning(), "Back to the defaults from the code. The start day is kept.");
          }}
        />
      )}
    </div>
  );
}
