import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { TOKENS_CHANGED_EVENT } from "../hooks/useTokenBalance.js";
import { ErrorBox, Notice, EmptyState } from "./ui.jsx";
import SlidingTabs from "./SlidingTabs.jsx";
import TokenIcon from "./TokenIcon.jsx";

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

function EarningSwitch({ earning, startDay, busy, onChange }) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <div className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-eyebrow">Earning points</div>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-light">
          {earning
            ? `Running${startDay ? `, races from ${startDay} count` : ""}. Everyone earns as they go.`
            : "Paused. Members can look around, but no race pays and no balance moves. Switching it on sets the day counting starts."}
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
          NABS Points
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
function MemberRow({ m, onAdjust, busy }) {
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
          <div className="truncate text-sm font-semibold text-dark">{m.name}</div>
          <div className="truncate text-xs text-light">
            Code <span className="font-mono font-bold text-medium">{m.code}</span>
            {m.invitedBy ? `. Invited by ${m.invitedBy}` : ""}
            {m.invitedCount ? `. Brought in ${m.invitedCount}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 font-mono text-sm font-bold tabular-nums text-dark">
            <TokenIcon className="h-3.5 w-3.5 text-brand" />
            {fmt(m.balance)}
          </span>
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
        It can run before the points are switched on for members, which fills the 30 day window in advance.
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
  const defaults = d.defaults || {};
  const defRule = (key) => defaults.rules?.find((r) => r.key === key) || {};
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
            Races before this day pay nothing. The site fills it in the first time you start the counting. Empty
            means every race ever, back to season 1.
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
          <Head>What earns points</Head>
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

export default function AdminTokens() {
  const data = useApi(useCallback(() => api.adminTokens(), []));
  const [view, setView] = useState("orders");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const reload = data.reload;

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

  return (
    <div className="space-y-4">
      {error && <ErrorBox message={error} />}
      {done && <Notice kind="success">{done}</Notice>}

      <TrialSwitch
        mode={d.mode || (d.enabled ? "all" : "off")}
        busy={busy}
        onChange={(m) =>
          run(
            () => api.setTokensMode(m),
            m === "all" ? "NABS Points are on for everyone." : m === "admins" ? "NABS Points are on for admins only." : "NABS Points are off."
          )
        }
      />

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
                />
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            title="Nobody has an account yet"
            hint="One is created the first time a member signs in while the points are switched on."
          />
        ))}

      {view === "bot" && <BotPanel />}

      {view === "rules" && (
        <TuningPanel
          key={JSON.stringify(d.tuning || {})}
          d={d}
          busy={busy}
          onSave={(t) => run(() => api.saveTokenTuning(t), "Saved. Members and payouts follow right away.")}
          onReset={() => run(() => api.resetTokenTuning(), "Back to the defaults from the code.")}
        />
      )}
    </div>
  );
}
