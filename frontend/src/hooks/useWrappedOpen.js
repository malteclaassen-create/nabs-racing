import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useSeries } from "../context/SeriesContext.jsx";

// ---------------------------------------------------------------------------
// Is Season Wrapped open to this visitor? The league switches it on in stages
// (off, admins first, everyone: backend services/seasonWrappedService.js), and
// the places that point at it (the Standings menu, the driver page, the
// finished season on Home) only show the way once it is.
//
// Asked once per series and per sign-in, and shared: the answer moves about
// twice in the feature's life, and the menu is on every page.
// ---------------------------------------------------------------------------
const answers = new Map(); // series slug -> Promise<boolean>

export function useWrappedOpen() {
  const { slug } = useSeries();
  const key = slug || "";
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState(0);

  // An admin signing in (or out) is a different answer while it is admins-only.
  useEffect(() => {
    const bump = () => {
      answers.clear();
      setAuth((n) => n + 1);
    };
    window.addEventListener("nabs-auth", bump);
    return () => window.removeEventListener("nabs-auth", bump);
  }, []);

  useEffect(() => {
    let alive = true;
    if (!answers.has(key)) {
      answers.set(
        key,
        api
          .wrappedStatus()
          .then((d) => !!d?.open)
          .catch(() => false)
      );
    }
    answers.get(key).then((v) => alive && setOpen(v));
    return () => {
      alive = false;
    };
  }, [key, auth]);

  return open;
}
