import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, RotateCw } from "lucide-react";
import { ErrorBox, Spinner } from "./ui.jsx";
import SlidingTabs from "./SlidingTabs.jsx";
import "./widgetRenderer.css";

// ---------------------------------------------------------------------------
// The iPhone widgets, in the personal area: every widget drawn with the
// member's own numbers, and how to get them onto the phone.
//
// This was a page of its own (public/widget-preview.html, which now sends
// people here) in the widgets' own look. The drawing is still done by the same files, because they are the
// ones the phones run: scriptable.js stands in for the Scriptable app,
// nabs-core.js is the widget code itself, and nabs-setup.js names the widgets.
// They live in public/widget-preview/ and are read from there at runtime, so a
// new widget version needs no change here.
// ---------------------------------------------------------------------------

const FILES = "/widget-preview/";
const BASE_URL = "https://nabsracing.com";

// The two leagues the widgets know. "" is the main series, the widgets' default.
const SERIES = [
  { slug: "", label: "F1 Friday" },
  { slug: "sunday-championship", label: "Sunday Championship" },
];

// Widget sizes in points, as iOS hands them to the widget.
const DEVICES = {
  pro: {
    label: "iPhone 15 / 16 (393 pt)", screen: [393, 852],
    small: [158, 158], medium: [338, 158], large: [338, 354],
    accessoryRectangular: [160, 72], accessoryCircular: [72, 72], accessoryInline: [234, 26],
  },
  pro17: {
    label: "iPhone 16 Pro / 17 Pro (402 pt)", screen: [402, 874],
    small: [162, 162], medium: [347, 162], large: [347, 364],
    accessoryRectangular: [164, 74], accessoryCircular: [74, 74], accessoryInline: [240, 26],
  },
  promax: {
    label: "iPhone Pro Max / Plus (430 pt)", screen: [430, 932],
    small: [170, 170], medium: [364, 170], large: [364, 382],
    accessoryRectangular: [172, 76], accessoryCircular: [76, 76], accessoryInline: [257, 26],
  },
  mini: {
    label: "iPhone mini / 11 Pro (375 pt)", screen: [375, 812],
    small: [155, 155], medium: [329, 155], large: [329, 345],
    accessoryRectangular: [157, 70], accessoryCircular: [70, 70], accessoryInline: [224, 26],
  },
};

const FAMILIES = {
  home: [
    { key: "small", label: "Small" },
    { key: "medium", label: "Medium" },
    { key: "large", label: "Large" },
  ],
  lock: [
    { key: "accessoryRectangular", label: "Rectangle" },
    { key: "accessoryCircular", label: "Round" },
    { key: "accessoryInline", label: "Line" },
  ],
};

// One line per widget.
const BLURBS = {
  auto: "Shows the latest result after a race, the next race before one.",
  result: "The last race: winner, podium and your own result.",
  next: "The next race with the countdown and the table.",
  countdown: "Days and hours until lights out.",
  live: "The session's fastest laps while the server is running.",
  standings: "The driver standings with your row highlighted.",
  top3: "The podium of the championship, and where you are.",
  constructors: "The constructors table of your tier, with your team.",
  card: "Your driver card with your rating.",
  me: "Your season: position, points, and the drivers around you.",
  teammate: "You against your teammate, head to head.",
  signup: "Are you signed up, and how many seats are left.",
  attendance: "How many races you drove this season.",
  form: "Your last six results at a glance.",
  rivals: "The driver ahead of you and the one behind, in points.",
};

const STORE_KEY = "nabs-widgets";
function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function writeSaved(v) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch {
    /* a private window: the choice just isn't remembered */
  }
}

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

// The widget list is read off the setup, the way the phone gets it. Parsed by
// pattern rather than evaluated: it is one line per widget.
function parseWidgets(setup) {
  const block = setup.match(/const WIDGETS = \[([\s\S]*?)\n\]/);
  if (!block) return [];
  const out = [];
  for (const m of block[1].matchAll(/\{[^}]*\}/g)) {
    const name = m[0].match(/name:\s*"([^"]+)"/)?.[1];
    const view = m[0].match(/view:\s*"([^"]+)"/)?.[1];
    if (name && view) out.push({ name, view, driver: /driver:\s*true/.test(m[0]) });
  }
  return out;
}

