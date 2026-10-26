import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { CircleHelp, Download, FileCheck, Film, Flag, Folder, Info, Lock, Package, Search, TriangleAlert } from "../components/icons/filled.jsx";
import { api, withApiBase } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useDiscordLogin } from "../hooks/useDiscordLogin.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { seasonGameParts } from "../utils/seasonGame.js";
import { SectionHeading, ErrorBox, Skeleton, MEDAL } from "../components/ui.jsx";
import { answerWords, withLiveAnswers } from "../utils/signupAnswers.mjs";
import { SocialIcon } from "../components/SocialLinks.jsx";
import Icon from "../components/InfoIcon.jsx";
import { singularOne, threeLetterMonths } from "../utils/format.js";
import { RACE_INFO_DEFAULTS, RACE_INFO_EVENT_DEFAULTS } from "../data/raceInfoDefaults.js";
import { useSeries } from "../context/SeriesContext.jsx";
import { raceKickoff } from "../utils/raceTime.js";
import { carStoreUrl } from "../data/defaultLiveries.js";

// League default points. Fallback only; seasons can override via pointsTable.
const DEFAULT_POINTS = [35, 30, 25, 22, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1];

// The page text is admin-editable (Admin -> Race Info) and stored as plain
// strings. Two tiny render helpers turn those strings into JSX:
//   fill(...)  resolves {rounds}/{platform}/... placeholders,
//   rich(...)  turns **spans** into the bold highlight.
// An unresolved placeholder used to be echoed literally, so a season with no
// calendar yet (or a failed read) printed "Best {counted} of {rounds}" on a
// public page. Dropping the token leaves a slightly thin sentence; leaving it in
// leaves something that reads as broken software. Collapse the double spaces the
// removal creates, and tidy a token that was the whole value ("{rounds} rounds"
// with no number is not worth a line).
function fill(s, tokens) {
  return singularOne(withLiveAnswers(s)
    .replace(/\{(\w+)\}/g, (m, k) => (tokens[k] != null && tokens[k] !== "" ? String(tokens[k]) : ""))
    .replace(/\s{2,}/g, " ")
    .trim());
}
const BOLD = "font-semibold text-dark";
// The rulebook marks its key values a little louder, so "160 km/h" or
// "4 seconds" can be found again at a glance.
const MARK = "rounded bg-primary/30 px-1 font-semibold text-dark";
function bold(s, cls, keyBase = "") {
  const parts = String(s ?? "").split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return s;
  return parts.map((p, i) =>
    i % 2 ? <span key={`${keyBase}${i}`} className={cls}>{p}</span> : p
  );
}
// [label](https://...) becomes a link that opens in a new tab, so a special
// event's page can point at the car's store. Only http(s) addresses.
const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
function rich(s, cls = BOLD) {
  const str = String(s ?? "");
  if (!LINK.test(str)) return bold(s, cls);
  LINK.lastIndex = 0;
  const out = [];
  let last = 0;
  let m;
  while ((m = LINK.exec(str))) {
    if (m.index > last) out.push(bold(str.slice(last, m.index), cls, `t${m.index}-`));
    out.push(
      <a key={`a${m.index}`} href={m[2]} target="_blank" rel="noopener noreferrer" className="font-semibold text-link hover:underline">
        {m[1]}
      </a>
    );
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push(bold(str.slice(last), cls, "end-"));
  return out;
}
const text = (s, tokens) => rich(fill(s, tokens));

// Mono eyebrow, the same one SectionHeading uses.
const EYEBROW = "font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow";

// Jump to a section of this page without adding a history entry per click.
function jumpTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const still =
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
    document.documentElement.classList.contains("fx-lite");
  el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
}

