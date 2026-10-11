import * as S from "./scriptable.js"

// On the website the page is a plain static file (SITE): the widget data comes straight
// from this site's own /api/widget, there is no dev server, no live reload and no
// test-data switch. In development the dev server proxies the data and reloads the page.
const SITE = !!window.NABS_SITE
if (SITE) { document.body.classList.add("site"); const i = document.getElementById("intro"); if (i) i.hidden = false }
const SETUP_URL = SITE ? "/widget-preview/nabs-setup.js" : "/dist/NABS%20Setup.js"
const CORE_URL = SITE ? "/widget-preview/nabs-core.js" : "/dist/NABS%20Core.js"

// How a request for the site's data is made: the page's own origin, or the dev proxy
function dataUrl(url, src) {
  if (SITE) {
    const u = new URL(url)
    u.searchParams.delete("t")
    return u.pathname + u.search
  }
  return "/proxy?" + new URLSearchParams({ url, src: src || "live" })
}

const BASE_URL = "https://nabsracing.com"

const FAMILIES = [
  { key: "small", label: "Small", group: "home" },
  { key: "medium", label: "Medium", group: "home" },
  { key: "large", label: "Large", group: "home" },
  { key: "accessoryInline", label: "Lock screen, line", group: "lock" },
  { key: "accessoryRectangular", label: "Lock screen, rectangle", group: "lock" },
  { key: "accessoryCircular", label: "Lock screen, round", group: "lock" },
]

// Widget sizes in points, as iOS hands them to the widget
const DEVICES = {
  pro17: {
    label: "iPhone 16 Pro / 17 Pro (402 pt)", screen: [402, 874],
    small: [162, 162], medium: [347, 162], large: [347, 364],
    accessoryRectangular: [164, 74], accessoryCircular: [74, 74], accessoryInline: [240, 26],
  },
  pro: {
    label: "iPhone 15 / 16 (393 pt)", screen: [393, 852],
    small: [158, 158], medium: [338, 158], large: [338, 354],
    accessoryRectangular: [160, 72], accessoryCircular: [72, 72], accessoryInline: [234, 26],
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
}

const SERIES = [
  { slug: "", label: "F1 Friday" },
  { slug: "sunday-championship", label: "Sunday Championship" },
]

const ZOOMS = [1, 1.25, 1.5, 2]

const TIME_PRESETS = [
  { key: "w-3d", label: "3 days before the race", ms: -3 * 864e5 },
  { key: "w-20h", label: "20 hours before the race", ms: -20 * 36e5 },
  { key: "w-2h", label: "2 hours before the race", ms: -2 * 36e5 },
  { key: "w-10m", label: "10 minutes before the start", ms: -10 * 6e4 },
  { key: "w+30m", label: "Race is running (30 min in)", ms: 30 * 6e4 },
  { key: "w+1d", label: "Day after the race", ms: 864e5 },
]

// ─── State ───────────────────────────────────────────────────

const DEFAULTS = { mockGrid: false, driver: SITE ? "" : "Maltegoat", series: "", device: "pro17", zoom: 1.5, source: "live", time: "now", customTime: "", widget: "all", home: true, lock: true }
const state = Object.assign({}, DEFAULTS, readSaved())

function readSaved() {
  try { return JSON.parse(localStorage.getItem("nabs-widget-preview") || "{}") } catch (_) { return {} }
}
function save() {
  try { localStorage.setItem("nabs-widget-preview", JSON.stringify(state)) } catch (_) {}
}

let widgets = []
let coreName = "NABS Core"
let coreSource = ""
let coreLines = []
let passId = 0
let offset = 0
let nextRace = null
const mounted = new Set()

const $ = sel => document.querySelector(sel)
const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

// ─── Loading ─────────────────────────────────────────────────

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-store" })
  if (!r.ok) throw new Error(url + ": HTTP " + r.status)
  return r.text()
}

// The widget list and the core's file name come from the setup, like on the phone.
// Returns true when the list changed.
async function loadWidgetList() {
  const setup = await fetchText(SETUP_URL)
  const m = setup.match(/const WIDGETS = (\[[\s\S]*?\n\])/)
  const next = m ? new Function("return " + m[1])() : []
  const v = setup.match(/const SETUP_VERSION = "([^"]+)"/)
  $("#setupVer").textContent = v ? "Setup " + v[1] : ""
  coreName = v && /CORE_NAME = "NABS Core " \+ SETUP_VERSION/.test(setup) ? "NABS Core " + v[1].replace(/\./g, "") : "NABS Core"
  const changed = JSON.stringify(next) !== JSON.stringify(widgets)
  widgets = next
  return changed
}

