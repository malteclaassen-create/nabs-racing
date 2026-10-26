import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";
import { useDiscordLogin } from "../hooks/useDiscordLogin.js";
import { useAsk } from "./overlay.jsx";
import { DriverAvatar, ErrorBox } from "./ui.jsx";
import { commentAge, gifBox, looksLikeGifLink } from "./newsComments.mjs";

// ---------------------------------------------------------------------------
// The comment section under an article (backend lib/newsComments.js).
//
// Anybody can read; a signed-in member can write some text, add a GIF, or
// both. GIFs come from GIPHY's search in the picker (when the league has set
// up a key) or from any Tenor or GIPHY link, pasted into the picker or straight
// into the comment box, the way Discord hands one over. The writer of a
// comment and the news desk can delete it.
// ---------------------------------------------------------------------------

const MAX_BODY = 1000;

function GifImage({ gif, maxW, maxH, className = "" }) {
  const box = gifBox(gif, { maxW, maxH });
  return (
    <img
      src={gif.url}
      alt="GIF"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      width={box.width}
      height={box.height}
      style={{ width: box.width, maxWidth: "100%", height: "auto", aspectRatio: `${box.width} / ${box.height}` }}
      className={`block rounded-lg bg-surface2 object-cover ${className}`}
    />
  );
}

// The GIF panel under the comment box: GIPHY's search (trending until
// something is typed) when it is set up, and a box for a Tenor or GIPHY link
// either way.
function GifPicker({ searchEnabled, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [gifs, setGifs] = useState(null);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");
  const [resolving, setResolving] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!searchEnabled) return undefined;
    let alive = true;
    setGifs(null);
    api
      .searchGifs(term)
      .then((d) => alive && setGifs(d?.gifs || []))
      .catch(() => alive && setGifs([]));
    return () => {
      alive = false;
    };
  }, [term, searchEnabled]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  async function addLink(e) {
    e.preventDefault();
    if (!link.trim()) return;
    setResolving(true);
    setLinkError("");
    try {
      const d = await api.resolveGifLink(link.trim());
      onPick(d.gif);
    } catch (err) {
      setLinkError(err.message || "That link didn't work");
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface2/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow">Add a GIF</span>
        <button type="button" onClick={onClose} className="text-xs font-semibold text-light hover:text-dark">
          Close
        </button>
      </div>

      {searchEnabled && (
        <>
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search GIPHY…"
            aria-label="Search GIFs"
            className="input mt-2 w-full py-1.5 text-sm"
          />
          <div className="mt-2 grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4">
            {gifs === null &&
              Array.from({ length: 8 }).map((_, i) => <span key={i} className="skeleton block aspect-video rounded-md" />)}
            {gifs?.map((g) => (
              <button
                key={g.id || g.url}
                type="button"
                title={g.title || "GIF"}
                onClick={() => onPick({ url: g.url, width: g.width, height: g.height })}
                className="overflow-hidden rounded-md bg-surface2 ring-brand transition hover:ring-2 focus-visible:ring-2"
              >
                <img
                  src={g.preview}
                  alt={g.title || "GIF"}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="aspect-video h-full w-full object-cover"
                />
              </button>
            ))}
            {gifs?.length === 0 && (
              <p className="col-span-full py-6 text-center text-sm text-light">
                {term ? "No GIFs for that. Try another word." : "Nothing to show right now."}
              </p>
            )}
          </div>
          <div className="mt-1.5 text-right font-mono text-[9px] font-bold uppercase tracking-widest text-faint">
            Powered by GIPHY
          </div>
        </>
      )}

      <form onSubmit={addLink} className={`flex gap-2 ${searchEnabled ? "mt-2 border-t border-border pt-3" : "mt-2"}`}>
        <input
          ref={searchEnabled ? null : searchRef}
          type="url"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setLinkError("");
          }}
          placeholder={searchEnabled ? "…or paste a Tenor or GIPHY link" : "Paste a Tenor or GIPHY link"}
          aria-label="GIF link"
          className="input min-w-0 flex-1 py-1.5 text-sm"
        />
        <button type="submit" className="btn-secondary shrink-0 py-1.5 text-xs" disabled={resolving || !link.trim()}>
          {resolving ? "…" : "Add"}
        </button>
      </form>
      {linkError && <p className="mt-1.5 text-xs font-semibold text-red-600 dark:text-red-400">{linkError}</p>}
    </div>
  );
}

