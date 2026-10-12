import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Skeleton } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";

// ---------------------------------------------------------------------------
// The iPhone widgets' switch: who sees the Widgets section of the profile.
//
// Admins try the widgets out first, so the section starts as theirs alone.
// When the widgets are ready this opens it to every member, and it can be
// closed again the same way (backend lib/widgetsPage.js). The widgets already
// on somebody's phone keep working either way: this is about the page only.
// ---------------------------------------------------------------------------

export default function AdminWidgets() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.widgetsVisibility(), []));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const ask = useAsk();
  const isPublic = data?.public === true;

  async function flip() {
    const next = !isPublic;
    const ok = await ask(
      next
        ? {
            title: "Show the widgets to every member?",
            body: "Every member gets a Widgets entry in their profile menu: all the iPhone widgets with their own numbers, and how to install them. It can be switched back.",
            confirmLabel: "Show everyone",
          }
        : {
            title: "Back to admins only?",
            body: "The Widgets entry disappears from the members' profile menu. Widgets already on their phones keep working.",
            confirmLabel: "Admins only",
          }
    );
    if (!ok) return;
    setBusy(true);
    setFailed(null);
    try {
      await api.setWidgetsVisibility(next);
      reload();
    } catch (e) {
      setFailed(e?.message || "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton className="h-40 w-full rounded-xl" />;

  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Profile · Widgets</div>
          <h3 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">iPhone widgets</h3>
        </div>
        <span className={`pill ${isPublic ? "bg-emerald-500/15 text-ok" : "bg-amber-500/15 text-warn"}`}>
          {isPublic ? "Visible to members" : "Admins only"}
        </span>
      </div>
      <p className="text-sm text-light">
        The Widgets section in the profile menu shows every iPhone widget with the member&rsquo;s own numbers and
        explains how to install them with Scriptable.{" "}
        {isPublic
          ? "Every member sees it now."
          : "Right now only admins see it, so the widgets can be tried out before the league gets them."}
      </p>
      <p className="text-sm text-light">
        Only the page is switched. The widgets themselves and the installer work for anyone who has them, either
        way.
      </p>
      {failed && <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">{failed}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={isPublic ? "btn-secondary" : "btn-primary"} onClick={flip} disabled={busy}>
          {busy ? "Saving…" : isPublic ? "Back to admins only" : "Publish to every member"}
        </button>
        <Link to="/profile?tab=widgets" className="text-sm font-semibold text-link hover:underline">
          Open the Widgets section →
        </Link>
      </div>
    </section>
  );
}