// Rough reading time of the rules on this page, from the words actually in it.
function readMinutes(content, tokens) {
  const all = [
    content.subtitle,
    ...content.cards.flatMap((c) => [c.title, c.text]),
    content.pointsFootnote,
    ...content.rulebook.flatMap((g) => [g.subject, ...g.rules]),
    content.rulebookFootnote,
  ];
  const words = all.reduce((n, s) => n + (s ? fill(s, tokens).split(/\s+/).filter(Boolean).length : 0), 0);
  return Math.max(1, Math.round(words / 220));
}

// ----------------------------------------------------------------- header --

// Title on the left, a table of contents on the right (under it on a phone).
// Every row jumps to its section; the counts come from the same content the
// sections render, so they can't disagree.
function Header({ content, tokens, pointsCount, isLoggedIn, fileCount, requiredCount, isEvent = false }) {
  const ruleCount = content.rulebook.reduce((n, g) => n + g.rules.length, 0);
  const cardCount = content.cards.length;
  // Admin text (Race Info tab). Content saved before it was editable has no
  // key and keeps the standard hint; an empty one hides the box.
  const newHere = content.newHere ?? (isEvent ? RACE_INFO_EVENT_DEFAULTS : RACE_INFO_DEFAULTS).newHere;
  // A special event scores nothing, so it has no points section.
  const rows = [
    { id: "format", title: isEvent ? "How the event works" : "How the championship works", meta: `${cardCount} ${cardCount === 1 ? "card" : "cards"}` },
    !isEvent && { id: "points", title: "Points per finish", meta: pointsCount ? `P1 to P${pointsCount}` : null },
    { id: "regulations", title: "Sporting regulations", meta: `${ruleCount} ${ruleCount === 1 ? "rule" : "rules"}` },
    { id: "downloads", title: "Downloads", members: true },
  ].filter(Boolean);

  return (
    <header className="mb-4 grid grid-cols-1 gap-6 border-b border-border pb-5 sm:mb-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="min-w-0">
        <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow sm:text-[13px] sm:tracking-[0.2em]">
          Drivers&rsquo; handbook
        </div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight text-dark sm:text-4xl">Race Info</h1>
        {content.subtitle && (
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-light">{fill(content.subtitle, tokens)}</p>
        )}
        {newHere && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-dashed border-accent/40 bg-primary/15 px-4 py-3 text-sm text-medium">
            <Flag className="mt-0.5 h-4 w-4 shrink-0 text-eyebrow" strokeWidth={2} aria-hidden="true" />
            <span>{text(newHere, tokens)}</span>
          </div>
        )}
      </div>

      <nav aria-label="On this page" className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow">Contents</span>
          <span className="font-mono text-[11px] text-faint">~{readMinutes(content, tokens)} min read</span>
        </div>
        <ol className="divide-y divide-border text-sm">
          {rows.map((r, i) => {
            const n = String(i + 1).padStart(2, "0");
            const loud = r.members;
            return (
              <li key={r.id}>
                <a
                  href={`#${r.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    jumpTo(r.id);
                  }}
                  className={`flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface2 ${loud ? "bg-primary/10" : ""}`}
                >
                  <span className={`w-5 font-mono text-xs font-bold ${loud ? "text-eyebrow" : "text-faint"}`}>{n}</span>
                  <span className="min-w-0 flex-1 font-semibold text-dark">{r.title}</span>
                  {r.members ? (
                    isLoggedIn ? (
                      fileCount > 0 && (
                        <span className="font-mono text-[11px] text-light">
                          {fileCount} {fileCount === 1 ? "file" : "files"}
                          {requiredCount > 0 && ` · ${requiredCount} required`}
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-eyebrow">
                        <Lock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                        members
                      </span>
                    )
                  ) : (
                    r.meta && <span className="font-mono text-[11px] text-light">{r.meta}</span>
                  )}
                </a>
              </li>
            );
          })}
          <li>
            <Link to="/content-check" className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface2">
              <span className="w-5 font-mono text-xs font-bold text-faint">{String(rows.length + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1 font-semibold text-dark">Checksum failed? Content Check</span>
              <ChevronRight className="h-4 w-4 text-faint" strokeWidth={2} aria-hidden="true" />
            </Link>
          </li>
        </ol>
      </nav>
    </header>
  );
}

// ------------------------------------------------- championship format --

const ANSWER_CHIPS = [
  ["ACCEPTED", "Accepted", "bg-ok/10 text-ok"],
  ["TENTATIVE", "Tentative", "bg-warn/10 text-warn"],
  ["DECLINED", "Declined", "bg-bad/10 text-bad"],
];

// A small picture under a card, only where the card's own text talks about
// something the page knows live: the drop rule (which rounds count) and the
// sign-up answers. Keyed on the placeholders, so an admin rewrite of the
// wording keeps it, and a card that drops the placeholder loses it.
function CardVisual({ card, rounds, counted, answers }) {
  const raw = `${card.title} ${withLiveAnswers(card.text)}`;
  if (/\{(counted|drop)\}/.test(raw) && rounds > 0 && counted > 0 && counted < rounds) {
    return (
      <div className="mt-3 flex gap-1" role="img" aria-label={`${counted} of ${rounds} rounds count`}>
        {Array.from({ length: rounds }).map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < counted ? "bg-dark" : "bg-border"}`} />
        ))}
      </div>
    );
  }
  if (/\{answers\}/.test(raw)) {
    const on = Array.isArray(answers) ? answers : ANSWER_CHIPS.map(([k]) => k);
    const chips = ANSWER_CHIPS.filter(([k]) => on.includes(k));
    if (!chips.length) return null;
    return (
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-bold">
        {chips.map(([k, label, cls]) => (
          <span key={k} className={`rounded-md px-2 py-0.5 ${cls}`}>{label}</span>
        ))}
      </div>
    );
  }
  return null;
}

