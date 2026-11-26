import { Link } from "react-router-dom";
import { useId } from "react";
import { parseNewsText, newsSections } from "./newsText.mjs";

// An article's text, drawn from the blocks newsText.mjs parses. Paths on this
// site open in the app, web addresses in a new tab. A row of buttons
// on top jumps to the sections: the writer's own [jump: …] places, else the
// ## headings when there are two or more. A [jump buttons] line moves the row
// from the top to that place.

function jumpTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
}

function Inline({ runs }) {
  return runs.map((r, i) => {
    if (r.t === "b") return <strong key={i} className="font-bold text-dark">{r.v}</strong>;
    if (r.t === "i") return <em key={i}>{r.v}</em>;
    if (r.t === "a") {
      return r.href.startsWith("/") ? (
        <Link key={i} to={r.href} className="font-semibold text-link underline-offset-2 hover:underline">
          {r.v}
        </Link>
      ) : (
        <a key={i} href={r.href} target="_blank" rel="noreferrer noopener" className="font-semibold text-link underline-offset-2 hover:underline">
          {r.v}
        </a>
      );
    }
    return <span key={i}>{r.v}</span>;
  });
}

function Lines({ lines }) {
  return lines.map((runs, i) => (
    <span key={i}>
      {i > 0 && <br />}
      <Inline runs={runs} />
    </span>
  ));
}

export default function NewsBody({ text }) {
  const blocks = parseNewsText(text);
  const sections = newsSections(blocks);
  const uid = useId();
  const anchor = (i) => `${uid}-s${i}`;
  const targets = new Set(sections.map((s) => s.index));
  // The row sits on top unless the writer put it somewhere with [jump buttons].
  const placed = blocks.some((b) => b.type === "menu");
  const menu = sections.length > 0 && (
        <nav aria-label="Jump to a section" className="flex flex-wrap gap-2">
          {sections.map((s) => (
            <button
              key={s.index}
              type="button"
              onClick={() => jumpTo(anchor(s.index))}
              className="rounded-lg border border-border bg-surface2/60 px-3 py-1.5 text-sm font-semibold text-dark transition hover:border-brand/50"
            >
              {s.title}
            </button>
          ))}
        </nav>
  );
  return (
    <div className="space-y-5 text-[16px] leading-relaxed text-medium [&>*]:scroll-mt-28">
      {!placed && menu}
      {blocks.map((b, i) => {
        const id = targets.has(i) ? anchor(i) : undefined;
        switch (b.type) {
          case "jump":
            return null;
          case "menu":
            return menu ? <div key={i}>{menu}</div> : null;
          case "h2":
            return (
              <h2 key={i} id={id} className="pt-2 font-display text-xl font-extrabold uppercase tracking-tight text-dark sm:text-2xl">
                <Inline runs={b.inline} />
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} id={id} className="font-display text-lg font-bold uppercase tracking-tight text-dark">
                <Inline runs={b.inline} />
              </h3>
            );
          case "ul":
          case "ol": {
            const Tag = b.type;
            return (
              <Tag key={i} id={id} className={`space-y-1.5 pl-6 ${b.type === "ol" ? "list-decimal" : "list-disc"}`}>
                {b.items.map((runs, j) => (
                  <li key={j}>
                    <Inline runs={runs} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote key={i} id={id} className="border-l-4 border-brand bg-surface2/60 px-4 py-3 italic text-dark">
                <Lines lines={b.lines} />
              </blockquote>
            );
          case "img":
            return (
              <figure key={i} id={id} className="overflow-hidden rounded-xl border border-border">
                <img src={b.src} alt={b.alt} loading="lazy" className="w-full object-cover" />
                {b.alt && <figcaption className="px-3 py-2 text-xs text-light">{b.alt}</figcaption>}
              </figure>
            );
          default:
            return (
              <p key={i} id={id}>
                <Lines lines={b.lines} />
              </p>
            );
        }
      })}
    </div>
  );
}
