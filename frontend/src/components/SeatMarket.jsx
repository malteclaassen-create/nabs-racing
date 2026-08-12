import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { ErrorBox } from "./ui.jsx";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { countryFor } from "../data/driverCountries.js";
import { MARKET_CHANGED_EVENT } from "../hooks/useAdminAttention.js";

// A driver's name with their flag, going through to their page. Used for every
// name in here: the whole block is about people, and a name you cannot click is
// a dead end on a site whose other half is driver pages.
function DriverName({ driverId, name, country, className = "" }) {
  const inner = (
    <>
      <Flag code={countryFor(driverId, country)} w={16} h={12} />
      <span className="truncate">{name}</span>
    </>
  );
  if (!driverId) return <span className={`inline-flex items-center gap-1.5 ${className}`}>{inner}</span>;
  return (
    <Link
      to={`/drivers/${driverId}`}
      className={`inline-flex items-center gap-1.5 transition hover:text-link hover:underline ${className}`}
    >
      {inner}
    </Link>
  );
}

// Points down when shut, up when open.
function Chevron({ open }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 transition-transform duration-base ease-out-soft ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Interested reserves, as a row of names. Chips became names on a line: a
// rounded pill each was a lot of furniture for what is a list of people.
function InterestRow({ interests, pickedId }) {
  if (!interests.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {interests.map((i) => (
        <DriverName
          key={i.driverId}
          driverId={i.driverId}
          name={i.name}
          country={i.country}
          className={i.driverId === pickedId ? "font-semibold text-ok" : "text-medium"}
        />
      ))}
    </span>
  );
}

// The Driver Market block for ONE race, embedded in the Sign-Up race card.
// `race` is the market race object ({ id, offers }) or undefined; `me` is the
// caller's market context; `reload` refreshes the market after an action.
// Renders nothing when there's no market activity and the caller can't offer.
//
// `highlight` marks the offers a RESERVE could still put their hand up for, so
// the block a scroll cue just sent them to actually looks like the thing that
// was worth scrolling for. Off once they have applied or looked once.
export default function SeatMarket({ race, me, reload, highlight = false, blockRef = null }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  // Which settled seats have been opened out. A settled seat is one line
  // because that is all it usually needs to say, but "who else wanted it" is a
  // fair question and used to be the only thing the tall version was good for.
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const offers = race?.offers || [];
  const iOffered = me && offers.some((o) => o.offeredBy.driverId === me.driverId);
  const canOfferHere = me?.canOffer && !iOffered;

  // Keep the card clean: only show the section when there's something to act on.
  if (offers.length === 0 && !canOfferHere) return null;

  async function act(key, fn) {
    setError(null);
    setBusy(key);
    try {
      await fn();
      await reload();
      window.dispatchEvent(new Event(MARKET_CHANGED_EVENT));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  // Three groups, in the order a reserve reads them: what still needs somebody,
  // then the settled seats by tier. Grouping rather than one long sort, because
  // "Tier 1" written above three rows says what a sorted list only implies.
  const rank = (o) => (o.team?.tier ?? 99);
  const byTeam = (a, b) => (a.team?.name || "").localeCompare(b.team?.name || "");
  const free = offers.filter((o) => o.status !== "FILLED").sort((a, b) => rank(a) - rank(b) || byTeam(a, b));
  const settled = offers.filter((o) => o.status === "FILLED");
  const groups = [
    { key: "free", label: free.length === 1 ? "Still needs a driver" : "Still need a driver", rows: free },
    { key: "t1", label: "Tier 1", rows: settled.filter((o) => o.team?.tier === 1).sort(byTeam) },
    { key: "t2", label: "Tier 2", rows: settled.filter((o) => o.team?.tier === 2).sort(byTeam) },
    // Anything whose team carries no tier still has to appear somewhere.
    { key: "rest", label: "Other", rows: settled.filter((o) => o.team?.tier !== 1 && o.team?.tier !== 2).sort(byTeam) },
  ].filter((g) => g.rows.length);

  return (
    <div ref={blockRef} className="border-t border-border bg-surface2/40 px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Driver Market</h3>
        {canOfferHere && race && (
          <button
            className="btn-primary"
            disabled={busy === `offer:${race.id}`}
            onClick={() => act(`offer:${race.id}`, () => api.offerSeat(race.id))}
          >
            {busy === `offer:${race.id}` ? "…" : "Offer my seat"}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}

      {offers.length === 0 ? (
        <p className="text-sm text-faint">No open seats yet. Offer yours above if you can't make it.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-faint">
                  {group.label}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-2">
          {group.rows.map((offer) => {
            const mine = me && offer.offeredBy.driverId === me.driverId;
            const iAmInterested = me && offer.interests.some((i) => i.driverId === me.driverId);
            const iAmPicked = me && offer.filledBy?.driverId === me.driverId;
            const filled = offer.status === "FILLED";
            // Free, not mine, and I am a reserve who could take it.
            const forMe = highlight && !mine && !iAmInterested && !filled && me?.isReserve;

            // A settled seat is a fact, not a decision. It used to carry the
            // interest list, a divider and the whole action block, roughly a
            // hundred and sixty pixels to say something a single line says
            // better — and with several swaps in a round they pushed everything
            // still needing an answer off the screen.
            if (filled && !mine && !iAmPicked && !open.has(offer.id)) {
              return (
                <div
                  key={offer.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                >
                  <TeamLogo id={offer.team.id} name={offer.team.name} color={offer.team.color} logoUrl={offer.team.logoUrl} size={18} />
                  <span className="font-semibold text-dark">{offer.team.name}</span>
                  <span className="text-light">·</span>
                  <DriverName {...offer.filledBy} className="font-semibold text-dark" />
                  <span className="text-light">drives for</span>
                  <DriverName {...offer.offeredBy} className="text-medium" />
                  {/* Its own control rather than the whole row, so the driver
                      names in it stay real links. */}
                  <button
                    type="button"
                    onClick={() => toggle(offer.id)}
                    aria-expanded={false}
                    className="ml-auto shrink-0 rounded p-1 text-faint transition hover:text-medium"
                    title="Show who else wanted this seat"
                  >
                    <Chevron open={false} />
                  </button>
                </div>
              );
            }

            return (
              <div
                key={offer.id}
                className={`rounded-xl border p-3 ${
                  forMe ? "border-brand/60 bg-brand/5 ring-1 ring-brand/30" : "border-border bg-card"
                }`}
              >
                {/* seat header */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <div className="flex min-w-0 items-center gap-2 font-semibold text-dark">
                    <TeamLogo id={offer.team.id} name={offer.team.name} color={offer.team.color} logoUrl={offer.team.logoUrl} size={20} />
                    <span className="truncate">{offer.team.name}</span>
                    <span className="flex items-center gap-1.5 text-sm font-normal text-light">
                      · seat of <DriverName {...offer.offeredBy} className="text-medium" />
                    </span>
                  </div>
                  {filled && !mine && !iAmPicked ? (
                    <span className="flex items-center gap-1">
                      <span className="pill bg-emerald-500/15 text-ok">Filled · {offer.filledBy.name}</span>
                      <button
                        type="button"
                        onClick={() => toggle(offer.id)}
                        aria-expanded
                        className="shrink-0 rounded p-1 text-faint transition hover:text-medium"
                        title="Show less"
                      >
                        <Chevron open />
                      </button>
                    </span>
                  ) : filled ? (
                    <span className="pill bg-emerald-500/15 text-ok">Filled · {offer.filledBy.name}</span>
                  ) : forMe ? (
                    <span className="pill bg-brand/20 font-bold text-dark">This seat is free</span>
                  ) : (
                    <span className="pill bg-amber-500/15 text-warn">Looking for a reserve</span>
                  )}
                </div>

                {/* Who wants it. One line with a label in front of it rather
                    than a heading over a row of pills. */}
                {(offer.interests.length > 0 || mine) && (
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
                      Interested
                    </span>
                    {offer.interests.length ? (
                      <InterestRow interests={offer.interests} pickedId={offer.filledBy?.driverId} />
                    ) : (
                      <span className="text-sm text-faint">nobody yet</span>
                    )}
                  </div>
                )}

                {/* actions. A settled seat that is nobody's business shows the
                    interest list and stops there, rather than an empty box with
                    a hairline over it. */}
                <div className={filled && !mine && !iAmPicked ? "hidden" : "mt-2.5 border-t border-border pt-2.5"}>
                  {/* Offerer: pick a reserve / withdraw */}
                  {mine && (
                    <div className="space-y-2">
                      {offer.interests.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {offer.interests.map((i) => {
                            const picked = offer.filledBy?.driverId === i.driverId;
                            return (
                              <button
                                key={i.driverId}
                                className={picked ? "btn-secondary" : "btn-primary"}
                                disabled={busy === `pick:${offer.id}:${i.driverId}`}
                                onClick={() =>
                                  act(`pick:${offer.id}:${i.driverId}`, () =>
                                    api.pickReplacement(offer.id, picked ? null : i.driverId)
                                  )
                                }
                              >
                                {picked ? `Deselect ${i.name}` : `Choose ${i.name}`}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <button
                        className="transition text-sm font-semibold text-link hover:underline disabled:opacity-50"
                        disabled={busy === `withdraw:${offer.id}`}
                        onClick={() => act(`withdraw:${offer.id}`, () => api.withdrawOffer(offer.id))}
                      >
                        Withdraw my offer
                      </button>
                    </div>
                  )}

                  {/* Reserve: express / withdraw interest */}
                  {!mine && me?.isReserve && (
                    <div className="flex flex-wrap items-center gap-3">
                      {iAmPicked ? (
                        <span className="text-sm font-semibold text-ok">
                          You have this seat. Use the sign-up buttons above if you cannot make it.
                        </span>
                      ) : iAmInterested ? (
                        <button
                          className="btn-secondary"
                          disabled={busy === `int:${offer.id}`}
                          onClick={() => act(`int:${offer.id}`, () => api.withdrawInterest(offer.id))}
                        >
                          Withdraw interest
                        </button>
                      ) : (
                        <button
                          className="btn-primary"
                          disabled={busy === `int:${offer.id}`}
                          onClick={() => act(`int:${offer.id}`, () => api.expressInterest(offer.id))}
                        >
                          I'm interested
                        </button>
                      )}
                    </div>
                  )}

                  {/* Everyone else / logged out: read-only hint. Never on a
                      seat that is already taken — inviting somebody to take a
                      car that has a driver in it is just wrong. */}
                  {!mine && !me?.isReserve && !filled && (
                    <p className="text-xs text-faint">
                      {me ? "Only reserve drivers can take this seat." : "Sign in as a reserve driver to take a seat."}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
