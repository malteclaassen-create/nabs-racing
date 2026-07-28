import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardHead, ErrorBox, Notice } from "./ui.jsx";
import { SocialIcon } from "./SocialLinks.jsx";

// Admin: the wall of posts on the home page. One panel, one row per platform,
// because that's how you actually think about it — "what's on our channels?"
//
// YouTube is the odd one out and looks it: it needs the channel once and then
// keeps itself up to date, because YouTube publishes a feed anyone may read.
// Instagram and TikTok publish nothing of the sort (their profile pages hand
// out no list of posts), so each gets a box to drop links into. Everything the
// link can tell us — picture, caption, date, whether it's filmed upright — we
// fetch on the spot.

const PLATFORM_LABEL = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", twitch: "Twitch", x: "X" };
const PLATFORM_ACCENT = { youtube: "#FF0000", instagram: "#E4405F", tiktok: "#25F4EE", twitch: "#9146FF", x: "#71767b" };

function fmtDate(iso) {
  if (!iso) return "no date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "no date" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// A card preview, the way the home page will show it.
function Thumb({ post, className = "w-32" }) {
  const src = post.coverUrl || post.thumbUrl;
  return (
    <div className={`aspect-video shrink-0 overflow-hidden rounded-lg border border-border bg-surface2 ${className}`}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-faint">
          <SocialIcon name={post.platform} className="h-6 w-6" />
        </div>
      )}
    </div>
  );
}

// The heading that opens each platform's row.
function PlatformRow({ platform, children, hint }) {
  return (
    <div className="border-t border-border pt-4">
      <div className="mb-1 flex items-center gap-2">
        <span style={{ color: PLATFORM_ACCENT[platform] }}>
          <SocialIcon name={platform} className="h-4 w-4" />
        </span>
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-dark">
          {PLATFORM_LABEL[platform]}
        </span>
      </div>
      {hint && <p className="mb-2 text-sm text-light">{hint}</p>}
      {children}
    </div>
  );
}