async function loadCore() {
  coreSource = await fetchText(CORE_URL)
  coreLines = coreSource.split("\n")
  const v = coreSource.match(/const CORE_VERSION = "([^"]+)"/)
  $("#coreVer").textContent = v ? "Core " + v[1] : ""
}

function apiUrl() {
  const q = []
  if (state.series) q.push("series=" + encodeURIComponent(state.series))
  if (state.driver) q.push("driver=" + encodeURIComponent(state.driver))
  return BASE_URL + "/api/widget" + (q.length ? "?" + q.join("&") : "")
}

// The same data the widgets get, used for the driver list and the time jumps
async function loadMeta() {
  try {
    const r = await fetch(dataUrl(apiUrl(), state.source), { cache: "no-cache" })
    const d = await r.json()
    nextRace = d.nextRace || null
    const list = $("#drivers")
    list.replaceChildren(...(d.standings || []).map(s => { const o = el("option"); o.value = s.driver; return o }))
    $("#dataInfo").textContent = (d.series && d.series.name ? d.series.name : "") + (d.season ? " · " + d.season : "")
  } catch (_) {
    nextRace = null
    $("#dataInfo").textContent = "No data"
  }
  fillTimeSelect()
}

// ─── Controls ────────────────────────────────────────────────

function option(value, label, selected) {
  const o = el("option", null, label)
  o.value = value
  if (selected) o.selected = true
  return o
}

function fillTimeSelect() {
  const sel = $("#time")
  const opts = [option("now", "Real time", state.time === "now")]
  if (nextRace && nextRace.date) {
    const g = el("optgroup")
    g.label = "R" + nextRace.round + " " + nextRace.track + " · " + new Date(nextRace.date).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    TIME_PRESETS.forEach(p => g.appendChild(option(p.key, p.label, state.time === p.key)))
    opts.push(g)
  }
  opts.push(option("custom", "Pick a time …", state.time === "custom"))
  sel.replaceChildren(...opts)
  $("#customTime").hidden = state.time === "now"
  $("#customTime").value = state.customTime || ""
}

function computeOffset() {
  if (state.time === "now" || !state.customTime) return 0
  const t = new Date(state.customTime).getTime()
  return isNaN(t) ? 0 : t - Date.now()
}

function toLocalInput(ms) {
  const d = new Date(ms)
  const p = n => String(n).padStart(2, "0")
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes())
}

function initControls() {
  const driver = $("#driver")
  driver.value = state.driver
  let t = null
  driver.addEventListener("input", () => {
    clearTimeout(t)
    t = setTimeout(() => { state.driver = driver.value.trim(); save(); refreshAll() }, 600)
  })

  const series = $("#series")
  series.replaceChildren(...SERIES.map(s => option(s.slug, s.label, state.series === s.slug)))
  series.addEventListener("change", () => { state.series = series.value; save(); refreshAll() })

  const device = $("#device")
  device.replaceChildren(...Object.entries(DEVICES).map(([k, d]) => option(k, d.label, state.device === k)))
  device.addEventListener("change", () => { state.device = device.value; save(); buildGrid(); renderAll() })

  const zoom = $("#zoom")
  zoom.replaceChildren(...ZOOMS.map(z => option(String(z), Math.round(z * 100) + " %", state.zoom === z)))
  zoom.addEventListener("change", () => { state.zoom = Number(zoom.value); save(); buildGrid(); renderAll() })

  const source = $("#source")
  source.value = state.source
  source.addEventListener("change", () => { state.source = source.value; save(); refreshAll() })

  $("#time").addEventListener("change", e => {
    const v = e.target.value
    state.time = v
    const p = TIME_PRESETS.find(x => x.key === v)
    if (p && nextRace) state.customTime = toLocalInput(new Date(nextRace.date).getTime() + p.ms)
    else if (v === "custom" && !state.customTime) state.customTime = toLocalInput(Date.now())
    save()
    fillTimeSelect()
    renderAll()
  })
  $("#customTime").addEventListener("change", e => {
    state.customTime = e.target.value
    if (state.time === "now") state.time = "custom"
    save()
    fillTimeSelect()
    renderAll()
  })

  $("#refresh").addEventListener("click", async () => {
    if (!SITE) await fetch("/proxy/clear", { method: "POST" }).catch(() => {})
    refreshAll()
  })

  $("#mockGrid").checked = state.mockGrid
  $("#mockGrid").addEventListener("change", e => { state.mockGrid = e.target.checked; save(); renderAll() })
  $("#showHome").checked = state.home
  $("#showLock").checked = state.lock
  $("#showHome").addEventListener("change", e => { state.home = e.target.checked; save(); buildGrid(); renderAll() })
  $("#showLock").addEventListener("change", e => { state.lock = e.target.checked; save(); buildGrid(); renderAll() })
}

