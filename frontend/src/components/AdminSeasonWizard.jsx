import { useState } from "react";
import { api } from "../api/client.js";
import { CardHead, Notice, Field } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";

// ---------------------------------------------------------------------------
// "Prepare a new season", as four steps in one card (Seasons tab).
//
// The season change was spread over three tabs and a handful of buttons whose
// order mattered: create the season, copy the field over (the copy that also
// links each driver to their earlier seasons, or careers split in two), put
// the calendar in, then announce and switch. Every step already existed; what
// was missing was the order, and a way to see what is still left.
//
// Each step's state is read off the season itself (how many teams, drivers and
// races it holds, whether it is announced or active), never stored as "done":
// leave half-way, come back tomorrow, and the card picks up where the season
// actually is. Only WHICH season is being prepared is remembered, for this
// browser tab (sessionStorage), because the calendar step switches the admin
// to the new season and that remounts the page.
// ---------------------------------------------------------------------------

const KEY = "nabs_season_wizard";

function readWizard() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

function writeWizard(v) {
  try {
    if (v) sessionStorage.setItem(KEY, JSON.stringify(v));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode: the guide just forgets which season it was on */
  }
}

function parseTable(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw || "null");
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function Step({ n, done, title, children }) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ${
          done ? "bg-emerald-500/15 text-ok" : "bg-surface2 text-medium"
        }`}
        aria-label={done ? "done" : `step ${n}`}
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className={`font-semibold ${done ? "text-medium" : "text-dark"}`}>{title}</div>
        {children}
      </div>
    </li>
  );
}

// `seasons` is the admin season list (with _count), `reload` refetches it,
// `gotoInSeason(tab, number)` opens a tab with that season selected.
export default function AdminSeasonWizard({ seasons, reload, gotoInSeason }) {
  const ask = useAsk();
  const [wizard, setWizard] = useState(readWizard);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(!!wizard);

  const list = seasons || [];
  const active = list.find((s) => s.isActive) || list[0] || null;
  const nextNumber = list.reduce((m, s) => Math.max(m, s.number || 0), 0) + 1;
  const [form, setForm] = useState({
    fromId: active?.id || "",
    number: String(nextNumber),
    name: `Season ${nextNumber}`,
    game: "",
    keepScoring: true,
  });

  const target = wizard ? list.find((s) => s.id === wizard.id) || null : null;
  const source = list.find((s) => s.id === (wizard?.fromId || form.fromId)) || null;

  async function run(fn, done) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fn();
      if (done) setMsg(typeof done === "function" ? done(r) : done);
      await reload();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function create(e) {
    e.preventDefault();
    run(async () => {
      const body = { number: Number(form.number), name: form.name.trim(), game: form.game.trim() || null };
      // The league's rules usually carry over from one season to the next; the
      // Season settings below stay the place to change them.
      if (form.keepScoring && source) {
        body.dropWorst = source.dropWorst;
        body.pointsTable = parseTable(source.pointsTable);
        if (source.teamDropWorst != null) body.teamDropWorst = source.teamDropWorst;
        if (source.teamDropMode) body.teamDropMode = source.teamDropMode;
        if (source.fastestLapPoints) body.fastestLapPoints = source.fastestLapPoints;
      }
      const created = await api.createSeason(body);
      const next = { id: created.id, fromId: form.fromId || null };
      writeWizard(next);
      setWizard(next);
    }, `${form.name.trim()} created. It stays private until the last step.`);
  }

  function stop() {
    writeWizard(null);
    setWizard(null);
    setMsg(null);
    setError(null);
  }

  const counts = target?._count || { teams: 0, drivers: 0, races: 0 };
  const hasTeams = counts.teams > 0;
  // Teams alone are not a field: "Teams only" leaves the drivers still to come.
  const hasField = hasTeams && counts.drivers > 0;
  const hasCalendar = counts.races > 0;

  async function goLive() {
    const ok = await ask({
      title: `Make ${target.name} the active season?`,
      body:
        `${target.name} becomes public and what the site shows by default. ` +
        `${active && active.id !== target.id ? `${active.name} stays readable in the season switcher. ` : ""}` +
        (hasCalendar ? "" : "Its calendar is still empty: the site will show a season with no races."),
      confirmLabel: "Make it active",
    });
    if (!ok) return;
    const done = await run(() => api.activateSeason(target.id), `${target.name} is the active season now.`);
    if (!done) return;
    // Finished: the guide folds away, the message says what happened.
    writeWizard(null);
    setWizard(null);
    setOpen(false);
  }

  return (
    <div className="card p-5">
      <CardHead eyebrow="Guided" title="Prepare a new season">
        {!open ? (
          <button type="button" className="btn-secondary py-1.5 text-sm" onClick={() => setOpen(true)}>
            Start
          </button>
        ) : wizard ? (
          <button type="button" className="btn-secondary py-1.5 text-xs" onClick={stop} disabled={busy}>
            Stop the guide
          </button>
        ) : (
          <button type="button" className="btn-secondary py-1.5 text-xs" onClick={() => setOpen(false)}>
            Close
          </button>
        )}
      </CardHead>
      {!open && (
        <p className="text-sm text-light">
          Create the season, bring the field over, put the calendar in and switch over, in that order.
        </p>
      )}

      {open && !wizard && (
        <form onSubmit={create} className="space-y-3">
          <p className="text-sm text-light">
            Step 1 of 4. The new season is created private: nobody sees it until the last step.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Follows on from" tone="plain">
              <select
                className="input"
                value={form.fromId}
                onChange={(e) => setForm({ ...form, fromId: e.target.value })}
              >
                <option value="">Nothing (a fresh start)</option>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.isActive ? " (active)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Game" tone="plain">
              <input
                className="input"
                placeholder={source?.game || "e.g. F1 2008 · Assetto Corsa"}
                value={form.game}
                onChange={(e) => setForm({ ...form, game: e.target.value })}
              />
            </Field>
            <Field label="Number" tone="plain">
              <input
                className="input"
                type="number"
                min="1"
                max="999"
                required
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
              />
            </Field>
            <Field label="Name" tone="plain">
              <input
                className="input"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
          </div>
          {source && (
            <label className="flex items-center gap-2 text-sm text-medium">
              <input
                type="checkbox"
                checked={form.keepScoring}
                onChange={(e) => setForm({ ...form, keepScoring: e.target.checked })}
              />
              Keep the scoring rules of {source.name} (points table, dropped rounds)
            </label>
          )}
          <button className="btn-primary" disabled={busy || !form.name.trim() || !form.number}>
            Create the season
          </button>
        </form>
      )}

      {open && wizard && !target && (
        <p className="text-sm text-light">
          The season this guide was preparing is gone (deleted, or in another series).{" "}
          <button type="button" className="font-semibold text-brand underline" onClick={stop}>
            Start over
          </button>
        </p>
      )}

      {open && target && (
        <ol className="space-y-4">
          <Step n={1} done title={`${target.name} created`}>
            <p className="text-sm text-light">
              {target.isPublic ? "Public." : "Private: hidden from the site until step 4."}
            </p>
          </Step>

          <Step
            n={2}
            done={hasField}
            title={
              hasField
                ? `${counts.teams} team(s) and ${counts.drivers} driver(s)`
                : hasTeams
                  ? `${counts.teams} team(s), no drivers yet`
                  : "Bring the field over"
            }
          >
            {!hasTeams && source ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary py-1.5 text-sm"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api.cloneRoster(target.id, source.id),
                      (r) =>
                        `Copied ${r.teamsCreated} team(s) and ${r.driversCreated} driver(s) from ${source.name}, each linked to their earlier seasons.`
                    )
                  }
                >
                  Teams and drivers from {source.name}
                </button>
                <button
                  type="button"
                  className="btn-secondary py-1.5 text-sm"
                  disabled={busy}
                  onClick={() =>
                    run(() => api.cloneTeams(target.id, source.id), (r) => `Copied ${r.created} team(s) from ${source.name}.`)
                  }
                >
                  Teams only
                </button>
              </div>
            ) : !hasTeams ? (
              <button
                type="button"
                className="btn-secondary py-1.5 text-sm"
                onClick={() => gotoInSeason("teams", target.number)}
              >
                Add teams by hand
              </button>
            ) : !hasField ? (
              <div className="flex flex-wrap gap-2">
                {source && (
                  <button
                    type="button"
                    className="btn-primary py-1.5 text-sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api.cloneDrivers(target.id, source.id),
                        (r) => `Copied ${r.created} driver(s) from ${source.name} into the teams of the same name.`
                      )
                    }
                  >
                    Drivers from {source.name}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary py-1.5 text-sm"
                  onClick={() => gotoInSeason("drivers", target.number)}
                >
                  Add drivers by hand
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary py-1.5 text-xs"
                  onClick={() => gotoInSeason("teams", target.number)}
                >
                  Check the teams
                </button>
                <button
                  type="button"
                  className="btn-secondary py-1.5 text-xs"
                  onClick={() => gotoInSeason("drivers", target.number)}
                >
                  Check the drivers
                </button>
              </div>
            )}
          </Step>

          <Step
            n={3}
            done={hasCalendar}
            title={hasCalendar ? `${counts.races} race(s) on the calendar` : "Put the calendar in"}
          >
            <button
              type="button"
              className={`${hasCalendar ? "btn-secondary py-1.5 text-xs" : "btn-primary py-1.5 text-sm"}`}
              onClick={() => gotoInSeason("discord", target.number)}
            >
              {hasCalendar ? "Open the calendar" : "Schedule the races"}
            </button>
            {!hasCalendar && (
              <p className="text-xs text-light">
                Opens Races &amp; Events with {target.name} selected. Come back to Seasons for the last step.
              </p>
            )}
          </Step>

          <Step n={4} done={target.isActive} title="Announce and switch over">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-secondary py-1.5 text-sm"
                disabled={busy || target.isActive}
                onClick={() =>
                  run(
                    () => api.updateSeason(target.id, { isAnnounced: !target.isAnnounced }),
                    target.isAnnounced
                      ? `${target.name} is no longer announced.`
                      : `${target.name} now shows as "Coming up" on the home page.`
                  )
                }
              >
                {target.isAnnounced ? "Announced on the home page ✓" : "Announce on the home page"}
              </button>
              <button
                type="button"
                className="btn-primary py-1.5 text-sm"
                disabled={busy || target.isActive || !hasField}
                onClick={goLive}
                title={!hasField ? "Bring the field over first" : undefined}
              >
                Make it the active season
              </button>
            </div>
            <p className="text-xs text-light">
              Announcing shows name, game and opener while the season stays private. Making it active publishes it and
              makes it the site&rsquo;s default.
              {!hasCalendar && " The calendar is still empty, so the season would go live with no races."}
            </p>
          </Step>
        </ol>
      )}

      {error && <Notice kind="error">{error}</Notice>}
      {msg && <Notice kind="success">{msg}</Notice>}
    </div>
  );
}
