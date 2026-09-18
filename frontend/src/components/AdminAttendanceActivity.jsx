import { useCallback, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { CardHead, ErrorBox, HelpNote, Notice, TableSkeleton, TeamDot } from "./ui.jsx";
import { fmtDateShort } from "../utils/format.js";

// ---------------------------------------------------------------------------
// Admin → Attendance → "Activity": the season read down the other way.
//
// Every other view here is about one race — who may answer it, who hasn't, what
// they said. This one is about the PERSON: one row per driver, one column per
// round, and a verdict at the end of it. A seat held by somebody who last raced
// in round 2 is a seat nobody is using, and until this page the only way to see
// that was to open every past round and compare the lists by eye.
//
// Tier 1, Tier 2 and the reserve pool are kept apart because a silence means a
// different thing in each: a missing full-timer is a hole in a car and needs a
// message today; a missing reserve is a name to stop counting on.
//
// The status comes from the server (backend/src/lib/attendanceActivity.js) and
// counts a SIGN-UP as a sign of life, not just a start — a reserve who answers
// every round and is needed for none is present, and judging the pool on starts
// alone would paint most of the roster as gone. The two numbers stay in their
// own columns so the difference is readable rather than buried in the verdict.
//
// PROGRESS is the other half, and the opposite kind of thing: a label a person
// sets by hand (backend/src/lib/driverProgress.js), which used to live in a
// spreadsheet of its own. It is here because the judgement is only worth making
// with the evidence on the same line — the numbers say what happened, the label
// says what the league decided about it. Nothing computes it and nothing reads
// it back into the standings.
// ---------------------------------------------------------------------------

const STATE_LABEL = { active: "Active", quiet: "Quiet", inactive: "Inactive", never: "Never seen" };
const STATE_TONE = {
  active: "bg-ok/10 text-ok",
  quiet: "bg-warn/10 text-warn",
  inactive: "bg-bad/10 text-bad",
  never: "bg-surface2 text-faint",
};

// The tint the dropdown wears for whatever is picked. Keyed by the server's
// keys with a plain fallback, so a sixth label added in driverProgress.js shows
// up working (just uncoloured) rather than breaking the row.
const PROGRESS_TONE = {
  FULL_TIME: "border-ok/50 bg-ok/10 text-ok",
  POSSIBLY_RESERVE: "border-warn/50 bg-warn/10 text-warn",
  DESERVING: "border-brand/60 bg-brand/10 text-link",
  IN_PROGRESS: "border-border bg-surface2 text-medium",
  TENTATIVE: "border-warn/40 bg-surface2 text-warn",
};
const progressTone = (key) => PROGRESS_TONE[key] || "border-border bg-card text-light";

const roundLabel = (r) => (r.number != null ? `R${r.number}` : r.type === "SPECIAL" ? "SP" : "–");
const roundTitle = (r) => `${roundLabel(r)} ${r.track}${r.date ? ` · ${fmtDateShort(r.date)}` : ""}`;

// What one cell of the strip says, in one word, so the legend and the tooltips
// agree with each other by construction.
function cellKind(cell) {
  if (cell.raced) return cell.result === "FINISHED" ? "finished" : "classified";
  if (cell.rsvp === "ACCEPTED") return "noshow";
  if (cell.rsvp === "DECLINED") return "out";
  if (cell.rsvp === "TENTATIVE") return "maybe";
  return "silent";
}

const CELL = {
  finished: { glyph: "", className: "bg-ok/70", label: "raced" },
  // A DNF or a DSQ still turned up, so it keeps the "was there" colour and
  // says what happened in the corner rather than in a different colour.
  classified: { glyph: "!", className: "bg-ok/30 text-ok", label: "raced, did not finish" },
  noshow: { glyph: "!", className: "bg-bad/20 text-bad", label: "said in, never started" },
  out: { glyph: "–", className: "bg-surface2 text-light", label: "answered out" },
  maybe: { glyph: "?", className: "bg-warn/20 text-warn", label: "answered maybe" },
  silent: { glyph: "", className: "border border-dashed border-border", label: "no answer, no start" },
};

function Cell({ cell, round }) {
  const kind = cellKind(cell);
  const look = CELL[kind];
  const detail = kind === "classified" ? `raced (${cell.result})` : look.label;
  // role="img" + aria-label rather than a hidden span of text inside: the
  // strip is a scroll container, and an absolutely positioned .sr-only in here
  // has no positioned ancestor to belong to — so it escapes the container and
  // drags the whole page sideways on a phone. The label also replaces the
  // glyph for a screen reader, which "!" on its own would not have said.
  return (
    <span
      role="img"
      aria-label={`${roundLabel(round)} ${round.track}: ${detail}`}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold leading-none ${look.className}`}
      title={`${roundTitle(round)}: ${detail}`}
    >
      {look.glyph}
    </span>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {["finished", "classified", "noshow", "maybe", "out", "silent"].map((k) => (
        <span key={k} className="flex items-center gap-1.5 text-xs text-light">
          <span
            className={`flex h-4 w-4 items-center justify-center rounded font-mono text-[9px] font-bold leading-none ${CELL[k].className}`}
          >
            {CELL[k].glyph}
          </span>
          {CELL[k].label}
        </span>
      ))}
    </div>
  );
}

// "2 rounds ago", counted in rounds rather than days: a league that skips a
// fortnight has not lost anybody.
//
// The round number carries the round, so the track name only made the widest
// column in the table wider still and pushed Progress off the edge. It stays in
// the tooltip, where it costs nothing.
function lastSeenText(d) {
  if (!d.lastSeen) return "never this season";
  const how = d.lastSeen.raced ? "raced" : "answered";
  const ago = d.roundsSinceSeen === 0 ? "last round" : `${d.roundsSinceSeen} round${d.roundsSinceSeen === 1 ? "" : "s"} ago`;
  return `${how} ${roundLabel(d.lastSeen)}, ${ago}`;
}

// The same thing with the track spelled out, for the tooltip and the CSV.
function lastSeenFull(d) {
  if (!d.lastSeen) return "never this season";
  return `${lastSeenText(d)} (${d.lastSeen.track})`;
}

// The hand-set label. A native select rather than a menu of pills: it is
// keyboard- and phone-native, and only the chosen value is ever on screen, so
// the tint can live on the control itself and the row still reads like the
// spreadsheet it replaces. "—" is a real choice, not a placeholder: "nobody has
// decided yet" is the state every driver starts in and has to be reachable
// again after a wrong pick.
function ProgressPicker({ driver, options, busy, onChange }) {
  const value = driver.progress || "";
  return (
    <select
      className={`w-full rounded-lg border px-2 py-1 text-xs font-bold transition disabled:opacity-50 ${progressTone(driver.progress)}`}
      value={value}
      disabled={busy}
      aria-label={`Progress for ${driver.name}`}
      onChange={(e) => onChange(driver, e.target.value || null)}
    >
      <option value="">Not set</option>
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function DriverRow({ d, rounds, options, busy, onProgress }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="max-w-0 py-2 pr-3 align-middle">
        <div className="flex items-center gap-2">
          <TeamDot color={d.teamColor || "var(--c-border)"} />
          <span className="min-w-0 truncate font-semibold text-dark">{d.name}</span>
        </div>
        <div className="truncate pl-4 text-xs text-light">{d.team || "no team"}</div>
      </td>
      <td className="py-2 pr-3 align-middle">
        <div className="flex gap-1">
          {rounds.map((r, i) => (
            <Cell key={r.id} cell={d.cells[i]} round={r} />
          ))}
        </div>
      </td>
      <td className="py-2 pr-3 text-right align-middle font-mono text-xs text-medium">
        {d.starts}
        <span className="text-faint">/{d.rounds}</span>
      </td>
      <td className="py-2 pr-3 text-right align-middle font-mono text-xs text-medium">
        {d.answers}
        <span className="text-faint">/{d.rounds}</span>
      </td>
      <td className="py-2 pr-3 text-right align-middle font-mono text-xs">
        {d.noShows > 0 ? <span className="text-bad">{d.noShows}</span> : <span className="text-faint">–</span>}
      </td>
      <td className="whitespace-nowrap py-2 pr-3 align-middle text-xs text-light" title={lastSeenFull(d)}>
        {lastSeenText(d)}
      </td>
      <td className="py-2 pr-3 align-middle">
        <span className={`pill whitespace-nowrap ${STATE_TONE[d.state]}`}>{STATE_LABEL[d.state]}</span>
      </td>
      <td className="py-2 align-middle">
        <ProgressPicker driver={d} options={options} busy={busy} onChange={onProgress} />
      </td>
    </tr>
  );
}

// One tier. `collapsible` folds the reserve pool away — it is usually the
// larger half of the roster by far, and the ten full-timers above it are what
// the page is opened for.
function Group({ title, hint, people, rounds, tally, options, busy, onProgress, collapsible = false }) {
  const [open, setOpen] = useState(!collapsible);
  const needs = (tally?.quiet || 0) + (tally?.inactive || 0) + (tally?.never || 0);

  return (
    <div className="border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
            {title} <span className="text-light">({people.length})</span>
          </h3>
          {hint && <p className="mt-0.5 text-xs text-light">{hint}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {["active", "quiet", "inactive", "never"].map((s) =>
            tally?.[s] ? (
              <span key={s} className={`pill ${STATE_TONE[s]}`}>
                {tally[s]} {STATE_LABEL[s]}
              </span>
            ) : null
          )}
          {collapsible && (
            <button className="btn-secondary py-1.5 text-xs" onClick={() => setOpen((o) => !o)}>
              {open ? "Hide list" : `Show list${needs ? ` (${needs} to look at)` : ""}`}
            </button>
          )}
        </div>
      </div>

      {people.length === 0 ? (
        <p className="mt-2 text-sm text-light">Nobody here.</p>
      ) : (
        open && (
          <div className="mt-2 overflow-x-auto scrollbar-slim">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wider text-light">
                  <th className="w-56 py-2 pr-3 font-bold">Driver</th>
                  <th className="py-2 pr-3 font-bold">
                    {/* The round numbers sit on the same fixed-width cells as
                        the strips below, so the two line up without a layout
                        that has to be kept in step by hand. */}
                    <div className="flex gap-1">
                      {rounds.map((r) => (
                        <span key={r.id} className="w-5 shrink-0 text-center text-[10px]" title={roundTitle(r)}>
                          {r.number ?? "·"}
                        </span>
                      ))}
                    </div>
                  </th>
                  <th className="py-2 pr-3 text-right font-bold">Raced</th>
                  <th className="py-2 pr-3 text-right font-bold">Answered</th>
                  <th className="whitespace-nowrap py-2 pr-3 text-right font-bold" title="Said in and never started.">
                    No-show
                  </th>
                  <th className="whitespace-nowrap py-2 pr-3 font-bold">Last seen</th>
                  <th className="py-2 pr-3 font-bold">Status</th>
                  {/* A width on the column rather than a cap on the control:
                      a native select clips its own text, and "In progress" lost
                      its last letter every time the table squeezed this one. */}
                  <th className="w-40 py-2 font-bold" title="Your call. Nothing computes this one.">
                    Progress
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((d) => (
                  <DriverRow
                    key={d.driverId}
                    d={d}
                    rounds={rounds}
                    options={options}
                    busy={busy}
                    onProgress={onProgress}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

// "Most present" leads, because a table of attendance reads like any other
// table of attendance: best at the top, and the people who have stopped coming
// found at the bottom where you scroll to look for them. It opened on "Needs
// attention" at first, which put 1-of-5 above 5-of-5 and made the whole list
// look upside down.
const SORTS = {
  raced: "Most present",
  attention: "Needs attention",
  progress: "Progress",
  name: "Name",
  team: "Team",
};

function sortPeople(people, sort, progressRank) {
  // "attention" is the order the server already sends (longest silence first),
  // so it is left alone rather than reproduced here and allowed to drift.
  if (sort === "attention") return people;
  const copy = [...people];
  if (sort === "name") return copy.sort((a, b) => a.name.localeCompare(b.name));
  // Races first, then answers: between two drivers who have started the same
  // number of rounds, the one who keeps replying is the one still with us.
  if (sort === "raced") {
    return copy.sort((a, b) => b.starts - a.starts || b.answers - a.answers || a.name.localeCompare(b.name));
  }
  if (sort === "progress") {
    // In the order the labels are defined (holding a seat → being looked at),
    // with the undecided rows last: sorting by this is how you find the people
    // still waiting on a decision.
    const rank = (d) => (d.progress ? progressRank.get(d.progress) ?? 98 : 99);
    return copy.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }
  return copy.sort((a, b) => (a.team || "").localeCompare(b.team || "") || a.name.localeCompare(b.name));
}

function csvFor(data, people, labelFor) {
  const rounds = data.rounds || [];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = [
    "Driver", "Tier", "Team", "Progress", "Status", "Raced", "Answered", "No-shows", "Last seen",
    ...rounds.map(roundLabel),
  ];
  const tierName = { tier1: "Tier 1", tier2: "Tier 2", reserve: "Reserve" };
  const lines = [head.map(esc).join(",")];
  for (const key of ["tier1", "tier2", "reserve"]) {
    for (const d of people[key] || []) {
      lines.push(
        [
          d.name,
          tierName[key],
          d.team || "",
          labelFor(d.progress) || "",
          STATE_LABEL[d.state],
          `${d.starts}/${d.rounds}`,
          `${d.answers}/${d.rounds}`,
          d.noShows,
          lastSeenFull(d),
          ...d.cells.map((c) => CELL[cellKind(c)].label),
        ]
          .map(esc)
          .join(",")
      );
    }
  }
  return lines.join("\n");
}

function download(name, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AdminAttendanceActivity() {
  const { current: season } = useSeason();
  const { data, loading, error, reload } = useApi(useCallback(() => api.attendanceActivity(), []));
  const [sort, setSort] = useState("raced");
  const [needsOnly, setNeedsOnly] = useState(false);
  const [q, setQ] = useState("");
  // Progress the admin has just set, over the top of what was loaded. Held
  // here rather than re-fetching the whole season on every pick: the answer is
  // one column and the page is a hundred rows deep, so a reload would scroll
  // the list out from under the person using it.
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const rounds = data?.rounds || [];
  const options = useMemo(() => data?.progressOptions || [], [data]);
  const labelFor = useCallback(
    (key) => (key ? options.find((o) => o.key === key)?.label || key : null),
    [options]
  );
  const progressRank = useMemo(() => new Map(options.map((o, i) => [o.key, i])), [options]);

  async function setProgress(driver, key) {
    setSaving(true);
    setSaveError(null);
    const before = driver.progress || null;
    setEdits((e) => ({ ...e, [driver.driverId]: key }));
    try {
      await api.setDriverProgress(driver.driverId, key);
    } catch (err) {
      // Put the row back to what the server still holds, rather than leaving a
      // label on screen that was never saved.
      setEdits((e) => ({ ...e, [driver.driverId]: before }));
      setSaveError(`${driver.name}: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const apply = (d) => (d.driverId in edits ? { ...d, progress: edits[d.driverId] } : d);
    const prep = (people = []) =>
      sortPeople(
        people
          .map(apply)
          .filter(
            (d) =>
              (!needsOnly || d.state !== "active") &&
              (!term ||
                d.name.toLowerCase().includes(term) ||
                (d.team || "").toLowerCase().includes(term) ||
                (labelFor(d.progress) || "").toLowerCase().includes(term))
          ),
        sort,
        progressRank
      );
    return {
      tier1: prep(data?.groups?.tier1),
      tier2: prep(data?.groups?.tier2),
      reserve: prep(data?.groups?.reserve),
    };
  }, [data, sort, needsOnly, q, edits, labelFor, progressRank]);

  const quietAfter = data?.thresholds?.quietAfter ?? 1;
  const inactiveAfter = data?.thresholds?.inactiveAfter ?? 3;

  return (
    <div className="card space-y-4 p-5">
      <CardHead eyebrow="Attendance page" title="Activity tracker" />
      {/* One line, and the rules folded away. Three paragraphs of definitions
          sat above the table every single visit, and the person opening this
          page has read them once. */}
      <p className="text-sm text-light">
        Who is still turning up. Every driver against every round of this season.
      </p>
      <HelpNote label="What the columns mean">
        <ul className="space-y-1">
          <li>
            <strong className="font-semibold text-medium">Raced</strong>: they were in the classification. A DNF counts,
            a DNS does not.
          </li>
          <li>
            <strong className="font-semibold text-medium">Answered</strong>: they touched the sign-up, whatever they
            said.
          </li>
          <li>
            <strong className="font-semibold text-medium">Status</strong>: runs on both, so a reserve who only ever
            answers still counts as present. Quiet after{" "}
            {quietAfter === 1 ? "a round" : `${quietAfter} rounds`} with neither, Inactive after {inactiveAfter}.
          </li>
          <li>
            <strong className="font-semibold text-medium">Progress</strong>: your call, saved as you pick it. Nothing
            computes it. It belongs to this season only.
          </li>
          <li>Deactivated drivers are left out.</li>
        </ul>
      </HelpNote>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {saveError && <Notice kind="error">{saveError}</Notice>}
      {loading && !data && <TableSkeleton rows={6} />}

      {data && rounds.length === 0 && (
        <p className="text-sm text-light">
          No finished round in this season yet. The page fills itself in as soon as a result is saved.
        </p>
      )}

      {data && rounds.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-medium">
              Sort
              <select className="input w-auto py-1.5 text-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
                {Object.entries(SORTS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="input max-w-[14rem] py-1.5 text-sm"
              placeholder="Find a driver, team or label"
              aria-label="Find a driver, team or label"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-medium">
              <input type="checkbox" checked={needsOnly} onChange={(e) => setNeedsOnly(e.target.checked)} />
              Only who needs looking at
            </label>
            <button
              className="btn-secondary ml-auto py-1.5 text-xs"
              onClick={() =>
                download(
                  `activity-${(season?.name || "season").replace(/\s+/g, "-").toLowerCase()}.csv`,
                  csvFor(data, groups, labelFor)
                )
              }
            >
              Export CSV
            </button>
          </div>

          <Legend />

          <Group
            title="Tier 1"
            hint="Someone quiet here is a car that may not be on the grid."
            people={groups.tier1}
            rounds={rounds}
            tally={data.totals?.tier1}
            options={options}
            busy={saving}
            onProgress={setProgress}
          />
          <Group
            title="Tier 2"
            hint=""
            people={groups.tier2}
            rounds={rounds}
            tally={data.totals?.tier2}
            options={options}
            busy={saving}
            onProgress={setProgress}
          />
          <Group
            title="Reserves"
            hint="They race when asked, so the answers are the signal here."
            people={groups.reserve}
            rounds={rounds}
            tally={data.totals?.reserve}
            options={options}
            busy={saving}
            onProgress={setProgress}
            collapsible
          />
        </>
      )}
    </div>
  );
}
