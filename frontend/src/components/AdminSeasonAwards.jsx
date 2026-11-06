import { useCallback, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAsk } from "./overlay.jsx";

// ---------------------------------------------------------------------------
// Admin › Seasons › one season › "Season awards": the honours the league hands
// out by vote or decision (best rookie, best qualifier, race of the season...).
// Each award is a name plus who won it: a driver, team or race of the season,
// or a name typed by hand. Shown in the Hall of Fame and in the season honours
// on Home (backend lib/seasonAwards.js).
// ---------------------------------------------------------------------------

// Names offered as a start; any other name can be typed.
const SUGGESTIONS = [
  "Best Rookie",
  "Best Qualifier",
  "Best Tier 1 Driver",
  "Best Tier 2 Driver",
  "Race of the Season",
  "Overtake of the Season",
  "Comeback of the Season",
  "Most Improved Driver",
  "Teammate of the Season",
  "Fair Play Award",
];

const KINDS = [
  { key: "driver", label: "Driver" },
  { key: "team", label: "Team" },
  { key: "race", label: "Race" },
  { key: "text", label: "Typed name" },
];

const EMPTY = { title: "", kind: "driver", winnerId: "", winnerText: "", note: "" };

function formFromAward(a) {
  return {
    title: a.title,
    kind: a.kind,
    winnerId: a.driver?.driverId || a.team?.id || a.race?.id || "",
    winnerText: a.winnerText || "",
    note: a.note || "",
  };
}

const tierLabel = (t) => (t === 1 ? "T1" : t === 2 ? "T2" : t === 0 ? "Reserve" : null);

function raceLabel(r) {
  return r.round != null ? `R${r.round} · ${r.track}` : r.track;
}

export function awardWinnerLabel(a) {
  if (a.kind === "driver") return a.driver.name;
  if (a.kind === "team") return a.team.name;
  if (a.kind === "race") return raceLabel(a.race);
  return a.winnerText;
}

function AwardForm({ value, onChange, choices, onSubmit, onCancel, busy, submitLabel }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const listId = "season-award-names";
  const options =
    value.kind === "driver"
      ? choices.drivers.map((d) => ({
          id: d.id,
          label: [d.name, d.team, tierLabel(d.tier)].filter(Boolean).join(" · "),
        }))
      : value.kind === "team"
        ? choices.teams.map((t) => ({ id: t.id, label: [t.name, tierLabel(t.tier)].filter(Boolean).join(" · ") }))
        : value.kind === "race"
          ? choices.races.map((r) => ({ id: r.id, label: raceLabel(r) }))
          : [];
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input
        aria-label="Award name"
        className="input min-w-40 flex-1 py-1 text-xs"
        list={listId}
        maxLength={60}
        placeholder="Award, e.g. Best Rookie"
        value={value.title}
        onChange={(e) => set({ title: e.target.value })}
      />
      <datalist id={listId}>
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <select
        aria-label="Who won it"
        className="input py-1 text-xs"
        value={value.kind}
        onChange={(e) => set({ kind: e.target.value, winnerId: "" })}
      >
        {KINDS.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </select>
      {value.kind === "text" ? (
        <input
          aria-label="Winner"
          className="input min-w-40 flex-1 py-1 text-xs"
          maxLength={80}
          placeholder="Winner, e.g. Max and Tom"
          value={value.winnerText}
          onChange={(e) => set({ winnerText: e.target.value })}
        />
      ) : (
        <select
          aria-label="Winner"
          className="input min-w-40 max-w-64 flex-1 py-1 text-xs"
          value={value.winnerId}
          onChange={(e) => set({ winnerId: e.target.value })}
        >
          <option value="">Pick the winner…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <input
        aria-label="Why (optional)"
        className="input min-w-48 basis-full py-1 text-xs sm:basis-auto sm:flex-[2]"
        maxLength={200}
        placeholder="Why, optional (one short line)"
        value={value.note}
        onChange={(e) => set({ note: e.target.value })}
      />
      <button type="submit" className="btn-secondary px-3 py-1 text-xs" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
      {onCancel && (
        <button type="button" className="text-xs font-semibold text-light transition hover:text-dark" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}

export default function AdminSeasonAwards({ season, onSaved, onError }) {
  const ask = useAsk();
  const { data, reload } = useApi(useCallback(() => api.seasonAwards(season.id), [season.id]));
  const awards = data?.awards || [];
  const choices = data?.choices || { drivers: [], teams: [], races: [] };
  const [draft, setDraft] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const body = (f) => ({
    title: f.title,
    kind: f.kind,
    note: f.note,
    ...(f.kind === "text" ? { winnerText: f.winnerText } : { winnerId: f.winnerId }),
  });

  async function run(fn, msg) {
    setBusy(true);
    onError(null);
    try {
      await fn();
      reload();
      if (msg) onSaved(msg);
      return true;
    } catch (err) {
      onError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const ok = await run(() => api.createSeasonAward(season.id, body(draft)), `Award "${draft.title.trim()}" added to ${season.name}.`);
    if (ok) setDraft({ ...EMPTY, kind: draft.kind });
  }

  async function saveEdit() {
    const ok = await run(() => api.updateSeasonAward(season.id, editId, body(editDraft)), `Award "${editDraft.title.trim()}" saved.`);
    if (ok) setEditId(null);
  }

  async function remove(a) {
    if (
      !(await ask({
        title: `Remove "${a.title}"?`,
        body: `It disappears from ${season.name} in the Hall of Fame and on Home.`,
        danger: true,
        confirmLabel: "Remove award",
      }))
    )
      return;
    await run(() => api.deleteSeasonAward(season.id, a.id), `Award "${a.title}" removed.`);
  }

  async function move(i, dir) {
    const ids = awards.map((a) => a.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await run(() => api.orderSeasonAwards(season.id, ids));
  }

  return (
    <div className="space-y-2 rounded-lg bg-surface2/60 p-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-light">Season awards</span>
        <span className="text-[11px] text-light">Shown in the Hall of Fame and, once the season is over, on Home.</span>
      </div>
      {awards.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {awards.map((a, i) => (
            <li key={a.id} className="px-2.5 py-1.5 text-xs">
              {editId === a.id ? (
                <AwardForm
                  value={editDraft}
                  onChange={setEditDraft}
                  choices={choices}
                  busy={busy}
                  submitLabel="Save"
                  onSubmit={saveEdit}
                  onCancel={() => setEditId(null)}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-dark">{a.title}</span>
                    <span className="text-light"> · {awardWinnerLabel(a)}</span>
                    {a.note && <div className="truncate text-[11px] text-light">{a.note}</div>}
                  </div>
                  <button type="button" className="p-1 text-light transition hover:text-dark disabled:opacity-30" disabled={busy || i === 0}
                    aria-label={`Move ${a.title} up`} onClick={() => move(i, -1)}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="p-1 text-light transition hover:text-dark disabled:opacity-30" disabled={busy || i === awards.length - 1}
                    aria-label={`Move ${a.title} down`} onClick={() => move(i, 1)}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="p-1 text-light transition hover:text-dark" disabled={busy}
                    aria-label={`Edit ${a.title}`} onClick={() => { setEditId(a.id); setEditDraft(formFromAward(a)); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="p-1 text-light transition hover:text-rose-500" disabled={busy}
                    aria-label={`Remove ${a.title}`} onClick={() => remove(a)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <AwardForm value={draft} onChange={setDraft} choices={choices} busy={busy} submitLabel="Add award" onSubmit={add} />
    </div>
  );
}