function buildFilter() {
  const box = $("#filter")
  const chips = [{ key: "all", label: "Alle" }].concat(widgets.map(w => ({ key: w.view, label: w.name.replace(/^NABS · /, "") })))
  if (!chips.some(c => c.key === state.widget)) state.widget = "all"
  box.replaceChildren(...chips.map(c => {
    const b = el("button", "chip" + (state.widget === c.key ? " on" : ""), c.label)
    b.type = "button"
    b.addEventListener("click", () => { state.widget = c.key; save(); buildFilter(); buildGrid(); renderAll() })
    return b
  }))
}

// ─── Grid ────────────────────────────────────────────────────

let cards = []

function buildGrid() {
  const grid = $("#grid")
  grid.replaceChildren()
  mounted.clear()
  cards = []
  const dev = DEVICES[state.device] || DEVICES.pro
  const z = state.zoom
  for (const w of widgets) {
    if (state.widget !== "all" && state.widget !== w.view) continue
    const sec = el("section", "wsec")
    const head = el("div", "whead")
    head.append(el("h2", null, w.name.replace(/^NABS · /, "")), el("code", null, w.view))
    if (w.driver) head.append(el("span", "tag", "needs a driver"))
    sec.append(head)

    const row = el("div", "wrow")
    if (state.home) {
      for (const f of FAMILIES.filter(x => x.group === "home")) row.append(makeCard(w, f, dev, z))
    }
    if (state.lock) {
      for (const f of FAMILIES.filter(x => x.group === "lock")) row.append(makeCard(w, f, dev, z))
    }
    sec.append(row)
    grid.append(sec)
  }
  if (!cards.length) grid.append(el("p", "empty", "Nothing selected. Switch on Home screen or Lock screen above."))
}

function makeCard(w, f, dev, z) {
  const [cw, ch] = dev[f.key]
  const fig = el("figure", "card card-" + f.group)
  const cap = el("figcaption", null, f.label + " · " + cw + "×" + ch)
  const stage = el("div", "stage stage-" + f.key)
  stage.style.width = cw * z + "px"
  stage.style.height = ch * z + "px"
  const foot = el("div", "foot")
  fig.append(cap, stage, foot)
  cards.push({ widget: w, family: f.key, w: cw, h: ch, stage, foot, fig })
  return fig
}

// ─── Rendering ───────────────────────────────────────────────

function seedStore(off) {
  const store = new Map()
  const now = Date.now() + off
  const docs = S.LOCAL_DOCS
  store.set(docs + "/nabs-settings.json", { value: JSON.stringify({ driver: state.driver, series: state.series }), mtime: now })
  // Stops the core from looking for an update on nabsracing.com in the preview
  store.set(docs + "/nabs-update-check.txt", { value: String(now), mtime: now })
  return store
}

// The same two lines the setup writes into every "NABS · …" script
function widgetScript(view) {
  return "const nabs = importModule(\"" + coreName + "\")\nawait nabs.run(\"" + view + "\")\n"
}

async function renderCard(card, store, off, id) {
  const ctx = {
    family: card.family, param: "", source: state.source, offset: off, store,
    screen: (DEVICES[state.device] || DEVICES.pro).screen,
    fetchUrl: u => dataUrl(u, state.source),
    mock: SITE ? null : Object.assign({}, state.mockGrid ? { maxGrid: 40, waiting: 2, stats: true } : {}, window.__mockExtra || {}),
    modules: { [coreName]: coreSource }, logs: [], requests: [], name: card.widget.name, widget: null,
  }
  card.fig.classList.add("busy")
  let node = null
  let error = null
  try {
    const w = await S.createRuntime(ctx).runScript(widgetScript(card.widget.view), card.widget.name)
    if (!w) throw new Error("Das Skript hat kein Widget gesetzt (Script.setWidget fehlt)")
    node = S.renderWidget(w, card.family, card.w, card.h, { now: () => Date.now() + off })
    if (w.url) card.url = w.url
  } catch (e) {
    error = e
  }
  if (id !== passId) return
  card.fig.classList.remove("busy")

  const wrap = el("div", "scale")
  wrap.style.transform = "scale(" + state.zoom + ")"
  if (node) wrap.append(node)
  else wrap.append(errorBox(error, card))
  card.stage.replaceChildren(wrap)
  if (node) {
    mounted.add(node)
    await document.fonts.ready
    S.fitTexts(node)
  }
  renderFoot(card, ctx, node ? card.url : null)
}

