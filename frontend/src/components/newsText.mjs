// ---------------------------------------------------------------------------
// The news articles' text format: a small, safe slice of Markdown.
//
//   ## Heading / ### Smaller heading
//   **bold**, *italic*, [a link](https://… or /a/page/here)
//   - a list / 1. a numbered list
//   > a quote
//   ![a caption](https://… or /api/uploads/…)   a picture on its own line
//
// parseNewsText turns the text into plain blocks the page draws itself
// (components/NewsBody.jsx). Nothing is ever handed to the browser as HTML, so
// whatever a writer types stays text; addresses that are not a web address or
// a path on this site are dropped and their words kept.
// ---------------------------------------------------------------------------

export function safeHref(raw) {
  const url = String(raw || "").trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(url)) return url;
  if (/^\/(?!\/)[^\s"'<>]*$/.test(url)) return url;
  return null;
}

export function safeImageSrc(raw) {
  const url = String(raw || "").trim();
  if (/^https:\/\/[^\s"'<>]+$/i.test(url)) return url;
  if (/^\/api\/uploads\/[A-Za-z0-9/_.-]+$/.test(url) && !url.includes("..")) return url;
  return null;
}

// Inline runs of one line or paragraph: [{ t: "text" | "b" | "i" | "a", … }].
export function parseInline(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m;
  const push = (node) => {
    const prev = out[out.length - 1];
    if (node.t === "text" && prev?.t === "text") prev.v += node.v;
    else out.push(node);
  };
  while ((m = re.exec(text))) {
    if (m.index > last) push({ t: "text", v: text.slice(last, m.index) });
    if (m[1] != null) push({ t: "b", v: m[1] });
    else if (m[2] != null) push({ t: "i", v: m[2] });
    else if (m[3] != null) push({ t: "i", v: m[3] });
    else {
      const href = safeHref(m[5]);
      push(href ? { t: "a", v: m[4], href } : { t: "text", v: m[4] });
    }
    last = re.lastIndex;
  }
  if (last < text.length) push({ t: "text", v: text.slice(last) });
  return out;
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

// Blocks: { type: "h2" | "h3" | "p" | "quote" | "ul" | "ol" | "img", … }.
// Paragraph and quote lines keep their line breaks as `lines`.
export function parseNewsText(src) {
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let para = null;
  const close = () => {
    para = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) {
      close();
      continue;
    }
    let m;
    if ((m = t.match(/^(#{2,3})\s+(.*)$/))) {
      close();
      blocks.push({ type: m[1].length === 2 ? "h2" : "h3", inline: parseInline(m[2]) });
    } else if ((m = t.match(IMAGE_LINE))) {
      close();
      const src2 = safeImageSrc(m[2]);
      if (src2) blocks.push({ type: "img", src: src2, alt: m[1] });
    } else if ((m = t.match(/^>\s?(.*)$/))) {
      const prev = blocks[blocks.length - 1];
      if (para && prev?.type === "quote") prev.lines.push(parseInline(m[1]));
      else {
        blocks.push({ type: "quote", lines: [parseInline(m[1])] });
        para = true;
      }
    } else if ((m = t.match(/^[-*]\s+(.*)$/)) || (m = t.match(/^\d+[.)]\s+(.*)$/))) {
      const type = /^\d/.test(t) ? "ol" : "ul";
      const prev = blocks[blocks.length - 1];
      if (para && prev?.type === type) prev.items.push(parseInline(m[1]));
      else {
        blocks.push({ type, items: [parseInline(m[1])] });
        para = true;
      }
    } else {
      const prev = blocks[blocks.length - 1];
      if (para && prev?.type === "p") prev.lines.push(parseInline(t));
      else {
        blocks.push({ type: "p", lines: [parseInline(t)] });
        para = true;
      }
    }
  }
  return blocks;
}