// Renderer, widget code and widget list: loaded once per visit.
let enginePromise = null;
function loadEngine() {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import(/* @vite-ignore */ `${FILES}scriptable.js`),
      fetchText(`${FILES}nabs-setup.js`),
      fetchText(`${FILES}nabs-core.js`),
    ])
      .then(([S, setup, core]) => {
        const v = setup.match(/const SETUP_VERSION = "([^"]+)"/);
        return {
          S,
          core,
          widgets: parseWidgets(setup),
          // The setup saves the core as "NABS Core 73" and every widget script
          // imports it by that name.
          coreName: v ? `NABS Core ${v[1].replace(/\./g, "")}` : "NABS Core",
        };
      })
      .catch((e) => {
        enginePromise = null; // the next visit tries again
        throw e;
      });
  }
  return enginePromise;
}

async function widgetData(name, series, scope) {
  const q = new URLSearchParams();
  if (series) q.set("series", series);
  q.set("driver", name);
  if (scope) q.set("scope", scope);
  try {
    const r = await fetch(`/api/widget?${q}`, { cache: "no-cache" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// The leagues this driver races in: the ones whose table has their name.
async function findMember(name) {
  const series = [];
  let tier = null;
  for (const s of SERIES) {
    const d = await widgetData(name, s.slug);
    if (d?.me) {
      series.push({ slug: s.slug, label: d.series?.name || s.label });
      if (tier == null) tier = d.me.tier ?? null;
    }
  }
  return { series, tier };
}

// Drawing runs a whole widget script each time, so a handful at once and the
// rest queued, rather than forty requests and scripts in the same instant.
const queue = [];
let running = 0;
function enqueue(job) {
  queue.push(job);
  pump();
}
function pump() {
  while (running < 6 && queue.length) {
    const job = queue.shift();
    running += 1;
    Promise.resolve()
      .then(job)
      .catch(() => {})
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

// The two lines the setup writes into every "NABS · …" script.
const widgetScript = (coreName, view) => `const nabs = importModule("${coreName}")\nawait nabs.run("${view}")\n`;

// The countdowns tick on their own, as they do on the phone.
const mounted = new Set();

function WidgetTile({ engine, pass, widget, family, size, zoom, lock }) {
  const host = useRef(null);
  const [status, setStatus] = useState("busy");
  const [drawn, setDrawn] = useState(false); // something on screen already
  const [error, setError] = useState("");
  const [w, h] = size;

  useEffect(() => {
    let alive = true;
    let node = null;
    setStatus("busy");
    enqueue(async () => {
      if (!alive) return;
      const { S, core, coreName } = engine;
      const ctx = {
        family,
        param: "",
        source: "live",
        offset: 0,
        store: pass.store,
        screen: pass.screen,
        // The widget code asks nabsracing.com; here it asks this site, which
        // is the same thing in production and the local backend in development.
        fetchUrl: (u) => {
          const url = new URL(u);
          url.searchParams.delete("t");
          return url.pathname + url.search;
        },
        mock: null,
        modules: { [coreName]: core },
        logs: [],
        requests: [],
        name: widget.name,
        widget: null,
      };
      try {
        const out = await S.createRuntime(ctx).runScript(widgetScript(coreName, widget.view), widget.name);
        if (!out) throw new Error("The script drew no widget.");
        if (!alive) return;
        node = S.renderWidget(out, family, w, h, { now: () => Date.now() });
        host.current?.replaceChildren(node);
        await document.fonts.ready;
        if (!alive) return;
        S.fitTexts(node);
        mounted.add(node);
        setDrawn(true);
        setStatus("ok");
      } catch (e) {
        if (!alive) return;
        setError(String(e?.message || e));
        setStatus("error");
      }
    });
    return () => {
      alive = false;
      if (node) mounted.delete(node);
    };
  }, [engine, pass, widget, family, w, h]);

  return (
    <div className="relative" style={{ width: w * zoom, height: h * zoom }}>
      <div
        className={lock ? `wg-lock wg-lock-${family}` : undefined}
        style={{ width: w, height: h, transform: `scale(${zoom})`, transformOrigin: "0 0", opacity: status === "busy" ? 0.5 : 1, transition: "opacity 150ms" }}
      >
        <div ref={host} />
      </div>
      {status === "busy" && !drawn && (
        <div className="absolute inset-0 animate-pulse rounded-[22px] bg-surface2" aria-hidden="true" />
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col justify-center gap-1 overflow-hidden rounded-[22px] border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300">
          <b>Could not draw this one</b>
          <span className="line-clamp-3 break-words">{error}</span>
        </div>
      )}
    </div>
  );
}

// One widget: its name, what it shows, and every size of it. The sizes shrink
// to fit a narrow phone, never grow past `base`.
function WidgetCard({ engine, pass, widget, families, device, base }) {
  const body = useRef(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = body.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setAvail(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lock = families[0]?.key.startsWith("accessory");
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border px-4 py-3.5 sm:px-5">
        <h3 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">
          {widget.name.replace(/^NABS · /, "")}
        </h3>
        {BLURBS[widget.view] && <p className="mt-0.5 text-sm text-light">{BLURBS[widget.view]}</p>}
      </div>
      <div ref={body} className="wg-plate flex flex-wrap items-start gap-x-5 gap-y-4 p-4 sm:p-5">
        {avail > 0 &&
          families.map((f) => {
            const size = device[f.key];
            const zoom = Math.min(base, avail / size[0]);
            return (
              <figure key={f.key} className="m-0 flex flex-col gap-2">
                <figcaption className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                  {f.label}
                </figcaption>
                <WidgetTile engine={engine} pass={pass} widget={widget} family={f.key} size={size} zoom={zoom} lock={lock} />
              </figure>
            );
          })}
      </div>
    </section>
  );
}

function CopyInstaller() {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const pre = useRef(null);
  useEffect(() => {
    fetchText(`${FILES}nabs-installer.js`).then(setCode, () => setCode(""));
  }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // an older browser: show the text selected, to copy by hand
      setOpen(true);
      requestAnimationFrame(() => {
        if (!pre.current) return;
        const r = document.createRange();
        r.selectNodeContents(pre.current);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      });
    }
  }
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={copy} disabled={!code}>
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy installer"}
        </button>
        <button type="button" className="text-sm font-semibold text-link hover:underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide the text" : "Show the text"}
        </button>
      </div>
      {open && (
        <pre ref={pre} className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-surface2 p-3 font-mono text-[11px] leading-relaxed text-light">
          {code}
        </pre>
      )}
    </div>
  );
}

const STEPS = (name) => [
  {
    title: "Install Scriptable.",
    body: (
      <>
        It is the free app that draws the widgets.{" "}
        <a href="https://apps.apple.com/app/scriptable/id1405459188" target="_blank" rel="noopener noreferrer" className="font-semibold text-link hover:underline">
          Open it in the App Store
        </a>
        , then open the app once.
      </>
    ),
  },
  { title: "Copy the installer.", body: <>A short piece of text that fetches the NABS setup.<CopyInstaller /></> },
  {
    title: "Paste it into Scriptable and run it.",
    body: (
      <>
        In Scriptable tap <b className="text-dark">+</b> (top right), paste, and tap the <b className="text-dark">▶︎</b> button. It loads the
        setup from nabsracing.com and starts it.
      </>
    ),
  },
  {
    title: "Answer the questions.",
    body: (
      <>
        Your driver name, exactly as on the website (<b className="text-dark">{name || "your name on nabsracing.com"}</b>), then your
        series. If you race in Tier 2 you can choose to compare only with your own tier. The setup creates one script per widget, named
        &ldquo;NABS · …&rdquo;.
      </>
    ),
  },
  {
    title: "Put a widget on your home screen.",
    body: (
      <>
        Press and hold an empty spot, tap <b className="text-dark">+</b>, search <b className="text-dark">Scriptable</b>, pick a size and tap{" "}
        <b className="text-dark">Add Widget</b>. Then press and hold the new widget, tap <b className="text-dark">Edit Widget</b>, and next to{" "}
        <b className="text-dark">Script</b> choose one of the &ldquo;NABS · …&rdquo; scripts. The sizes above are the ones to pick: small,
        medium or large.
      </>
    ),
  },
  {
    title: "Lock screen widgets (optional).",
    body: (
      <>
        Press and hold the lock screen, tap <b className="text-dark">Customize</b>, tap a widget slot, choose{" "}
        <b className="text-dark">Scriptable</b> and then a &ldquo;NABS · …&rdquo; script the same way.
      </>
    ),
  },
];

const TIPS = [
  "You can stack several NABS widgets on top of each other and swipe through them.",
  "iOS decides when a widget redraws, so numbers can be a few minutes old. The countdowns tick on their own.",
  "A widget that looks old after an update: press and hold it, tap Edit Widget and choose the script again.",
  "To update to a newer version, run the installer in Scriptable again.",
  "Tapping a widget opens the matching page on nabsracing.com.",
];

function HowTo({ name, innerRef }) {
  return (
    <section ref={innerRef} className="card scroll-mt-28 p-5 sm:p-6">
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">About two minutes, once</div>
      <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark sm:text-2xl">Get them on your iPhone</h2>
      <p className="mt-1 text-sm text-light">It works with the free app Scriptable.</p>
      <ol className="mt-5 space-y-4">
        {STEPS(name).map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand font-mono text-[13px] font-black text-ink">
              {i + 1}
            </span>
            <div className="min-w-0 pt-0.5 text-[15px] leading-relaxed text-light">
              <b className="text-dark">{s.title}</b> {s.body}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 border-t border-border pt-4">
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">Good to know</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-light">
          {TIPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const SELECT = "input w-auto min-w-0 py-1.5 font-sans text-sm font-semibold normal-case tracking-normal";
const LABEL = "flex min-w-0 flex-col gap-1 font-mono text-[10.5px] font-bold uppercase tracking-wider text-light";

export default function WidgetsSection({ driverName, isPublic = true, isAdmin = false }) {
  const [engine, setEngine] = useState(null);
  const [engineError, setEngineError] = useState(null);
  const [member, setMember] = useState(null); // { series, tier }
  const saved = useMemo(readSaved, []);
  const [series, setSeries] = useState(saved.series ?? null);
  const [scope, setScope] = useState(saved.scope === "tier" ? "tier" : "all");
  const [deviceKey, setDeviceKey] = useState(DEVICES[saved.device] ? saved.device : "pro");
  const [screen, setScreen] = useState(saved.screen === "lock" ? "lock" : "home");
  const [reloads, setReloads] = useState(0);
  const howTo = useRef(null);
  const base = typeof window !== "undefined" && window.innerWidth >= 1024 ? 1.15 : 1;

  const loadAll = useCallback(() => {
    setEngineError(null);
    loadEngine().then(setEngine, (e) => setEngineError(String(e?.message || e)));
  }, []);
  useEffect(loadAll, [loadAll]);

  useEffect(() => {
    let alive = true;
    if (!driverName) {
      setMember({ series: [], tier: null });
      return undefined;
    }
    findMember(driverName).then((m) => alive && setMember(m));
    return () => {
      alive = false;
    };
  }, [driverName]);

  // The series shown: the remembered one if this driver races there, else
  // their first.
  const seriesSlug = member?.series.some((s) => s.slug === series) ? series : member?.series[0]?.slug ?? "";
  const found = !!member?.series.length;
  const tierChoice = found && (member.tier === 1 || member.tier === 2);
  const shownScope = tierChoice ? scope : "all";

  useEffect(() => {
    if (member) writeSaved({ series: seriesSlug, scope, device: deviceKey, screen });
  }, [member, seriesSlug, scope, deviceKey, screen]);

  const device = DEVICES[deviceKey];

  // Everything one round of drawing shares: the settings file the setup would
  // have written on the phone, and the files the widget code keeps between
  // runs. A new pass whenever any of it changes, or on Reload.
  const pass = useMemo(() => {
    if (!engine || !member) return null;
    const store = new Map();
    const now = Date.now();
    const docs = engine.S.LOCAL_DOCS;
    store.set(`${docs}/nabs-settings.json`, {
      value: JSON.stringify({ driver: found ? driverName : "", series: seriesSlug, scope: shownScope }),
      mtime: now,
    });
    // Keeps the widget code from looking for an update of itself.
    store.set(`${docs}/nabs-update-check.txt`, { value: String(now), mtime: now });
    return { store, screen: device.screen, id: reloads };
  }, [engine, member, found, driverName, seriesSlug, shownScope, device, reloads]);

  useEffect(() => {
    if (!engine) return undefined;
    const t = setInterval(() => {
      const now = Date.now();
      for (const n of mounted) engine.S.tickTimers(n, now);
    }, 1000);
    return () => clearInterval(t);
  }, [engine]);

  // Your own widgets need a driver to be about.
  const widgets = (engine?.widgets || []).filter((w) => found || !w.driver);

  let lead;
  if (!member) lead = "Loading your widgets…";
  else if (found)
    lead = "This is how your widgets look on your iPhone, with your own numbers. It is all live, the same data as the website.";
  else
    lead = `We could not find ${driverName || "you"} in a current season, so there is nothing of your own to show yet. Below are the widgets that look the same for everybody.`;

  return (
    <div className="cascade cascade-auto space-y-6">
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">On your iPhone</div>
            <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark sm:text-2xl">Your NABS widgets</h2>
          </div>
          {isAdmin && (
            <span className={`pill ${isPublic ? "bg-emerald-500/15 text-ok" : "bg-amber-500/15 text-warn"}`}>
              {isPublic ? "Visible to members" : "Admins only"}
            </span>
          )}
        </div>
        <p className="mt-2 max-w-3xl text-[15px] text-light">{lead}</p>
        {isAdmin && !isPublic && (
          <p className="mt-2 max-w-3xl text-sm text-light">
            Members don&rsquo;t see this section yet.{" "}
            <Link to="/admin?tab=widgets" className="font-semibold text-link hover:underline">
              Publish it in the admin
            </Link>{" "}
            when the widgets are ready.
          </p>
        )}
        <button
          type="button"
          className="btn-secondary mt-4 inline-flex items-center gap-1.5"
          onClick={() => howTo.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          How to get them on your phone <span aria-hidden="true">↓</span>
        </button>

        <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-border pt-4">
          {member?.series.length > 1 && (
            <label className={LABEL}>
              Series
              <select className={SELECT} value={seriesSlug} onChange={(e) => setSeries(e.target.value)}>
                {member.series.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tierChoice && (
            <label className={LABEL} title="Standings, gaps and neighbours can count everybody or only the drivers in your tier">
              Compare with
              <select className={SELECT} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">Everybody</option>
                <option value="tier">Only my tier</option>
              </select>
            </label>
          )}
          <label className={LABEL}>
            Phone
            <select className={SELECT} value={deviceKey} onChange={(e) => setDeviceKey(e.target.value)}>
              {Object.entries(DEVICES).map(([k, d]) => (
                <option key={k} value={k}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <SlidingTabs
            items={[
              { key: "home", label: "Home screen" },
              { key: "lock", label: "Lock screen" },
            ]}
            value={screen}
            onChange={setScreen}
            btnClassName="px-3 py-1.5 text-sm font-semibold"
          />
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5 py-1.5"
            onClick={() => setReloads((n) => n + 1)}
            title="Fetches fresh data from the site"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            Reload
          </button>
        </div>
      </section>

      {engineError ? (
        <ErrorBox message={engineError} onRetry={loadAll} title="The widgets didn't load" />
      ) : !engine || !pass ? (
        <Spinner label="Drawing your widgets…" />
      ) : (
        widgets.map((w) => (
          <WidgetCard key={w.view} engine={engine} pass={pass} widget={w} families={FAMILIES[screen]} device={device} base={base} />
        ))
      )}

      <HowTo name={found ? driverName : ""} innerRef={howTo} />
    </div>
  );
}
