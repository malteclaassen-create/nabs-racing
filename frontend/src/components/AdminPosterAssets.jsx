import { useRef } from "react";
import { CardBar } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";
import Flag from "./Flag.jsx";
import { COUNTRIES } from "../data/countries.js";

// ---------------------------------------------------------------------------
// The two things a poster needs that are not in the results table: a flag for
// every driver on it, and a picture for every team on it.
//
// Shared by both generators, because they are the same two lists about the same
// people. The result poster wants all three pictures (the cut-out car, the wide
// logo, the square badge); the standings poster has no podium tiles, so the car
// and the badge would be two upload boxes that change nothing on it — hence
// `kinds`, which is the list of slots a caller actually draws with.
//
// A flag fixed here is written to the driver, not to the poster, so it turns up
// across the whole site rather than only on the picture.
// ---------------------------------------------------------------------------

// What each slot is called on screen, and what the hover says it is for. The
// long logo is a "wordmark" in design language, which is precise and means
// nothing to anybody filling this in; the label says what it looks like
// instead, and the tooltip says how it differs from the logo the site already
// has. `mark` stays as the stored key (see lib/teamArt.js) — renaming the wire
// format to improve a caption would only orphan the files already uploaded.
const SLOT = {
  car: {
    label: "Car",
    hint: "the car, cut out, side on. It fills a podium tile.",
  },
  mark: {
    label: "Wide logo",
    hint: "the long logo with the team name written out, for the rows under the podium.",
  },
  badge: {
    label: "Logo",
    hint: "the square logo in the corner of a podium tile. Only needed if the site's own logo reads badly on the poster.",
  },
};

// One picture for one team. Empty, it is a labelled dashed box, which is both
// the button and the only place the word "car" needs to appear. Filled, it is
// the picture, and pressing it replaces.
//
// `fallback` is for the slot that has something to fall back ON: the tile logo
// uses the site's own if nothing is uploaded, so the empty box shows THAT,
// dimmed. An empty dashed box would read as a hole in the poster, when in fact
// the poster is already fine and this is only an override.
function ArtSlot({ team, kind, url, busy, onUpload, onClear, fallback = null }) {
  const fileRef = useRef(null);
  const { label, hint } = SLOT[kind];
  return (
    <span className="relative shrink-0">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onUpload(team.id, kind, f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        // The hover carries the explanation the page deliberately doesn't
        // print: what this picture is, in words somebody can act on.
        title={`${team.name}: ${url ? "replace" : fallback ? "override" : "upload"} ${hint}`}
        onClick={() => fileRef.current?.click()}
        className={`flex h-12 w-28 items-center justify-center overflow-hidden rounded-lg border transition disabled:opacity-50 ${
          url
            ? "border-border bg-black hover:border-link"
            : "border-dashed border-border bg-surface2 hover:border-link hover:text-dark"
        }`}
      >
        {url ? (
          <img src={url} alt="" className="h-full w-full object-contain" />
        ) : fallback ? (
          <img src={fallback} alt="" className="h-full w-full object-contain opacity-40" />
        ) : (
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-faint">{label}</span>
        )}
      </button>
      {url && (
        <button
          type="button"
          disabled={busy}
          aria-label={`Remove the ${label.toLowerCase()} for ${team.name}`}
          title="Remove"
          onClick={() => onClear(team.id, kind)}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-light transition hover:text-bad"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </span>
  );
}

// Every driver ON the poster, with the flag they have now.
//
// Nationality is normally the driver's own to set, on their profile after a
// Discord login, so anyone who has never logged in has none — but the ones who
// HAVE logged in can also have picked the wrong country, or a country they no
// longer race under, and without this the only way to fix that was to be them.
// The ones without a flag are listed first, because they are the ones the
// poster shows a hole for.
export function PosterFlags({ drivers, busy, onSet }) {
  if (!drivers.length) return null;
  const flagless = drivers.filter((d) => !d.country).length;
  return (
    <div className="card overflow-hidden">
      <CardBar
        title="Flags"
        right={
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
            {flagless > 0 ? `${flagless} without` : "all set"}
          </span>
        }
      />
      <ul className="divide-y divide-border">
        {drivers.map((d) => (
          <li key={d.driverId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
            {/* The flag they have, so the row shows the answer rather than
                asking the question twice. */}
            <span className="flex h-[15px] w-5 shrink-0 items-center justify-center">
              <Flag code={d.country} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-dark">{d.name}</span>
            <select
              aria-label={`Country for ${d.name}`}
              className="input w-auto max-w-[15rem] py-1.5 text-sm"
              value={d.country}
              disabled={busy}
              onChange={(e) => onSet(d.driverId, e.target.value)}
            >
              <option value="">No country</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The teams actually on the poster — the only ones whose artwork it can use. A
// full roster of upload slots would bury them.
export function PosterTeamArt({ teams, art, busy, onUpload, onClear, kinds = ["car", "mark", "badge"] }) {
  if (!teams.length) return null;
  // The one status worth stating in words, and it is a count, not a sentence.
  // Counted on the FIRST slot the caller draws with, which is the one that
  // matters to this poster: the car for the result, the wide logo for the table.
  const [main] = kinds;
  const have = teams.filter((t) => art?.[t.id]?.[main]).length;
  return (
    <div className="card overflow-hidden">
      <CardBar
        title="Team artwork"
        right={
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
            {have}/{teams.length} {SLOT[main].label.toLowerCase()}
          </span>
        }
      />
      <ul className="divide-y divide-border">
        {teams.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3">
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <TeamLogo id={t.id} name={t.name} color={t.color} logoUrl={t.logoUrl} size={22} />
              <span className="truncate text-sm font-semibold text-dark">{t.name}</span>
            </span>
            {kinds.map((kind) => (
              <ArtSlot
                key={kind}
                team={t}
                kind={kind}
                url={art?.[t.id]?.[kind]}
                // Only the badge has something to fall back ON: the site's own
                // logo already stands in for it, so the empty box shows that,
                // dimmed, rather than reading as a hole in the poster.
                fallback={kind === "badge" ? t.logoUrl || null : null}
                busy={busy}
                onUpload={onUpload}
                onClear={onClear}
              />
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