function FormatCards({ content, tokens, rounds, counted, answers, title = "How the championship works" }) {
  return (
    <section id="format" className="reveal scroll-mt-28 space-y-4">
      <SectionHeading eyebrow="01 · The rules" title={title} />
      <div className="cascade grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {content.cards.map((c, i) => (
          <div key={i} style={{ "--i": Math.min(i, 8) }}>
            <article className="card h-full p-5">
              <div className="flex items-start justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-onbrand">
                  <Icon name={c.icon} className="h-5 w-5" />
                </span>
                <span className="font-display text-4xl font-black leading-none text-faint" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-4 font-display text-lg font-extrabold uppercase tracking-tight text-dark">
                {fill(c.title, tokens)}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-medium">{text(c.text, tokens)}</p>
              <CardVisual card={c} rounds={rounds} counted={counted} answers={answers} />
            </article>
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------ points table --

function PointsTable({ content, tokens, pointsTable, fastestLapPoints }) {
  return (
    <section id="points" className="reveal scroll-mt-28 space-y-4">
      <SectionHeading
        eyebrow="02 · Scoring"
        title="Points per finish"
        right={
          <span className="font-mono text-[11px] uppercase tracking-wider text-light">
            P{pointsTable.length + 1}+ &amp; DNF = 0
          </span>
        }
      />
      <div className="card overflow-hidden">
        <div className="grid grid-cols-3 gap-px bg-border sm:grid-cols-6 lg:grid-cols-9">
          {pointsTable.map((pts, i) => {
            const medal = i < 3 ? MEDAL[i] : null;
            return (
              <div key={i} className="flex flex-col items-center justify-center bg-card py-3">
                <span
                  className="flex h-6 min-w-6 items-center justify-center rounded px-1 font-display text-xs font-black"
                  style={{ backgroundColor: medal || "transparent", color: medal ? "#0F172A" : "var(--c-text3)" }}
                >
                  P{i + 1}
                </span>
                <span className="mt-1 font-mono text-lg font-bold tabular-nums text-dark">{pts}</span>
              </div>
            );
          })}
        </div>
      </div>
      {fastestLapPoints > 0 && (
        <p className="text-xs leading-relaxed text-light">
          <span className="font-bold text-fl">Fastest lap:</span> the driver who sets the fastest race lap scores +
          {fastestLapPoints} on top of their finishing points, if they finish the race. On a sprint weekend the
          feature race and the sprint each pay it.
        </p>
      )}
      {content.pointsFootnote && (
        <p className="text-xs leading-relaxed text-light">{text(content.pointsFootnote, tokens)}</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------ the rulebook --

// Subjects on the left (swipeable chips on a phone), the chosen subject's
// numbered rules on the right. Subject n's rules are numbered n.1, n.2, ...
function Rulebook({ content, tokens, num = "03" }) {
  const groups = content.rulebook || [];
  const [sel, setSel] = useState(0);
  const total = groups.reduce((n, g) => n + g.rules.length, 0);
  if (!groups.length) return null;

  const at = Math.min(sel, groups.length - 1);
  const g = groups[at];

  return (
    <section id="regulations" className="reveal scroll-mt-28 space-y-4">
      <SectionHeading
        eyebrow={`${num} · On track`}
        title="Sporting regulations"
        right={
          <span className="hidden font-mono text-[11px] uppercase tracking-wider text-light sm:inline">
            {total} {total === 1 ? "rule" : "rules"}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Chips that scroll sideways on a phone, a list that stays in view
            below the site header on a desktop. */}
        <nav
          aria-label="Rule subjects"
          className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:sticky lg:top-[100px] lg:mx-0 lg:self-start lg:overflow-visible lg:px-0"
        >
          <ul className="flex min-w-max gap-2 pb-1 lg:min-w-0 lg:flex-col lg:gap-1 lg:rounded-xl lg:border lg:border-border lg:bg-card lg:p-2 lg:pb-2 lg:shadow-card">
            {groups.map((grp, i) => {
              const on = i === at;
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => setSel(i)}
                    aria-pressed={on}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                      on
                        ? "bg-ink text-white"
                        : "border border-border bg-card text-medium hover:bg-surface2 lg:border-transparent"
                    }`}
                  >
                    <span className={on ? "text-primary" : "text-eyebrow"}>
                      <Icon name={grp.icon} className="h-4 w-4" />
                    </span>
                    <span className="flex-1 whitespace-nowrap">{grp.subject}</span>
                    <span className={`font-mono text-[11px] ${on ? "text-white/60" : "text-faint"}`}>{grp.rules.length}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <article className="card min-w-0 overflow-hidden">
          <header className="flex items-center gap-3 border-b border-border px-5 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-onbrand">
              <Icon name={g.icon} className="h-5 w-5" />
            </span>
            <h3 className="min-w-0 flex-1 font-display text-lg font-extrabold uppercase tracking-tight text-dark">
              {g.subject}
            </h3>
            <span className="shrink-0 font-mono text-[11px] text-faint">
              {g.rules.length} {g.rules.length === 1 ? "rule" : "rules"} · §{at + 1}
            </span>
          </header>
          <ol className="divide-y divide-border">
            {g.rules.map((r, j) => (
              <li key={j} className="flex gap-4 px-5 py-3.5">
                <span className="shrink-0 pt-0.5 font-mono text-xs font-bold text-eyebrow">
                  {at + 1}.{j + 1}
                </span>
                <p className="text-sm leading-relaxed text-medium">{rich(r, MARK)}</p>
              </li>
            ))}
          </ol>
        </article>
      </div>
      {content.rulebookFootnote && (
        <p className="text-xs leading-relaxed text-light">{text(content.rulebookFootnote, tokens)}</p>
      )}
    </section>
  );
}

// -------------------------------------------------------------- downloads --

// Members-only gate. Behind the sign-in card sits a blurred stand-in for the
// file list: plain grey bars, never the real catalogue (a logged-out visitor
// can't read it, and nothing about the files belongs in this page's markup).
function LoginGate() {
  const { enabled, loading, start } = useDiscordLogin();
  return (
    <div className="card relative overflow-hidden">
      <div className="pointer-events-none select-none divide-y divide-border opacity-60 blur-[3px]" aria-hidden="true">
        {[44, 36, 52, 40, 30, 48].map((w, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <span className="h-8 w-8 shrink-0 rounded-lg bg-surface2" />
            <span className="flex-1 space-y-1.5">
              <span className="block h-3.5 rounded bg-dark/60" style={{ width: `${w}%` }} />
              <span className="block h-2.5 w-24 rounded bg-border" />
            </span>
            <span className="h-8 w-9 shrink-0 rounded-lg bg-primary sm:w-24" />
          </div>
        ))}
      </div>
      <div
        className="absolute inset-0 flex items-center justify-center p-4"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--c-card) 40%, transparent), color-mix(in srgb, var(--c-card) 90%, transparent))",
        }}
      >
        <div className="flex w-full max-w-xl flex-col items-center gap-4 rounded-xl border border-border bg-card p-5 text-center shadow-lift sm:flex-row sm:text-left">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#5865F2]/15 text-[#5865F2]">
            <Lock className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Members only</h3>
            <p className="mt-0.5 text-sm text-light">
              Sign in with Discord to get the tracks, safety car, Custom Shaders Patch, Real Penalty and more.
            </p>
          </div>
          {loading ? (
            <span className="text-sm text-light">…</span>
          ) : enabled ? (
            <button
              onClick={start}
              className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4752c4] sm:w-auto"
            >
              <SocialIcon name="discord" className="h-5 w-5" />
              Sign in
            </button>
          ) : (
            <p className="text-sm text-medium sm:max-w-[10rem]">Discord login is not configured yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// A file counts as new for two weeks after it was put on the server.
const NEW_FOR_MS = 14 * 24 * 3600 * 1000;

function fmtUpdated(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const opts = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return threeLetterMonths(d.toLocaleDateString("en-GB", opts));
}

const version = (v) => (v ? (/^v/i.test(v) ? v : `v${v}`) : "");

// Shared column layout of the header row and the file rows. Below md the row
// folds into name + button with the details on a second line.
const COLS = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 md:grid-cols-[minmax(0,1fr)_90px_90px_110px_130px] md:gap-4 md:px-5";

function FileRow({ item, round, highlight }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const { url, external } = await api.downloadTicket(item.id);
      if (external) window.open(url, "_blank", "noopener,noreferrer");
      else window.location.href = withApiBase(url); // browser download (resumable), API-origin aware
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const updated = fmtUpdated(item.updatedAt);
  const isNew = item.updatedAt && Date.now() - new Date(item.updatedAt).getTime() < NEW_FOR_MS;
  const size = item.external ? "External link" : item.sizeText;
  const FileIcon = item.external ? ExternalLink : item.raceId ? Film : Package;
  const label = busy ? "Preparing…" : item.external ? "Open link" : "Download";

  return (
    <div
      id={`dl-${item.id}`}
      className={`${COLS} scroll-mt-28 py-2.5 ${highlight ? "bg-primary/10 ring-2 ring-inset ring-brand" : ""}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface2 text-medium">
          <FileIcon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="min-w-0 truncate text-sm font-semibold text-dark">{item.title}</span>
            {item.required && (
              <span className="shrink-0 rounded bg-warn/15 px-1.5 py-px font-mono text-[9px] font-bold uppercase text-warn">
                Required
              </span>
            )}
            {isNew && (
              <span className="shrink-0 rounded bg-primary/50 px-1.5 py-px font-mono text-[9px] font-bold uppercase text-dark">
                New
              </span>
            )}
            {round != null && (
              <span className="shrink-0 rounded bg-link/10 px-1.5 py-px font-mono text-[9px] font-bold uppercase text-link">
                R{round}
              </span>
            )}
          </div>
          <span className="block font-mono text-[11px] text-light md:hidden">
            {[version(item.version), size, updated].filter(Boolean).join(" · ")}
          </span>
          {item.description && <p className="mt-0.5 text-xs leading-relaxed text-light">{item.description}</p>}
          {item.installNote && (
            <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-warn">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span>{item.installNote}</span>
            </p>
          )}
        </div>
      </div>
      <span className="hidden self-start pt-2 font-mono text-xs text-medium md:block">{version(item.version)}</span>
      <span className="hidden self-start pt-2 text-right font-mono text-xs text-medium md:block">
        {item.external ? "" : item.sizeText}
      </span>
      <span className="hidden self-start pt-2 text-xs text-light md:block">{updated}</span>
      <span className="flex justify-end self-start">
        {item.available ? (
          <button
            type="button"
            onClick={go}
            disabled={busy}
            aria-label={`${label}: ${item.title}`}
            className={`inline-flex min-h-8 min-w-9 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:cursor-wait disabled:opacity-60 md:px-3 ${
              item.external ? "bg-surface2 text-dark hover:bg-border" : "bg-primary text-onbrand hover:bg-primary-dark"
            }`}
          >
            {item.external ? (
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            ) : (
              <Download className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            )}
            <span className="hidden md:inline">{label}</span>
          </button>
        ) : (
          <span className="pt-2 text-xs text-faint">Coming soon</span>
        )}
      </span>
      {err && <p className="col-span-full text-xs font-medium text-bad">{err}</p>}
    </div>
  );
}

// The catalogue as one dense list, grouped by the admin's folders. A folder
// that holds nothing but race replays starts folded away; every other folder
// is open. The ?dl=<id> deep link (the Races page's "Replay" button) opens the
// folder holding that entry, scrolls to it and highlights the row.
function Catalogue({ data, loading, error, reload, query, roundOf }) {
  const [params] = useSearchParams();
  const highlightId = params.get("dl");
  const [toggled, setToggled] = useState({});

  const groups = useMemo(() => {
    const items = data?.downloads || [];
    const folders = data?.folders || [];
    const known = new Set(folders.map((f) => f.id));
    const out = folders
      .map((f) => ({ key: f.id, name: f.name, description: f.description, items: items.filter((i) => i.folderId === f.id) }))
      .filter((g) => g.items.length > 0);
    const loose = items.filter((i) => !i.folderId || !known.has(i.folderId));
    if (loose.length) out.push({ key: "loose", name: "More files", description: null, items: loose });
    return out.map((g) => ({ ...g, replays: g.items.every((i) => i.raceId) }));
  }, [data]);

  useEffect(() => {
    if (!highlightId || !data) return;
    // Keep nudging until the row actually sits in the viewport: the page
    // remounts once the season context resolves (scroll resets to top) and
    // the entrance animations shift the layout, so a single scroll attempt
    // reliably lands short. Instant jumps can't be cancelled mid-animation.
    const timers = [300, 800, 1500, 2400].map((ms) =>
      setTimeout(() => {
        const el = document.getElementById(`dl-${highlightId}`);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const inView = r.top >= 0 && r.bottom <= window.innerHeight;
        if (!inView) el.scrollIntoView({ behavior: "auto", block: "center" });
      }, ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [highlightId, data]);

  if (loading)
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
      </div>
    );
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  if (!groups.length)
    return (
      <div className="card p-10 text-center text-medium">
        <Package className="mx-auto h-8 w-8 text-faint" strokeWidth={2} aria-hidden="true" />
        <p className="mt-3 text-sm">No downloads have been added yet.</p>
      </div>
    );

  const q = query.trim().toLowerCase();
  const matches = (it, g) =>
    !q || [it.title, it.description, it.version, g.name].some((s) => s && String(s).toLowerCase().includes(q));
  const shownGroups = groups
    .map((g) => ({ ...g, hits: g.items.filter((it) => matches(it, g)) }))
    .filter((g) => g.hits.length > 0);

  return (
    <div className="card overflow-hidden">
      <div className={`${COLS} hidden border-b border-border bg-surface2/60 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-light md:grid`}>
        <span>File</span>
        <span>Version</span>
        <span className="text-right">Size</span>
        <span>Updated</span>
        <span />
      </div>
      {!shownGroups.length && (
        <p className="px-5 py-8 text-center text-sm text-light">No file matches &ldquo;{query.trim()}&rdquo;.</p>
      )}
      <div className="divide-y divide-border">
        {shownGroups.map((g) => {
          const byDefault = !g.replays || g.items.some((it) => it.id === highlightId);
          const open = q ? true : toggled[g.key] != null ? toggled[g.key] : byDefault;
          return (
            <div key={g.key} className="divide-y divide-border">
              <button
                type="button"
                onClick={() => setToggled((t) => ({ ...t, [g.key]: !open }))}
                aria-expanded={open}
                disabled={!!q}
                className="flex w-full items-center gap-2 bg-surface2/30 px-4 py-2 text-left transition hover:bg-surface2 disabled:cursor-default disabled:hover:bg-surface2/30 md:px-5"
              >
                <Folder className="h-3.5 w-3.5 shrink-0 text-eyebrow" strokeWidth={2} aria-hidden="true" />
                <span className="font-display text-xs font-extrabold uppercase tracking-tight text-dark">{g.name}</span>
                <span className="font-mono text-[10px] text-faint">{g.hits.length}</span>
                {!q && (
                  <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-link">
                    {!open && "Show"}
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform duration-base ${open ? "" : "-rotate-90"}`}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </span>
                )}
              </button>
              {open && g.description && (
                <p className="px-4 py-2 text-xs leading-relaxed text-light md:px-5">{g.description}</p>
              )}
              {open &&
                g.hits.map((it) => (
                  <FileRow key={it.id} item={it} round={it.raceId ? roundOf.get(it.raceId) ?? null : null} highlight={it.id === highlightId} />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The downloads are where a wrong mod version comes from, so the page that
// finds one belongs right under them, and it needs no login: being unable to
// join is not a reason to make somebody sign in first.
function ContentCheckNotice({ num = "05" }) {
  return (
    <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warn/10 text-warn">
        <TriangleAlert className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className={EYEBROW}>{num} · Content Check</div>
        <h3 className="mt-1 font-display text-base font-extrabold uppercase tracking-tight text-dark sm:text-lg">
          Kicked with &ldquo;Checksum failed&rdquo;?
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-light">
          The Content Check compares your files with the race server&rsquo;s and names the one that doesn&rsquo;t
          match. No sign-in needed.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row">
        <Link
          to="/content-check"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-bold text-white transition hover:bg-ink/85 focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          <FileCheck className="h-4 w-4 text-primary" strokeWidth={2} aria-hidden="true" />
          Run Content Check
        </Link>
        <Link
          to="/help"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-medium transition hover:bg-surface2 focus:outline-none focus:ring-2 focus:ring-border"
        >
          <CircleHelp className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          Other problems
        </Link>
      </div>
    </div>
  );
}

export default function Downloads() {
  const { isLoggedIn } = useAuth();
  const { current: season } = useSeason();
  const races = useApi(useCallback(() => api.races(), []));
  const info = useApi(useCallback(() => api.raceInfo(), []));
  // The catalogue is members only; a logged-out visitor never asks for it.
  const files = useApi(useCallback(() => (isLoggedIn ? api.downloads() : Promise.resolve(null)), [isLoggedIn]));
  const [query, setQuery] = useState("");

  // A special event has a page of its own (its car, its format, no points).
  const { current: series } = useSeries();
  const isEvent = info.data ? !!info.data.event : series?.kind === "event";
  // Admin-saved content wins; the built-in defaults cover a fresh site.
  const content = info.data?.content || (isEvent ? RACE_INFO_EVENT_DEFAULTS : RACE_INFO_DEFAULTS);
  // When the livery links are due: the day before the race, an hour before
  // its clock time (backend lib/eventCars.js).
  const eventKickoff = isEvent ? raceKickoff((races.data || []).find((r) => !r.isCompleted)?.date || races.data?.[0]?.date) : null;
  const liveryDue = eventKickoff
    ? `${new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC", weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      }).format(new Date(eventKickoff.getTime() - 25 * 3600e3))} UTC`
    : "the day before the race";

  // Live numbers the text placeholders can reference.
  const { era, platform } = seasonGameParts(season);
  const champRaces = (races.data || []).filter((r) => !r.isSpecialEvent && r.number != null);
  const totalRounds = champRaces.length;
  const dropWorst = season?.dropWorst ?? 3;
  const counted = dropWorst > 0 && totalRounds > dropWorst ? totalRounds - dropWorst : totalRounds;
  const teamDrop = season?.teamDropWorst ?? null;
  const tokens = {
    rounds: totalRounds || "",
    counted: counted || "",
    drop: dropWorst || "",
    // Team-level drop count when the season uses it, else blank.
    teamDrop: teamDrop != null && teamDrop > 0 ? teamDrop : "",
    platform: platform || "Assetto Corsa",
    era: era || "Formula 1",
    // Only the sign-up buttons that exist (Admin -> Notifications).
    answers: answerWords(info.data?.answers),
    car: season?.game || series?.game || "",
    // "[Get the car](store)" for a car we know the shop of, else nothing.
    carLink: carStoreUrl(season?.game || series?.game) ? `[Get the car here](${carStoreUrl(season?.game || series?.game)}).` : "",
    deadline: liveryDue,
  };
  const pointsTable =
    Array.isArray(season?.pointsTable) && season.pointsTable.length ? season.pointsTable : DEFAULT_POINTS;

  // Replays carry their race; the list tags them with that round's number.
  const roundOf = useMemo(
    () => new Map((races.data || []).filter((r) => r.number != null).map((r) => [r.id, r.number])),
    [races.data]
  );
  const fileCount = files.data?.downloads?.length || 0;
  const requiredCount = (files.data?.downloads || []).filter((d) => d.required).length;

  return (
    <div className="space-y-6 sm:space-y-12">
      <Header
        content={content}
        tokens={tokens}
        pointsCount={pointsTable.length}
        isLoggedIn={isLoggedIn}
        fileCount={fileCount}
        requiredCount={requiredCount}
        isEvent={isEvent}
      />

      <div className="space-y-7 sm:space-y-10">
        <FormatCards
          content={content}
          tokens={tokens}
          rounds={totalRounds}
          counted={counted}
          answers={info.data?.answers}
          title={isEvent ? "How the event works" : undefined}
        />
        {!isEvent && (
          <PointsTable
            content={content}
            tokens={tokens}
            pointsTable={pointsTable}
            fastestLapPoints={season?.fastestLapPoints}
          />
        )}
        <Rulebook content={content} tokens={tokens} num={isEvent ? "02" : "03"} />
      </div>

      <section id="downloads" className="reveal scroll-mt-28 space-y-4">
        <SectionHeading
          eyebrow={`${isEvent ? "03" : "04"} · Members`}
          title="Downloads"
          right={
            isLoggedIn ? (
              fileCount > 0 && (
                <label className="relative w-44 sm:w-64">
                  <span className="sr-only">Filter the downloads</span>
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Filter ${fileCount} ${fileCount === 1 ? "file" : "files"}`}
                    className="input pl-9"
                  />
                </label>
              )
            ) : (
              <span className="hidden font-mono text-[11px] uppercase tracking-wider text-light sm:inline">
                Tracks · Mods · Car pack
              </span>
            )
          }
        />
        {isLoggedIn ? (
          <Catalogue
            data={files.data}
            loading={files.loading}
            error={files.error}
            reload={files.reload}
            query={query}
            roundOf={roundOf}
          />
        ) : (
          <LoginGate />
        )}
        <ContentCheckNotice num={isEvent ? "04" : "05"} />
      </section>
    </div>
  );
}
