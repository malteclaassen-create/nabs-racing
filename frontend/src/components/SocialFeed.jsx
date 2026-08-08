import { useCallback } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { SocialIcon, SOCIAL_META, useSocial } from "./SocialLinks.jsx";
import VideoEmbed from "./VideoEmbed.jsx";

// The league's own posts on the home page: the newest YouTube videos (pulled
// from the channel automatically) next to the Instagram and TikTok posts an
// admin added by hand. See backend lib/socialFeed.js for how each one is read.
//
// A card is a line of text and then the picture — the line sits on the page
// itself, not in a panel of its own, so a row of clips stays a row of clips
// rather than becoming a row of paragraphs.
//
// YouTube and TikTok play right here — press the still, the platform's player
// takes over the same window, full screen included. Instagram can't: it answers
// every attempt to show it inside another page with "X-Frame-Options: DENY", so
// those cards open on Instagram instead.

const PLATFORM = {
  youtube: { label: "YouTube", accent: "#FF0000" },
  instagram: { label: "Instagram", accent: "#E4405F" },
  tiktok: { label: "TikTok", accent: "#25F4EE" },
  twitch: { label: "Twitch", accent: "#9146FF" },
  x: { label: "X", accent: "#71767b" },
};

// A caption on a phone post is half hashtags — "The good ending #assettocorsa
// #simracing #f1" — and a row of those reads as noise rather than as a line
// about the clip. Drop the tags that trail at the end and keep the sentence.
// A caption that is nothing BUT tags stays as it is: better than blank.
function caption(title) {
  const s = String(title || "").trim();
  return s.replace(/(\s+#[\p{L}\p{N}_]+)+$/u, "").trim() || s;
}

function PostCard({ post, channel }) {
  const meta = PLATFORM[post.platform] || { label: post.platform, accent: "#64748b" };
  const aspect = post.aspect || 16 / 9;
  // The heading doubles as the way to the channel itself — same address the
  // footer icons use, so there is one place to change it. Without a link
  // configured for that platform it stays plain text rather than a dead one.
  const hover = SOCIAL_META.find((m) => m.key === post.platform)?.hover || "";

  return (
    // Every window is the SAME HEIGHT, and the row fills the page edge to edge.
    //
    // Both at once, without measuring anything: each card is allowed to grow in
    // proportion to its own shape (an upright clip counts 0.56, a normal one
    // 1.78). Share the width out in those proportions and every window's height
    // — width divided by its shape — comes out identical, whatever mix of
    // upright and wide clips the row happens to hold.
    //
    // On a phone that same sharing would leave an upright clip a sliver wide,
    // so there each card simply takes the full width and keeps its own height.
    <article
      style={{ "--ar": aspect }}
      className="w-full sm:w-auto sm:[flex-basis:calc(var(--ar)*var(--row-h))] sm:[flex-grow:var(--ar)] sm:[max-width:calc(var(--ar)*var(--cap-h))]"
    >
      {/* Which channel, then what the post says. Both above the window as plain
          text, and both given fixed room whether they fill it or not — a caption
          one line longer than its neighbour would otherwise push its window down
          and leave the row's top edge crooked. */}
      <div className="mb-1.5 flex h-4 items-center">
        {channel ? (
          <a
            href={channel}
            target="_blank"
            rel="noopener noreferrer"
            title={`Our ${meta.label} channel`}
            className={`inline-flex items-center gap-1.5 text-eyebrow transition ${hover}`}
          >
            <span style={{ color: meta.accent }}>
              <SocialIcon name={post.platform} className="h-3.5 w-3.5" />
            </span>
            <span className="font-mono text-[11px] font-bold uppercase tracking-widest">{meta.label}</span>
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span style={{ color: meta.accent }}>
              <SocialIcon name={post.platform} className="h-3.5 w-3.5" />
            </span>
            <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow">{meta.label}</span>
          </span>
        )}
      </div>
      <p className="mb-2 line-clamp-2 h-9 text-[13px] font-semibold leading-snug text-medium">{caption(post.title)}</p>

      {/* The shape lives on the bordered box, not on what's inside it: a card's
          1px border would otherwise be added on top of a height worked out from
          the shape, by the same 2px on a narrow window as on a wide one — and
          the row's bottom edge would come out crooked. */}
      <div className="card relative overflow-hidden" style={{ aspectRatio: aspect }}>
        {post.embedUrl ? (
          <VideoEmbed
            fill
            embedUrl={post.embedUrl}
            poster={post.thumbUrl}
            aspect={aspect}
            title={post.title || `${meta.label} post`}
            accent={meta.accent}
          />
        ) : (
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative block h-full w-full overflow-hidden bg-surface2"
            aria-label={post.title ? `${post.title} — open on ${meta.label}` : `Open on ${meta.label}`}
          >
            {post.thumbUrl ? (
              <img
                src={post.thumbUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition duration-slow group-hover:scale-[1.04]"
              />
            ) : (
              // No picture from the platform and none uploaded: the brand mark
              // on the card's own surface, rather than a broken image box.
              <div className="flex h-full w-full items-center justify-center" style={{ color: meta.accent }}>
                <SocialIcon name={post.platform} className="h-10 w-10 opacity-70" />
              </div>
            )}
            {/* This one leaves the site, so it says so. */}
            <span className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition group-hover:bg-black/80">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
              </svg>
            </span>
          </a>
        )}
      </div>
    </article>
  );
}

// `header` lets a page bring its own heading (the newcomer landing writes its
// headings in a different, larger style). It is passed IN rather than rendered
// around this component so that an empty wall takes its heading with it —
// a title over nothing is worse than no section at all.
export default function SocialFeed({ header }) {
  const { data } = useApi(useCallback(() => api.socialFeed(), []));
  // The league's own channel addresses, shared with the footer icons.
  const social = useSocial();
  const posts = data?.posts || [];
  // Nothing configured yet, the switch is off, or every platform stayed quiet:
  // the section simply isn't there. No empty state on the page.
  if (!data?.enabled || !posts.length) return null;

  return (
    <section className="reveal space-y-5">
      {header || <h3 className="section-title">Latest from our channels</h3>}
      {/* --row-h is the height a row aims for, and so decides how many cards
          share one before the next wraps; the cards then stretch from there to
          fill the width exactly. --cap-h stops a lone wide clip from growing
          into a billboard on a big screen — the only case where the row can't
          fill, which is why it stays centred. */}
      <div className="cascade flex flex-col gap-4 [--cap-h:32rem] [--row-h:15rem] sm:flex-row sm:flex-wrap sm:justify-center lg:[--row-h:17rem]">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} channel={social.data?.[p.platform] || null} />
        ))}
      </div>
    </section>
  );
}
