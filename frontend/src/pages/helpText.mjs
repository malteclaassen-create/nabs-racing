// Plain helpers for the Help page (/help), kept free of JSX so node --test can
// run them (helpText.test.mjs).

import { withLiveAnswers } from "../utils/signupAnswers.mjs";

// The address of one question: /help#i-get-kicked-with-checksum-failed. Built
// from the question so a link pasted in Discord still reads like what it opens.
// Two questions that come out the same get -2, -3 behind the later ones.
export function slugify(s) {
  const base = String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "question";
}

// One slug per item, in the topics' own shape: slugs[topic][item].
export function helpSlugs(topics) {
  const seen = new Map();
  return (topics || []).map((t) =>
    (t.items || []).map((it) => {
      const base = slugify(it.q);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return n === 1 ? base : `${base}-${n}`;
    })
  );
}

// Search: every word typed has to appear somewhere in the question or the
// answer, in any order ("kicked checksum" finds "Checksum failed ... kicked").
export function matchesHelp(item, query) {
  const hay = `${item.q} ${item.a}`.toLowerCase();
  return String(query)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

// The {answers} placeholder's words live in utils/signupAnswers.mjs, shared
// with Race Info and the Welcome page.
export { answerWords } from "../utils/signupAnswers.mjs";

// Fill the live placeholders. Unknown ones stay as typed, so a typo shows up
// on the page instead of silently vanishing.
export function fillHelp(s, tokens) {
  return withLiveAnswers(s).replace(/\{(\w+)\}/g, (m, k) => (tokens[k] != null ? String(tokens[k]) : m));
}

// Where a [label](href) may point. A path stays on the site, http(s) leaves it;
// anything else (javascript:, data:, ...) is shown as plain text.
export function linkKind(href) {
  if (/^\/(?!\/)/.test(href)) return "internal";
  if (/^https?:\/\//i.test(href)) return "external";
  return null;
}

// An answer as paragraphs of pieces: { text } | { bold } | { link, href, kind }.
// Paragraphs are split on blank lines, single line breaks stay inside one.
export function parseHelp(s) {
  return String(s ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const out = [];
      const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
      let last = 0;
      let m;
      while ((m = re.exec(p))) {
        if (m.index > last) out.push({ text: p.slice(last, m.index) });
        if (m[1] != null) out.push({ bold: m[1] });
        else {
          const kind = linkKind(m[3]);
          out.push(kind ? { link: m[2], href: m[3], kind } : { text: m[2] });
        }
        last = re.lastIndex;
      }
      if (last < p.length) out.push({ text: p.slice(last) });
      return out;
    });
}
