import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Notice, Spinner, CardHead, EmptyState } from "../components/ui.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";
import NewsBody from "../components/NewsBody.jsx";
import { useUnsavedGuard, UnsavedHint } from "../hooks/useUnsavedGuard.js";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { fmtStamp } from "../utils/format.js";
import { CategoryChip, NewsCover, useNewsDeskAccess } from "./News.jsx";

// ---------------------------------------------------------------------------
// /news/desk — where the news is written (backend routes/news.js).
//
// Open to league admins and to the members an admin named a news writer. The
// list shows drafts first: after every saved round the site drafts that
// round's race report by itself (backend lib/newsRaceReport.js) and it waits
// here for a writer to add the stories and publish. /news/desk/new and
// /news/desk/:id are the editor.
// ---------------------------------------------------------------------------

const MODE_TEXT = {
  off: "Off. The site writes nothing by itself. The Write draft button above still works for any round.",
  draft:
    "Draft. After each saved round the site writes the race report from the results and leaves it here as a draft. Nothing is public until somebody presses publish.",
  publish: "Publish. The race report goes live by itself the moment the results are saved.",
};

function DeskSettings() {
  const { data, error, reload } = useApi(useCallback(() => api.newsDeskSettings(), []));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setFound([]);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(() => {
      api
        .newsDeskMembers(q.trim())
        .then((d) => alive && setFound(d.members || []))
        .catch(() => alive && setFound([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  async function save(body, note) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.saveNewsDeskSettings(body);
      setMsg(note);
      reload();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  const ids = data.writers.map((w) => w.discordId);

  return (
    <div className="card space-y-5 p-5">
      <CardHead eyebrow="Admins only" title="Desk settings" />
      {err && <ErrorBox message={err} />}
      {msg && <Notice kind="success">{msg}</Notice>}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-bold text-dark">Automatic race reports</div>
          <SlidingTabs
            items={[
              { key: "off", label: "Off" },
              { key: "draft", label: "Draft" },
              { key: "publish", label: "Publish" },
            ]}
            value={data.mode}
            onChange={(m) => !busy && m !== data.mode && save({ mode: m }, "Saved.")}
            wrapClassName="inline-flex rounded-xl border border-border bg-surface2/60 p-1"
            btnClassName="px-3 py-1.5 text-[13px]"
          />
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-light">{MODE_TEXT[data.mode]}</p>
        <p className="mt-1 max-w-2xl text-xs text-faint">
          Whether anybody gets a bell for a new article or a waiting draft is set with the other notifications (Admin,
          Notifications: News articles, Race report drafts). Both are off until switched on.
        </p>
      </div>

      <div>
        <div className="text-sm font-bold text-dark">News writers</div>
        <p className="mt-1 max-w-2xl text-sm text-light">
          Members who may write and publish articles without being admins. They sign in with Discord as usual and find
          the News desk button on the news page.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {data.writers.map((w) => (
            <li key={w.discordId} className="flex items-center gap-2 rounded-lg border border-border bg-surface2/60 px-3 py-1.5 text-sm">
              <span className="font-semibold text-dark">{w.name || w.discordId}</span>
              <button
                type="button"
                className="text-xs font-bold text-light hover:text-dark"
                disabled={busy}
                aria-label={`Remove ${w.name || w.discordId}`}
                onClick={() => save({ writers: ids.filter((id) => id !== w.discordId) }, `${w.name || "Writer"} removed.`)}
              >
                ✕
              </button>
            </li>
          ))}
          {!data.writers.length && <li className="text-sm text-faint">No writers yet. Admins can always write.</li>}
        </ul>
        <div className="relative mt-3 max-w-sm">
          <input
            className="input w-full py-1.5 text-sm"
            placeholder="Add a writer: type a Discord name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {found.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
              {found.map((m) => (
                <li key={m.discordId}>
                  <button
                    type="button"
                    disabled={busy || ids.includes(m.discordId)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface2 disabled:opacity-50"
                    onClick={() => {
                      setQ("");
                      save({ writers: [...ids, m.discordId] }, `${m.name} can write now.`);
                    }}
                  >
                    <span className="font-semibold text-dark">{m.name}</span>
                    <span className="text-xs text-light">@{m.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function RaceReportStarter() {
  const navigate = useNavigate();
  const { data } = useApi(useCallback(() => api.newsDeskRounds(), []));
  const [raceId, setRaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const rounds = data?.rounds || [];

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const { article } = await api.draftNewsRaceReport(raceId);
      navigate(`/news/desk/${article.id}`);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3 p-5">
      <CardHead eyebrow="Head start" title="Race report from the results" />
      <p className="text-sm text-light">
        Pick a round and the site writes the facts for you: winner, podium, pole, the biggest climber, fastest lap,
        retirements and the championship. You add the rest.
      </p>
      {err && <ErrorBox message={err} />}
      <div className="flex flex-wrap items-center gap-3">
        <select className="input max-w-[22rem] py-1.5 text-sm" value={raceId} onChange={(e) => setRaceId(e.target.value)} aria-label="Round">
          <option value="">Choose a round…</option>
          {rounds.map((r) => (
            <option key={r.id} value={r.id}>
              {r.season != null ? `S${r.season} ` : ""}
              {r.number != null ? `R${r.number} · ` : ""}
              {r.track}
              {r.date ? ` · ${fmtStamp(r.date)}` : ""}
            </option>
          ))}
        </select>
        <button type="button" className="btn-primary" disabled={!raceId || busy} onClick={start}>
          {busy ? "Writing…" : "Write draft"}
        </button>
      </div>
    </div>
  );
}

function DeskList() {
  useSpecificTitle("News desk · NABS Racing League");
  const access = useNewsDeskAccess();
  const { data, error, reload } = useApi(useCallback(() => api.newsDesk(), []));

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const articles = data.articles || [];

  return (
    <div className="content-in space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <Link to="/news" className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow hover:underline">
            ← News
          </Link>
          <h1 className="mt-1 font-display text-3xl font-extrabold uppercase tracking-tight text-dark">News desk</h1>
        </div>
        <Link to="/news/desk/new" className="btn-primary">
          New article
        </Link>
      </div>

      <RaceReportStarter />

      <div className="card overflow-hidden">
        {!articles.length ? (
          <EmptyState title="Nothing written yet" hint="Start one above, or wait for the next round's automatic draft." className="p-6" />
        ) : (
          <ul className="divide-y divide-border">
            {articles.map((a) => (
              <li key={a.id}>
                <Link to={`/news/desk/${a.id}`} className="flex items-center gap-4 p-3 hover:bg-surface2/60">
                  <div className="h-14 w-24 shrink-0 overflow-hidden rounded-md bg-surface2">
                    <NewsCover article={a} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                          a.status === "PUBLISHED" ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"
                        }`}
                      >
                        {a.status === "PUBLISHED" ? "Live" : "Draft"}
                      </span>
                      <CategoryChip category={a.category} label={a.categoryLabel} />
                      {a.source === "AUTO" && <span className="font-mono text-[10px] text-faint">written by the site</span>}
                    </div>
                    <div className="mt-1 truncate font-bold text-dark">{a.title}</div>
                    <div className="text-xs text-light">
                      {a.authorName ? `${a.authorName} · ` : ""}
                      {a.status === "PUBLISHED" ? `published ${fmtStamp(a.publishedAt)}` : `edited ${fmtStamp(a.updatedAt)}`}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {access.admin && <DeskSettings />}
    </div>
  );
}

const FORMAT_HELP = [
  ["## Heading", "a section heading"],
  ["**bold**  *italic*", "emphasis"],
  ["[words](https://…)", "a link"],
  ["- item", "a list (1. for numbered)"],
  ["> words", "a quote"],
  ["![caption](picture address)", "a picture on its own line"],
];

const EMPTY = { title: "", summary: "", body: "", category: "RACES", coverUrl: "", status: "DRAFT" };

function Editor({ id }) {
  const navigate = useNavigate();
  const isNew = id === "new";
  const [categories, setCategories] = useState({});
  const [saved, setSaved] = useState(isNew ? EMPTY : null);
  const [form, setForm] = useState(isNew ? EMPTY : null);
  const [meta, setMeta] = useState(null); // slug, raceId, source, status as stored
  const [tab, setTab] = useState("write");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [photos, setPhotos] = useState([]);
  const fileRef = useRef(null);
  const bodyRef = useRef(null);
  useSpecificTitle(isNew ? "New article · NABS News" : "Edit article · NABS News");

  useEffect(() => {
    api
      .newsDesk()
      .then((d) => setCategories(d.categories || {}))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isNew) return undefined;
    let alive = true;
    api
      .newsDeskArticle(id)
      .then(({ article }) => {
        if (!alive) return;
        const f = {
          title: article.title,
          summary: article.summary || "",
          body: article.body || "",
          category: article.category,
          coverUrl: article.coverUrl || "",
          status: article.status,
        };
        setSaved(f);
        setForm(f);
        setMeta(article);
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [id, isNew]);

  // A race report can take its cover from that round's gallery.
  useEffect(() => {
    if (!meta?.raceId) return undefined;
    let alive = true;
    api
      .raceResults(meta.raceId)
      .then((d) => alive && setPhotos((d.photos || []).slice(0, 12)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [meta?.raceId]);

  const dirty = !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved);
  useUnsavedGuard(dirty, "the article");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(status) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const body = { ...form, status: status || form.status };
    try {
      const { article } = isNew ? await api.createNewsArticle(body) : await api.updateNewsArticle(id, body);
      const f = { ...body, coverUrl: article.coverUrl || "", status: article.status };
      setSaved(f);
      setForm(f);
      setMeta(article);
      setMsg(
        article.status === "PUBLISHED"
          ? status === "PUBLISHED" && saved?.status !== "PUBLISHED"
            ? "Published."
            : "Saved. The live article is updated."
          : status === "DRAFT" && saved?.status === "PUBLISHED"
            ? "Taken offline. It is a draft again."
            : "Draft saved."
      );
      if (isNew) navigate(`/news/desk/${article.id}`, { replace: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this article for good?")) return;
    setBusy(true);
    try {
      await api.deleteNewsArticle(id);
      setSaved(form); // nothing left to lose
      navigate("/news/desk");
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  async function uploadCover(file) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const { url } = await api.uploadNewsCover(file);
      setForm((f) => ({ ...f, coverUrl: url }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Puts a picture into the text where the cursor is, as its own line.
  async function insertPicture(file) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const { url } = await api.uploadNewsCover(file);
      const el = bodyRef.current;
      setForm((f) => {
        const at = el ? el.selectionStart : f.body.length;
        const before = f.body.slice(0, at).replace(/\s*$/, "");
        const after = f.body.slice(at).replace(/^\s*/, "");
        return { ...f, body: `${before}${before ? "\n\n" : ""}![](${url})\n\n${after}` };
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (err && !form) return <ErrorBox message={err} />;
  if (!form) return <Spinner />;
  const live = saved?.status === "PUBLISHED";

  return (
    <div className="content-in mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/news/desk" className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow hover:underline">
          ← News desk
        </Link>
        <div className="flex items-center gap-3">
          <UnsavedHint dirty={dirty} />
          {live && meta?.slug && (
            <Link to={`/news/${meta.slug}`} className="text-sm font-semibold text-link hover:underline">
              View live
            </Link>
          )}
        </div>
      </div>

      {err && <ErrorBox message={err} />}
      {msg && <Notice kind="success">{msg}</Notice>}
      {meta?.source === "AUTO" && !live && (
        <Notice kind="info">
          The site wrote this draft from the results. Make it yours: add what happened out there, then publish.
        </Notice>
      )}

      <div className="card space-y-4 p-5">
        <input
          className="input w-full font-display text-xl font-extrabold"
          placeholder="Headline"
          value={form.title}
          maxLength={120}
          onChange={set("title")}
          aria-label="Headline"
        />
        <div className="flex flex-wrap gap-3">
          <select className="input py-1.5 text-sm" value={form.category} onChange={set("category")} aria-label="Category">
            {Object.entries(categories).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
            {!categories[form.category] && <option value={form.category}>{form.category}</option>}
          </select>
        </div>
        <textarea
          className="input w-full text-sm"
          rows={2}
          maxLength={280}
          placeholder="Teaser: one or two sentences for the card on the news page"
          value={form.summary}
          onChange={set("summary")}
          aria-label="Teaser"
        />

        <div>
          <div className="mb-2 text-sm font-bold text-dark">Cover picture</div>
          <div className="flex flex-wrap items-start gap-4">
            <div className="aspect-[16/9] w-56 overflow-hidden rounded-lg border border-border bg-surface2">
              <NewsCover article={{ coverUrl: form.coverUrl }} />
            </div>
            <div className="flex flex-col gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => uploadCover(e.target.files?.[0])} />
              <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                Upload picture
              </button>
              {form.coverUrl && (
                <button type="button" className="text-left text-xs font-semibold text-light hover:text-dark" onClick={() => setForm((f) => ({ ...f, coverUrl: "" }))}>
                  Remove picture
                </button>
              )}
            </div>
          </div>
          {photos.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-light">Or take one from this round's gallery:</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {photos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, coverUrl: p.url }))}
                    className={`h-14 w-24 overflow-hidden rounded-md border-2 ${form.coverUrl === p.url ? "border-brand" : "border-transparent"}`}
                  >
                    <img src={p.url} alt={p.caption || ""} loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SlidingTabs
            items={[
              { key: "write", label: "Write" },
              { key: "preview", label: "Preview" },
            ]}
            value={tab}
            onChange={setTab}
            wrapClassName="inline-flex rounded-xl border border-border bg-surface2/60 p-1"
            btnClassName="px-3 py-1.5 text-[13px]"
          />
          {tab === "write" && (
            <label className="btn-secondary cursor-pointer text-xs">
              Insert picture
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => insertPicture(e.target.files?.[0])} />
            </label>
          )}
        </div>
        {tab === "write" ? (
          <>
            <textarea
              ref={bodyRef}
              className="input min-h-[22rem] w-full font-mono text-sm leading-relaxed"
              value={form.body}
              onChange={set("body")}
              placeholder="Write the story…"
              aria-label="Article text"
            />
            <details className="mt-2 text-xs text-light">
              <summary className="cursor-pointer font-semibold">Formatting</summary>
              <ul className="mt-2 space-y-1">
                {FORMAT_HELP.map(([code, what]) => (
                  <li key={code}>
                    <code className="rounded bg-surface2 px-1.5 py-0.5 font-mono text-dark">{code}</code> {what}
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <div className="min-h-[22rem]">
            <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight text-dark">{form.title || "Headline"}</h1>
            {form.summary && <p className="mt-3 text-lg text-light">{form.summary}</p>}
            <div className="mt-6">
              <NewsBody text={form.body} />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {live ? (
            <>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => save("PUBLISHED")}>
                Save changes
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => save("DRAFT")}>
                Unpublish
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => save("PUBLISHED")}>
                Publish
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => save("DRAFT")}>
                Save draft
              </button>
            </>
          )}
        </div>
        {!isNew && (
          <button type="button" className="text-sm font-semibold text-light hover:text-dark" disabled={busy} onClick={remove}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export default function NewsDesk() {
  const { id } = useParams();
  const access = useNewsDeskAccess();

  if (!access.canWrite) {
    if (!access.loaded) return <Spinner />;
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState title="The news desk is for writers" hint="Sign in with Discord. League admins can make you a news writer." />
        <div className="mt-4 text-center">
          <Link to="/news" className="text-sm font-semibold text-link">
            ← Back to the news
          </Link>
        </div>
      </div>
    );
  }
  return id ? <Editor id={id} /> : <DeskList />;
}