// A paste box for one platform. Links go in, cards come out — several at a
// time, because collecting a week's posts and pasting them in one go is the
// whole point of doing it by hand.
function PasteBox({ platform, onAdd }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  async function submit() {
    setBusy(true);
    setResults(null);
    try {
      const res = await onAdd(text);
      const rank = { failed: 0, added: 1, duplicate: 2 };
      setResults([...res.results].sort((a, b) => rank[a.status] - rank[b.status]));
      if (res.results.some((r) => r.status === "added")) setText("");
    } finally {
      setBusy(false);
    }
  }

  const placeholder =
    platform === "instagram"
      ? "https://www.instagram.com/p/…\nhttps://www.instagram.com/reel/…"
      : "https://www.tiktok.com/@nabsracing/video/…";

  return (
    <>
      <textarea
        className="input min-h-24 font-mono text-xs"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button className="btn-secondary py-1.5 text-sm" disabled={busy || !text.trim()} onClick={submit}>
          {busy ? "Fetching…" : `Add to the wall`}
        </button>
        {busy && <span className="text-sm text-light">Asking {PLATFORM_LABEL[platform]} — this can take a moment.</span>}
      </div>

      {results && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {results.map((r, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-2">
              <span
                className={`font-mono text-[11px] font-bold uppercase tracking-wider ${
                  r.status === "added" ? "text-ok" : r.status === "duplicate" ? "text-light" : "text-bad"
                }`}
              >
                {r.status === "added" ? "added" : r.status === "duplicate" ? "already there" : "no card"}
              </span>
              <span className="min-w-0 flex-1 truncate text-medium">{r.status === "added" ? r.title || r.url : r.url}</span>
              {/* Say which platform it actually turned out to be, so a link
                  dropped in the wrong box isn't a mystery. */}
              {r.status === "added" && r.platform !== platform && (
                <span className="text-xs text-light">went in as {PLATFORM_LABEL[r.platform] || r.platform}</span>
              )}
              {r.status === "added" && !r.picture && <span className="text-xs text-light">no picture — upload a cover below</span>}
              {r.error && <span className="text-xs text-light">{r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function AdminSocialFeed() {
  const feed = useApi(useCallback(() => api.getSocialFeed(), []));
  const [config, setConfig] = useState(null);
  const [posts, setPosts] = useState([]);
  const [channelVideos, setChannelVideos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!feed.data) return;
    setConfig(feed.data.config);
    setPosts(feed.data.posts || []);
    setChannelVideos(feed.data.channelVideos || []);
  }, [feed.data]);

  async function saveConfig(next) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await api.setSocialFeed(next);
      setConfig(res.config);
      setChannelVideos(res.channelVideos || []);
      if (res.channelError) setError(res.channelError);
      else setMsg("Saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Every mutation returns the full saved list, so the UI never guesses.
  async function mutate(fn, note) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res?.posts) setPosts(res.posts);
      if (note) setMsg(note);
      return res;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function addLinks(text) {
    setError(null);
    setMsg(null);
    const res = await api.addSocialPostsBulk(text).catch((e) => {
      setError(e.message);
      return { results: [], posts };
    });
    if (res.posts) setPosts(res.posts);
    return res;
  }

  if (feed.error) return <ErrorBox message={feed.error} onRetry={feed.reload} />;
  if (!config) return <div className="text-sm text-light">Loading…</div>;

  // `posts` is what's stored — the automatically pulled YouTube videos are not
  // in here, they're read fresh from the channel on every page load.
  const countOf = (platform) => posts.filter((p) => p.platform === platform).length;

  return (
    <div className="card space-y-4 p-5">
      <CardHead eyebrow="Home page" title="Social wall" />
      <p className="text-sm text-light">
        The cards under the numbers band on the home page. YouTube keeps itself up to date from your channel; Instagram
        and TikTok publish no feed anyone may read, so their posts come in as links below. Picture, caption and date are
        fetched from the link either way.
      </p>

      {error && <ErrorBox message={error} />}
      {msg && <Notice kind="success">{msg}</Notice>}

      <label className="flex items-center gap-2 text-sm font-semibold text-medium">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={config.enabled}
          onChange={(e) => saveConfig({ ...config, enabled: e.target.checked })}
        />
        Show the section on the home page
      </label>

      {/* ---------- YouTube: set once, then automatic ---------- */}
      <PlatformRow
        platform="youtube"
        hint="Open your channel on YouTube and copy the address from the browser bar — an @handle link works as well as a /channel/ one. The newest videos then appear on their own, no key and no login needed."
      >
        <div className="flex flex-wrap gap-2">
          <input
            className="input min-w-64 flex-1"
            placeholder="https://www.youtube.com/@yourchannel"
            value={config.youtubeChannelUrl}
            onChange={(e) => setConfig((c) => ({ ...c, youtubeChannelUrl: e.target.value }))}
          />
          <button className="btn-secondary py-1.5 text-sm" disabled={busy} onClick={() => saveConfig(config)}>
            {busy ? "Checking…" : "Save channel"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-medium">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={config.youtubeAuto}
              onChange={(e) => setConfig((c) => ({ ...c, youtubeAuto: e.target.checked }))}
            />
            Pull videos automatically
          </label>
          <label className="flex items-center gap-2 text-sm text-medium">
            How many at once
            <select
              className="input w-20 py-1.5 text-sm"
              value={config.youtubeCount}
              onChange={(e) => setConfig((c) => ({ ...c, youtubeCount: Number(e.target.value) }))}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>

        {channelVideos.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {channelVideos.slice(0, config.youtubeCount || 0).map((v) => (
              <li key={v.id} className="flex items-center gap-3 text-sm">
                <Thumb post={v} className="w-24" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-dark">{v.title}</span>
                  <span className="font-mono text-xs text-light">
                    {fmtDate(v.postedAt)}
                    {v.aspect < 1 && " · upright"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </PlatformRow>

      {/* ---------- Instagram and TikTok: a box each ---------- */}
      <PlatformRow
        platform="instagram"
        hint={`Paste post or reel links, one per line — or just paste the message you collected them in. ${
          countOf("instagram") ? `${countOf("instagram")} on the wall right now.` : "None on the wall yet."
        }`}
      >
        <PasteBox platform="instagram" onAdd={addLinks} />
      </PlatformRow>

      <PlatformRow
        platform="tiktok"
        hint={`Same here: paste video links, as many as you like at once. ${
          countOf("tiktok") ? `${countOf("tiktok")} on the wall right now.` : "None on the wall yet."
        }`}
      >
        <PasteBox platform="tiktok" onAdd={addLinks} />
      </PlatformRow>

      {/* ---------- what's on the wall ---------- */}
      <div className="border-t border-border pt-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-dark">
          Added by hand ({posts.length})
        </div>
        {posts.length === 0 ? (
          <p className="text-sm text-light">
            Nothing yet. Videos pulled from the YouTube channel aren't listed here — they look after themselves.
          </p>
        ) : (
          <ul className="space-y-3">
            {posts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                <Thumb post={p} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">
                    <span style={{ color: PLATFORM_ACCENT[p.platform] }}>
                      <SocialIcon name={p.platform} className="h-3.5 w-3.5" />
                    </span>
                    {PLATFORM_LABEL[p.platform] || p.platform}
                    <span className="text-faint">· {fmtDate(p.postedAt)}</span>
                    {p.aspect < 1 && <span className="text-faint">· upright</span>}
                    {p.pinned && <span className="text-link">· pinned</span>}
                  </div>
                  <input
                    className="input py-1.5 text-sm"
                    value={p.title}
                    onChange={(e) => setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, title: e.target.value } : x)))}
                    onBlur={() => mutate(() => api.updateSocialPost(p.id, { title: p.title })).catch(() => {})}
                  />
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-link hover:underline">
                    {p.url}
                  </a>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className="text-sm font-semibold text-link hover:underline"
                      disabled={busy}
                      onClick={() => mutate(() => api.updateSocialPost(p.id, { pinned: !p.pinned }), p.pinned ? "Unpinned." : "Pinned.").catch(() => {})}
                    >
                      {p.pinned ? "Unpin" : "Pin to front"}
                    </button>
                    {/* The repair button: asks the platform again and takes a
                        fresh copy of the picture. Leaves your title alone. */}
                    <button
                      className="text-sm font-semibold text-link hover:underline"
                      disabled={busy}
                      onClick={() => mutate(() => api.refreshSocialPost(p.id), "Fetched again from the platform.").catch(() => {})}
                    >
                      Refresh picture
                    </button>
                    {p.coverUrl ? (
                      <button
                        className="text-sm font-semibold text-link hover:underline"
                        disabled={busy}
                        onClick={() => mutate(() => api.clearSocialCover(p.id), "Cover removed.").catch(() => {})}
                      >
                        Remove cover
                      </button>
                    ) : (
                      <label className="cursor-pointer text-sm font-semibold text-link hover:underline">
                        Upload cover
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) mutate(() => api.uploadSocialCover(p.id, file), "Cover uploaded.").catch(() => {});
                          }}
                        />
                      </label>
                    )}
                    <button
                      className="text-sm font-semibold text-light hover:text-bad"
                      disabled={busy}
                      onClick={() => mutate(() => api.deleteSocialPost(p.id), "Post removed.").catch(() => {})}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------- how the wall is put together ---------- */}
      <div className="border-t border-border pt-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-dark">The wall itself</div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-medium">
            Cards on the page
            <select
              className="input w-20 py-1.5 text-sm"
              value={config.limit}
              onChange={(e) => setConfig((c) => ({ ...c, limit: Number(e.target.value) }))}
            >
              {[3, 6, 9, 12].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm font-semibold text-medium">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={config.mixPlatforms}
            onChange={(e) => setConfig((c) => ({ ...c, mixPlatforms: e.target.checked }))}
          />
          <span>
            One from each channel, taking turns
            <span className="mt-0.5 block font-normal text-light">
              YouTube, Instagram, TikTok, then round again — so a busy week on one channel doesn't fill the whole wall.
              Off means purely newest first. Pinned posts stay in front either way.
            </span>
          </span>
        </label>
        <button className="btn-primary mt-3" disabled={busy} onClick={() => saveConfig(config)}>
          Save settings
        </button>
      </div>
    </div>
  );
}
