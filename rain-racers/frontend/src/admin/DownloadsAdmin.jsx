import { useRef, useState } from "react";
import { api } from "../api.js";
import { fileSize } from "../format.js";
import { useAdminList, useAction, Message, Section, Field, confirmDelete } from "./common.jsx";

export default function DownloadsAdmin() {
  const { data, reload } = useAdminList("/admin/downloads");
  const { busy, message, run } = useAction();
  const [link, setLink] = useState({ title: "", url: "", description: "" });
  const [upload, setUpload] = useState({ title: "", description: "" });
  const fileRef = useRef(null);

  async function move(index, dir) {
    const list = [...data];
    const [item] = list.splice(index, 1);
    list.splice(index + dir, 0, item);
    await run(() => Promise.all(list.map((d, i) => api.put(`/admin/downloads/${d.id}`, { order: i }))));
    reload();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Add a link">
          <p className="mb-4 text-sm text-muted">For car and track packs: put them on Google Drive, Dropbox or similar and add the link here.</p>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api.post("/admin/downloads/link", link), "Link added.")) {
                setLink({ title: "", url: "", description: "" });
                reload();
              }
            }}
          >
            <Field label="Title">
              <input className="input" value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} />
            </Field>
            <Field label="Link">
              <input className="input" placeholder="https://" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} />
            </Field>
            <Field label="Description (optional)">
              <input className="input" value={link.description} onChange={(e) => setLink({ ...link, description: e.target.value })} />
            </Field>
            <button className="btn-accent" disabled={busy || !link.title || !link.url}>
              Add link
            </button>
          </form>
        </Section>
        <Section title="Upload a file">
          <p className="mb-4 text-sm text-muted">Small files like setups or a skin pack. Large files fill up the server's storage, so use a link for those.</p>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const file = fileRef.current?.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.append("title", upload.title);
              form.append("description", upload.description);
              form.append("file", file);
              if (await run(() => api.post("/admin/downloads/file", form), "File uploaded.")) {
                setUpload({ title: "", description: "" });
                fileRef.current.value = "";
                reload();
              }
            }}
          >
            <Field label="Title (optional, else the file name)">
              <input className="input" value={upload.title} onChange={(e) => setUpload({ ...upload, title: e.target.value })} />
            </Field>
            <Field label="Description (optional)">
              <input className="input" value={upload.description} onChange={(e) => setUpload({ ...upload, description: e.target.value })} />
            </Field>
            <input ref={fileRef} type="file" className="block text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-line file:px-3 file:py-2 file:text-ink" />
            <button className="btn-accent" disabled={busy}>
              {busy ? "Uploading…" : "Upload"}
            </button>
          </form>
        </Section>
      </div>
      <Message message={message} />
      <Section title="Downloads">
        <ul className="divide-y divide-line">
          {data?.map((d, i) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <div className="flex flex-col">
                <button className="text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  ▲
                </button>
                <button className="text-muted hover:text-ink disabled:opacity-30" disabled={i === data.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  ▼
                </button>
              </div>
              <div className="min-w-0">
                <div className="font-semibold">{d.title}</div>
                <div className="truncate text-xs text-muted">{d.fileName ? `File · ${fileSize(d.sizeBytes)}` : d.url}</div>
              </div>
              <button className="btn-danger ml-auto py-1" onClick={() => confirmDelete(`"${d.title}"`) && run(() => api.del(`/admin/downloads/${d.id}`)).then(reload)}>
                Delete
              </button>
            </li>
          ))}
          {data?.length === 0 && <li className="py-3 text-sm text-muted">No downloads yet.</li>}
        </ul>
      </Section>
    </div>
  );
}
