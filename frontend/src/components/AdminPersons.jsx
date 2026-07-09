import { useCallback, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox } from "./ui.jsx";

// Admin: link a person's per-season driver rows together so career stats
// aggregate and archive tables show their current name with a "raced as <old>"
// note. Two cards: the linker (auto suggestions + manual search) on top, and a
// compact, filterable register of everyone already linked below — each person
// is one collapsed row that expands to its season entries.

function seasonLabel(d) {
  return d.seasonName || (d.seasonNumber != null ? `Season ${d.seasonNumber}` : "—");
}

function Chevron({ open }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`}
      fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Slim ruled header, same language as the other admin cards.
function CardHeader({ title, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface2/50 px-5 py-3">
      <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-light">{title}</h3>
      {children}
    </div>
  );
}

export default function AdminPersons() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.adminPersons(), []));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [note, setNote] = useState(null); // success summary of the auto-link run
  const [picks, setPicks] = useState([]); // driverIds selected for linking
  const [query, setQuery] = useState(""); // linker search
  const [filter, setFilter] = useState(""); // linked-people register filter
  const [expanded, setExpanded] = useState(null); // personId whose entries are open
  const [showAll, setShowAll] = useState(false);

  const drivers = data?.drivers || [];
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  // One row per person: current identity = the newest season's entry; any other
  // spelling becomes a "raced as" note. Sorted by current name for scanning.
  const persons = useMemo(() => {
    return (data?.persons || [])
      .filter((p) => p.drivers.length)
      .map((p) => {
        const current = p.drivers[p.drivers.length - 1]; // drivers arrive season-ascending
        // "raced as" only for genuinely different handles — case or accent
        // variants (aleks/Aleks, González/Gonzalez) are not worth a note here.
        const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const formerNames = [
          ...new Set(p.drivers.map((d) => d.name).filter((n) => n && norm(n) !== norm(current.name))),
        ];
        return { ...p, current, formerNames };
      })
      .sort((a, b) => a.current.name.localeCompare(b.current.name));
  }, [data]);

  const pf = filter.trim().toLowerCase();
  const filteredPersons = pf
    ? persons.filter((p) => p.drivers.some((d) => d.name.toLowerCase().includes(pf)))
    : persons;
  const COLLAPSED_COUNT = 10;
  const shownPersons = pf || showAll ? filteredPersons : filteredPersons.slice(0, COLLAPSED_COUNT);

  // Linker search across name, season and team; newest seasons first.
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (q.length < 2) return [];
    return drivers
      .filter((d) => `${d.name} ${seasonLabel(d)} ${d.teamName || ""}`.toLowerCase().includes(q))
      .sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0) || a.name.localeCompare(b.name))
      .slice(0, 20);
  }, [drivers, q]);

  async function run(fn) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const linkGroup = (ids) => run(() => api.linkPersons(ids));
  const unlink = (driverId) => run(() => api.unlinkPerson(driverId));

  function togglePick(id) {
    setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  if (error) return <ErrorBox message={error} />;

  return (
    <div className="space-y-5">
      {/* ----------------------------------------------------------------- */}
      {/* Card 1: link accounts                                              */}
      {/* ----------------------------------------------------------------- */}
      <div className="card overflow-hidden">
        <CardHeader title="Same person across seasons" />
        <div className="space-y-5 p-5">
          <p className="text-sm text-light">
            Link the season entries of one person, so their profile shows a combined career and old seasons display the
            current name with a &ldquo;raced as&rdquo; note. Identical names are linked automatically with the button
            below; only people who changed their handle need the manual search.
          </p>

          {msg && <ErrorBox message={msg} />}
          {note && (
            <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-600">{note}</p>
          )}
          {loading && <p className="text-sm text-light">Loading…</p>}

          {/* auto suggestions: identical names spanning seasons, not yet linked */}
          {data?.candidates?.length > 0 && (
            <div className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
                  Same name in several seasons · {data.candidates.length} open
                </span>
                <button
                  className="btn-primary py-1 text-sm disabled:opacity-50"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const r = await api.autoLinkPersons();
                      setNote(
                        `Linked ${r.linked} ${r.linked === 1 ? "person" : "people"} automatically.` +
                          (r.skippedAmbiguous
                            ? ` ${r.skippedAmbiguous} name${r.skippedAmbiguous === 1 ? "" : "s"} appear twice in one season and need a manual decision.`
                            : "")
                      );
                    })
                  }
                >
                  Link all automatically
                </button>
              </div>
              <ul className="divide-y divide-border">
                {data.candidates.map((group, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <span className="font-semibold text-dark">{group[0].name}</span>
                    <span className="flex flex-wrap gap-1">
                      {group.map((d) => (
                        <span key={d.id} className="pill bg-surface2 font-mono text-[10px] text-light">
                          S{d.seasonNumber ?? "?"}
                        </span>
                      ))}
                    </span>
                    <button
                      className="btn-secondary ml-auto px-3 py-1 text-xs disabled:opacity-50"
                      disabled={busy}
                      onClick={() => linkGroup(group.map((d) => d.id))}
                    >
                      Link
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* manual linker for handle changes */}
          <div>
            <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
              Different names? Link by hand
            </div>
            <p className="mt-1 text-xs text-light">
              Search the old name, click it, search the current name, click it, hit Link.
            </p>
            <input
              className="input mt-2 w-full max-w-md py-1.5 text-sm"
              type="search"
              placeholder="Type a driver name (old or new)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={busy}
            />

            {q.length >= 2 && (
              <ul className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {matches.map((d) => {
                  const picked = picks.includes(d.id);
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => togglePick(d.id)}
                        className={`flex w-full flex-wrap items-center gap-2 px-3 py-1.5 text-left text-sm transition ${
                          picked ? "bg-brand/10" : "hover:bg-surface2"
                        }`}
                      >
                        <span className="font-semibold text-dark">{d.name}</span>
                        <span className="pill bg-surface2 font-mono text-[10px] text-light">S{d.seasonNumber ?? "?"}</span>
                        {d.teamName && <span className="text-xs text-light">{d.teamName}</span>}
                        <span className={`ml-auto font-mono text-[10px] font-bold uppercase ${picked ? "text-brand" : "text-faint"}`}>
                          {picked ? "Selected" : "Select"}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {matches.length === 0 && <li className="px-3 py-2 text-sm text-light">No entries match &ldquo;{query}&rdquo;.</li>}
              </ul>
            )}

            {picks.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">Selected:</span>
                {picks.map((id) => (
                  <span key={id} className="pill bg-surface2 text-dark">
                    {driverById.get(id)?.name} · S{driverById.get(id)?.seasonNumber ?? "?"}
                    <button className="ml-1.5 text-light hover:text-dark" onClick={() => togglePick(id)}>×</button>
                  </span>
                ))}
                {picks.length >= 2 ? (
                  <button
                    className="btn-primary py-1 text-sm disabled:opacity-50"
                    disabled={busy}
                    onClick={() => run(async () => { await api.linkPersons(picks); setPicks([]); setQuery(""); })}
                  >
                    Link {picks.length} entries
                  </button>
                ) : (
                  <span className="text-xs text-light">Select at least one more entry to link.</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Card 2: the register of linked people                              */}
      {/* ----------------------------------------------------------------- */}
      {persons.length > 0 && (
        <div className="card overflow-hidden">
          <CardHeader title={`Linked people · ${persons.length}`}>
            <input
              className="input w-56 py-1 text-sm"
              type="search"
              placeholder="Filter by any name…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </CardHeader>
          <ul className="divide-y divide-border">
            {shownPersons.map((p) => {
              const open = expanded === p.personId;
              return (
                <li key={p.personId}>
                  {/* collapsed row: current name, former names, season chips */}
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : p.personId)}
                    className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition hover:bg-surface2"
                  >
                    <span className="min-w-0 truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark">
                      {p.current.name}
                    </span>
                    {p.formerNames.length > 0 && (
                      <span className="min-w-0 truncate text-xs text-light">raced as {p.formerNames.join(", ")}</span>
                    )}
                    {/* per-season chips need room — phones get a plain count */}
                    <span className="ml-auto hidden shrink-0 gap-1 sm:flex">
                      {p.drivers.map((d) => (
                        <span key={d.id} className="pill bg-surface2 font-mono text-[10px] text-light" title={`${d.name} · ${seasonLabel(d)}`}>
                          S{d.seasonNumber ?? "?"}
                        </span>
                      ))}
                    </span>
                    <span className="pill ml-auto shrink-0 bg-surface2 font-mono text-[10px] text-light sm:hidden">
                      {p.drivers.length} seasons
                    </span>
                    <Chevron open={open} />
                  </button>

                  {/* expanded: one line per season entry, with remove */}
                  {open && (
                    <ul className="divide-y divide-border border-t border-border bg-surface2/40">
                      {p.drivers.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-2.5 py-2 pl-8 pr-5 text-sm">
                          <span className="pill bg-card font-mono text-[10px] text-light">{seasonLabel(d)}</span>
                          <span className="font-semibold text-dark">{d.name}</span>
                          {d.teamName && <span className="text-xs text-light">{d.teamName}</span>}
                          <button
                            className="ml-auto text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                            disabled={busy}
                            onClick={() => unlink(d.id)}
                            title="Remove this entry from the person"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
            {shownPersons.length === 0 && (
              <li className="px-5 py-3 text-sm text-light">Nobody matches &ldquo;{filter}&rdquo;.</li>
            )}
          </ul>
          {!pf && !showAll && filteredPersons.length > COLLAPSED_COUNT && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="block w-full border-t border-border px-5 py-2.5 text-center text-sm font-semibold text-primary transition hover:bg-surface2"
            >
              Show all {filteredPersons.length}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
