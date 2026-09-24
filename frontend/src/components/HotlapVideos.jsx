import { useEffect, useState } from "react";
import VideoEmbed from "./VideoEmbed.jsx";

// Hotlap videos for a circuit (or one event), from the admin's Photos & Videos
// tab. One player with a picker above it when there's more than one lap on file
// (a season's car each, say).
//
// Shared by the sign-up page, where it sits beside the entry list, and live
// timing, where it sits under the board for anyone watching a session at that
// track — the lap breakdown is as useful during practice as it is the week
// before.
//
// A circuit nobody has filmed yet says so, in the same panel the video would
// have filled. It used to play a stand-in lap — the rickroll — which was funny
// exactly once and unhelpful to somebody genuinely trying to learn the track
// before Friday. `hideWhenEmpty` drops the panel instead: live timing has
// plenty on screen already and a "coming soon" card there is just a gap.
//
// `loading` only suppresses the panel before the FIRST answer is in, so the
// page doesn't announce "coming soon" and then replace itself with a video half
// a second later. Once there is an answer it stays on screen while the next one
// is fetched, rather than blinking out.
export default function HotlapVideos({
  track,
  videos,
  loading = false,
  hideWhenEmpty = false,
  subtitle = `Learn ${track} before Friday`,
  className = "",
}) {
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [track]);
  if (loading && !videos) return null;
  if (!videos?.length) return hideWhenEmpty ? null : <HotlapComingSoon track={track} className={className} />;
  const current = videos[Math.min(i, videos.length - 1)];
  return (
    <div className={`card reveal overflow-hidden p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow">Hotlap</h3>
        <span className="font-mono text-[11px] uppercase tracking-wider text-light">{subtitle}</span>
      </div>
      {videos.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {videos.map((v, idx) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={idx === i}
              onClick={() => setI(idx)}
              className={`inline-flex min-h-[36px] items-center rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                idx === i ? "bg-brand text-ink" : "bg-surface2 text-medium hover:text-dark"
              }`}
            >
              {v.title || `Lap ${idx + 1}`}
            </button>
          ))}
        </div>
      )}
      <VideoEmbed
        videoId={current.id}
        title={current.title || `${track} hotlap`}
        className="rounded-xl"
      />
      {current.title && videos.length === 1 && (
        <p className="mt-2.5 text-sm font-semibold text-medium">{current.title}</p>
      )}
    </div>
  );
}

// The circuit has no lap on file. Same card, same eyebrow, same shape as the
// player it stands in for, so the page doesn't rearrange itself the week a lap
// finally lands — only the window's contents change.
function HotlapComingSoon({ track, className = "" }) {
  return (
    <div className={`card reveal overflow-hidden p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow">Hotlap</h3>
        <span className="font-mono text-[11px] uppercase tracking-wider text-light">Coming soon</span>
      </div>
      <div
        style={{ aspectRatio: 16 / 9 }}
        className="flex w-full flex-col items-center justify-center gap-3 rounded-xl bg-surface2 px-6 text-center"
      >
        <svg viewBox="0 0 24 24" className="h-9 w-9 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="5" width="19" height="14" rx="3" />
          <path d="M10 9.5l5 2.5-5 2.5z" />
        </svg>
        <p className="font-display text-lg font-extrabold uppercase tracking-tight text-medium">
          No hotlap yet
        </p>
        <p className="max-w-xs text-sm leading-relaxed text-light">
          Nobody has filmed a lap of {track} for us yet. One turns up here as soon as somebody does.
        </p>
      </div>
    </div>
  );
}
