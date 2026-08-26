import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Field, Notice } from "./ui.jsx";

// The four fields on the public /privacy page that are a league decision, not a
// description of the software: who is responsible, how to reach them, and what
// the Android app is called (see backend/src/lib/privacyInfo.js for why these
// four and no others).
//
// Deliberately a plain form with no cleverness: the person filling it in is
// doing it once, probably under mild time pressure, because an app store or a
// member asked. What it does add is the consequence of each field, written out,
// so nobody has to guess what happens on the public page.

const EMPTY = { controllerName: "", controllerAddress: "", controllerEmail: "", appName: "" };
const APP_EMPTY = { packageName: "", fingerprints: "" };

export default function AdminPrivacy() {
  const { data, loading, error } = useApi(useCallback(() => api.adminPrivacyInfo(), []));
  const android = useApi(useCallback(() => api.adminAndroidApp(), []));
  const [form, setForm] = useState(null);
  // The fingerprint list is edited as text, one per line, because that is how
  // Play Console and keytool print them and pasting several at once is the
  // normal case. The server does the parsing.
  const [app, setApp] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !error && !form) setForm({ ...EMPTY, ...(data || {}) });
  }, [loading, error, data, form]);

  useEffect(() => {
    if (!android.loading && !android.error && !app) {
      setApp({
        packageName: android.data?.packageName || "",
        fingerprints: (android.data?.fingerprints || []).join("\n"),
      });
    }
  }, [android.loading, android.error, android.data, app]);

  if (error) return <ErrorBox message={error} />;
  if (loading || !form || !app) return <p className="text-sm text-light">Loading…</p>;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // The public page only shows a named contact once one of these two is filled
  // in; the address alone would leave people with nobody to write to.
  const contactShown = !!(form.controllerName.trim() || form.controllerEmail.trim());

  // Both halves go in one press. The app half can be REJECTED (a mistyped
  // package name or fingerprint is worth an error rather than a silent save),
  // so it goes second: a rejection then leaves the contact details already
  // stored rather than losing them along with the typo.
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.savePrivacyInfo(form);
      await api.saveAndroidApp({
        packageName: app.packageName,
        fingerprints: app.fingerprints,
      });
      android.reload?.();
      setMsg({ ok: true, text: "Saved. The privacy page shows it right away." });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-surface2/60 px-4 py-3 text-sm leading-relaxed text-medium">
        These fill in the public{" "}
        <Link to="/privacy" className="font-semibold text-link hover:underline">
          privacy page
        </Link>
        . The rest of that page describes what the site actually does with data and is kept in step
        with the code, so it needs no editing here. Leave a field empty and the page simply leaves
        that part out.
      </div>

      <div className="card space-y-4 p-5">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
          Who is responsible
        </h3>
        <p className="text-sm leading-relaxed text-light">
          The person or organisation answerable for the site. Until a name or an email is here, the
          page tells readers the contact is still being settled and points them at Discord instead.
        </p>
        <Field label="Name" hint="A person or the league itself, e.g. “NABS Racing League, Jane Doe”.">
          <input
            className="input"
            value={form.controllerName}
            onChange={(e) => set("controllerName", e.target.value)}
            placeholder="Not filled in yet"
          />
        </Field>
        <Field label="Postal address" hint="Optional. Shown as written, on one line.">
          <input
            className="input"
            value={form.controllerAddress}
            onChange={(e) => set("controllerAddress", e.target.value)}
            placeholder="Not filled in yet"
          />
        </Field>
        <Field
          label="Email for privacy requests"
          hint="Becomes a clickable link on the page. Use an address someone actually reads."
        >
          <input
            className="input"
            value={form.controllerEmail}
            onChange={(e) => set("controllerEmail", e.target.value)}
            placeholder="Not filled in yet"
          />
        </Field>
        {!contactShown && (
          <Notice kind="info">
            No contact yet, so the page currently says it is being finalised. That is fine for now,
            but an app store listing will not be accepted without one.
          </Notice>
        )}
      </div>

      <div className="card space-y-4 p-5">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
          The Android app
        </h3>
        <p className="text-sm leading-relaxed text-light">
          Only needed if the site is published to Google Play. Play requires the privacy policy to
          name the app itself, not just the website. Fill this in with the exact name used in the
          store listing, and the page names it. Empty means the page talks about the website only,
          which is right until the app exists.
        </p>
        <Field label="App name" hint="Exactly as it appears in the store, e.g. “NABS Racing”.">
          <input
            className="input"
            value={form.appName}
            onChange={(e) => set("appName", e.target.value)}
            placeholder="No app published"
          />
        </Field>

        <div className="border-t border-border pt-4">
          <h4 className="font-display text-sm font-extrabold uppercase tracking-tight text-dark">
            Link the app to this domain
          </h4>
          <p className="mt-1 text-sm leading-relaxed text-light">
            The Play Store version is this site running full screen inside the app. It only gets to
            hide the browser's address bar if this domain vouches for the app, which happens through
            a small file the two fields below produce. Get both values from Play Console (Setup →
            App integrity, where the signing certificate's SHA-256 fingerprint is shown). Without
            them the app still works, it just carries a browser bar across the top.
          </p>
        </div>
        <Field label="Package name" hint="From Play Console, e.g. “com.nabsracing.app”. Cannot be changed after the app is published.">
          <input
            className="input"
            value={app.packageName}
            onChange={(e) => setApp((a) => ({ ...a, packageName: e.target.value }))}
            placeholder="com.example.app"
          />
        </Field>
        <Field
          label="SHA-256 signing fingerprints"
          hint="One per line. Usually two: the key you signed the upload with, and Google's own key from Play App Signing. Pasting them with or without colons is fine."
        >
          <textarea
            className="input font-mono text-xs"
            rows={4}
            value={app.fingerprints}
            onChange={(e) => setApp((a) => ({ ...a, fingerprints: e.target.value }))}
            placeholder="AA:BB:CC:…"
          />
        </Field>
        {android.data?.packageName && android.data?.fingerprints?.length ? (
          <Notice kind="success">
            The domain is vouching for {android.data.packageName} with{" "}
            {android.data.fingerprints.length === 1
              ? "one fingerprint"
              : `${android.data.fingerprints.length} fingerprints`}.{" "}
            <a
              className="underline"
              href="/.well-known/assetlinks.json"
              target="_blank"
              rel="noopener noreferrer"
            >
              Check the file
            </a>
            .
          </Notice>
        ) : (
          <Notice kind="info">
            No verification file is being served yet. Both fields above are needed before it appears.
          </Notice>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-brand px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-ink transition hover:brightness-105 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && <Notice kind={msg.ok ? "success" : "error"}>{msg.text}</Notice>}
      </div>
    </div>
  );
}
