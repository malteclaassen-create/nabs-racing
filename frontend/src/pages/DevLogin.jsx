import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { PageHeader, Notice, ErrorBox } from "../components/ui.jsx";

// ---------------------------------------------------------------------------
// "Be somebody else for a minute" — development only.
//
// Both sides of an incident report are behind a Discord login, so trying the
// whole thing (A reports B, B answers, the stewards decide, both are told)
// needs two accounts. This hands out a real member session for any driver on
// the roster, with no password.
//
// It cannot reach the live site. The API half (backend/src/routes/devLogin.js)
// refuses anything that looks like a deployment AND anything that did not come
// from the loopback address, and this page is compiled out of the production
// bundle entirely — the route is behind import.meta.env.DEV in App.jsx, so
// `npm run build` removes it.
//
// Two browsers, or one browser and one private window: the session lives in
// localStorage, so two windows of the same profile share one login. That is the
// one thing worth knowing before wondering why the accused sees the reporter's
// view.
// ---------------------------------------------------------------------------

const USER_TOKEN_KEY = "nabs_user_token";

export default function DevLogin() {
  const navigate = useNavigate();
  const [drivers, setDrivers] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const who = (() => {
    try {
      return JSON.parse(localStorage.getItem("nabs_user") || "null");
    } catch {
      return null;
    }
  })();

  const load = useCallback(() => {
    fetch("/api/dev/drivers")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("The dev hatch is closed (not a local request)"))))
      .then((d) => setDrivers(d.drivers))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function be(d) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: d.id }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not sign in");
      const { token, user } = await res.json();
      // Exactly what the Discord callback stores, so everything downstream
      // (the nav chip, the report calls, the notification bell) behaves as if
      // this were a real login.
      localStorage.setItem(USER_TOKEN_KEY, token);
      localStorage.setItem("nabs_user", JSON.stringify(user));
      window.dispatchEvent(new Event("nabs-auth"));
      navigate("/");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    localStorage.removeItem(USER_TOKEN_KEY);
    localStorage.removeItem("nabs_user");
    window.dispatchEvent(new Event("nabs-auth"));
    navigate(0);
  }

  const list = (drivers || []).filter((d) => d.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <PageHeader
        eyebrow="Development only"
        title="Sign in as a driver"
        subtitle="No password. This page does not exist in a built site and the API behind it answers nothing but a request from this machine."
      />

      <Notice kind="warn">
        Signing in as a driver who has never used Discord writes a made-up Discord ID onto their row, so the
        person links and notifications have something to resolve. Fine on a dev database, not on a copy of the
        league&rsquo;s.
      </Notice>

      {error && <ErrorBox message={error} onRetry={load} />}

      <div className="card mt-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            Right now you are:{" "}
            <span className="font-semibold text-dark">{who?.driverName || who?.discordName || "signed out"}</span>
          </div>
          {who && (
            <button className="btn-secondary" onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </div>

      <input
        aria-label="Find a driver"
        className="input mt-5 w-full"
        placeholder="Find a driver…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {!drivers && !error && <p className="mt-4 text-sm text-light">Loading…</p>}

      <ul className="card mt-4 divide-y divide-border overflow-hidden">
        {list.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-dark">{d.name}</span>
            {d.discordUserId ? (
              <span className="font-mono text-[10px] uppercase tracking-wider text-faint">has a login</span>
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-wider text-light">no login yet</span>
            )}
            <button className="btn-secondary py-1.5 text-sm" disabled={busy} onClick={() => be(d)}>
              Be {d.name}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
