import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Check, Link2, Search, X } from "lucide-react";
import { PageHeader, SectionHeading } from "../components/ui.jsx";
import { SocialIcon, useSocial } from "../components/SocialLinks.jsx";
import VideoEmbed from "../components/VideoEmbed.jsx";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { useApi } from "../hooks/useApi.js";
import { api } from "../api/client.js";
import { HELP_DEFAULTS } from "../data/helpDefaults.js";
import { answerWords, fillHelp, helpSlugs, matchesHelp, parseHelp } from "./helpText.mjs";

// ---------------------------------------------------------------------------
// /help — Help & troubleshooting.
//
// Asked for in the admin chat (2026-10): the same questions (checksums, being
// kicked, "where do I sign up") arrive in tickets and in the briefing channel
// right before a race, and an admin answers them one at a time. This page is
// the thing to point at instead. That is why every question has its own
// address (/help#<slug>) and a "Copy link" button: an admin pastes the link in
// Discord and the page opens on exactly that answer.
//
// The words are admin-edited (Admin -> Site texts -> Help, lib/helpFaq.js on
// the server); data/helpDefaults.js is what shows until somebody saves.
// Deliberately public: someone who cannot get on the server is exactly the
// person who should not have to sign in first.
// ---------------------------------------------------------------------------

// An answer on screen: paragraphs, **bold**, and [links](/somewhere).
function Answer({ text }) {
  return parseHelp(text).map((para, i) => (
    // pre-line: a single line break inside a paragraph stays one, so steps
    // written one per line read as steps.
    <p key={i} className="whitespace-pre-line">
      {para.map((piece, j) => {
        if (piece.bold != null) return <span key={j} className="font-semibold text-dark">{piece.bold}</span>;
        if (piece.link == null) return piece.text;
        const cls = "font-semibold text-link underline-offset-2 hover:underline";
        return piece.kind === "internal" ? (
          <Link key={j} to={piece.href} className={cls}>{piece.link}</Link>
        ) : (
          <a key={j} href={piece.href} target="_blank" rel="noopener noreferrer" className={cls}>{piece.link}</a>
        );
      })}
    </p>
  ));
}

function CopyLink({ slug }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  async function copy() {
    const url = `${window.location.origin}/help#${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard (old browser, http): the address bar still gets it.
      window.history.replaceState(null, "", `#${slug}`);
    }
  }
  const Icon = copied ? Check : Link2;
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
        copied ? "bg-emerald-500/15 text-ok" : "bg-surface2 text-medium hover:bg-border"
      }`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}

function HelpItem({ slug, q, a, video, open, highlight }) {
  return (
    <details
      id={slug}
      open={open}
      className={`anim-details group card scroll-mt-24 overflow-hidden transition-shadow ${
        highlight ? "ring-2 ring-accent/60" : ""
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 transition hover:bg-surface2 sm:px-5 sm:py-4">
        <span className="flex-1 text-[15px] font-semibold leading-snug text-dark">{q}</span>
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-eyebrow transition-transform duration-base group-open:rotate-45" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </summary>
      <div className="border-t border-border px-4 py-4 sm:px-5">
        <div className="space-y-3 text-sm leading-relaxed text-medium">
          <Answer text={a} />
        </div>
        {/* Still only a picture until somebody presses play (VideoEmbed), so a
            page full of answers does not load a player per question. */}
        {video && (
          <div className="mt-4 max-w-xl overflow-hidden rounded-xl border border-border">
            <VideoEmbed videoId={video} title={q} />
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <CopyLink slug={slug} />
        </div>
      </div>
    </details>
  );
}

export default function Help() {
  useSpecificTitle("Help & troubleshooting · NABS Racing League");
  const { hash } = useLocation();
  const social = useSocial();
  const discord = social.data?.discord;
  const saved = useApi(useCallback(() => api.helpFaq(), []));
  const [query, setQuery] = useState("");

  // Saved content wins; until the request is back the defaults are on screen,
  // so a deep link has something to open even before the answer arrives.
  const rawTopics = saved.data?.content?.topics?.length ? saved.data.content.topics : HELP_DEFAULTS.topics;
  // Live placeholders filled before anything else, so search and slugs see
  // the same words the reader does.
  const answers = saved.data?.answers;
  const topics = useMemo(() => {
    const tokens = { answers: answerWords(answers) };
    return rawTopics.map((t) => ({
      title: fillHelp(t.title, tokens),
      items: t.items.map((it) => ({ ...it, q: fillHelp(it.q, tokens), a: fillHelp(it.a, tokens) })),
    }));
  }, [rawTopics, answers]);
  const slugs = useMemo(() => helpSlugs(topics), [topics]);
  const target = decodeURIComponent((hash || "").replace(/^#/, ""));

  // Opened from a shared link: bring that answer into view once it exists.
  useEffect(() => {
    if (!target) return;
    const el = document.getElementById(target);
    if (el) el.scrollIntoView({ block: "start" });
  }, [target, slugs]);

  const q = query.trim();
  const filtered = useMemo(
    () =>
      topics
        .map((t, ti) => ({
          title: t.title,
          items: t.items
            .map((it, ii) => ({ ...it, slug: slugs[ti][ii] }))
            .filter((it) => !q || matchesHelp(it, q)),
        }))
        .filter((t) => t.items.length),
    [topics, slugs, q]
  );
  const hits = filtered.reduce((n, t) => n + t.items.length, 0);

  return (
    <div className="space-y-6 sm:space-y-10">
      <PageHeader
        eyebrow="Troubleshooting"
        title="Help"
        subtitle="The questions that come up most, and what to do about each one. Can't find yours? Ask in Discord, the link is at the bottom."
      />

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search, e.g. checksum, kicked, replay"
          aria-label="Search the help"
          className="input w-full pl-9 pr-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-light transition hover:bg-surface2"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {q && hits === 0 && (
        <p className="text-sm text-light">
          Nothing here matches &ldquo;{q}&rdquo;. Ask in Discord and we&rsquo;ll add it.
        </p>
      )}

      {filtered.map((t) => (
        <section key={t.title} className="space-y-3">
          <SectionHeading title={t.title} />
          <div className="space-y-2.5">
            {t.items.map((it) => (
              // While searching the matches are shown open: the answer is what
              // somebody typing "checksum" came for, not one more click.
              <HelpItem
                key={`${it.slug}:${q ? "s" : ""}`}
                slug={it.slug}
                q={it.q}
                a={it.a}
                video={it.video}
                open={!!q || it.slug === target}
                highlight={it.slug === target}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-extrabold uppercase tracking-tight text-dark">Still stuck?</div>
          <p className="mt-0.5 text-xs leading-relaxed text-light">
            Open a ticket in our Discord. Tell us what you tried and add a screenshot if you can.
          </p>
        </div>
        {discord && (
          <a
            href={discord}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4752c4]"
          >
            <SocialIcon name="discord" className="h-4 w-4" />
            Open Discord
          </a>
        )}
      </div>
    </div>
  );
}
