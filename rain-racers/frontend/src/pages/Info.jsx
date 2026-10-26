import { useSite, useApi } from "../site.jsx";
import { PageHeader, Empty } from "../components/ui.jsx";
import { fileSize } from "../format.js";

// The rules text from the admin. Deliberately tiny "markdown": "# " heading,
// "## " subheading, "- " list item, blank line = new paragraph. Rendered as
// React elements, so nothing in the text can turn into HTML.
function Rules({ text }) {
  const blocks = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length} className="text-muted">{para.join(" ")}</p>);
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(<ul key={blocks.length} className="list-disc space-y-1 pl-5 text-muted marker:text-accent">{list}</ul>);
    list = null;
  };
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("- ")) {
      flushPara();
      (list ??= []).push(<li key={list.length}>{line.slice(2)}</li>);
    } else if (line.startsWith("## ")) {
      flushPara();
      flushList();
      blocks.push(<h3 key={blocks.length} className="pt-2 text-base font-black uppercase italic">{line.slice(3)}</h3>);
    } else if (line.startsWith("# ")) {
      flushPara();
      flushList();
      blocks.push(<h2 key={blocks.length} className="h2 pt-4 text-xl first:pt-0">{line.slice(2)}</h2>);
    } else if (!line) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="space-y-3 leading-relaxed">{blocks}</div>;
}

export default function Info() {
  const { settings } = useSite();
  const { data: downloads } = useApi("/downloads");

  return (
    <div>
      <PageHeader eyebrow={settings.leagueName} title="Race Info" />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="card p-6 sm:p-8">
          {settings.rules?.trim() ? <Rules text={settings.rules} /> : <p className="text-muted">No rules written yet.</p>}
        </section>
        <section>
          <h2 className="h2 mb-3">Downloads</h2>
          {!downloads ? null : downloads.length === 0 ? (
            <Empty>Nothing to download yet.</Empty>
          ) : (
            <ul className="space-y-3">
              {downloads.map((d) => (
                <li key={d.id}>
                  <a
                    href={d.url}
                    target={d.isFile ? undefined : "_blank"}
                    rel="noopener noreferrer"
                    className="card flex items-center gap-4 p-4 transition hover:border-accent/50"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {d.isFile ? <path d="M12 3v12m0 0l-5-5m5 5l5-5M4 21h16" /> : <path d="M10 14L21 3m0 0h-7m7 0v7M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />}
                      </svg>
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold">{d.title}</span>
                      {d.description && <span className="block text-sm text-muted">{d.description}</span>}
                      {d.sizeBytes && <span className="block text-xs text-muted">{fileSize(d.sizeBytes)}</span>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
