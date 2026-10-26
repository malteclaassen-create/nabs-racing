import { useState } from "react";
import { Streaks } from "./ui.jsx";
import { inkOn } from "../format.js";

// Pictures of rounds and seasons: the league's posters, else the thumbnail
// of the round's recording on YouTube, else a panel in the series colour
// with the streaks and the round number, so a card never stands empty.

export function youtubeId(url) {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url || "");
  return m ? m[1] : null;
}

// The video's own thumbnail: the full-size one, and a smaller one that every
// video has for when the full size is missing.
export function thumbnails(url) {
  const id = youtubeId(url);
  return id ? [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`] : [];
}

// Every picture worth trying for a round, best first.
export function roundSources(race, ...more) {
  return [race?.imageUrl, ...thumbnails(race?.videoUrl), ...more].filter(Boolean);
}

// An image that moves on to the next source when one fails to load (a video
// without a full-size thumbnail, an upload gone missing); `fallback` once
// none is left. YouTube answers a missing full-size thumbnail with a small
// grey placeholder rather than an error, so that one is caught by its size.
export function Img({ sources, alt = "", className = "", fallback = null, ...rest }) {
  const [i, setI] = useState(0);
  const list = sources.filter(Boolean);
  if (i >= list.length) return fallback;
  return (
    <img
      key={list[i]}
      src={list[i]}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setI((n) => n + 1)}
      onLoad={(e) => {
        if (/i\.ytimg\.com/.test(list[i]) && e.currentTarget.naturalWidth <= 120) setI((n) => n + 1);
      }}
      {...rest}
    />
  );
}

// The stand-in for a round without any picture: the series colour, the
// streaks and the round number in the leaning capitals.
// A mystery track gets a big question mark instead.
// `className` positions it ("relative" in the flow, or "absolute inset-0" to
// fill a frame); the base classes leave the position to it on purpose, as
// "relative" would win over "absolute" in the stylesheet.
export function PosterPanel({ color, round, label, mystery = false, className = "relative" }) {
  const bg = color || "#1a1a1a";
  const ink = inkOn(bg);
  return (
    <div className={`flex items-end overflow-hidden ${className}`} style={{ background: bg, color: ink }}>
      <Streaks tone={ink === "#000" ? "black" : "white"} opacity={0.12} className="streaks-full" />
      {mystery && (
        <span className="display pointer-events-none absolute -right-2 top-1/2 -translate-y-1/2 select-none text-[11rem] leading-none opacity-25 sm:text-[14rem]" aria-hidden="true">
          ?
        </span>
      )}
      <div className="relative w-full p-5">
        {label && <div className="text-[11px] font-bold uppercase tracking-wider opacity-70">{label}</div>}
        {round != null && <div className="display text-7xl leading-none opacity-90">R{round}</div>}
        {mystery && round != null && <div className="display mt-1 text-lg opacity-80">Mystery track</div>}
      </div>
    </div>
  );
}

// A round's picture in a 16:9 frame (or the frame given by className).
// `bare` leaves the stand-in without text, for small thumbnails.
export function RoundPicture({ race, extra = [], color, label, bare = false, className = "aspect-video", imgClassName = "" }) {
  return (
    <div className={`relative overflow-hidden bg-card ${className}`}>
      <Img
        sources={roundSources(race, ...extra)}
        className={`absolute inset-0 h-full w-full object-cover ${imgClassName}`}
        fallback={<PosterPanel color={color} round={bare ? null : race?.round} label={bare ? null : label} mystery={!!race?.mysteryTrack && !race?.track} className="absolute inset-0" />}
      />
    </div>
  );
}

// The round button on a video thumbnail.
export function PlayBadge({ className = "h-14 w-14" }) {
  return (
    <span className={`flex items-center justify-center rounded-full bg-black/75 text-white ring-1 ring-white/30 transition-transform duration-300 group-hover:scale-110 ${className}`}>
      <svg viewBox="0 0 24 24" className="ml-0.5 h-1/2 w-1/2" fill="currentColor" aria-hidden="true">
        <path d="M8 5.5v13l11-6.5z" />
      </svg>
    </span>
  );
}

// A recording: its thumbnail with a play button, and the player itself only
// once someone presses play (YouTube sees nothing of visitors before that).
export function VideoEmbed({ url, title, className = "aspect-video rounded-2xl border border-line" }) {
  const [on, setOn] = useState(false);
  const id = youtubeId(url);
  if (!id) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="btn-ghost">
        Watch the recording
      </a>
    );
  }
  if (on) {
    return (
      <div className={`overflow-hidden bg-black ${className}`}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          title={title || "Recording"}
          className="h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <button type="button" onClick={() => setOn(true)} className={`group relative block w-full overflow-hidden bg-black text-left ${className}`}>
      <Img sources={thumbnails(url)} className="absolute inset-0 h-full w-full object-cover opacity-90 transition duration-500 group-hover:scale-[1.02] group-hover:opacity-100" />
      <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
      <span className="absolute inset-0 flex items-center justify-center">
        <PlayBadge className="h-16 w-16" />
      </span>
      <span className="absolute bottom-4 left-5 text-sm font-bold text-white">Watch the recording</span>
    </button>
  );
}
