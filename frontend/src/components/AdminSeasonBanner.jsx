import { useCallback } from "react";
import { CalendarPlus, ArrowRight } from "lucide-react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";

// ---------------------------------------------------------------------------
// The season change, where every admin sees it: at the top of the admin area.
//
// The guide that prepares a new season (AdminSeasonWizard) lives in the
// Seasons tab, and an admin who did not build the site would never go looking
// for it. So this line appears above the tabs exactly when there is something
// to do, and takes them straight into the guide:
//   * a new season is created and not live yet: which step it is on, and
//     "Carry on";
//   * otherwise, the active season has raced every round: "Prepare Season N".
// Nothing at all the rest of the year.
// ---------------------------------------------------------------------------

const STEPS = ["", "", "pick the teams", "pick the drivers", "put the calendar in", "announce it and switch over"];

// Tells the guide to open on mount (it reads and clears this, see
// AdminSeasonWizard) and which season it is preparing.
export function openSeasonWizard(waiting, active) {
  try {
    if (waiting) sessionStorage.setItem("nabs_season_wizard", JSON.stringify({ id: waiting.id, fromId: active?.id || null }));
    sessionStorage.setItem("nabs_season_wizard_open", "1");
  } catch {
    /* private mode: the Seasons tab still opens, the guide one click away */
  }
}

export default function AdminSeasonBanner({ onOpen }) {
  const { data: seasons } = useApi(useCallback(() => api.adminSeasons(), []));
  const list = seasons || [];
  const active = list.find((s) => s.isActive) || null;
  const waiting = active
    ? list
        .filter((s) => !s.isActive && (s.number || 0) > (active.number || 0))
        .sort((a, b) => (b.number || 0) - (a.number || 0))[0] || null
    : null;
  // Only asked when there is no new season yet: has the active one raced every round?
  const { data: races } = useApi(
    useCallback(() => (active && !waiting ? api.racesFor(active.number) : Promise.resolve(null)), [active?.number, !!waiting])
  );
  if (!active) return null;

  let title = null;
  let text = null;
  let button = null;
  if (waiting) {
    const c = waiting._count || { teams: 0, drivers: 0, races: 0 };
    const step = !c.teams ? 2 : !c.drivers ? 3 : !c.races ? 4 : 5;
    title = `${waiting.name} is being prepared`;
    text = `Step ${step} of 5: ${STEPS[step]}. ${waiting.isPublic ? "" : "It stays hidden from the site until the last step."}`;
    button = `Carry on with ${waiting.name}`;
  } else {
    const rounds = (races || []).filter((r) => !r.isSpecialEvent && r.number != null);
    const over = rounds.length > 0 && rounds.every((r) => r.isCompleted);
    if (!over) return null;
    const next = Math.max(...list.map((s) => s.number || 0)) + 1;
    title = `${active.name} is over`;
    text = `Every round is raced. The guide takes you through the next season step by step: teams, drivers, calendar, switch over.`;
    button = `Prepare Season ${next}`;
  }

  return (
    // Same card, same gap below (mb-4) as the search above and the To do card
    // under it; a thin bar in the brand colour on the left is the only accent.
    <section
      className="card mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:px-5"
      style={{ boxShadow: "inset 3px 0 0 rgb(var(--c-brand))" }}
    >
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
        <CalendarPlus className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-[12rem] flex-1">
        <div className="font-display text-base font-black uppercase tracking-tight text-dark sm:text-lg">{title}</div>
        <p className="text-sm text-light">{text}</p>
      </div>
      <button
        type="button"
        className="btn-primary inline-flex w-full items-center justify-center gap-2 sm:w-auto"
        onClick={() => {
          openSeasonWizard(waiting, active);
          onOpen?.();
        }}
      >
        {button}
        <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </section>
  );
}
