import { useState } from "react";
import { api } from "../api/client.js";
import { TeamDot, ErrorBox } from "./ui.jsx";
import Flag from "./Flag.jsx";
import { countryFor } from "../data/driverCountries.js";

// One reserve chip (name + flag) used in the interest list.
function ReserveChip({ driverId, name, country, highlight }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ${
        highlight ? "bg-emerald-500/15 font-semibold text-emerald-600" : "bg-surface2 text-dark"
      }`}
    >
      {name}
      <Flag code={countryFor(driverId, country)} w={16} h={12} />
    </span>
  );
}

// The Driver Market block for ONE race, embedded in the Sign-Up race card.
// `race` is the market race object ({ id, offers }) or undefined; `me` is the
// caller's market context; `reload` refreshes the market after an action.
// Renders nothing when there's no market activity and the caller can't offer.
export default function SeatMarket({ race, me, reload }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

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
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t border-border bg-surface2/40 px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-medium">
          Driver Market
        </h3>
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

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      {offers.length === 0 ? (
        <p className="text-sm text-faint">
          No open seats yet. Offer yours above if you can't make it.
        </p>
      ) : (
        <div className="space-y-3">
          {offers.map((offer) => {
            const mine = me && offer.offeredBy.driverId === me.driverId;
            const iAmInterested = me && offer.interests.some((i) => i.driverId === me.driverId);
            const iAmPicked = me && offer.filledBy?.driverId === me.driverId;

            return (
              <div key={offer.id} className="rounded-xl border border-border bg-card p-4">
                {/* seat header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-dark">
                    <TeamDot color={offer.team.color} />
                    {offer.team.name}
                    <span className="text-sm font-normal text-light">· seat of {offer.offeredBy.name}</span>
                  </div>
                  {offer.status === "FILLED" ? (
                    <span className="pill bg-emerald-500/15 text-emerald-600">
                      Filled · {offer.filledBy.name}
                    </span>
                  ) : (
                    <span className="pill bg-amber-500/15 text-amber-600">Looking for a reserve</span>
                  )}
                </div>

                {/* interest list */}
                <div className="mt-3">
                  <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-medium">
                    Interested reserves ({offer.interests.length})
                  </div>
                  {offer.interests.length === 0 ? (
                    <p className="text-sm text-faint">No reserves yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {offer.interests.map((i) => (
                        <ReserveChip
                          key={i.driverId}
                          driverId={i.driverId}
                          name={i.name}
                          country={i.country}
                          highlight={offer.filledBy?.driverId === i.driverId}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* actions */}
                <div className="mt-3 border-t border-border pt-3">
                  {/* Offerer: pick a reserve / withdraw */}
                  {mine && (
                    <div className="space-y-2">
                      {offer.interests.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          {offer.interests.map((i) => {
                            const picked = offer.filledBy?.driverId === i.driverId;
                            return (
                              <div key={i.driverId} className="flex items-center justify-between gap-2">
                                <span className="text-sm text-dark">{i.name}</span>
                                <button
                                  className={picked ? "btn-secondary" : "btn-primary"}
                                  disabled={busy === `pick:${offer.id}:${i.driverId}`}
                                  onClick={() =>
                                    act(`pick:${offer.id}:${i.driverId}`, () =>
                                      api.pickReplacement(offer.id, picked ? null : i.driverId)
                                    )
                                  }
                                >
                                  {picked ? "Deselect" : "Choose"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <button
                        className="text-sm font-semibold text-primary hover:underline disabled:opacity-50"
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
                      {iAmInterested ? (
                        <>
                          <button
                            className="btn-secondary"
                            disabled={busy === `int:${offer.id}`}
                            onClick={() => act(`int:${offer.id}`, () => api.withdrawInterest(offer.id))}
                          >
                            Withdraw interest
                          </button>
                          {iAmPicked && (
                            <span className="text-sm font-semibold text-emerald-600">
                              You've been picked for this seat!
                            </span>
                          )}
                        </>
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

                  {/* Everyone else / logged out: read-only hint */}
                  {!mine && !me?.isReserve && (
                    <p className="text-xs text-faint">
                      {me
                        ? "Only reserve drivers can take this seat."
                        : "Sign in as a reserve driver to take a seat."}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
