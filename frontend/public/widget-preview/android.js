import * as S from "./scriptable.js"

// One widget for the Android app (android.html says why).
//
// The app opens this page in a hidden browser the size of the widget on the home
// screen, waits for done(), and takes a picture of it. Everything about how the
// widget looks stays in nabs-core.js, the iPhone widgets' own code, so a new
// widget version reaches Android phones without a new app.
//
// The address:
//   view    one of the setup's views (auto, result, next, ..., rivals)
//   family  small, medium or large: which of the iPhone layouts to draw
//   w, h    its size in iPhone points. The width is the iPhone's (the layouts
//           are worked out for it), the height follows the shape of the space
//           on the Android home screen. The page scales the result to fill
//           whatever width the app gives it.
//   driver, series, scope   what the setup would have saved on the phone
//   live    1 from an app that runs the timers itself (below); older apps
//           leave it out and get the timers drawn into the picture
//
// What comes back, through window.NabsWidget.done(json) when the app is
// listening (and window.__nabs either way, for tests):
//   { ok, url, refreshAfter, error, timers }
//   url           the page a tap on the widget opens
//   refreshAfter  when the widget wants to be drawn again, ms since 1970
//   timers        with live=1: the running clocks ("lights out in 149:56:31").
//                 A picture cannot tick, so they are left out of it and the app
//                 lays Android's own ticking clock over the same spot. Each is
//                 { target, x, y, w, h, size, color, align }, the box and the
//                 font size as fractions of the page's width and height.

const q = new URLSearchParams(location.search)
const FAMILIES = ["small", "medium", "large"]
const family = FAMILIES.includes(q.get("family")) ? q.get("family") : "medium"
const view = (q.get("view") || "auto").replace(/[^a-z0-9]/gi, "") || "auto"
const W = clamp(Number(q.get("w")) || 338, 100, 800)
const H = clamp(Number(q.get("h")) || 158, 60, 800)
const liveTimers = q.get("live") === "1"
const settings = {
  driver: q.get("driver") || "",
  series: q.get("series") || "",
  scope: q.get("scope") === "tier" ? "tier" : "",
}

// The iPhone 15 / 16, whose widgets are the 158 / 338 point ones. The core
// works its widths out from the screen, and the app asks for exactly those.
const SCREEN = [393, 852]
const CORE_NAME = "NABS Core"

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

function report(r) {
  window.__nabs = r
  try {
    if (window.NabsWidget) window.NabsWidget.done(JSON.stringify(r))
  } catch (_) {}
}

async function draw() {
  const core = await (await fetch("/widget-preview/nabs-core.js", { cache: "no-cache" })).text()
  const store = new Map()
  const now = Date.now()
  store.set(S.LOCAL_DOCS + "/nabs-settings.json", { value: JSON.stringify(settings), mtime: now })
  // Keeps the core from looking for an update of itself: this page always has the latest.
  store.set(S.LOCAL_DOCS + "/nabs-update-check.txt", { value: String(now), mtime: now })
  const ctx = {
    family, param: "", source: "live", offset: 0, store, screen: SCREEN,
    // The widget code asks nabsracing.com; this page asks the site it came from.
    fetchUrl: u => {
      const url = new URL(u)
      url.searchParams.delete("t")
      return url.pathname + url.search
    },
    mock: null, modules: { [CORE_NAME]: core }, logs: [], requests: [], name: "NABS · Android", widget: null,
  }
  // Text is measured as it is laid out, so the fonts have to be there first.
  await Promise.all(["400", "500", "600", "700", "800", "900"].map(w => document.fonts.load(w + " 16px Inter")).concat(
    ["500", "700"].map(w => document.fonts.load(w + " 16px 'JetBrains Mono'")))).catch(() => {})

  const script = "const nabs = importModule(\"" + CORE_NAME + "\")\nawait nabs.run(\"" + view + "\")\n"
  const w = await S.createRuntime(ctx).runScript(script, ctx.name)
  if (!w) throw new Error("The widget code drew no widget")

  const stage = document.getElementById("stage")
  const node = S.renderWidget(w, family, W, H, { now: () => Date.now() })
  stage.style.width = W + "px"
  stage.style.height = H + "px"
  stage.style.transform = "scale(" + window.innerWidth / W + ")"
  stage.replaceChildren(node)
  await document.fonts.ready
  S.fitTexts(node)
  // The flags and pictures in it are <img>s that load on their own time; the
  // app takes its picture the moment it hears done(), so they have to be in
  // first. One that fails or takes over five seconds is left out, not waited for.
  await Promise.race([
    Promise.all([...node.querySelectorAll("img")].map(img =>
      img.complete ? null : new Promise(ok => { img.addEventListener("load", ok); img.addEventListener("error", ok) }))),
    new Promise(ok => setTimeout(ok, 5000)),
  ])
  const timers = liveTimers ? takeOutTimers(node, window.innerWidth / W) : []
  // Two frames, so what the app photographs is what was just laid out.
  await new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)))
  const refresh = w.refreshAfterDate ? new Date(w.refreshAfterDate).getTime() : NaN
  report({ ok: true, url: w.url || null, refreshAfter: isNaN(refresh) ? null : refresh, error: null, timers })
}

// Where each running clock sits, and how it looks; then out of the picture.
// Two at most: no widget has more, and the app keeps two clocks ready.
function takeOutTimers(node, scale) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return [...node.querySelectorAll(".sw-timer")].slice(0, 2).map(el => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    el.style.visibility = "hidden"
    return {
      target: Number(el.dataset.target),
      x: r.left / vw, y: r.top / vh, w: r.width / vw, h: r.height / vh,
      size: parseFloat(cs.fontSize) * scale / vw,
      color: hexColor(cs.color),
      align: cs.textAlign === "center" || cs.textAlign === "right" ? cs.textAlign : "left",
    }
  })
}

// "rgb(244, 175, 198)" -> "#F4AFC6", the form Android reads
function hexColor(css) {
  const m = String(css).match(/\d+(\.\d+)?/g) || ["255", "255", "255"]
  return "#" + m.slice(0, 3).map(n => Math.round(Number(n)).toString(16).padStart(2, "0")).join("").toUpperCase()
}

draw().catch(e => report({ ok: false, url: null, refreshAfter: null, error: String(e && e.message ? e.message : e) }))
