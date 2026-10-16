import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useSeries } from "../context/SeriesContext.jsx";

// ---------------------------------------------------------------------------
// Is Season Wrapped open to this visitor, and for which seasons? The league
// switches it on in stages (off, admins first, everyone: backend
// services/seasonWrappedService.js), and a season only has a Wrapped once it is
// over. The places that point at it (the Standings menu, the driver page, the
// finished season on Home) only show the way where both hold.
//
// Asked once per series and per sign-in, and shared: the answer moves about
// twice in the feature's life and once a season, and the menu is on every page.
// ---------------------------------------------------------------------------
const answers = new Map(); // series slug -> Promise<number[]> (empty when closed)

function useWrappedAnswer() {
  const { slug } = useSeries();
  const key = slug || "";
  const [seasons, setSeasons] = useState([]);
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
          .then((d) => (d?.open && Array.isArray(d.seasons) ? d.seasons : []))
          .catch(() => [])
      );
    }
    answers.get(key).then((v) => alive && setSeasons(v));
    return () => {
      alive = false;
    };
  }, [key, auth]);

  return seasons;
}

// The season numbers that have a Wrapped for this visitor (finished seasons,
// while it is open to them); empty otherwise.
export function useWrappedSeasons() {
  return useWrappedAnswer();
}

// Whether there is any Wrapped to point at.
export function useWrappedOpen() {
  return useWrappedAnswer().length > 0;
}
