import { useEffect, useRef } from "react";
import { LAYOUT, renderPosterTo } from "../utils/resultGraphic.js";

// ---------------------------------------------------------------------------
// What the message will look like once it lands in the channel.
//
// The draft is written as Discord source: `**bold**`, `<@1234…>`, and a masked
// link nobody can read as a sentence. Those are the three things that look
// nothing like their result, so an admin editing raw source is guessing at the
// message they are about to send to eighty people. This renders them.
//
// Deliberately dark whatever the site's theme is. It is a picture of another
// application, not a piece of this one, and a Discord message on a white card
// would be a preview of something that does not exist.
//
// It is a likeness, not an emulator: the name and avatar on a webhook message
// come from the webhook's own settings over in Discord, so those are labelled
// rather than promised. Everything below the header is exact.
// ---------------------------------------------------------------------------

// `**bold**`, `[text](url)` and `<@id>` — the three pieces of Discord markup the
// generated message actually uses. Anything else is left as the text it is,
// which is the honest thing to do: inventing a renderer for markup we never
// write would only be a second thing to keep true.
const TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|<@!?\d+>)/g;

function Line({ text, mentions }) {
  // An empty line is an empty line BOX, one line tall. A <br> here would add a
  // break to a block that already ends in one and open a two-line hole where
  // Discord leaves one.
  if (!text) return <div className="h-[1.375rem]" />;
  const parts = text.split(TOKEN).filter((p) => p !== "");
  return (
    <div className="min-h-[1.375rem]">
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) {
          return (
            <strong key={i} className="font-bold text-white">
              {p.slice(2, -2)}
            </strong>
          );
        }
        const mention = /^<@!?(\d+)>$/.exec(p);
        if (mention) {
          const name = mentions?.[mention[1]];
          return (
            <span key={i} className="rounded bg-[#3c4270] px-1 py-0.5 font-medium text-[#c9cdfb]">
              @{name || "unknown"}
            </span>
          );
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
        if (link) {
          return (
            <span key={i} className="text-[#00a8fc]" title={link[2]}>
              {link[1]}
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}

export default function DiscordPreview({ text, mentions, poster = null, when = "" }) {
  const canvasRef = useRef(null);

  // The attachment is drawn by the same function that draws the real one, so
  // what is under the message here is not a stand-in for the poster: it IS the
  // poster, at preview size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !poster) return;
    renderPosterTo(canvas, poster).catch(() => {
      /* the preview losing its picture is not worth an error box */
    });
  }, [poster]);

  const lines = String(text || "").split("\n");

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface2 px-4 py-2">
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">In Discord</span>
        <span className="text-[11px] text-light">Name and avatar come from the webhook&rsquo;s own settings</span>
      </div>
      <div className="bg-[#313338] p-4">
        <div className="flex gap-4">
          <img src="/logo-light.png" alt="" className="h-10 w-10 shrink-0 rounded-full bg-[#f7c2ce] object-contain" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold text-white">NABS Racing</span>
              <span className="rounded bg-[#5865f2] px-1.5 py-px text-[10px] font-bold uppercase text-white">Bot</span>
              <span className="text-xs text-[#949ba4]">{when}</span>
            </div>
            <div className="mt-0.5 space-y-0.5 whitespace-pre-wrap break-words text-[15px] leading-[1.375rem] text-[#dbdee1]">
              {lines.map((l, i) => (
                <Line key={i} text={l} mentions={mentions} />
              ))}
            </div>
            {poster && (
              <canvas
                ref={canvasRef}
                className="mt-2 h-auto w-full max-w-[280px] rounded-lg"
                style={{ aspectRatio: `${LAYOUT.width} / ${LAYOUT.height}` }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
