import { useEffect, useState } from "react";

// Whether the promo page (components/EventPromo.jsx) is up. It sets
// <html data-promo="open"> while it is, and fires "nabs-promo" on open and
// close; a film that should be watched (the event's main card) waits for it.
export function promoOpen() {
  return typeof document !== "undefined" && document.documentElement.dataset.promo === "open";
}

export function usePromoOpen() {
  const [open, setOpen] = useState(promoOpen);
  useEffect(() => {
    const sync = () => setOpen(promoOpen());
    sync();
    window.addEventListener("nabs-promo", sync);
    return () => window.removeEventListener("nabs-promo", sync);
  }, []);
  return open;
}
