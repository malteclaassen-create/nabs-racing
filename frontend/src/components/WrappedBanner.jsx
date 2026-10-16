import { useState } from "react";
import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import { carFor } from "../utils/heroImage.js";

// ---------------------------------------------------------------------------
// Home's call to Season Wrapped once a season is over: the season's real car
// behind it, the story's bars filling along the top, and the way into the
// viewer's own story (a driver of that season) or everyone's (anyone else).
// Always dark, like the story it opens.
// ---------------------------------------------------------------------------
export default function WrappedBanner({ season, driverId = null }) {
  const [photo, setPhoto] = useState(true); // false once the picture fails
  const src = carFor(season);
  const label = season.name && !/^\d+$/.test(season.name) ? season.name : `Season ${season.number}`;
  const hub = `/wrapped?season=${season.number}`;
  const mine = driverId ? `/wrapped/${encodeURIComponent(driverId)}` : null;
  return (
    <section className="reveal wrapped-banner relative isolate overflow-hidden rounded-[1.75rem] bg-[#0B0A12] text-white shadow-xl shadow-ink/20 ring-1 ring-white/10">
      {src && photo && (
        <img
          src={src}
          alt=""
          onError={() => setPhoto(false)}
          className="wrapped-banner-car absolute inset-x-0 top-0 -z-10 h-56 w-full object-cover object-[50%_60%] brightness-110 [mask-image:linear-gradient(180deg,#000_45%,transparent)] sm:inset-y-0 sm:h-full sm:object-[60%_50%] sm:[mask-image:none]"
        />
      )}
      {/* The words under the car on a phone (it fades out below), beside it
          wider up, over the dark side. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 hidden bg-[linear-gradient(90deg,#0B0A12_0%,#0B0A12eb_36%,#0B0A1280_66%,#0B0A1226_100%)] sm:block" />
      <div aria-hidden="true" className="absolute -bottom-40 -left-24 -z-10 h-96 w-96 rounded-full bg-brand/25 blur-3xl" />

      <div className="relative flex max-w-2xl flex-col gap-5 px-6 pb-7 pt-48 sm:p-10 lg:p-12">
        <div aria-hidden="true" className="flex w-44 gap-1 sm:w-56">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
              <span className="wrapped-banner-bar block h-full w-full rounded-full bg-white" style={{ "--i": i }} />
            </span>
          ))}
        </div>
        <p className="font-mono text-xs font-bold uppercase tracking-[0.25em] text-brand">{label} Wrapped</p>
        <h2 className="font-display text-4xl font-black uppercase leading-[0.92] tracking-tight sm:text-6xl">
          The season is over.
          <span className="block text-[#C6F432]">Here's how it went.</span>
        </h2>
        <p className="max-w-md text-base text-white/85 sm:text-lg">
          {mine
            ? "Your season as a full-screen story: the wins, the climbs, the rival and the final table."
            : "Every driver's season as a full-screen story: the wins, the climbs, the rivals and the final table."}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            to={mine || hub}
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-display text-base font-black uppercase text-[#0B0A12] transition hover:scale-[1.03] hover:bg-white/90"
          >
            <Play className="h-5 w-5 fill-current" aria-hidden="true" />
            {mine ? "Play your season" : "Watch the stories"}
          </Link>
          {mine && (
            <Link to={hub} className="inline-flex items-center rounded-full bg-white/10 px-5 py-3 text-sm font-bold transition hover:bg-white/20">
              Every driver
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
