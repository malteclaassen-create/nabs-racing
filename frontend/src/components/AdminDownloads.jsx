import { useCallback, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, CardBar, CardHead, Field, CheckField } from "./ui.jsx";
import Icon from "./InfoIcon.jsx";
import { useAsk } from "./overlay.jsx";
import { NO_VALUE } from "../utils/format.js";

const EMPTY = { title: "", folderId: "", raceId: "", version: "", description: "", installNote: "", fileName: "", externalUrl: "", sortOrder: 0, published: true };

const smallBtn = "flex h-7 w-7 items-center justify-center rounded-lg bg-surface2 text-medium transition hover:bg-border disabled:opacity-30";

// Folder manager: the folders group the public Downloads page (Tracks, Cars,
// one folder per event...). Files stay untouched when folders change.
function Folders({ folders, reload, onMsg }) {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [busy, setBusy] = useState(false);
  const ask = useAsk();

  async function run(fn) {
    setBusy(true);
    try { await fn(); reload(); }
    catch (e) { onMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    run(async () => {
      await api.createDownloadFolder({ name, sortOrder: folders.length });
      setNewName("");
    });
  };

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= folders.length) return;
    const order = [...folders];
    [order[i], order[j]] = [order[j], order[i]];
    run(async () => {
      for (let k = 0; k < order.length; k++) {
        if (order[k].sortOrder !== k) await api.updateDownloadFolder(order[k].id, { sortOrder: k });
      }
    });
  };

  const saveRename = () => {
    const { id, name } = renaming;
    if (!name.trim()) return;
    run(async () => {
      await api.updateDownloadFolder(id, { name: name.trim() });
      setRenaming(null);
    });
  };

  const remove = async (f) => {
    const ok = await ask({
      title: `Delete the folder "${f.name}"?`,
      body: 'The downloads inside are kept and move to "More files".',
      danger: true,
      confirmLabel: "Delete folder",
    });
    if (!ok) return;
    run(() => api.deleteDownloadFolder(f.id));
  };

  return (
    <div className="card p-5">
      <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Folders</h3>
      <p className="mt-1 text-sm text-light">
        Folders group the Downloads page for members, e.g. Tracks, Cars, or one folder per event.
      </p>

      {folders.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {folders.map((f, i) => (
            <li key={f.id} className="flex items-center gap-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-eyebrow">
                <Icon name="folder" className="h-4 w-4" />
              </span>
              {renaming?.id === f.id ? (
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    autoFocus
                    aria-label={`Folder name for ${f.name}`}
                    className="input"
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenaming(null); }}
                  />
                  <button onClick={saveRename} disabled={busy} className="transition rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary/90">Save</button>
                  <button onClick={() => setRenaming(null)} className="transition text-xs font-semibold text-light hover:text-dark">Cancel</button>
                </span>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate font-semibold text-dark">{f.name}</span>
                  <button onClick={() => move(i, -1)} disabled={busy || i === 0} className={smallBtn} title="Move up">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  </button>
                  <button onClick={() => move(i, 1)} disabled={busy || i === folders.length - 1} className={smallBtn} title="Move down">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
                  </button>
                  <button onClick={() => setRenaming({ id: f.id, name: f.name })} className="rounded-lg bg-surface2 px-3 py-1.5 text-xs font-semibold text-medium transition hover:bg-border">Rename</button>
                  <button onClick={() => remove(f)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-bad transition hover:bg-red-500/10">Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-2">
        <input
          aria-label="New folder name"
          className="input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }}
          placeholder="New folder name, e.g. Tracks"
        />
        <button onClick={create} disabled={busy || !newName.trim()} className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition hover:bg-primary/90 disabled:opacity-50">
          Create folder
        </button>
      </div>
    </div>
  );
}

export default function AdminDownloads() {
  const { data, loading, error, reload } = useApi(useCallback(() => api.adminDownloads(), []));
  // Files with no catalogue entry left. Everything the old "remove the entry,
  // keep the file" delete left behind is in here, plus any replaced upload.
  const orphans = useApi(useCallback(() => api.downloadOrphans(), []));
  // Races of the season being edited, for linking a replay to its round.
  const { data: racesData } = useApi(useCallback(() => api.races(), []));
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState(null); // { name, pct } while uploading
  const [flash, setFlash] = useState(false); // brief highlight on the form after a jump
  const formRef = useRef(null);
  const ask = useAsk();

  // "Register" and a finished upload both land the admin on the entry form —
  // scroll to the FORM itself (page top would show the folder manager instead)
  // and flash it so the next step is unmissable.
  function jumpToForm() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlash(true);
    setTimeout(() => setFlash(false), 1600);
  }

  const downloads = data?.downloads || [];
  const folders = data?.folders || [];
  const diskFiles = data?.diskFiles || [];
  const unregistered = diskFiles.filter((f) => !f.registered);
  const folderName = (id) => folders.find((f) => f.id === id)?.name || null;
  // Newest round first — that's the one whose replay is being added.
  const races = [...(racesData || [])].sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
  const raceLabel = (r) => `${r.isSpecialEvent || r.number == null ? "SE" : `R${r.number}`} · ${r.track}`;
  const raceName = (id) => {
    const r = races.find((x) => x.id === id);
    return r ? raceLabel(r) : null;
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  function startNew() { setForm(EMPTY); setEditingId(null); }
  function startEdit(d) {
    setEditingId(d.id);
    setMsg(null);
    setForm({
      title: d.title, folderId: d.folderId || "", raceId: d.raceId || "", version: d.version || "",
      description: d.description || "",
      installNote: d.installNote || "", fileName: d.fileName || "", externalUrl: d.externalUrl || "",
      sortOrder: d.sortOrder || 0, published: d.published,
    });
    jumpToForm();
  }

  // Picking a race turns the entry into that round's replay: prefill a title
  // when the field is still empty, so the catalogue reads consistently.
  function pickRace(raceId) {
    setForm((f) => {
      const race = races.find((r) => r.id === raceId);
      const title = f.title.trim() || (race ? `Replay ${raceLabel(race)}` : f.title);
      return { ...f, raceId, title: raceId ? title : f.title };
    });
  }

  async function save(e) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      // An address typed without a protocol ("drive.google.com/…") would open as
      // a relative path on our own site — default it to https.
      let url = (form.externalUrl || "").trim();
      if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
      const body = {
        ...form,
        folderId: form.folderId || null,
        raceId: form.raceId || null,
        externalUrl: url || null,
        fileName: form.fileName.trim() || null,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (!body.fileName && !body.externalUrl) {
        setMsg({ ok: false, text: "Pick a file on the server or paste an external link (one of the two)." });
        setBusy(false);
        return;
      }
      if (editingId) await api.updateDownload(editingId, body);
      else await api.createDownload(body);
      setMsg({ ok: true, text: editingId ? "Updated." : "Added." });
      startNew();
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;
    setMsg(null);
    setUpload({ name: file.name, pct: 0 });
    try {
      const res = await api.uploadDownloadFile(file, (pct) => setUpload({ name: file.name, pct }));
      setMsg({ ok: true, text: `Uploaded "${res.fileName}" (${res.sizeText}). One more step: register it so members can see it.` });
      // Jump straight into registering the freshly uploaded file.
      startNew();
      set("fileName", res.fileName);
      set("title", res.fileName.replace(/\.[^.]+$/, ""));
      reload();
      jumpToForm();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setUpload(null);
    }
  }

  // One question with three real answers, for entries that own a file: back
  // out, remove the entry but leave the file on disk, or remove both. This used
  // to be two chained yes/no boxes where cancelling the second one silently
  // meant "keep the file" — the same three outcomes, but you had to know that
  // Cancel was a choice rather than an escape. External links get the plain
  // two-button version: there is no file of ours to delete.
  async function remove(d) {
    let alsoFile = false;
    if (d.fileName) {
      const answer = await ask({
        title: `Remove "${d.title}" from the catalogue?`,
        body:
          `${d.fileName}${d.sizeText ? ` (${d.sizeText})` : ""}\n\n` +
          `Deleting the file frees the space. Keeping it leaves the file on disk and only removes the entry.`,
        danger: true,
        confirmLabel: "Remove entry and delete the file",
        thirdLabel: "Remove entry, keep the file",
      });
      if (!answer) return;
      alsoFile = answer === true;
    } else if (!(await ask({ title: `Remove "${d.title}" from the catalogue?`, danger: true, confirmLabel: "Remove entry" }))) {
      return;
    }
    try {
      const r = await api.deleteDownload(d.id, alsoFile);
      setMsg({
        ok: true,
        text: r?.fileDeleted ? `"${d.title}" and its file are gone.` : `"${d.title}" removed from the catalogue.`,
      });
      if (editingId === d.id) startNew();
      reload();
      orphans.reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  if (error) return <ErrorBox message={error} />;

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-surface2/60 px-4 py-3 text-sm text-medium">
        Three ways to add something: <b>upload a file below</b>, copy it into{" "}
        <code className="rounded bg-card px-1.5 py-0.5 text-xs">backend/downloads/</code> on the server, or register an{" "}
        <b>external link</b> to a file hosted elsewhere (Google Drive, Mega…). Then sort it into a folder. Members
        download everything from the <b>Race Info</b> page. File sizes are read live from disk.
      </div>

      {/* Folder management */}
      <Folders folders={folders} reload={reload} onMsg={setMsg} />

      {/* Files detected on disk */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Files on the server</h3>
          <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition hover:bg-primary/90 ${upload ? "pointer-events-none opacity-50" : ""}`}>
            <Icon name="upload" className="h-4 w-4" />
            {upload ? "Uploading…" : "Upload file"}
            <input type="file" className="hidden" onChange={uploadFile} disabled={!!upload} />
          </label>
        </div>

        {upload && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between font-mono text-[11px] text-light">
              <span className="min-w-0 truncate">{upload.name}</span>
              <span className="shrink-0 pl-2">{upload.pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface2">
              <div className="h-full rounded-full bg-primary transition-[width] duration-quick" style={{ width: `${upload.pct}%` }} />
            </div>
          </div>
        )}

        {diskFiles.length === 0 ? (
          <p className="mt-2 text-sm text-light">No files in <code>backend/downloads/</code> yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {diskFiles.map((f) => (
              <li key={f.fileName} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate font-mono text-sm text-dark">{f.fileName}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="font-mono text-xs text-light">{f.sizeText}</span>
                  {f.registered ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-ok">registered</span>
                  ) : (
                    <button
                      onClick={() => { startNew(); set("fileName", f.fileName); set("title", f.fileName.replace(/\.[^.]+$/, "")); jumpToForm(); }}
                      className="rounded-lg bg-link/10 px-2.5 py-1 text-[11px] font-bold text-link transition hover:bg-link/20"
                    >
                      Register
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {unregistered.length > 0 && (
          <p className="mt-2 text-xs text-light">{unregistered.length} file(s) on disk are not yet in the catalogue.</p>
        )}
      </div>

      {/* Create / edit form */}
      <form
        ref={formRef}
        onSubmit={save}
        className={`card scroll-mt-24 space-y-4 p-5 transition-shadow duration-slow ${
          flash ? "ring-2 ring-primary shadow-lg" : ""
        }`}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
            {editingId ? "Edit entry" : form.fileName ? "Register file" : "New entry"}
          </h3>
          {editingId && (
            <button type="button" onClick={startNew} className="transition text-xs font-semibold text-light hover:text-dark">
              Cancel edit
            </button>
          )}
        </div>

        {/* The not-yet-registered file the admin is working on right now. */}
        {!editingId && form.fileName && (
          <div className="rounded-lg bg-link/10 px-3 py-2 text-sm text-dark">
            You are registering <code className="rounded bg-card px-1.5 py-0.5 font-mono text-xs">{form.fileName}</code>.
            Pick a folder, give it a title, then hit <b>Add download</b>. Only then do members see it.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required>
            <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Real Penalty" required />
          </Field>
          <Field label="Folder">
            <select className="input" value={form.folderId} onChange={(e) => set("folderId", e.target.value)}>
              <option value="">No folder (shows under "More files")</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
          <Field
            label="Race (for replays)"
            hint={
              <>
                Marks this entry as that round&rsquo;s replay: it lands in the Replays folder automatically and the
                race gets a Replay button on the Races page.
              </>
            }
          >
            <select className="input" value={form.raceId} onChange={(e) => pickRace(e.target.value)}>
              <option value="">Not tied to a race</option>
              {races.map((r) => <option key={r.id} value={r.id}>{raceLabel(r)}</option>)}
            </select>
          </Field>
          <div>
            <Field label="File on server">
              <input list="dl-files" className="input" value={form.fileName} onChange={(e) => set("fileName", e.target.value)} placeholder="filename in backend/downloads/" />
            </Field>
            <datalist id="dl-files">{diskFiles.map((f) => <option key={f.fileName} value={f.fileName}>{f.sizeText}</option>)}</datalist>
          </div>
          <Field
            label="… or external link"
            hint={
              <>
                For files hosted elsewhere (Google Drive, Mega, the mod site…). Members get an &ldquo;Open link&rdquo; button
                instead of a download. Fill in either a file or a link, not both.
              </>
            }
          >
            {/* type=text on purpose: native url validation would block submit
                for "drive.google.com/…" before our https:// autofix can run */}
            <input
              type="text"
              inputMode="url"
              className="input"
              value={form.externalUrl}
              onChange={(e) => set("externalUrl", e.target.value)}
              placeholder="https://drive.google.com/…"
            />
          </Field>
          <Field label="Version">
            <input className="input" value={form.version} onChange={(e) => set("version", e.target.value)} placeholder="e.g. 1.2" />
          </Field>
        </div>

        <Field label="Description">
          <textarea className="input" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Short description shown on the card." />
        </Field>
        <Field label="Install note">
          <input className="input" value={form.installNote} onChange={(e) => set("installNote", e.target.value)} placeholder='e.g. "Uninstall old CSP first"' />
        </Field>

        <div className="flex flex-wrap items-center gap-6">
          <Field label="Sort order" className="w-28">
            <input type="number" className="input" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
          </Field>
          <CheckField
            className="mt-5"
            checked={form.published}
            onChange={(e) => set("published", e.target.checked)}
            label="Published (visible to members)"
          />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition hover:bg-primary/90 disabled:opacity-50">
            {busy ? "Saving…" : editingId ? "Save changes" : "Add download"}
          </button>
          {msg && <span className={`text-sm font-medium ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</span>}
        </div>
      </form>

      {/* Existing entries */}
      <div className="card overflow-hidden">
        <CardBar as="h3" title={<>Catalogue {downloads.length > 0 && <span className="font-mono text-xs text-light">({downloads.length})</span>}</>} />
        {loading ? (
          <p className="p-5 text-sm text-light">Loading…</p>
        ) : downloads.length === 0 ? (
          <p className="p-5 text-sm text-light">No entries yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {downloads.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display font-bold uppercase tracking-tight text-dark">{d.title}</span>
                    <span className="inline-flex items-center gap-1 rounded bg-surface2 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-light">
                      <Icon name="folder" className="h-3 w-3" />
                      {folderName(d.folderId) || "More files"}
                    </span>
                    {d.raceId && (
                      <span className="rounded bg-link/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-link">
                        {raceName(d.raceId) || "Replay"}
                      </span>
                    )}
                    {!d.published && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">hidden</span>}
                    {!d.fileExists && !d.externalUrl && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-bad">file missing</span>}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-light">
                    {d.fileName || d.externalUrl || NO_VALUE}{d.sizeText ? ` · ${d.sizeText}` : ""}{d.version ? ` · v${d.version}` : ""}
                  </div>
                </div>
                <button onClick={() => startEdit(d)} className="rounded-lg bg-surface2 px-3 py-1.5 text-xs font-semibold text-medium transition hover:bg-border">Edit</button>
                <button onClick={() => remove(d)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-bad transition hover:bg-red-500/10">Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <OrphanFiles orphans={orphans} onMessage={setMsg} />
    </div>
  );
}

// Files sitting in the downloads folder that no catalogue entry points at.
//
// They are the residue of years of "remove the entry, keep the file": every
// replaced pack and every mistaken upload is still on the volume, and nothing in
// the admin could show them. Hidden entirely when there are none, so this only
// appears when there is genuinely something to clean up.
function OrphanFiles({ orphans, onMessage }) {
  const [busy, setBusy] = useState(null);
  const ask = useAsk();
  const files = orphans.data?.files || [];
  if (orphans.loading || orphans.error || files.length === 0) return null;

  async function wipe(f) {
    const ok = await ask({
      title: `Delete "${f.fileName}" (${f.sizeText}) from the server?`,
      body: "No download in the catalogue uses this file. This frees the space and cannot be undone.",
      danger: true,
      confirmLabel: "Delete file",
    });
    if (!ok) return;
    setBusy(f.fileName);
    try {
      await api.deleteDownloadOrphan(f.fileName);
      onMessage?.({ ok: true, text: `${f.fileName} deleted.` });
      orphans.reload();
    } catch (e) {
      onMessage?.({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card p-5">
      <CardHead eyebrow="Clean-up" title={`Unused files (${files.length})`} />
      <p className="-mt-2 mb-4 text-sm text-light">
        These sit in the downloads folder but no entry in the catalogue uses them, so nobody can
        reach them. Together they take {orphans.data?.totalBytes ? fmtBytes(orphans.data.totalBytes) : "space"} on
        the server.
      </p>
      <ul className="divide-y divide-border">
        {files.map((f) => (
          <li key={f.fileName} className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs text-medium">{f.fileName}</span>
              <span className="block font-mono text-[11px] text-light">{f.sizeText}</span>
            </span>
            <button
              onClick={() => wipe(f)}
              disabled={busy === f.fileName}
              className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-bad transition hover:bg-red-500/10 disabled:opacity-50"
            >
              {busy === f.fileName ? "Deleting…" : "Delete file"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function fmtBytes(n) {
  if (n > 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