function errorBox(e, card) {
  const box = el("div", "errbox")
  box.style.width = card.w + "px"
  box.style.height = card.h + "px"
  box.append(el("b", null, "Error"), el("span", null, String(e && e.message ? e.message : e)))
  const m = String(e && e.stack || "").match(/nabs-core[-0-9]*\.js:(\d+)/)
  if (m) {
    const n = Number(m[1]) - S.LINE_SHIFT
    box.append(el("code", null, "NABS Core.js Zeile " + n + ": " + (coreLines[n - 1] || "").trim()))
  }
  console.error(card.widget.name, card.family, e)
  return box
}

function renderFoot(card, ctx, url) {
  const foot = card.foot
  foot.replaceChildren()
  if (url) {
    const a = el("a", "link", url.replace(BASE_URL, "") || "/")
    a.href = url
    a.target = "_blank"
    a.rel = "noopener"
    a.title = "Tapping the widget opens this page"
    foot.append(a)
  }
  const bad = ctx.requests.filter(r => r.status !== 200)
  if (bad.length) foot.append(el("span", "warn", "Data: " + bad.map(r => r.status || "no connection").join(", ")))
  if (ctx.logs.length) {
    const b = el("button", "logbtn", "Log (" + ctx.logs.length + ")")
    b.type = "button"
    const pre = el("pre", "log")
    pre.hidden = true
    pre.textContent = ctx.logs.map(l => (l.kind === "log" ? "" : l.kind.toUpperCase() + " ") + l.text).join("\n")
    b.addEventListener("click", () => { pre.hidden = !pre.hidden })
    foot.append(b, pre)
  }
}

async function pool(jobs, size) {
  let i = 0
  const workers = Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (i < jobs.length) await jobs[i++]()
  })
  await Promise.all(workers)
}

async function renderAll() {
  const id = ++passId
  offset = computeOffset()
  mounted.clear()
  try {
    await loadCore()
  } catch (e) {
    toast("The widget code could not be loaded: " + e.message, true)
    return
  }
  const store = seedStore(offset)
  const t0 = performance.now()
  await pool(cards.map(c => () => renderCard(c, store, offset, id)), 6)
  if (id === passId) {
    updateClocks()
    $("#stamp").textContent = "Drawn " + new Date().toLocaleTimeString("en-GB") + " · " + Math.round(performance.now() - t0) + " ms"
  }
}

async function refreshAll() {
  await loadMeta()
  renderAll()
}

function updateClocks() {
  const now = new Date(Date.now() + offset)
  $("#fakeTime").textContent = offset ? "Simulated time: " + now.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""
}

setInterval(() => {
  const now = Date.now() + offset
  for (const n of mounted) S.tickTimers(n, now)
  updateClocks()
}, 1000)

// ─── Live reload ─────────────────────────────────────────────

let toastTimer = null
function toast(text, bad) {
  const t = $("#toast")
  t.textContent = text
  t.className = "show" + (bad ? " bad" : "")
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.className = "" }, 2600)
}

function connect() {
  if (SITE) { $("#live").style.display = "none"; return }
  const es = new EventSource("/events")
  let lost = false
  es.addEventListener("hello", () => {
    $("#live").className = "live on"
    $("#live").title = "Connected: changes show up at once"
    if (lost) { lost = false; refreshAll() }
  })
  es.addEventListener("widgets", async e => {
    const files = (JSON.parse(e.data || "{}").files || []).join(", ")
    $("#buildError").hidden = true
    if (await loadWidgetList()) { buildFilter(); buildGrid() }
    await renderAll()
    toast("Redrawn: " + (files || "widgets"))
  })
  es.addEventListener("build-error", e => {
    const box = $("#buildError")
    box.querySelector("pre").textContent = JSON.parse(e.data || "{}").message || ""
    box.hidden = false
  })
  es.addEventListener("reload", () => location.reload())
  es.onerror = () => {
    lost = true
    $("#live").className = "live off"
    $("#live").title = "Server nicht erreichbar"
  }
}

// ─── Start ───────────────────────────────────────────────────

async function start() {
  initControls()
  // Load the font weights first so text measurement is right on the first pass
  await Promise.all(["400", "500", "600", "700", "800", "900"].map(w => document.fonts.load(w + " 16px Inter")).concat(
    ["500", "700"].map(w => document.fonts.load(w + " 16px 'JetBrains Mono'")))).catch(() => {})
  await loadWidgetList()
  buildFilter()
  buildGrid()
  await loadMeta()
  // a visitor without a saved driver sees the widgets of the table's leader
  if (SITE && !state.driver) {
    const first = document.querySelector("#drivers option")
    if (first) { state.driver = first.value; $("#driver").value = first.value; await loadMeta() }
  }
  connect()
  renderAll()
}

start()
