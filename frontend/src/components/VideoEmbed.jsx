import { useEffect, useRef, useState } from "react";

// A player that isn't a player until you press play.
//
// Dropping a platform's <iframe> straight onto a page pulls in the best part of
// a megabyte of their code and their cookies, for every visitor, whether or not
// anyone ever watches. So we show the still image with a play button over it,
// and swap in the real frame on the first click — it starts playing straight
// away, and a visitor who never clicks never talks to YouTube or TikTok at all.
//
// Works for anything with an embed address. Pass `videoId` for the YouTube
// shorthand (the hotlap panel), or `embedUrl` + `poster` for anything else.
// `aspect` is width/height: a vertical clip keeps its vertical window rather
// than sitting as a thin strip between two black bars.

const YT_THUMBS = (id) => [
  `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
  `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
];

export default function VideoEmbed({
  videoId,
  embedUrl,
  poster,
  aspect = 16 / 9,
  title = "Video",
  accent = "#FF0000",
  className = "",
  // Take the height of whatever box we're put in, instead of working it out
  // from `aspect`. For a container that already carries the shape — and the
  // border that goes with it, which would otherwise be added on top of a
  // computed height and knock a row of windows out of line.
  fill = false,
}) {
  const [playing, setPlaying] = useState(false);
  const [thumbStep, setThumbStep] = useState(0);
  const boxRef = useRef(null);

  const src = embedUrl || (videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1` : null);
  // `poster={false}` means "show no still at all" — a plain dark window with the
  // play button, which is what a video whose preview hasn't loaded looks like.
  // Passing nothing still falls back to YouTube's own thumbnails.
  const posters = poster === false ? [] : poster ? [poster] : videoId ? YT_THUMBS(videoId) : [];

  // Switching to another video in a picker must not leave the previous one
  // playing behind the new still.
  useEffect(() => {
    setPlaying(false);
    setThumbStep(0);
  }, [src]);

  if (!src) return null;

  // Full screen for the whole frame. The platforms' own players carry a
  // fullscreen button too, but it only appears once their controls load — this
  // one is ours and is there from the start.
  function goFullscreen(e) {
    e.stopPropagation();
    e.preventDefault();
    const el = boxRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  }

  return (
    <div
      ref={boxRef}
      style={fill ? undefined : { aspectRatio: aspect }}
      className={`group/player relative w-full overflow-hidden bg-black ${fill ? "h-full" : ""} ${className}`}
    >
      {playing ? (
        <iframe
          className="absolute inset-0 h-full w-full"
          src={src}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} aria-label={`Play ${title}`} className="absolute inset-0 h-full w-full">
          {posters[thumbStep] && (
            <img
              src={posters[thumbStep]}
              alt=""
              loading="lazy"
              onError={() => setThumbStep((s) => Math.min(s + 1, posters.length - 1))}
              className="h-full w-full object-cover transition duration-500 group-hover/player:scale-[1.03]"
            />
          )}
          {/* Darkened towards the bottom so the play button and any caption
              underneath keep their contrast on a bright still. */}
          <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span
              className="flex h-14 w-20 items-center justify-center rounded-xl bg-black/60 backdrop-blur-sm transition group-hover/player:[background-color:var(--play-accent)] sm:h-16 sm:w-24"
              style={{ "--play-accent": accent }}
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7 text-white" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={goFullscreen}
        title="Full screen"
        aria-label="Full screen"
        className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg bg-black/55 text-white opacity-0 backdrop-blur-sm transition hover:bg-black/80 focus-visible:opacity-100 group-hover/player:opacity-100"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      </button>
    </div>
  );
}
