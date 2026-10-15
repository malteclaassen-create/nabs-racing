// The words over each slide: headlines that rise in word by word, numbers
// that count up on the story's clock, outlined words sliding behind.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// "Your best race." -> each word rising in after the one before.
export function words(text, d0 = 0.15, step = 0.08) {
  return String(text)
    .split(/\s+/)
    .map((w, i) => `<span class="w"><span style="--d:${(d0 + i * step).toFixed(2)}s">${esc(w)}</span></span>`)
    .join(" ");
}

// A number that counts up from `from` over `dur` seconds, starting at `at`.
export function count(n, { from = 0, at = 0.3, dur = 1.2, prefix = "", suffix = "" } = {}) {
  return `<span data-count="${n}" data-from="${from}" data-at="${at}" data-dur="${dur}" data-prefix="${esc(prefix)}" data-suffix="${esc(suffix)}">${esc(prefix)}${from}${esc(suffix)}</span>`;
}

export const fade = (html, d = 0) => `<div class="fade" style="--d:${d}s">${html}</div>`;
export const pop = (html, d = 0, cls = "") => `<div class="pop ${cls}" style="--d:${d}s">${html}</div>`;
export const slam = (html, d = 0, cls = "") => `<div class="slam ${cls}" style="--d:${d}s">${html}</div>`;
export const marquee = (text, top, rev = false) =>
  `<div class="marquee${rev ? " rev" : ""}" style="top:${top}"><span>${esc(text)} ${esc(text)} ${esc(text)} </span><span>${esc(text)} ${esc(text)} ${esc(text)} </span></div>`;
export const hint = (text, d = 1.4) => `<div class="hint fade" style="--d:${d}s"><b></b>${esc(text)}</div>`;

const ease = (k) => 1 - Math.pow(1 - k, 3);

export function view(html) {
  const el = document.createElement("div");
  el.className = "slide";
  el.innerHTML = html;
  const counters = [...el.querySelectorAll("[data-count]")].map((n) => ({
    n,
    to: Number(n.dataset.count),
    from: Number(n.dataset.from),
    at: Number(n.dataset.at),
    dur: Number(n.dataset.dur),
    pre: n.dataset.prefix,
    suf: n.dataset.suffix,
    shown: null,
  }));
  return {
    el,
    update(t) {
      for (const c of counters) {
        const k = Math.min(1, Math.max(0, (t - c.at) / c.dur));
        const v = Math.round(c.from + (c.to - c.from) * ease(k));
        if (v !== c.shown) {
          c.shown = v;
          c.n.textContent = `${c.pre}${v.toLocaleString("en-US")}${c.suf}`;
        }
      }
    },
  };
}