function Composer({ articleId, searchEnabled, onPosted }) {
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const [gif, setGif] = useState(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fetchingGif, setFetchingGif] = useState(false);

  const canPost = !busy && (body.trim() || gif) && body.length <= MAX_BODY;

  async function post() {
    if (!canPost) return;
    setBusy(true);
    setError("");
    try {
      const d = await api.postNewsComment(articleId, { body, gif });
      setBody("");
      setGif(null);
      setPicking(false);
      onPosted(d.comment);
    } catch (err) {
      setError(err.message || "That didn't post. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // A Tenor or GIPHY link pasted on its own becomes the GIF, the way Discord
  // shows one, instead of a line of address in the text.
  async function onPaste(e) {
    const text = e.clipboardData?.getData("text") || "";
    if (gif || !looksLikeGifLink(text)) return;
    e.preventDefault();
    setFetchingGif(true);
    setError("");
    try {
      const d = await api.resolveGifLink(text.trim());
      setGif(d.gif);
    } catch {
      // Not one after all: the link goes in as text, as it would have.
      setBody((b) => `${b}${text}`);
    } finally {
      setFetchingGif(false);
    }
  }

  return (
    <div className="flex gap-3">
      <DriverAvatar name={user?.driverName || user?.discordName} photoUrl={user?.avatarUrl} size={36} className="mt-1" />
      <div className="min-w-0 flex-1">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              post();
            }
          }}
          rows={2}
          maxLength={MAX_BODY + 200}
          placeholder="Say something about it…"
          aria-label="Your comment"
          className="input w-full resize-y py-2 text-sm leading-relaxed"
        />
        {(gif || fetchingGif) && (
          <div className="relative mt-2 inline-block">
            {gif ? (
              <GifImage gif={gif} maxW={240} maxH={180} />
            ) : (
              <span className="skeleton block h-[120px] w-[200px] rounded-lg" />
            )}
            {gif && (
              <button
                type="button"
                onClick={() => setGif(null)}
                aria-label="Remove the GIF"
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-sm font-bold text-white hover:bg-black"
              >
                ×
              </button>
            )}
          </div>
        )}
        {picking && (
          <GifPicker
            searchEnabled={searchEnabled}
            onClose={() => setPicking(false)}
            onPick={(g) => {
              setGif(g);
              setPicking(false);
            }}
          />
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            aria-expanded={picking}
            className={`rounded-md border px-2.5 py-1 font-mono text-[11px] font-black tracking-wider transition ${
              picking ? "border-brand bg-brand text-onbrand" : "border-border bg-surface2/60 text-medium hover:border-brand/50"
            }`}
          >
            GIF
          </button>
          <span className={`font-mono text-[10px] ${body.length > MAX_BODY ? "text-red-600 dark:text-red-400" : "text-faint"}`}>
            {body.length > MAX_BODY - 150 ? `${body.length}/${MAX_BODY}` : ""}
          </span>
          <button type="button" onClick={post} disabled={!canPost} className="btn-primary ml-auto py-1.5 text-xs">
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
        {error && <p className="mt-1.5 text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function SignInPrompt() {
  const { enabled, loading, start } = useDiscordLogin(`${window.location.pathname}#comments`);
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border bg-surface2/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-medium">Sign in with Discord to join the conversation. GIFs welcome.</p>
      {loading ? null : enabled ? (
        <button
          type="button"
          onClick={start}
          className="shrink-0 rounded-lg bg-[#5865F2] px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-[#4752c4]"
        >
          Sign in with Discord
        </button>
      ) : null}
    </div>
  );
}

function Comment({ comment, onDelete }) {
  const name = comment.author?.name || "Member";
  const nameEl = comment.author?.driverId ? (
    <Link to={`/drivers/${comment.author.driverId}`} className="font-bold text-dark hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-bold text-dark">{name}</span>
  );
  return (
    <li className="group flex gap-3 py-4">
      <DriverAvatar name={name} photoUrl={comment.author?.avatarUrl} size={36} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-sm">
          {nameEl}
          <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()} className="font-mono text-[11px] text-light">
            {commentAge(comment.createdAt)}
          </time>
          {comment.canDelete && (
            <button
              type="button"
              onClick={() => onDelete(comment)}
              className="ml-auto text-[11px] font-semibold text-faint opacity-100 transition hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            >
              Delete
            </button>
          )}
        </div>
        {comment.body && (
          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-medium">{comment.body}</p>
        )}
        {comment.gif && <GifImage gif={comment.gif} maxW={320} maxH={240} className="mt-2" />}
      </div>
    </li>
  );
}

export default function NewsComments({ articleId }) {
  const { isLoggedIn } = useAuth();
  const ask = useAsk();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(() => {
    setError("");
    return api
      .newsComments(articleId)
      .then((d) => setData(d))
      .catch((e) => setError(e.message || "The comments didn't load"));
  }, [articleId]);

  // Again when somebody signs in or out: which comments are theirs changes.
  useEffect(() => {
    setData(null);
    load();
  }, [load, isLoggedIn]);

  async function loadMore() {
    const last = data?.comments?.[data.comments.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const d = await api.newsComments(articleId, last.createdAt);
      setData((cur) => ({ ...cur, comments: [...cur.comments, ...(d.comments || [])], more: d.more }));
    } catch {
      /* the button stays, a second press tries again */
    } finally {
      setLoadingMore(false);
    }
  }

  async function remove(comment) {
    if (!(await ask({ title: "Delete this comment?", body: "It is gone for everybody.", danger: true, confirmLabel: "Delete" })))
      return;
    try {
      await api.deleteNewsComment(articleId, comment.id);
      setData((cur) => ({
        ...cur,
        comments: cur.comments.filter((c) => c.id !== comment.id),
        count: Math.max(0, (cur.count || 1) - 1),
      }));
    } catch (e) {
      await ask({ title: "Not deleted", body: e.message || "Try again.", alert: true });
    }
  }

  const count = data?.count ?? 0;

  return (
    <section id="comments" className="mt-12 scroll-mt-24 border-t border-border pt-6">
      <h2 className="flex items-baseline gap-2 font-display text-xl font-extrabold tracking-tight text-dark">
        Comments
        {count > 0 && <span className="font-mono text-sm font-bold text-light">{count}</span>}
      </h2>

      <div className="mt-4">
        {isLoggedIn ? (
          <Composer
            articleId={articleId}
            searchEnabled={!!data?.gifSearch}
            onPosted={(c) =>
              setData((cur) => ({ ...(cur || {}), comments: [c, ...(cur?.comments || [])], count: (cur?.count || 0) + 1 }))
            }
          />
        ) : (
          <SignInPrompt />
        )}
      </div>

      {error && (
        <div className="mt-4">
          <ErrorBox message={error} onRetry={load} title="The comments didn't load" />
        </div>
      )}
      {!data && !error && (
        <div className="mt-6 space-y-4" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-3">
              <span className="skeleton block h-9 w-9 rounded-full" />
              <span className="flex-1 space-y-2">
                <span className="skeleton block h-3.5 w-32 rounded" />
                <span className="skeleton block h-3.5 w-3/4 rounded" />
              </span>
            </div>
          ))}
        </div>
      )}
      {data && data.comments.length === 0 && (
        <p className="mt-6 text-sm text-light">No comments yet. Be the first.</p>
      )}
      {data?.comments?.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {data.comments.map((c) => (
            <Comment key={c.id} comment={c} onDelete={remove} />
          ))}
        </ul>
      )}
      {data?.more && (
        <div className="mt-2 text-center">
          <button type="button" className="btn-secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Older comments"}
          </button>
        </div>
      )}
    </section>
  );
}
