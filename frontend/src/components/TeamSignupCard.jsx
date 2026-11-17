import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useDiscordLogin } from "../hooks/useDiscordLogin.js";
import { CheckField, Field } from "./ui.jsx";
import { SocialIcon } from "./SocialLinks.jsx";
import { useAsk } from "./overlay.jsx";

// The team sign-up on the home page (backend lib/teamSignups.js). Shows only
// while an admin has it open for the series being viewed: "Season 7: which
// team do you want, and who drives it?" A member fills in the team and the
// two drivers; on their own, they leave the second seat empty. Sending again
// changes their entry. The admins read them in the Team sign-ups tab.

const EMPTY = { teamName: "", driver1: "", driver2: "", note: "" };

export default function TeamSignupCard() {
  const state = useApi(useCallback(() => api.teamSignup(), []));
  const teams = useApi(useCallback(() => api.teams().catch(() => []), []));
  const { enabled: loginEnabled, start: startLogin } = useDiscordLogin();
  const ask = useAsk();
  const [mine, setMine] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [alone, setAlone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const data = state.data;
  useEffect(() => {
    setMine(data?.mine || null);
  }, [data]);

  if (!data?.open) return null;

  const label = data.label;
  const teamNames = [...new Set((teams.data || []).filter((t) => t.tier !== 0).map((t) => t.name))].sort();

  function openForm() {
    const from = mine || { ...EMPTY, driver1: data.myName || "" };
    setForm({
      teamName: from.teamName || "",
      driver1: from.driver1 || "",
      driver2: from.driver2 || "",
      note: from.note || "",
    });
    setAlone(!!mine && !mine.driver2);
    setError(null);
    setEditing(true);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveTeamSignup({ ...form, driver2: alone ? "" : form.driver2 });
      setMine(res.mine);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!(await ask({ title: "Take your sign-up back?", danger: true, confirmLabel: "Take it back" }))) return;
    setBusy(true);
    setError(null);
    try {
      await api.withdrawTeamSignup();
      setMine(null);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section className="reveal rounded-2xl border border-border bg-card p-5 shadow-lg shadow-ink/5 sm:p-6">
      <div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
              {data.seriesName ? `${data.seriesName} · ` : ""}
              {label}
            </div>
            <h2 className="mt-1 font-display text-xl font-black uppercase tracking-tight text-dark sm:text-2xl">Sign-up</h2>
            <p className="mt-1 max-w-xl text-sm text-medium">
              Tell us which team you want to drive for and who your teammate is. On your own for now? Just put yourself down.
            </p>
          </div>

          {!editing && (
            <div className="shrink-0">
              {!data.signedIn ? (
                loginEnabled ? (
                  <button
                    onClick={startLogin}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4752c4]"
                  >
                    <SocialIcon name="discord" className="h-5 w-5" />
                    Sign in to sign up
                  </button>
                ) : null
              ) : mine ? (
                <button onClick={openForm} className="btn-secondary text-sm">
                  Change
                </button>
              ) : (
                <button onClick={openForm} className="btn-primary text-sm">
                  Sign up
                </button>
              )}
            </div>
          )}
        </div>

        {mine && !editing && (
          <div className="mt-4 rounded-xl border border-border bg-white/60 p-4 dark:bg-white/[0.04]">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">You're signed up</div>
            <div className="mt-1 font-display text-lg font-extrabold uppercase tracking-tight text-dark">{mine.teamName}</div>
            <div className="mt-0.5 text-sm text-medium">
              {mine.driver1}
              {mine.driver2 ? ` and ${mine.driver2}` : ", looking for a teammate"}
            </div>
            {mine.note && <p className="mt-2 whitespace-pre-line text-sm text-light">{mine.note}</p>}
            <button onClick={withdraw} disabled={busy} className="mt-3 text-xs font-semibold text-light underline-offset-2 hover:text-bad hover:underline">
              Take it back
            </button>
          </div>
        )}

        {editing && (
          <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Team" required className="sm:col-span-2" hint="The team you want to drive for.">
              <input className="input w-full" value={form.teamName} onChange={set("teamName")} maxLength={60} list="team-signup-teams" autoComplete="off" />
            </Field>
            {teamNames.length > 0 && (
              <datalist id="team-signup-teams">
                {teamNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            )}
            <Field label="First driver" required>
              <input className="input w-full" value={form.driver1} onChange={set("driver1")} maxLength={60} autoComplete="off" />
            </Field>
            <Field label="Second driver" hint={alone ? "Left open. The admins know you're looking for a teammate." : null}>
              <input
                className="input w-full disabled:opacity-50"
                value={alone ? "" : form.driver2}
                onChange={set("driver2")}
                maxLength={60}
                disabled={alone}
                autoComplete="off"
              />
            </Field>
            <CheckField className="sm:col-span-2" checked={alone} onChange={(e) => setAlone(e.target.checked)} label="I don't have a teammate yet" />
            <Field label="Anything else" className="sm:col-span-2">
              <textarea className="input min-h-[4.5rem] w-full" value={form.note} onChange={set("note")} maxLength={500} placeholder="Optional" />
            </Field>
            {error && <p className="text-sm font-semibold text-warn sm:col-span-2">{error}</p>}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" disabled={busy} className="btn-primary text-sm">
                {busy ? "Sending…" : mine ? "Save changes" : "Send sign-up"}
              </button>
              <button type="button" onClick={() => setEditing(false)} disabled={busy} className="btn-secondary text-sm">
                Cancel
              </button>
            </div>
          </form>
        )}
        {!editing && error && <p className="mt-3 text-sm font-semibold text-warn">{error}</p>}
      </div>
    </section>
  );
}
