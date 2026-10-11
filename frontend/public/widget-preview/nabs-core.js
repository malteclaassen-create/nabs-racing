// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: pink; icon-glyph: flag-checkered;

// NABS Core, the shared code behind all NABS Racing widgets.
// "NABS Setup" creates this file, so please don't edit or rename it.
// To change your driver or to update, just run "NABS Setup" again.

const CORE_VERSION = "6.7"
const BASE_URL = "https://nabsracing.com"
const SETTINGS_FILE = "nabs-settings.json"
let MY_DRIVER = ""
let DEFAULT_SERIES = ""
let SCOPE = ""

const C = {
  bg: new Color("#18181B"),
  border: new Color("#2A2A2F"),
  text: Color.white(),
  mute: new Color("#A1A1AA"),
  dim: new Color("#71717A"),
  ink: new Color("#0B0B0D"),
  gold: new Color("#E8B90E"),
  silver: new Color("#9AA3B5"),
  bronze: new Color("#D4561A"),
  purple: new Color("#B98CFF"),
  green: new Color("#22C55E"),
  red: new Color("#EF4444"),
  amber: new Color("#F59E0B"),
  rowLead: new Color("#2A2530"),
  rowAlt: new Color("#1F1F23"),
  card: new Color("#34265E"),
  card2: new Color("#3B2C6E"),
  cardBase: new Color("#2A1F4E"),
  cardDeep: new Color("#161030"),
  statFill: new Color("#8B7CF6"),
  statTrack: new Color("#2A2440"),
  cardText: new Color("#E9E3FF"),
  cardAcc: new Color("#B9A8FF"),
}
let ACC_HEX = "#F4AFC6"
let ACC = new Color(ACC_HEX)
let ACC_DARK = new Color("#1C1218")
let HERO = new Color("#2A0E14")

const TEAM_COLORS = {
  "mclaren": "#FF8000", "renault": "#C9B400", "brawn gp": "#B6F000", "williams": "#1E6FE0",
  "ferrari": "#E10600", "mercedes": "#19D3C5", "red bull": "#5B5BD6", "sauber": "#B5121B",
  "toro rosso": "#7A0A0A", "lotus": "#2E9E5B", "hrt": "#C2A46A", "audi": "#B9B9C2",
  "skoda": "#22C55E", "arrows": "#F28C28", "force india": "#F596C8", "virgin": "#E4002B",
  "usf1": "#2A6DE8", "ncb mugen": "#E8E8E8", "axn-rb": "#8A5CF6", "jaguar": "#138A5E",
  "aix racing": "#7CFC00", "reserve": "#F4AFC6",
}

let LAST_ERROR = null
let P = null

module.exports.VERSION = CORE_VERSION
module.exports.run = async function (view, opts) {
  opts = opts || {}
  const s = await loadSettings()
  MY_DRIVER = s.driver || ""
  DEFAULT_SERIES = s.series || ""
  SCOPE = s.scope || ""
  const param = String(args.widgetParameter || "").trim()
  if (param && !param.startsWith("@")) P = parseParam(param)
  else P = parseParam((view || "auto") + param)
  if (!param && opts.series) P.series = opts.series
  await main()
  await autoUpdate()
}

// Keeps NABS Core up to date: at most twice a day it checks nabsracing.com for a newer version.
async function autoUpdate() {
  try {
    const fm = scriptsFM()
    const stamp = fm.joinPath(fm.documentsDirectory(), "nabs-update-check.txt")
    const last = fm.fileExists(stamp) ? Number(fm.readString(stamp)) || 0 : 0
    if (Date.now() - last < 12 * 3600e3) return
    fm.writeString(stamp, String(Date.now()))
    const req = new Request(BASE_URL + "/widgets/nabs-core.js?t=" + Date.now())
    req.timeoutInterval = 10
    const code = await req.loadString()
    if (!req.response || req.response.statusCode !== 200) return
    const m = String(code).match(/const CORE_VERSION = "([0-9.]+)"/)
    if (!m || !/NABS Core/.test(code) || !/module\.exports\.run/.test(code)) return
    if (!isNewer(m[1], CORE_VERSION)) return
    if (module.filename) fm.writeString(module.filename, code)
  } catch (_) {}
}

function isNewer(a, b) {
  const x = String(a).split(".").map(Number)
  const y = String(b).split(".").map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) > (y[i] || 0)) return true
    if ((x[i] || 0) < (y[i] || 0)) return false
  }
  return false
}

function scriptsFM() {
  try {
    const ic = FileManager.iCloud()
    if (module.filename && module.filename.indexOf(ic.documentsDirectory()) === 0) return ic
  } catch (_) {}
  return FileManager.local()
}

async function loadSettings() {
  try {
    const fm = scriptsFM()
    const p = fm.joinPath(fm.documentsDirectory(), SETTINGS_FILE)
    if (!fm.fileExists(p)) return {}
    if (fm.isFileStoredIniCloud(p) && !fm.isFileDownloaded(p)) await fm.downloadFileFromiCloud(p)
    return JSON.parse(fm.readString(p))
  } catch (_) {
    return {}
  }
}

// Flow

async function main() {
  let view = P.view
  let family = config.widgetFamily || "medium"
  const inWidget = config.runsInWidget || config.runsInAccessoryWidget

  if (!inWidget) {
    const fam = await pickSize()
    if (!fam) { Script.complete(); return }
    family = fam
  }

  const driver = (view !== "constructors" && P.arg) ? P.arg : MY_DRIVER
  const raw = await loadData(P.series, driver)
  const d = raw ? normalize(raw, driver) : null
  setAccent(d, P.series)

  const tier = view === "constructors" ? P.arg : ""
  const w = await build(view, family, d, tier)
  w.refreshAfterDate = nextRefresh(d)
  w.url = linkFor(d ? resolveView(view, d) : view, d, driver)

  if (inWidget) Script.setWidget(w)
  else await present(w, family)
  Script.complete()
}

function parseParam(raw) {
  let p = String(raw || "").trim()
  let series = DEFAULT_SERIES
  const at = p.indexOf("@")
  if (at >= 0) { series = p.slice(at + 1).trim(); p = p.slice(0, at).trim() }
  let view = p
  let arg = ""
  const colon = p.indexOf(":")
  if (colon >= 0) { view = p.slice(0, colon).trim(); arg = p.slice(colon + 1).trim() }
  view = view.toLowerCase() || "auto"
  return { view, arg, series }
}

async function pickSize() {
  const fams = ["small", "medium", "large", "accessoryRectangular", "accessoryCircular", "accessoryInline"]
  const labels = ["Small", "Medium", "Large", "Lock screen · rectangular", "Lock screen · circular", "Lock screen · inline"]
  const b = new Alert()
  b.title = "NABS Widget · Preview"
  b.message = "Pick a size to preview this widget."
  labels.forEach(l => b.addAction(l))
  b.addCancelAction("Cancel")
  const j = await b.presentSheet()
  if (j < 0 || j >= fams.length) return null
  return fams[j]
}

function resolveView(view, d) {
  if (view === "auto") return showResultNow(d) ? "result" : "next"
  return view
}

function linkFor(view, d, driver) {
  const slug = (d && d.series && d.series.slug) || P.series || "friday-f1"
  const base = BASE_URL + "/s/" + slug
  switch (view) {
    case "result": case "next": case "countdown": return base + "/races"
    case "live": return base + "/live"
    case "standings": case "top3": return base + "/drivers"
    case "constructors": return base + "/constructors"
    case "attendance": case "signup": return base + "/attendance"
    case "rivals": return base + "/drivers"
    case "card": case "me": case "teammate": {
      if (d && d.me && d.me.url) return d.me.url
      const name = (d && d.me && d.me.driver) || driver
      const m = d && d.season ? String(d.season).match(/season\s*(\d+)/i) : null
      if (name && m) return base + "/drivers/" + low(name).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") + "_s" + m[1]
      return base + "/drivers"
    }
    default: return BASE_URL
  }
}

async function present(w, family) {
  const map = {
    small: "presentSmall", medium: "presentMedium", large: "presentLarge",
    accessoryRectangular: "presentAccessoryRectangular",
    accessoryCircular: "presentAccessoryCircular",
    accessoryInline: "presentAccessoryInline",
  }
  const fn = map[family]
  if (fn && typeof w[fn] === "function") await w[fn]()
  else await w.presentMedium()
}

// Data

function apiUrl(series, driver) {
  const q = []
  if (series) q.push("series=" + encodeURIComponent(series))
  if (driver) q.push("driver=" + encodeURIComponent(driver))
  // "Only my tier": the tables, gaps and neighbours are counted inside your own tier
  if (driver && SCOPE === "tier") q.push("scope=tier")
  q.push("t=" + Date.now())
  return BASE_URL + "/api/widget?" + q.join("&")
}

async function loadData(series, driver) {
  const fm = FileManager.local()
  const key = ("nabs-" + (series || "main") + "-" + (driver || "none") + (driver && SCOPE === "tier" ? "-tier" : "")).toLowerCase().replace(/[^a-z0-9-]/g, "_")
  const path = fm.joinPath(fm.documentsDirectory(), key + ".json")
  try {
    const req = new Request(apiUrl(series, driver))
    req.timeoutInterval = 15
    req.headers = {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 NABS-Widget",
    }
    const text = await req.loadString()
    const status = req.response ? req.response.statusCode : 0
    if (status !== 200) throw new Error("HTTP " + status)
    let json
    try { json = JSON.parse(text) } catch (_) { throw new Error("Keine JSON-Antwort: " + String(text).slice(0, 60)) }
    fm.writeString(path, JSON.stringify(json))
    return json
  } catch (e) {
    LAST_ERROR = String(e && e.message ? e.message : e)
    if (fm.fileExists(path)) {
      try { return JSON.parse(fm.readString(path)) } catch (_) { return null }
    }
    return null
  }
}

function normalize(r, driver) {
  const d = Object.assign({}, r)
  if (r.lastRace) {
    d.lastRace = Object.assign({}, r.lastRace, { results: r.lastRace.results || r.lastRace.podium || [] })
  }
  const st = Array.isArray(r.standings) ? r.standings : []
  d.standings = st.map((s, i) => Object.assign({}, s, {
    gap: s.gap != null ? s.gap : (i === 0 ? null : s.points - st[0].points),
  }))
  d.me = r.me || deriveMe(d.standings, driver)
  d.myName = (d.me && d.me.driver) || driver || ""
  return d
}

function deriveMe(st, driver) {
  if (!driver) return null
  const i = st.findIndex(s => low(s.driver) === low(driver))
  if (i < 0) return null
  const s = st[i]
  return {
    driver: s.driver, country: s.country, team: s.team, teamColor: s.teamColor,
    pos: s.pos, points: s.points, gapAhead: i > 0 ? s.points - st[i - 1].points : null,
    gapLeader: s.gap,
  }
}

function setAccent(d, series) {
  const hex = d && d.series && d.series.accent
  const slug = String((d && d.series && d.series.slug) || series || "")
  const cyan = /sunday/i.test(slug) || (hex && hex.toLowerCase() === "#22d3ee")
  if (hex) ACC_HEX = hex
  else if (cyan) ACC_HEX = "#22D3EE"
  ACC = new Color(ACC_HEX)
  if (cyan) { HERO = new Color("#0C1B22"); ACC_DARK = new Color("#06171C") }
}

function nextRefresh(d) {
  const now = Date.now()
  let mins = 120
  if (d) {
    const start = d.nextRace && d.nextRace.date ? new Date(d.nextRace.date).getTime() : null
    if (d.live && onTrack(d.live)) mins = 10
    else if (start != null) {
      const diff = start - now
      if (diff < 3 * 3600e3 && diff > -6 * 3600e3) mins = 10
      else if (diff > 0 && diff < 24 * 3600e3) mins = 30
      if (diff > 864e5 && diff < 8 * 864e5) mins = Math.min(mins, Math.max(5, Math.ceil((diff % 36e5) / 6e4) + 1))
    }
  }
  return new Date(now + mins * 60e3)
}

// Views

async function build(view, fam, d, tier) {
  if (!d) return errorWidget(fam)
  if (String(fam).startsWith("accessory")) return accessory(view, fam, d)
  if (view === "auto") view = showResultNow(d) ? "result" : (fam === "small" ? "countdown" : "next")
  const big = fam === "large" || fam === "extraLarge"
  switch (view) {
    case "result": return fam === "small" ? resultS(d) : big ? resultL(d) : resultM(d)
    case "next": return fam === "small" ? countdownS(d) : big ? nextL(d) : nextM(d)
    case "countdown": return fam === "small" ? countdownS(d) : big ? countdownL(d) : countdownM(d)
    case "live": return fam === "small" ? liveS(d) : liveM(d, big ? 12 : 3)
    case "standings": return fam === "small" ? standingsS(d) : big ? standingsL(d) : standingsM(d)
    case "top3": return fam === "small" ? top3S(d) : big ? top3L(d) : top3M(d)
    case "constructors": return constructorsW(d, fam, tier)
    case "card": return fam === "small" ? await cardS(d) : big ? await cardL(d) : await cardM(d)
    case "me": return fam === "small" ? await meS(d) : big ? await meL(d) : await meM(d)
    case "teammate": return teammateW(d, fam)
    case "signup": return fam === "small" ? signupS(d) : signupM(d, big)
    case "attendance": return fam === "small" ? attendanceS(d) : attendanceM(d, big)
    case "form": return fam === "small" ? formS(d) : big ? formL(d) : formM(d)
    case "rivals": return fam === "small" ? rivalsS(d) : big ? rivalsL(d) : rivalsM(d)
    case "debug": {
      const w = W()
      kicker(w, "NABS · Debug")
      w.addSpacer(4)
      line(w, "Core v" + (typeof CORE_VERSION !== "undefined" ? CORE_VERSION : "?"), 14, { f: "heavy" })
      line(w, String(module.filename || "").split("/").slice(-2).join("/"), 9, { f: "mono", c: C.mute, lines: 2 })
      line(w, "Driver: " + (d.myName || "–") + " · " + (d.series && d.series.slug || P.series || "main"), 10, { f: "mono", c: C.mute })
      line(w, "Data: " + (d.updatedAt || "?"), 9, { f: "mono", c: C.mute })
      line(w, "Rendered: " + fmt(new Date(), "HH:mm:ss"), 9, { f: "mono", c: C.mute })
      return w
    }
    default: return message("Unknown view", "There is no widget called \"" + view + "\".")
  }
}

function showResultNow(d) {
  const r = d.lastRace
  if (!r) return false
  if (r.date) return Date.now() - new Date(r.date).getTime() < 3 * 864e5
  const n = d.nextRace && d.nextRace.date ? new Date(d.nextRace.date).getTime() - Date.now() : null
  return n == null || n > 4.5 * 864e5
}

// Latest race

function resultS(d) {
  const r = d.lastRace
  if (!r || !r.results.length) return message("Latest race", "No race yet")
  const x = r.results[0]
  const w = heroWidget()
  const h = H(w, 5)
  kicker(h, "Latest race")
  h.addSpacer()
  sub(h, "R" + r.round)
  w.addSpacer(4)
  trackLine(w, r, 15)
  w.addSpacer()
  // the winner
  const n = H(w, 6)
  tile(n, 1, C.gold, 22)
  T(n, x.driver, 16, { f: "heavy", c: isMe(x.driver, d) ? ACC : C.text })
  if (x.country) T(n, flag(x.country), 12)
  n.addSpacer()
  w.addSpacer(3)
  const t = H(w, 5)
  bar(t, teamColor(x), 3, 10)
  T(t, x.team, 11, { f: "medium", c: C.mute })
  T(t, "· " + x.points + " PTS", 10, { f: "monob", c: C.text })
  t.addSpacer()
  // your own result, set apart
  const mine = myResult(d)
  if (mine && mine.pos !== 1) {
    w.addSpacer(7)
    divider(w)
    w.addSpacer(6)
    const m = H(w, 6)
    T(m, "YOU", 10, { f: "monob", c: ACC })
    m.addSpacer()
    T(m, "P" + mine.pos, 16, { f: "black", c: ACC })
    T(m, (mine.points || 0) + " PTS", 9, { f: "mono", c: C.mute })
  }
  return w
}

function resultM(d) {
  const r = d.lastRace
  if (!r || !r.results.length) return message("Latest race", "No race yet")
  const w = heroWidget()
  w.setPadding(13, 10, 13, 10)
  // header and title get the same 4 pt as the rows, so everything lines up
  const hd = V(w, 0)
  hd.setPadding(0, 4, 0, 4)
  raceHeader(hd, "Latest race", r)
  hd.addSpacer(3)
  trackLine(hd, r, 22)
  w.addSpacer(5)
  const list = V(w, 2)
  list.size = new Size(widgetWidth("medium") - 20, 0)
  const top = r.results.slice(0, 3)
  top.forEach(x => resultRow(list, x, d, true))
  const mine = myResult(d)
  if (mine && !top.some(x => isMe(x.driver, d))) {
    const h = H(list, 7)
    h.backgroundColor = new Color(ACC_HEX, 0.14)
    h.cornerRadius = 8
    h.setPadding(1, 4, 1, 4)
    const box = h.addStack()
    box.size = new Size(26, 0)
    T(box, "P" + mine.pos, 15, { f: "black", c: ACC })
    bar(h, d.me ? teamColor(d.me) : C.dim, 4, 14)
    T(h, "YOU", 14, { f: "heavy", c: ACC })
    if (d.me && d.me.country) T(h, flag(d.me.country), 10)
    h.addSpacer()
    T(h, mine.points || 0, 15, { f: "black", c: ACC })
  }
  return w
}

function resultL(d) {
  const r = d.lastRace
  if (!r || !r.results.length) return message("Latest race", "No race yet")
  const w = heroWidget()
  raceHeader(w, "Latest race", r)
  w.addSpacer(6)
  trackLine(w, r, 34)
  const bits = [r.circuit, r.date ? fmt(new Date(r.date), "EEE d MMM") : null].filter(Boolean)
  if (bits.length) { w.addSpacer(4); line(w, up(bits.join(" · ")), 10, { f: "mono", c: new Color("#D4D4D8") }) }
  w.addSpacer(10)
  const list = V(w, 6)
  r.results.slice(0, 3).forEach(x => resultCard(list, x, d))
  w.addSpacer()
  const mine = myResult(d)
  if (mine) {
    const yr = H(w, 10)
    yr.backgroundColor = new Color("#000000", 0.38)
    yr.borderColor = new Color("#FFFFFF", 0.10)
    yr.borderWidth = 1
    yr.cornerRadius = 12
    yr.setPadding(7, 12, 7, 12)
    const yl = V(yr, 1)
    line(yl, "YOUR RACE", 9, { f: "mono", c: C.mute })
    line(yl, d.myName, 13, { f: "heavy" })
    T(yr, "P" + mine.pos, 22, { f: "black" })
    T(yr, (mine.points || 0) + " PTS", 9, { f: "mono", c: C.mute })
  } else if (r.results.length > 3) {
    const more = V(w, 2)
    r.results.slice(3, 6).forEach(x => resultRow(more, x, d))
  }
  return w
}

function myResult(d) {
  const r = d.lastRace
  if (!r) return null
  const inList = r.results.find(x => isMe(x.driver, d))
  if (inList) return inList
  const lr = d.me && d.me.lastResult
  if (lr && (lr.round == null || lr.round === r.round)) return lr
  return null
}

// The biggest text size, up to max, that leaves a tenth of the room free. iOS sets
// text wider than any estimate and shrinks what does not fit to a fraction of its
// size, so a size picked to just fit would still end up small on the phone.
// The last argument is room for things beside the text, in em (a flag, say).
function fitSize(avail, text, max, min, extra) {
  const em = 0.7 * String(text == null ? "" : text).length + (extra || 0)
  return Math.max(min, Math.min(max, Math.floor(0.9 * avail / Math.max(1, em))))
}

// The longest of a list of names, upper case, for sizing a column of them
function longestName(names) {
  return up(names.map(n => String(n || "")).sort((a, b) => b.length - a.length)[0] || "")
}

// The track name with the flag of its country right behind it. The last argument is the width
// the line may use; the name gets the biggest size that fits in it.
function trackLine(p, race, size, o, avail) {
  const h = H(p, 6)
  const sz = avail ? fitSize(avail - 8, up(race.track), size, 14, race.country ? 0.8 : 0) : size
  T(h, up(race.track), sz, o || { f: "black" })
  if (race.country) T(h, flag(race.country), Math.round(sz * 0.62))
  h.addSpacer()
  return h
}

function raceHeader(p, label, race) {
  const h = H(p, 6)
  kicker(h, label)
  h.addSpacer()
  const total = race.totalRounds || (race.round && race.of) || null
  sub(h, "Round " + race.round + (total ? " / " + total : ""))
}

function resultRow(p, x, d, inset) {
  const h = H(p, 7)
  if (inset) h.setPadding(1, 4, 1, 4)
  const pc = posColor(x.pos)
  const box = h.addStack()
  box.size = new Size(26, 0)
  T(box, "P" + x.pos, 15, { f: "black", c: pc || C.mute })
  bar(h, teamColor(x), 4, 14)
  T(h, x.driver, 14, { f: "heavy", c: isMe(x.driver, d) ? ACC : C.text })
  if (x.country) T(h, flag(x.country), 10)
  T(h, x.team, 12, { f: "medium", c: C.mute })
  h.addSpacer()
  if (x.fastestLap) badge(h, "FL", new Color("#A855F7", 0.25), new Color("#C4A1FF"))
  T(h, x.points, 15, { f: "black" })
}

function resultCard(p, x, d) {
  const pc = posColor(x.pos) || C.mute
  const c = H(p, 10)
  c.backgroundColor = new Color("#000000", 0.3)
  c.cornerRadius = 12
  c.borderColor = new Color("#FFFFFF", 0.08)
  c.borderWidth = 1
  c.setPadding(7, 8, 7, 12)
  bar(c, pc, 3, 32)
  const box = c.addStack()
  box.size = new Size(36, 0)
  T(box, "P" + x.pos, 22, { f: "black", c: pc })
  const mid = V(c, 1)
  const top = H(mid, 5)
  T(top, x.driver, 15, { f: "heavy", c: isMe(x.driver, d) ? ACC : C.text })
  if (x.country) T(top, flag(x.country), 11)
  top.addSpacer()
  const bot = H(mid, 5)
  bar(bot, teamColor(x), 8, 8)
  T(bot, x.team, 12, { f: "medium", c: C.mute })
  bot.addSpacer()
  const rt = V(c, 0)
  rightLine(rt, x.points, 20, { f: "black" })
  rightLine(rt, "PTS", 8, { f: "mono", c: C.mute })
}

// Next race / countdown

function nextM(d) {
  const r = d.nextRace
  if (!r) return seasonOver(d)
  const img = trackImage(r.track, r.outline, 80, 80)
  const w = stripedWidget()
  const row = H(w, 10)
  const left = V(row, 0)
  const h = H(left, 6)
  kicker(h, "Next race")
  sub(h, "· R" + r.round)
  h.addSpacer()
  left.addSpacer(5)
  trackLine(left, r, 26, null, widgetWidth("medium") - 28 - 92 - 10)
  left.addSpacer(3)
  line(left, up(fmt(new Date(r.date), "EEE d MMM · HH:mm")), 10, { f: "mono", c: new Color("#D4D4D8") })
  left.addSpacer()
  line(left, "LIGHTS OUT IN", 10, { f: "mono", c: C.mute })
  countdownLine(left, r.date, 19)
  const right = V(row, 5)
  right.addSpacer()
  const tileSt = right.addStack()
  tileSt.size = new Size(92, 92)
  tileSt.cornerRadius = 16
  tileSt.backgroundColor = new Color("#FFFFFF", 0.04)
  tileSt.borderColor = C.border
  tileSt.borderWidth = 1
  tileSt.centerAlignContent()
  tileSt.addSpacer()
  if (img) {
    const im = tileSt.addImage(img)
    im.imageSize = new Size(80, 80)
  } else {
    T(tileSt, "R" + r.round, 28, { f: "black", c: new Color(ACC_HEX, 0.5) })
  }
  tileSt.addSpacer()
  if (r.signedUp != null) {
    const su = H(right, 0)
    su.size = new Size(92, 0)
    su.addSpacer()
    T(su, r.signedUp + " SIGNED UP", 9, { f: "monob", c: C.mute })
    su.addSpacer()
  }
  right.addSpacer()
  return w
}

function nextL(d) {
  const r = d.nextRace
  if (!r) return seasonOver(d)
  const img = trackImage(r.track, r.outline, 112, 78)
  const w = stripedWidget()
  const top = H(w, 10)
  const left = V(top, 0)
  raceHeader(left, "Next race", r)
  left.addSpacer(6)
  trackLine(left, r, 30, null, widgetWidth("large") - 28 - 112 - 10)
  left.addSpacer(3)
  line(left, up(fmt(new Date(r.date), "EEE d MMM · HH:mm")), 10, { f: "mono", c: new Color("#D4D4D8") })
  if (r.circuit) line(left, up(r.circuit), 10, { f: "mono", c: C.mute })
  left.addSpacer(10)
  line(left, "LIGHTS OUT IN", 10, { f: "mono", c: C.mute })
  countdownLine(left, r.date, 22)
  if (r.signedUp != null) {
    left.addSpacer(4)
    line(left, r.signedUp + " SIGNED UP", 10, { f: "monob", c: C.mute })
  }
  if (img) {
    const im = top.addImage(img)
    im.imageSize = new Size(112, 78)
  }
  w.addSpacer(10)
  divider(w)
  w.addSpacer(6)
  line(w, "STANDINGS", 10, { f: "monob", c: ACC })
  w.addSpacer(3)
  // outside the top four your own row follows below them; inside it, the table runs
  // two rows further so the widget has no hole at the bottom
  const insideTop = !d.me || d.me.pos == null || d.me.pos <= 4
  standingRows(w, d, insideTop ? 6 : 4, true)
  w.addSpacer()
  return w
}

// Days and hours as two big numbers (under a day it is one running timer)
function countdownBlocks(p, date, size) {
  const ms = new Date(date).getTime() - Date.now()
  if (ms <= 0) { line(p, "LIGHTS OUT", size, { f: "black", c: ACC }); return }
  if (ms < 864e5) {
    const t = p.addDate(new Date(date))
    t.applyTimerStyle()
    t.font = Font.boldMonospacedSystemFont(Math.round(size * 0.9))
    t.textColor = ACC
    t.lineLimit = 1
    t.minimumScaleFactor = 0.6
    return
  }
  // Days and hours only: the widget redraws on the hour in the days before a race,
  // so minutes would already be out of date. Under a day the timer below ticks on its own.
  const parts = [
    [Math.floor(ms / 864e5), Math.floor(ms / 864e5) === 1 ? "DAY" : "DAYS"],
    [Math.floor((ms % 864e5) / 36e5), "HRS"],
  ]
  const row = H(p, 8)
  parts.forEach(([n, label], i) => {
    if (i > 0) T(row, ":", Math.round(size * 0.8), { f: "black", c: C.dim })
    const c = V(row, 0)
    // no spacer next to the number: it would keep 8 pt of a narrow widget
    const num = H(c, 0)
    T(num, String(n).padStart(2, "0"), size, { f: "black", c: i === 0 ? ACC : C.text })
    T(c, label, 9, { f: "monob", c: C.mute })
  })
  row.addSpacer()
}

function countdownM(d) {
  const r = d.nextRace
  if (!r) return seasonOver(d)
  const w = stripedWidget()
  raceHeader(w, "Countdown", r)
  w.addSpacer(5)
  trackLine(w, r, 20)
  w.addSpacer()
  line(w, "LIGHTS OUT IN", 10, { f: "mono", c: C.mute })
  w.addSpacer(2)
  countdownBlocks(w, r.date, 30)
  w.addSpacer()
  line(w, up(fmt(new Date(r.date), "EEE d MMM · HH:mm")) + (r.signedUp != null ? " · " + r.signedUp + " SIGNED UP" : ""), 10, { f: "mono", c: new Color("#D4D4D8") })
  return w
}

function countdownL(d) {
  const r = d.nextRace
  if (!r) return seasonOver(d)
  const w = stripedWidget()
  raceHeader(w, "Countdown", r)
  w.addSpacer(6)
  trackLine(w, r, 30)
  w.addSpacer(3)
  line(w, up([r.circuit, fmt(new Date(r.date), "EEE d MMM · HH:mm")].filter(Boolean).join(" · ")), 10, { f: "mono", c: new Color("#D4D4D8") })
  w.addSpacer()
  line(w, "LIGHTS OUT IN", 11, { f: "mono", c: C.mute })
  w.addSpacer(2)
  countdownBlocks(w, r.date, 62)
  w.addSpacer()
  const img = trackImage(r.track, r.outline, 150, 105)
  if (img) {
    const c = H(w, 0)
    c.addSpacer()
    const im = c.addImage(img)
    im.imageSize = new Size(150, 105)
    c.addSpacer()
    w.addSpacer()
  }
  const f = H(w, 8)
  if (r.signedUp != null) T(f, r.signedUp + " SIGNED UP", 10, { f: "monob", c: C.mute })
  f.addSpacer()
  const st = d.me && d.me.attendance && attNext(d.me.attendance, d)
  if (st) T(f, st.text, 10, { f: "monob", c: st.ok ? ACC : C.red })
  return w
}

function countdownS(d) {
  const r = d.nextRace
  if (!r) return seasonOver(d)
  const w = stripedWidget()
  const h = H(w, 5)
  kicker(h, "Next race")
  h.addSpacer()
  sub(h, "R" + r.round)
  w.addSpacer(6)
  trackLine(w, r, 15)
  w.addSpacer()
  const ms = new Date(r.date).getTime() - Date.now()
  if (ms <= 0) {
    line(w, "LIGHTS", 30, { f: "black", c: ACC })
    line(w, "OUT", 30, { f: "black", c: ACC })
  } else if (ms >= 864e5) {
    line(w, "LIGHTS OUT IN", 9, { f: "mono", c: C.mute })
    w.addSpacer(2)
    countdownBlocks(w, r.date, 30)
  } else {
    line(w, "TODAY", 10, { f: "monob", c: ACC })
    const t = w.addDate(new Date(r.date))
    t.applyTimerStyle()
    t.font = Font.boldMonospacedSystemFont(30)
    t.textColor = C.text
    t.lineLimit = 1
    t.minimumScaleFactor = 0.5
  }
  w.addSpacer(7)
  line(w, up(fmt(new Date(r.date), "EEE d MMM · HH:mm")), 10, { f: "mono", c: new Color("#D4D4D8") })
  return w
}

function countdownText(ms) {
  const d = Math.floor(ms / 864e5)
  const h = Math.floor((ms % 864e5) / 36e5)
  const m = Math.floor((ms % 36e5) / 6e4)
  if (d > 0) return d + (d === 1 ? " DAY " : " DAYS ") + h + (h === 1 ? " HR" : " HRS")
  return h + (h === 1 ? " HR " : " HRS ") + m + " MIN"
}

function countdownLine(p, date, size) {
  const ms = new Date(date).getTime() - Date.now()
  if (ms <= 0) { line(p, "LIGHTS OUT", size, { f: "black", c: ACC }); return }
  if (ms < 864e5) {
    const t = p.addDate(new Date(date))
    t.applyTimerStyle()
    t.font = Font.boldMonospacedSystemFont(size)
    t.textColor = ACC
    t.lineLimit = 1
    t.minimumScaleFactor = 0.7
    return
  }
  line(p, countdownText(ms), size, { f: "black", c: ACC, min: 0.8 })
}

function seasonOver(d) {
  const champ = d.standings && d.standings[0]
  return message("Season finished", champ ? "Champion: " + champ.driver + " · " + champ.points + " pts" : "See you next season")
}

// Live

function liveS(d) {
  const lv = d.live
  if (!hasTimes(lv)) return noLive(d, "small")
  const w = W()
  liveHeader(w, lv, false)
  w.addSpacer(5)
  line(w, up(lv.track || lv.name || "Live"), 16, { f: "black", min: 0.5 })
  if (lv.session) line(w, up(lv.session), 10, { f: "monob", c: ACC })
  w.addSpacer()
  const b = lv.best && lv.best[0]
  if (b) {
    line(w, "FASTEST", 9, { f: "mono", c: C.mute })
    const fl = H(w, 4)
    T(fl, up(b.driver), 12, { f: "heavy", c: isMe(b.driver, d) ? ACC : C.text })
    if (b.country) T(fl, flag(b.country), 10)
    fl.addSpacer()
    line(w, b.time, 18, { f: "monob", c: C.purple })
    const you = lv.me && lv.me.pos ? lv.me : (lv.best || []).find((x, i) => i > 0 && isMe(x.driver, d))
    if (you) {
      w.addSpacer(4)
      line(w, "YOU P" + you.pos + " · " + you.time, 9, { f: "monob", c: ACC })
    }
  }
  return w
}

// Live timing, medium and large. The fewer drivers have a time, the bigger the rows
// get, and in the large widget the room left over holds the session at a glance.
function liveM(d, rows) {
  const lv = d.live
  const big = rows > 3
  if (!hasTimes(lv)) return noLive(d, big ? "large" : "medium")
  // Your own line when you are slower than the list is long: the last row of the
  // list gives way to a gap marker and your line.
  const mine = lv.me && lv.me.pos ? lv.me : null
  const list = lv.best.slice(0, rows - (mine ? 1 : 0))
  const n = list.length + (mine ? 1 : 0)
  // The rows share one height budget: few drivers get tall rows, many get a long,
  // compact list that still fills the widget. (With three or fewer in the large
  // widget there is also the session block underneath, which takes part of it.)
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const sp = n <= 5 ? 6 : n <= 8 ? 4 : 3
  const budget = big ? (n <= 3 ? 130 : 250) - (mine ? 14 : 0) : 88
  const rowH = Math.min(58, Math.floor((budget - (n - 1) * sp) / n))
  // The text sizes come from the width, not just the height: iOS sets text wider
  // than any estimate, and text that does not fit is shrunk to a fraction of its
  // size. So every size is chosen to leave a tenth of the row free for the longest name.
  const inner = widgetWidth(big ? "large" : "medium") - 28
  const longest = Math.max.apply(null, [6].concat(list.concat(mine ? [mine] : []).map(x => String(x.driver || "").length)))
  const twoLine = rowH >= 36
  const bg = rowH >= 26
  const room = inner - (bg ? 18 : 0)
  const tileSz = twoLine ? clamp(rowH - 10, 24, 34) : clamp(rowH - 8, 17, 26)
  const nameSize = twoLine
    ? clamp(Math.floor(0.9 * (room - tileSz - 4 - 8 - 20) / (0.7 * longest + 5.7)), 12, 19)
    : clamp(Math.floor(0.9 * (room - tileSz - 4 - 8 - 30) / (0.7 * longest + 8.46)), 10, 16)
  const sz = {
    twoLine,
    bg,
    tile: tileSz,
    name: nameSize,
    time: twoLine ? nameSize : Math.round(nameSize * 1.05),
    gap: twoLine ? clamp(Math.round(nameSize * 0.6), 9, 11) : Math.round(nameSize * 0.7),
    flag: clamp(Math.round(nameSize * 0.7), 9, 13),
    pad: bg ? Math.max(1, Math.floor((rowH - tileSz) / 2)) : 0,
    space: sp,
  }
  const w = W()
  liveHeader(w, lv, true)
  w.addSpacer(5)
  const t = H(w, 8)
  T(t, up(lv.name || lv.track || "Live"), big ? 20 : 17, { f: "black" })
  if (lv.session) T(t, up(lv.session), 10, { f: "monob", c: ACC })
  t.addSpacer()
  w.addSpacer(big ? 10 : 6)
  const col = V(w, sz.space)
  const addRow = (x, i, youLine) => {
    const me = youLine || isMe(x.driver, d)
    const h = H(col, 5)
    // with four or more drivers every row gets exactly its share of the height
    if (big && n > 3) h.size = new Size(0, rowH)
    if (sz.bg) {
      h.backgroundColor = me ? new Color(ACC_HEX, 0.16) : C.rowAlt
      h.cornerRadius = 10
      h.setPadding(sz.pad, 8, sz.pad, 10)
    } else if (youLine) {
      h.backgroundColor = new Color(ACC_HEX, 0.16)
      h.cornerRadius = 6
    }
    if (i === 0 && !youLine) tile(h, x.pos || 1, ACC, sz.tile)
    else numBox(h, x.pos || i + 1, sz.tile, me ? ACC : C.mute)
    bar(h, teamColor(x), 4, Math.round(sz.tile * 0.8))
    const gapText = (i > 0 || youLine) && x.gap ? x.gap : null
    if (sz.twoLine) {
      // name and flag on one line, the gap to the leader under it
      const who = V(h, 1)
      const nl = H(who, 4)
      T(nl, up(x.driver), sz.name, { f: "heavy", c: me ? ACC : C.text })
      if (x.country) T(nl, flag(x.country), sz.flag)
      T(who, gapText || "FASTEST", sz.gap, { f: "mono", c: C.mute })
      h.addSpacer()
    } else {
      T(h, up(x.driver), sz.name, { f: "heavy", c: me ? ACC : C.text })
      if (x.country) T(h, flag(x.country), sz.flag)
      h.addSpacer()
      if (gapText) T(h, gapText, sz.gap, { f: "mono", c: C.mute })
    }
    T(h, x.time, sz.time, { f: "monob", c: i === 0 && !youLine ? C.purple : C.text })
  }
  list.forEach((x, i) => addRow(x, i, false))
  if (mine) {
    if (big) gapMarker(col, true)
    addRow(mine, list.length, true)
  }
  if (big && n <= 3) {
    w.addSpacer(10)
    divider(w)
    w.addSpacer(8)
    const row = H(w, 14)
    const img = trackImage(lv.track || lv.name, null, 126, 88)
    if (img) {
      const im = row.addImage(img)
      im.imageSize = new Size(126, 88)
    }
    const info = V(row, 8)
    liveStat(info, "ON TRACK", String(typeof lv.onTrack === "number" ? lv.onTrack : onTrack(lv) ? "yes" : "0"))
    liveStat(info, "TIMES SET", String(lv.timed != null ? lv.timed : lv.best.length))
    if (lv.session) liveStat(info, "SESSION", up(lv.session))
    row.addSpacer()
    w.addSpacer(8)
    line(w, n < 3 ? "Set a lap and you are on the board." : "More times appear here as laps are set.", 11, { f: "medium", c: C.mute })
  }
  w.addSpacer()
  return w
}

function liveStat(p, label, value) {
  const s = V(p, 0)
  line(s, label, 8, { f: "mono", c: C.mute })
  line(s, value, 18, { f: "black" })
}

function hasTimes(lv) {
  return !!(lv && Array.isArray(lv.best) && lv.best.length)
}

// Someone is driving right now? Otherwise the widget just shows the session's best laps.
function onTrack(lv) {
  if (!lv) return false
  if (typeof lv.onTrack === "number") return lv.onTrack > 0
  return !!lv.active
}

function liveHeader(p, lv, withTime) {
  const h = H(p, 6)
  const live = onTrack(lv)
  dot(h, live ? C.green : C.dim, 7)
  kicker(h, live ? (withTime ? "Live timing" : "Live") : "Best times")
  if (live && withTime && typeof lv.onTrack === "number") T(h, "· " + lv.onTrack + " ON TRACK", 10, { f: "mono", c: C.mute })
  h.addSpacer()
  if (withTime && lv.endsAt) {
    const ms = new Date(lv.endsAt).getTime() - Date.now()
    if (ms > 0) {
      sub(h, "Left")
      if (ms < 864e5) {
        const t = h.addDate(new Date(lv.endsAt))
        t.applyTimerStyle()
        t.font = Font.boldMonospacedSystemFont(12)
        t.textColor = C.text
        t.lineLimit = 1
        t.rightAlignText()
      } else {
        T(h, countdownText(ms), 11, { f: "monob" })
      }
    }
  }
}

function noLive(d, fam) {
  const w = W()
  const h = H(w, 6)
  dot(h, C.dim, 7)
  kicker(h, "Live", C.mute)
  h.addSpacer()
  w.addSpacer()
  line(w, "No laps yet", fam === "small" ? 18 : 22, { f: "black" })
  line(w, "Be the first on the server", 12, { f: "medium", c: C.mute })
  const r = d.nextRace
  if (r) {
    w.addSpacer(8)
    line(w, up("Next · R" + r.round + " " + r.track), 10, { f: "mono", c: C.mute })
    countdownLine(w, r.date, 13)
  }
  w.addSpacer()
  return w
}

// Standings

function standingsS(d) {
  const st = d.standings
  if (!st.length) return message("Standings", "No standings yet")
  const w = W()
  kicker(w, "Standings" + (d.scope && d.scope.tier ? " · T" + d.scope.tier : ""))
  w.addSpacer()
  const rows = [st[0], st[1]]
  const meRow = st.find(s => isMe(s.driver, d))
  if (meRow && meRow.pos > 2) rows.push(meRow)
  else if (st[2]) rows.push(st[2])
  // a name, its flag and the points have to share a narrow row
  const ns = fitSize(widgetWidth("small") - 28 - 20 - 8 - 29 - 12, longestName(rows.filter(Boolean).map(x => (isMe(x.driver, d) ? "YOU" : x.driver))), 13, 10, 0.9)
  rows.filter(Boolean).forEach((s, i) => {
    if (i > 0) w.addSpacer(5)
    const h = H(w, 4)
    const pc = posColor(s.pos)
    if (pc) tile(h, s.pos, pc, 20)
    else numBox(h, s.pos, 20, isMe(s.driver, d) ? ACC : C.mute)
    T(h, isMe(s.driver, d) ? "YOU" : up(s.driver), ns, { f: "heavy", c: isMe(s.driver, d) ? ACC : C.text })
    if (s.country) T(h, flag(s.country), Math.min(10, ns))
    h.addSpacer()
    T(h, s.points, 15, { f: "black", c: isMe(s.driver, d) ? ACC : C.text })
  })
  if (!meRow && d.me && d.me.pos) {
    w.addSpacer(5)
    const h = H(w, 4)
    numBox(h, d.me.pos, 20, ACC)
    T(h, "YOU", ns, { f: "heavy", c: ACC })
    if (d.me.country) T(h, flag(d.me.country), Math.min(10, ns))
    h.addSpacer()
    T(h, d.me.points, 15, { f: "black", c: ACC })
  }
  w.addSpacer()
  return w
}

// " · TIER 2" when the tables are counted inside one tier
function scopeTag(d) {
  return d && d.scope && d.scope.tier ? " · TIER " + d.scope.tier : ""
}

// Standings, medium: the top of the table and, below, your own row
function standingsM(d) {
  const st = d.standings
  if (!st.length) return message("Standings", "No standings yet")
  const w = W()
  const h = H(w, 6)
  kicker(h, (d.season ? shortSeason(d.season) + " · " : "") + "Drivers" + scopeTag(d))
  h.addSpacer()
  sub(h, "Standings")
  w.addSpacer(3)
  standingRows(w, d, 3, true, 2)
  w.addSpacer()
  return w
}

// Where you are, when you are not on the podium
function mySummary(d) {
  const me = d.me
  if (!me || !me.pos || me.pos <= 3) return null
  return "YOU P" + me.pos + " · " + me.points + " PTS"
}

function top3S(d) {
  const st = d.standings
  if (!st.length) return message("Top 3", "No standings yet")
  const w = W()
  const h = H(w, 6)
  kicker(h, "Top 3" + (d.scope && d.scope.tier ? " · T" + d.scope.tier : ""))
  h.addSpacer()
  const mine = mySummary(d)
  if (mine) T(h, "YOU P" + d.me.pos, 10, { f: "monob", c: ACC })
  w.addSpacer()
  const ns = fitSize(widgetWidth("small") - 28 - 20 - 8 - 29 - 12, longestName(st.slice(0, 3).map(x => x.driver)), 13, 10, 0.9)
  st.slice(0, 3).forEach((s, i) => {
    if (i > 0) w.addSpacer(5)
    const r = H(w, 4)
    tile(r, s.pos, posColor(s.pos) || C.dim, 20)
    T(r, up(s.driver), ns, { f: "heavy", c: isMe(s.driver, d) ? ACC : C.text })
    if (s.country) T(r, flag(s.country), Math.min(10, ns))
    r.addSpacer()
    T(r, s.points, 15, { f: "black" })
  })
  w.addSpacer()
  return w
}

function top3M(d) {
  const st = d.standings
  if (!st.length) return message("Top 3", "No standings yet")
  const w = W()
  const h = H(w, 6)
  kicker(h, (d.season ? shortSeason(d.season) + " · " : "") + "Drivers" + scopeTag(d))
  h.addSpacer()
  const mine = mySummary(d)
  if (mine) T(h, mine, 10, { f: "monob", c: ACC })
  else sub(h, "Top 3")
  w.addSpacer(6)
  const row = H(w, 8)
  row.topAlignContent()
  const cw = Math.floor((widgetWidth("medium") - 28 - 16) / 3)
  // one name size for the three cards, from the longest name in their width
  const nameSize = fitSize(cw - 20, up(st.slice(0, 3).map(x => x.driver).sort((a, b) => b.length - a.length)[0]), 14, 10, 1.2)
  st.slice(0, 3).forEach((s, i) => {
    const me = isMe(s.driver, d)
    const c = V(row, 0)
    c.size = new Size(cw, 0)
    c.backgroundColor = me ? new Color(ACC_HEX, 0.16) : i === 0 ? C.rowLead : C.rowAlt
    c.cornerRadius = 12
    c.setPadding(8, 10, 8, 10)
    // place on the left, the gap to the leader on the right
    const t = H(c, 0)
    tile(t, s.pos, posColor(s.pos) || C.dim, 20)
    t.addSpacer()
    T(t, s.gap == null ? "LEADER" : signed(s.gap), 9, { f: "mono", c: C.mute })
    c.addSpacer(6)
    // who: the name with its flag on the same line, the team under it
    const nm = H(c, 4)
    T(nm, up(s.driver), nameSize, { f: "heavy", c: me ? ACC : C.text })
    if (s.country) T(nm, flag(s.country), Math.min(11, nameSize))
    c.addSpacer(2)
    const tm = H(c, 4)
    bar(tm, teamColor(s), 3, 10)
    T(tm, s.team, 10, { f: "medium", c: C.mute })
    c.addSpacer(5)
    T(c, s.points, 22, { f: "black" })
  })
  w.addSpacer()
  return w
}

// Top 3, large: three big podium cards, then where you are
function top3L(d) {
  const st = d.standings
  if (!st.length) return message("Top 3", "No standings yet")
  const w = W()
  const hl = V(w, 3)
  line(hl, up((d.season ? shortSeason(d.season) + " · " : "") + "Championship" + scopeTag(d)), 10, { f: "monob", c: ACC })
  line(hl, "TOP 3", 20, { f: "black" })
  w.addSpacer(10)
  const list = V(w, 6)
  st.slice(0, 3).forEach(s => podiumCard(list, s, d))
  const me = d.me
  if (me && me.pos > 3) {
    w.addSpacer(8)
    const own = st.find(x => isMe(x.driver, d)) || {
      pos: me.pos, driver: me.driver, team: me.team, teamColor: me.teamColor,
      country: me.country, points: me.points, gap: me.gapLeader,
    }
    if (me.pos > 4) gapMarker(w, false)
    standingRow(w, own, d, false)
    w.addSpacer(8)
    const f = H(w, 8)
    if (me.gapAhead != null && me.pos > 1) {
      T(f, signed(me.gapAhead), 13, { f: "black", c: new Color("#F87171") })
      T(f, "to P" + (me.pos - 1), 10, { f: "mono", c: C.mute })
    }
    f.addSpacer()
    if (me.gapBehind != null) {
      T(f, "P" + (me.pos + 1) + " is", 10, { f: "mono", c: C.mute })
      T(f, signed(-Math.abs(me.gapBehind)), 13, { f: "black", c: C.green })
    }
  }
  w.addSpacer()
  return w
}

function podiumCard(p, s, d) {
  const me = isMe(s.driver, d)
  const pc = posColor(s.pos) || C.mute
  const c = H(p, 10)
  c.backgroundColor = me ? new Color(ACC_HEX, 0.16) : s.pos === 1 ? C.rowLead : C.rowAlt
  c.cornerRadius = 12
  c.setPadding(8, 8, 8, 12)
  bar(c, pc, 3, 34)
  tile(c, s.pos, pc, 26)
  const mid = V(c, 2)
  const top = H(mid, 5)
  T(top, up(s.driver), 16, { f: "heavy", c: me ? ACC : C.text })
  if (s.country) T(top, flag(s.country), 12)
  top.addSpacer()
  const bot = H(mid, 5)
  bar(bot, teamColor(s), 8, 8)
  T(bot, s.team, 12, { f: "medium", c: C.mute })
  bot.addSpacer()
  const rt = V(c, 0)
  rightLine(rt, s.points, 22, { f: "black" })
  rightLine(rt, s.gap == null ? "LEADER" : signed(s.gap), 9, { f: "mono", c: C.mute })
}

function standingsL(d) {
  const st = d.standings
  if (!st.length) return message("Standings", "No standings yet")
  const w = W()
  const h = H(w, 6)
  const hl = V(h, 3)
  line(hl, up((d.season ? shortSeason(d.season) + " · " : "") + "Championship" + scopeTag(d)), 10, { f: "monob", c: ACC })
  line(hl, "DRIVER STANDINGS", 20, { f: "black" })
  h.addSpacer()
  w.addSpacer(8)
  standingRows(w, d, 5, false)
  w.addSpacer()
  return w
}

function standingRows(w, d, count, compact, pad) {
  const st = d.standings
  const meIdx = st.findIndex(s => isMe(s.driver, d))
  let shown = st.slice(0, count)
  if (meIdx === count) shown = st.slice(0, count + 1)
  shown.forEach(s => standingRow(w, s, d, compact, pad))
  const meVisible = shown.some(s => isMe(s.driver, d))
  if (!meVisible) {
    const meRow = meIdx >= 0 ? st[meIdx] : (d.me && d.me.pos ? {
      pos: d.me.pos, driver: d.me.driver, team: d.me.team, teamColor: d.me.teamColor,
      country: d.me.country, points: d.me.points, gap: d.me.gapLeader,
    } : null)
    if (meRow) {
      gapMarker(w, compact)
      standingRow(w, meRow, d, compact, pad)
    }
  }
}

// Shows that rows were skipped: a thin line, three dots in the middle, a thin line.
// A fixed height with centred content keeps the dots exactly between the two rows.
function gapMarker(p, compact) {
  const g = H(p, 6)
  g.size = new Size(0, compact ? 12 : 16)
  g.centerAlignContent()
  const side = () => {
    const l = g.addStack()
    l.size = new Size(0, 1)
    l.backgroundColor = new Color("#3F3F46")
    l.addStack().addSpacer()
  }
  side()
  const dots = H(g, 4)
  for (let i = 0; i < 3; i++) dot(dots, new Color("#71717A"), 3)
  side()
}

function standingRow(p, s, d, compact, pad) {
  const me = isMe(s.driver, d)
  const h = H(p, 8)
  const vp = pad != null ? pad : compact ? 3 : 5
  h.setPadding(vp, 6, vp, 6)
  h.cornerRadius = 8
  if (me) h.backgroundColor = new Color(ACC_HEX, 0.13)
  else if (s.pos === 1 && !compact) h.backgroundColor = C.rowLead
  const pc = posColor(s.pos)
  if (pc) tile(h, s.pos, pc, compact ? 20 : 24)
  else numBox(h, s.pos, compact ? 20 : 24, me ? ACC : C.mute)
  if (!compact) {
    const db = h.addStack()
    db.size = new Size(22, 0)
    if (s.change > 0) T(db, "▲" + s.change, 10, { f: "mono", c: C.green })
    else if (s.change < 0) T(db, "▼" + Math.abs(s.change), 10, { f: "mono", c: C.red })
  }
  bar(h, teamColor(s), 4, compact ? 16 : 24)
  const mid = V(h, 0)
  const top = H(mid, 5)
  T(top, up(s.driver), 14, { f: "heavy", c: me ? ACC : C.text })
  if (s.country) T(top, flag(s.country), 10)
  top.addSpacer()
  if (!compact) line(mid, s.team + (me ? " · you" : ""), 11, { f: "medium", c: C.mute })
  const rt = V(h, 0)
  rightLine(rt, s.points, compact ? 15 : 18, { f: "black", c: me ? ACC : C.text })
  if (!compact) rightLine(rt, s.gap == null ? "leader" : signed(s.gap), 10, { f: "mono", c: C.mute })
}

// The top rows of a table, plus your own team when it is further down
function withMine(list, count, myTeam) {
  const head = list.slice(0, count)
  const mine = list.find(x => low(x.team) === myTeam)
  if (!mine || head.includes(mine)) return { rows: head, skipped: false }
  return { rows: head.concat([mine]), skipped: mine.pos > count + 1 }
}

function constructorRow(p, x, myTeam, o) {
  const mine = low(x.team) === myTeam
  const r = H(p, o.small ? 5 : 8)
  r.setPadding(o.pad, 0, o.pad, 0)
  const pc = posColor(x.pos)
  if (pc) tile(r, x.pos, pc, 20)
  else numBox(r, x.pos, 20, mine ? ACC : C.mute)
  bar(r, teamColor(x), 4, 16)
  if (o.small) {
    // one size for every row, so no team looks smaller than the next
    T(r, up(x.team), 10, { f: "heavy", c: mine ? ACC : C.text, min: 0.6 })
    r.addSpacer()
  } else {
    const nb = r.addStack()
    nb.size = new Size(84, 0)
    T(nb, up(x.team), 13, { f: "heavy", c: mine ? ACC : C.text })
    const track = r.addStack()
    track.size = new Size(o.bw, 6)
    track.backgroundColor = C.border
    track.cornerRadius = 3
    const fill = track.addStack()
    fill.size = new Size(Math.max(4, Math.round(o.bw * (x.points || 0) / o.max)), 6)
    fill.backgroundColor = teamColor(x)
    fill.cornerRadius = 3
    track.addSpacer()
    r.addSpacer()
  }
  T(r, x.points, 15, { f: "black", c: mine ? ACC : C.text })
}

function constructorBlock(p, list, count, myTeam, o) {
  const max = Math.max.apply(null, list.map(x => x.points || 0)) || 1
  const sel = withMine(list, count, myTeam)
  sel.rows.forEach((x, i) => {
    if (i === sel.rows.length - 1 && sel.skipped) gapMarker(p, true)
    constructorRow(p, x, myTeam, Object.assign({ max }, o))
  })
}

function constructorsW(d, fam, tier) {
  const cons = d.constructors
  let t1 = null
  let t2 = null
  if (Array.isArray(cons)) t1 = cons
  else if (cons) { t1 = cons.tier1 || cons.t1; t2 = cons.tier2 || cons.t2 }
  if ((!t1 || !t1.length) && (!t2 || !t2.length)) return message("Constructors", "Coming soon, data not available yet.")
  const myTeam = low(d.me && d.me.team)
  const inList = l => !!l && l.some(x => low(x.team) === myTeam)
  const asked = /[12]/.test(tier || "") ? (/2/.test(tier) ? 2 : 1) : 0
  // without a tier in the parameter, show the table your own team is in
  const which = asked || (inList(t2) && !inList(t1) ? 2 : 1)
  const big = fam === "large" || fam === "extraLarge"
  const small = fam === "small"
  const w = W()
  const h = H(w, 6)
  kicker(h, "Constructors")
  h.addSpacer()

  if (big && !asked && t1 && t1.length && t2 && t2.length) {
    sub(h, "Tier 1 + 2")
    w.addSpacer(4)
    const o = { small: false, pad: 2, bw: 120 }
    // the table your own team is in comes first and gets the most rows
    const blocks = which === 2 ? [[2, t2, 5], [1, t1, 3]] : [[1, t1, 6], [2, t2, 4]]
    blocks.forEach(([n, list, count], i) => {
      if (i > 0) { w.addSpacer(8); divider(w); w.addSpacer(6) }
      line(w, "TIER " + n, 9, { f: "monob", c: C.mute })
      w.addSpacer(2)
      constructorBlock(w, list, count, myTeam, o)
    })
    w.addSpacer()
    return w
  }

  const list = which === 2 ? t2 : t1
  if (!list || !list.length) return message("Constructors", "Coming soon, data not available yet.")
  sub(h, which === 2 ? "Tier 2" : "Tier 1")
  w.addSpacer(small ? 0 : 4)
  if (small) w.addSpacer()
  // small and medium: the top three plus your own team, however far down it is
  const count = big ? 10 : (inList(list) && list.findIndex(x => low(x.team) === myTeam) < 4 && !small ? 4 : 3)
  constructorBlock(w, list, count, myTeam, { small, pad: small ? 2 : 3, bw: big ? 120 : 100 })
  w.addSpacer()
  return w
}

// Driver card / me

// Driver card with the profile picture (like the card on nabsracing.com)

async function loadAvatar(me) {
  const raw = avatarField(me)
  if (!raw) { console.log("NABS: no avatar field in data for " + (me && me.driver)); return null }
  const url = /^https?:/.test(raw) ? raw : BASE_URL + (String(raw).charAt(0) === "/" ? "" : "/") + raw
  const fm = FileManager.local()
  const path = fm.joinPath(fm.cacheDirectory(), "nabs-avatar-" + hashStr(url) + ".png")
  try {
    if (fm.fileExists(path) && Date.now() - fm.modificationDate(path).getTime() < 12 * 3600e3) return fm.readImage(path)
  } catch (_) {}
  try {
    const req = new Request(url)
    req.timeoutInterval = 10
    const img = await req.loadImage()
    try { fm.writeImage(path, img) } catch (_) {}
    return img
  } catch (e) {
    console.log("NABS: avatar could not be loaded from " + url + " (" + (e && e.message ? e.message : e) + ")")
    try { if (fm.fileExists(path)) return fm.readImage(path) } catch (_) {}
    return null
  }
}

function avatarField(me) {
  if (!me) return null
  const keys = ["avatar", "avatarUrl", "avatar_url", "photo", "photoUrl", "image", "imageUrl", "picture", "profileImage", "profilePicture", "cardImage"]
  for (const k of keys) if (typeof me[k] === "string" && me[k].trim()) return me[k].trim()
  const nested = me.card || me.profile || me.user
  if (nested) for (const k of keys) if (typeof nested[k] === "string" && nested[k].trim()) return nested[k].trim()
  return null
}

function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

// Draws the card background: photo (or silhouette), purple tint and fade. No frame line.
function cardImage(avatar, w, h, o) {
  o = o || {}
  const S = 3
  const Wd = Math.round(w * S)
  const Ht = Math.round(h * S)
  const dc = new DrawContext()
  dc.size = new Size(Wd, Ht)
  dc.opaque = true
  dc.respectScreenScale = false
  dc.setFillColor(C.cardBase)
  dc.fillRect(new Rect(0, 0, Wd, Ht))
  if (avatar && avatar.size && avatar.size.width > 0) {
    const iw = avatar.size.width
    const ih = avatar.size.height
    const sc = Math.max(Wd / iw, Ht / ih)
    const dw = iw * sc
    const dh = ih * sc
    dc.drawImageInRect(avatar, new Rect((Wd - dw) / 2, Math.min(0, (Ht - dh) * 0.25), dw, dh))
    dc.setFillColor(new Color("#34265E", 0.42))
    dc.fillRect(new Rect(0, 0, Wd, Ht))
  } else {
    const a = o.sil || [0.3, 0.08, 0.8, 1]
    drawSilhouette(dc, new Rect(Wd * a[0], Ht * a[1], Wd * a[2], Ht * a[3]))
  }
  fadeV(dc, Wd, Ht, 0, Ht * 0.3, 0.35, 0)
  fadeV(dc, Wd, Ht, Ht * (o.fadeFrom || 0.42), Ht, 0, 0.95)
  const c = (o.chamfer || 12) * S
  if (o.clip) {
    dc.setFillColor(o.clip)
    const t1 = new Path()
    t1.move(new Point(0, 0)); t1.addLine(new Point(c, 0)); t1.addLine(new Point(0, c)); t1.closeSubpath()
    dc.addPath(t1); dc.fillPath()
    const t2 = new Path()
    t2.move(new Point(Wd, Ht)); t2.addLine(new Point(Wd - c, Ht)); t2.addLine(new Point(Wd, Ht - c)); t2.closeSubpath()
    dc.addPath(t2); dc.fillPath()
  }
  return dc.getImage()
}

function fadeV(dc, Wd, Ht, y0, y1, a0, a1) {
  const start = Math.round(y0)
  const end = Math.round(y1)
  for (let y = start; y < end; y += 2) {
    const t = (y - start + 1) / Math.max(1, end - start)
    const a = a0 + (a1 - a0) * t * t * (3 - 2 * t)
    dc.setFillColor(new Color("#161030", Math.max(0, Math.min(1, a))))
    dc.fillRect(new Rect(0, y, Wd, Math.min(2, end - y)))
  }
}

function drawSilhouette(dc, r) {
  dc.setFillColor(new Color("#5E4BA8"))
  const head = Math.min(r.width, r.height) * 0.21
  const cx = r.x + r.width / 2
  const cy = r.y + r.height * 0.34
  dc.fillEllipse(new Rect(cx - head, cy - head, head * 2, head * 2))
  dc.fillEllipse(new Rect(cx - r.width * 0.42, cy + head * 1.25, r.width * 0.84, r.height * 0.95))
}

function avatarThumb(avatar) {
  if (avatar) return avatar
  const dc = new DrawContext()
  dc.size = new Size(90, 90)
  dc.opaque = true
  dc.respectScreenScale = false
  dc.setFillColor(C.cardBase)
  dc.fillRect(new Rect(0, 0, 90, 90))
  drawSilhouette(dc, new Rect(8, 10, 74, 90))
  return dc.getImage()
}

function ghostImage(text, color) {
  const dc = new DrawContext()
  dc.size = new Size(510, 510)
  dc.opaque = true
  dc.respectScreenScale = false
  dc.setFillColor(C.bg)
  dc.fillRect(new Rect(0, 0, 510, 510))
  dc.setFont(Font.blackSystemFont(420))
  dc.setTextColor(new Color("#" + String(color.hex).replace("#", ""), 0.16))
  dc.setTextAlignedRight()
  dc.drawTextInRect(String(text), new Rect(-60, 150, 600, 520))
  return dc.getImage()
}

function cardIdentity(p, me, rt, sizes) {
  const fl = H(p, 5)
  if (me.country) T(fl, flag(me.country), sizes.flag)
  if (me.number != null) T(fl, "#" + me.number, sizes.flag, { f: "mono", c: new Color("#C9C2E8") })
  fl.addSpacer()
  p.addSpacer(3)
  line(p, up(me.driver), sizes.name, { f: "black" })
  p.addSpacer(2)
  line(p, up(me.team + (sizes.withPos ? " · P" + me.pos : "")), sizes.team, { f: "monob", c: C.cardAcc })
}

async function cardS(d) {
  const me = d.me
  if (!me) return noDriver()
  const rt = me.rating
  const av = await loadAvatar(me)
  const w = new ListWidget()
  w.backgroundColor = C.cardBase
  w.backgroundImage = cardImage(av, 170, 170, { inset: 6, chamfer: 12, fadeFrom: 0.4, sil: [0.32, 0.09, 0.8, 1] })
  w.setPadding(16, 18, 15, 14)
  w.url = BASE_URL
  line(w, rt ? "RTG" : "POS", 9, { f: "monob", c: C.cardText })
  line(w, rt ? rt.rtg : "P" + me.pos, 38, { f: "black" })
  w.addSpacer()
  cardIdentity(w, me, rt, { flag: 10, name: 17, team: 9, withPos: !!rt })
  return w
}

async function cardM(d) {
  const me = d.me
  if (!me) return noDriver()
  const rt = me.rating
  const av = await loadAvatar(me)
  const w = W()
  w.setPadding(9, 9, 9, 14)
  const row = H(w, 12)
  const card = V(row, 0)
  card.size = new Size(128, 138)
  card.backgroundImage = cardImage(av, 128, 138, { inset: 4, chamfer: 10, clip: C.bg, fadeFrom: 0.42, sil: [0.1, 0.06, 0.9, 1] })
  card.setPadding(10, 12, 10, 10)
  line(card, rt ? "RTG" : "POS", 9, { f: "monob", c: C.cardText })
  line(card, rt ? rt.rtg : "P" + me.pos, 32, { f: "black" })
  card.addSpacer()
  cardIdentity(card, me, rt, { flag: 9, name: 15, team: 8, withPos: false })

  const right = V(row, 0)
  const h = H(right, 6)
  h.setPadding(4, 0, 0, 0)
  kicker(h, "Driver card", C.cardAcc)
  h.addSpacer()
  if (d.season) sub(h, shortSeason(d.season).replace(/season\s*/i, "S"))
  right.addSpacer()
  if (rt) {
    // the bars take what is left beside the card, so the numbers keep their size
    const BW = Math.max(50, Math.min(88, Math.floor(0.92 * (widgetWidth("medium") - 28 - 128 - 12) - 81)))
    ;[["EXP", rt.exp], ["RAC", rt.rac], ["AWA", rt.awa], ["PAC", rt.pac]].forEach(([k, v], i) => {
      if (i > 0) right.addSpacer(6)
      const r = H(right, 8)
      const lb = r.addStack()
      lb.size = new Size(30, 0)
      T(lb, k, 10, { f: "monob", c: new Color("#C9C2E8") })
      const track = r.addStack()
      track.size = new Size(BW, 6)
      track.backgroundColor = C.statTrack
      track.cornerRadius = 3
      const fill = track.addStack()
      fill.size = new Size(Math.max(4, Math.round(BW * Math.min(100, v || 0) / 100)), 6)
      fill.backgroundColor = C.statFill
      fill.cornerRadius = 3
      track.addSpacer()
      r.addSpacer()
      T(r, v == null ? "–" : v, 15, { f: "black" })
    })
  } else {
    line(right, "P" + me.pos, 44, { f: "black" })
  }
  right.addSpacer()
  const f = H(right, 4)
  sub(f, "Standings")
  f.addSpacer()
  T(f, "P" + me.pos + " · " + me.points, 14, { f: "black" })
  T(f, "PTS", 9, { f: "mono", c: C.mute })
  return w
}

// The large card keeps the proportions of the real card on the website (332 x 470,
// portrait). The room next to it holds the season numbers.
async function cardL(d) {
  const me = d.me
  if (!me) return noDriver()
  const rt = me.rating
  const av = await loadAvatar(me)
  const w = W()
  w.setPadding(12, 12, 12, 12)
  const row = H(w, 10)
  const CW = 226
  const CH = 312
  const card = V(row, 0)
  card.size = new Size(CW, CH)
  card.cornerRadius = 14
  card.backgroundImage = cardImage(av, CW, CH, { chamfer: 0, fadeFrom: 0.3, sil: [0.22, 0.06, 0.9, 1] })
  card.setPadding(14, 14, 10, 14)
  // top: the rating
  line(card, rt ? "RTG" : "POS", 10, { f: "monob", c: C.cardText })
  line(card, rt ? rt.rtg : "P" + me.pos, 50, { f: "black" })
  card.addSpacer()
  // the identity block, kept together: flag and number, the name, the team
  const fl = H(card, 6)
  if (me.country) T(fl, flag(me.country), 12)
  if (me.number != null) T(fl, "#" + me.number, 11, { f: "mono", c: new Color("#C9C2E8") })
  card.addSpacer(2)
  const nm = H(card, 0)
  T(nm, up(me.driver), 24, { f: "black", min: 0.5 })
  card.addSpacer(2)
  const tm = H(card, 5)
  bar(tm, teamColor(me), 3, 11)
  T(tm, up(me.team), 10, { f: "monob", c: C.cardAcc })
  if (rt) {
    card.addSpacer(9)
    const box = H(card, 0)
    box.backgroundColor = new Color("#3B2C6E", 0.9)
    box.cornerRadius = 10
    box.setPadding(6, 0, 6, 0)
    ;[["EXP", rt.exp], ["RAC", rt.rac], ["AWA", rt.awa], ["PAC", rt.pac]].forEach(([k, v], i) => {
      if (i > 0) {
        const div = box.addStack()
        div.size = new Size(1, 28)
        div.backgroundColor = new Color("#E9E3FF", 0.16)
      }
      const cell = V(box, 1)
      cell.size = new Size(48, 0)
      centerLine(cell, k, 8, { f: "monob", c: C.cardText })
      centerLine(cell, v == null ? "–" : v, 19, { f: "black" })
    })
  }

  const side = V(row, 6)
  const att = me.attendance
  sideStat(side, "POSITION", "P" + me.pos)
  sideStat(side, "POINTS", me.points)
  if (me.gapAhead != null && me.pos > 1) sideStat(side, "TO P" + (me.pos - 1), signed(me.gapAhead))
  else if (me.gapBehind != null) sideStat(side, "LEAD", signed(me.gapBehind))
  if (att) sideStat(side, "RACED", att.driven + "/" + att.total)
  if (me.tier) sideStat(side, "TIER", String(me.tier))
  return w
}

// A little tile for the numbers next to the large driver card
function sideStat(p, label, value) {
  const s = V(p, 1)
  s.size = new Size(0, 48)
  s.backgroundColor = C.card2
  s.cornerRadius = 10
  s.setPadding(6, 0, 6, 0)
  s.centerAlignContent()
  centerLine(s, label, 8, { f: "monob", c: C.cardText })
  centerLine(s, value == null ? "–" : value, 22, { f: "black" })
}

async function meS(d) {
  const me = d.me
  if (!me) return noDriver()
  const av = await loadAvatar(me)
  const w = W()
  w.setPadding(11, 11, 12, 12)
  w.backgroundImage = ghostImage(me.pos, teamColor(me))
  const top = H(w, 8)
  const img = top.addImage(avatarThumb(av))
  img.imageSize = new Size(34, 34)
  img.cornerRadius = 17
  img.borderWidth = 1.5
  img.borderColor = teamColor(me)
  nameAndTeam(top, me, 13, 10, 8)
  w.addSpacer()
  line(w, "P" + me.pos, 52, { f: "black" })
  w.addSpacer(6)
  const b = H(w, 6)
  b.bottomAlignContent()
  const l = V(b, 1)
  line(l, "POINTS", 8, { f: "mono", c: C.mute })
  line(l, me.points, 17, { f: "black" })
  b.addSpacer()
  const r = V(b, 1)
  if (me.gapAhead != null && me.pos > 1) {
    rightLine(r, "TO P" + (me.pos - 1), 8, { f: "mono", c: C.mute })
    rightLine(r, signed(me.gapAhead), 17, { f: "black" })
  } else if (me.gapBehind != null) {
    rightLine(r, "LEAD", 8, { f: "mono", c: C.mute })
    rightLine(r, signed(me.gapBehind), 17, { f: "black" })
  }
  return w
}

// My season: you, your position and the fight with the cars around you

function battleRows(d) {
  const me = d.me
  const st = d.standings || []
  const i = st.findIndex(x => isMe(x.driver, d))
  const rows = []
  if (i >= 0) {
    if (i > 0) rows.push(Object.assign({}, st[i - 1], { kind: "ahead", diff: st[i - 1].points - st[i].points }))
    rows.push(Object.assign({}, st[i], { kind: "me" }))
    if (i < st.length - 1) rows.push(Object.assign({}, st[i + 1], { kind: "behind", diff: st[i + 1].points - st[i].points }))
  } else {
    if (me.gapAhead != null && me.pos > 1) rows.push({ pos: me.pos - 1, driver: me.ahead || "Car ahead", country: me.aheadCountry, team: me.aheadTeam, teamColor: me.aheadColor, kind: "ahead", diff: Math.abs(me.gapAhead) })
    rows.push({ pos: me.pos, driver: me.driver, team: me.team, teamColor: me.teamColor, points: me.points, kind: "me" })
    if (me.gapBehind != null) rows.push({ pos: me.pos + 1, driver: me.behind || "Car behind", country: me.behindCountry, team: me.behindTeam, teamColor: me.behindColor, kind: "behind", diff: -Math.abs(me.gapBehind) })
  }
  return rows
}

function battleList(p, d, rowH, avail) {
  const rows = battleRows(d)
  // the name, its flag, the gap and the position share the row; the name gets what is left
  const ns = fitSize(avail - 18 - 4 - 8 - 34 - 25 - 14, longestName(rows.map(x => (x.kind === "me" ? "YOU" : x.driver))), 13, 10, 1.0)
  rows.forEach((x, i) => {
    if (i > 0) p.addSpacer(3)
    const r = H(p, 5)
    r.size = new Size(0, rowH)
    r.setPadding(0, 6, 0, 8)
    r.cornerRadius = 8
    if (x.kind === "me") r.backgroundColor = new Color(ACC_HEX, 0.14)
    numBox(r, x.pos, 18, x.kind === "me" ? ACC : C.mute)
    bar(r, teamColor(x), 4, 16)
    T(r, x.kind === "me" ? "YOU" : up(x.driver), ns, { f: "heavy", c: x.kind === "me" ? ACC : C.text })
    const cc = x.kind === "me" ? (x.country || (d.me && d.me.country)) : x.country
    if (cc) T(r, flag(cc), Math.min(11, ns))
    r.addSpacer()
    if (x.kind === "me") T(r, x.points + " PTS", ns, { f: "black", c: ACC })
    else T(r, (x.diff > 0 ? "+" : x.diff < 0 ? "−" : "±") + Math.abs(x.diff || 0), ns, { f: "monob", c: x.kind === "ahead" ? new Color("#F87171") : C.green })
  })
}

function meHead(p, me, av, big) {
  const top = H(p, big ? 12 : 8)
  const size = big ? 46 : 32
  const img = top.addImage(avatarThumb(av))
  img.imageSize = new Size(size, size)
  img.cornerRadius = size / 2
  img.borderWidth = big ? 2 : 1.5
  img.borderColor = teamColor(me)
  nameAndTeam(top, me, big ? 20 : 13, big ? 14 : 10, big ? 10 : 8)
}

// Name with the flag right next to it, team underneath
function nameAndTeam(p, me, size, flagSize, teamSize) {
  const nm = V(p, 2)
  const nl = H(nm, 4)
  T(nl, me.driver, size, { f: "heavy" })
  if (me.country) T(nl, flag(me.country), flagSize)
  // no spacer in the name line: it would keep 8 pt of the little room the name has
  const tl = H(nm, 4)
  bar(tl, teamColor(me), 3, (teamSize || 8) + 2)
  T(tl, up(me.team), teamSize || 8, { f: "mono", c: C.mute })
}

// Scriptable doesn't tell a script how wide its widget is, so it comes from the
// screen width: Apple's widget sizes per iPhone, in between it interpolates.
function widgetWidth(fam) {
  let sw = 393
  try { const s = Device.screenSize(); sw = Math.min(s.width, s.height) } catch (_) {}
  const sizes = [[320, 141, 292], [375, 155, 329], [393, 158, 338], [414, 169, 360], [430, 170, 364]]
  const col = fam === "small" ? 1 : 2
  if (sw <= sizes[0][0]) return sizes[0][col]
  for (let i = 1; i < sizes.length; i++) {
    const [w0, ...a] = sizes[i - 1]
    const [w1, ...b] = sizes[i]
    if (sw <= w1) return Math.round(a[col - 1] + (b[col - 1] - a[col - 1]) * (sw - w0) / (w1 - w0))
  }
  const last = sizes[sizes.length - 1]
  return Math.round(last[col] * sw / last[0])
}

// Two bars side by side (you and your teammate) that together fill the given width
function duelBar(p, mine, theirs, otherColor, width) {
  const total = (mine || 0) + (theirs || 0) || 1
  const sb = H(p, 2)
  const aw = Math.min(width - 8, Math.max(6, Math.round((width - 2) * (mine || 0) / total)))
  const a = sb.addStack()
  a.size = new Size(aw, 8)
  a.backgroundColor = ACC
  a.cornerRadius = 3
  const b = sb.addStack()
  b.size = new Size(width - 2 - aw, 8)
  b.backgroundColor = otherColor
  b.cornerRadius = 3
}

async function meM(d) {
  const me = d.me
  if (!me) return noDriver()
  const av = await loadAvatar(me)
  const w = W()
  w.setPadding(13, 14, 13, 12)
  const row = H(w, 14)
  const left = V(row, 0)
  left.size = new Size(118, 130)
  meHead(left, me, av, false)
  left.addSpacer()
  line(left, "P" + me.pos, 50, { f: "black" })
  const pts = H(left, 4)
  T(pts, me.points, 15, { f: "black" })
  T(pts, "PTS", 9, { f: "mono", c: C.mute })
  pts.addSpacer()

  const right = V(row, 0)
  const h = H(right, 6)
  kicker(h, "Battle")
  h.addSpacer()
  if (d.season) sub(h, shortSeason(d.season))
  right.addSpacer()
  battleList(right, d, 28, widgetWidth("medium") - 28 - 118 - 14)
  right.addSpacer()
  return w
}

async function meL(d) {
  const me = d.me
  if (!me) return noDriver()
  const av = await loadAvatar(me)
  const w = W()
  w.setPadding(14, 14, 14, 14)
  const head = H(w, 10)
  const hl = V(head, 0)
  meHead(hl, me, av, true)
  head.addSpacer()
  const hr = V(head, 0)
  rightLine(hr, "P" + me.pos, 44, { f: "black" })
  rightLine(hr, me.points + " PTS", 12, { f: "monob", c: C.mute })

  w.addSpacer(10)
  line(w, "BATTLE", 10, { f: "monob", c: ACC })
  w.addSpacer(4)
  battleList(w, d, 28, widgetWidth("large") - 28)

  const tm = me.teammate
  if (tm) {
    w.addSpacer(12)
    const th = H(w, 6)
    kicker(th, "Teammate")
    th.addSpacer()
    T(th, up(tm.driver) + " · P" + tm.pos, 10, { f: "monob", c: C.mute })
    w.addSpacer(5)
    duelBar(w, me.points, tm.points, teamColor(me), widgetWidth("large") - 28)
    w.addSpacer(4)
    const tl = H(w, 4)
    T(tl, me.points + " YOU", 10, { f: "monob", c: ACC })
    tl.addSpacer()
    T(tl, tm.points + " " + up(tm.driver), 10, { f: "monob", c: C.mute })
  }

  const form = Array.isArray(me.form) ? me.form.slice(-6) : null
  w.addSpacer(12)
  if (form && form.length) {
    line(w, "FORM", 10, { f: "monob", c: ACC })
    w.addSpacer(5)
    formChips(w, form, widgetWidth("large") - 28)
  } else if (me.lastResult) {
    infoRow(w, "Last race", "P" + me.lastResult.pos + (me.lastResult.track ? " · " + me.lastResult.track : ""))
  }
  w.addSpacer()
  return w
}

// Team name with its colour dot, top right of the teammate widgets
function teamTag(p, me, size) {
  const t = H(p, 4)
  bar(t, teamColor(me), 4, 10)
  T(t, up(me.team), size, { f: "mono", c: C.mute })
}

function teammateW(d, fam) {
  const me = d.me
  const tm = me && me.teammate
  if (!tm) return message("Teammate", me ? "Coming soon, data not available yet." : "Driver not found")
  if (fam === "large" || fam === "extraLarge") return teammateL(d)
  const small = fam === "small"
  const w = W()
  const h = H(w, 6)
  kicker(h, "Teammate")
  h.addSpacer()
  teamTag(h, me, 10)
  w.addSpacer()
  const s = H(w, 6)
  s.bottomAlignContent()
  const l = V(s, 0)
  const yl = H(l, 4)
  T(yl, small ? "YOU" : "YOU · P" + me.pos, 10, { f: "mono", c: C.mute })
  if (me.country) T(yl, flag(me.country), 9)
  yl.addSpacer()
  line(l, me.points, small ? 28 : 34, { f: "black", c: ACC })
  s.addSpacer()
  const r = V(s, 0)
  const tl = H(r, 4)
  tl.addSpacer()
  T(tl, up(small ? tm.driver : tm.driver + " · P" + tm.pos), 10, { f: "mono", c: C.mute })
  if (tm.country) T(tl, flag(tm.country), 9)
  rightLine(r, tm.points, small ? 28 : 34, { f: "black", c: teamColor(me) })
  w.addSpacer(7)
  duelBar(w, me.points, tm.points, teamColor(me), widgetWidth(fam) - 28)
  w.addSpacer(6)
  const diff = (me.points || 0) - (tm.points || 0)
  line(w, diff === 0 ? "Dead even" : diff > 0 ? "You lead by " + diff : tm.driver + " leads by " + (-diff), 11, { f: "medium", c: C.mute })
  return w
}

// The team's table position and points, from the constructors table
function teamStanding(d) {
  const me = d.me
  const cons = d.constructors
  if (!me || !cons) return null
  const lists = Array.isArray(cons) ? [cons] : [cons.tier1 || cons.t1, cons.tier2 || cons.t2]
  for (const l of lists) {
    const x = l && l.find(t => low(t.team) === low(me.team))
    if (x) return x
  }
  return null
}

// Teammate, large: both drivers side by side, then the team and your recent form
function teammateL(d) {
  const me = d.me
  const tm = me.teammate
  const w = W()
  const h = H(w, 6)
  kicker(h, "Head to head")
  h.addSpacer()
  teamTag(h, me, 10)
  w.addSpacer(12)

  const duel = H(w, 8)
  duel.topAlignContent()
  const l = V(duel, 1)
  const ln = H(l, 4)
  T(ln, up(me.driver), 12, { f: "heavy", c: ACC })
  if (me.country) T(ln, flag(me.country), 10)
  ln.addSpacer()
  line(l, "P" + me.pos, 34, { f: "black" })
  const lp = H(l, 4)
  T(lp, me.points, 20, { f: "black", c: ACC })
  T(lp, "PTS", 9, { f: "mono", c: C.mute })
  lp.addSpacer()
  duel.addSpacer()
  const r = V(duel, 1)
  const rn = H(r, 4)
  rn.addSpacer()
  T(rn, up(tm.driver), 12, { f: "heavy", c: teamColor(me) })
  if (tm.country) T(rn, flag(tm.country), 10)
  rightLine(r, "P" + tm.pos, 34, { f: "black" })
  const rp = H(r, 4)
  rp.addSpacer()
  T(rp, "PTS", 9, { f: "mono", c: C.mute })
  T(rp, tm.points, 20, { f: "black", c: teamColor(me) })

  w.addSpacer(8)
  duelBar(w, me.points, tm.points, teamColor(me), widgetWidth("large") - 28)
  w.addSpacer(8)
  divider(w)
  w.addSpacer(7)
  if (me.stats && tm.stats) h2hRows(w, me, tm)
  else teamBlock(w, d, me, tm)

  const form = Array.isArray(me.form) ? me.form.slice(-6) : null
  if (form && form.length) {
    w.addSpacer(10)
    divider(w)
    w.addSpacer(8)
    line(w, "YOUR LAST " + form.length + " RACES", 10, { f: "monob", c: ACC })
    w.addSpacer(5)
    formChips(w, form, widgetWidth("large") - 28)
  }
  w.addSpacer()
  return w
}

// The head-to-head rows of the driver profile: your value, what is compared, theirs.
// The better value of each pair is coloured.
function h2hRows(p, me, tm) {
  const a = me.stats
  const b = tm.stats
  const num = v => (v == null ? "–" : String(v))
  const rows = [
    ["WINS", num(a.wins), num(b.wins), a.wins - b.wins],
    ["PODIUMS", num(a.podiums), num(b.podiums), a.podiums - b.podiums],
    ["POLES", num(a.poles), num(b.poles), a.poles - b.poles],
    ["AVG FINISH", a.avgFinish == null ? "–" : "P" + a.avgFinish, b.avgFinish == null ? "–" : "P" + b.avgFinish, a.avgFinish == null || b.avgFinish == null ? 0 : b.avgFinish - a.avgFinish],
    ["AVG GRID", a.avgGrid == null ? "–" : "P" + a.avgGrid, b.avgGrid == null ? "–" : "P" + b.avgGrid, a.avgGrid == null || b.avgGrid == null ? 0 : b.avgGrid - a.avgGrid],
  ]
  const mateColor = teamColor(me)
  const list = V(p, 5)
  rows.forEach(([label, mine, theirs, cmp]) => {
    const r = H(list, 0)
    const l = r.addStack()
    l.size = new Size(78, 0)
    T(l, mine, 15, { f: "black", c: cmp > 0 ? ACC : C.text })
    l.addSpacer()
    const c = H(r, 0)
    c.addSpacer()
    T(c, label, 9, { f: "monob", c: C.mute })
    c.addSpacer()
    const t = H(r, 0)
    t.size = new Size(78, 0)
    t.addSpacer()
    T(t, theirs, 15, { f: "black", c: cmp < 0 ? mateColor : C.text })
  })
}

// Without the head-to-head numbers: the team's place in the constructors table
function teamBlock(w, d, me, tm) {
  line(w, "THE TEAM", 10, { f: "monob", c: ACC })
  w.addSpacer(5)
  const ts = teamStanding(d)
  const tr = H(w, 8)
  if (ts) {
    tile(tr, ts.pos, posColor(ts.pos) || C.dim, 24)
    const nm = V(tr, 1)
    line(nm, up(me.team), 14, { f: "heavy" })
    line(nm, "CONSTRUCTORS" + (me.tier ? " · TIER " + me.tier : ""), 9, { f: "mono", c: C.mute })
    tr.addSpacer()
    const pt = V(tr, 0)
    rightLine(pt, ts.points, 22, { f: "black" })
    rightLine(pt, "TEAM PTS", 8, { f: "mono", c: C.mute })
  } else {
    line(tr, up(me.team), 14, { f: "heavy" })
  }
}

// Your last results as chips that fill the width. Gold, silver and bronze for the podium.
function formChips(p, form, width) {
  const n = form.length
  // chips sit edge to edge with flexible gaps between them, so the space at the left
  // and at the right of the row is exactly the widget's own margin
  const cw = Math.min(46, Math.floor(((width || 300) - 8 * (n - 1)) / n))
  const ch = Math.round(cw * 0.82)
  // a full row of six runs edge to edge; fewer chips sit side by side from the left
  const full = n >= 6
  const fr = H(p, full ? 0 : 8)
  form.forEach((f, i) => {
    if (full && i > 0) fr.addSpacer()
    const c = V(fr, 3)
    const chip = c.addStack()
    chip.size = new Size(cw, ch)
    chip.cornerRadius = 10
    chip.centerAlignContent()
    const pc = f.pos != null ? posColor(f.pos) : null
    chip.backgroundColor = pc || C.border
    chip.addSpacer()
    T(chip, f.pos == null ? "–" : "P" + f.pos, Math.round(cw * 0.3), { f: "black", c: pc ? C.ink : C.text })
    chip.addSpacer()
    const lb = H(c, 0)
    lb.size = new Size(cw, 0)
    lb.addSpacer()
    T(lb, "R" + f.round, 9, { f: "mono", c: C.mute })
    lb.addSpacer()
  })
  if (!full) fr.addSpacer()
}

function signupStatus(d) {
  const r = d.nextRace
  const me = d.me
  if (!r || !me) return null
  if (typeof me.signedUpNext === "boolean") return me.signedUpNext
  const a = me.attendance
  if (a) {
    if (a.next === "signed" || a.next === true) return true
    if (a.next === "pending" || a.next === "notSigned" || a.next === false) return false
    const x = Array.isArray(a.rounds) ? a.rounds.find(z => z.round === r.round) : null
    if (x && x.status === "signed") return true
    if (x && x.status === "pending") return false
  }
  if (Array.isArray(r.signedUpDrivers)) return r.signedUpDrivers.some(n => isMe(typeof n === "string" ? n : n.driver, d))
  return null
}

function statusLine(p, st, size) {
  const h = H(p, 6)
  const color = st === true ? ACC : st === false ? C.amber : C.mute
  const sym = SFSymbol.named(st === true ? "checkmark.circle.fill" : st === false ? "exclamationmark.circle.fill" : "questionmark.circle")
  if (sym) {
    sym.applyFont(Font.boldSystemFont(size))
    const im = h.addImage(sym.image)
    im.imageSize = new Size(size + 2, size + 2)
    im.tintColor = color
  }
  T(h, st === true ? "YOU'RE IN" : st === false ? "NOT SIGNED UP" : "CHECK SIGN-UP", size, { f: "black", c: color })
  h.addSpacer()
}

// The seats of the next round, like the "18/40 seats taken" line on the Attendance page
function seatsOf(r) {
  if (!r || r.signedUp == null) return null
  const cap = r.maxGrid || null
  return {
    taken: r.signedUp,
    cap,
    free: cap ? Math.max(0, cap - r.signedUp) : null,
    full: !!cap && r.signedUp >= cap,
    waiting: r.waiting || 0,
  }
}

// The fill bar of the grid: green while there are seats, amber when it is full
function seatBar(p, seats, width, height) {
  const tr = p.addStack()
  tr.size = new Size(width, height)
  tr.backgroundColor = C.border
  tr.cornerRadius = height / 2
  const fl = tr.addStack()
  fl.size = new Size(Math.max(height, Math.round(width * Math.min(1, seats.taken / seats.cap))), height)
  fl.backgroundColor = seats.full ? C.amber : C.green
  fl.cornerRadius = height / 2
  tr.addSpacer()
}

function seatsColor(seats) { return seats.full ? C.amber : C.green }

function signupS(d) {
  const r = d.nextRace
  if (!r) return seasonOver(d)
  const st = signupStatus(d)
  const seats = seatsOf(r)
  const w = stripedWidget()
  const h = H(w, 5)
  kicker(h, "Sign-up")
  h.addSpacer()
  sub(h, "R" + r.round)
  w.addSpacer(5)
  trackLine(w, r, 15)
  w.addSpacer()
  statusLine(w, st, 13)
  w.addSpacer(8)
  if (seats && seats.cap) {
    const b = H(w, 5)
    b.bottomAlignContent()
    T(b, seats.full ? "FULL" : seats.free, 30, { f: "black", c: seatsColor(seats) })
    if (!seats.full) T(b, "SEATS FREE", 9, { f: "monob", c: C.mute })
    b.addSpacer()
    w.addSpacer(5)
    seatBar(w, seats, widgetWidth("small") - 28, 6)
    w.addSpacer(4)
    line(w, seats.taken + "/" + seats.cap + " TAKEN" + (seats.waiting ? " · " + seats.waiting + " WAITING" : ""), 9, { f: "monob", c: C.mute })
  } else {
    const b = H(w, 5)
    b.bottomAlignContent()
    T(b, seats ? seats.taken : "–", 30, { f: "black" })
    T(b, "SIGNED UP", 9, { f: "monob", c: C.mute })
    b.addSpacer()
  }
  return w
}

function signupM(d, big) {
  const r = d.nextRace
  if (!r) return seasonOver(d)
  const st = signupStatus(d)
  const seats = seatsOf(r)
  const w = stripedWidget()
  const width = widgetWidth(big ? "large" : "medium") - 28
  const img = big ? trackImage(r.track, r.outline, 104, 72) : null

  const top = H(w, 10)
  top.topAlignContent()
  const left = V(top, 0)
  const h = H(left, 6)
  kicker(h, "Sign-up")
  sub(h, "· R" + r.round)
  h.addSpacer()
  left.addSpacer(5)
  trackLine(left, r, big ? 28 : 22, null, widgetWidth(big ? "large" : "medium") - 28 - (big ? 104 + 10 : 0))
  left.addSpacer(3)
  line(left, up(fmt(new Date(r.date), "EEE d MMM · HH:mm")), 10, { f: "mono", c: new Color("#D4D4D8") })
  if (big && r.circuit) line(left, up(r.circuit), 10, { f: "mono", c: C.mute })
  left.addSpacer(big ? 10 : 6)
  statusLine(left, st, big ? 16 : 14)
  if (big || st !== true) {
    left.addSpacer(2)
    line(left, st === false ? "Tap to sign up on nabsracing.com" : st === true ? "See you on the grid" : "Run NABS Setup with your name", 11, { f: "medium", c: C.mute })
  }
  if (img) {
    const im = top.addImage(img)
    im.imageSize = new Size(104, 72)
  }

  // the grid, the way the Attendance page shows it
  if (big) { w.addSpacer(); divider(w); w.addSpacer(10) } else w.addSpacer()
  if (seats && seats.cap) {
    const hd = H(w, 6)
    T(hd, "GRID", 10, { f: "monob", c: big ? ACC : C.mute })
    hd.addSpacer()
    T(hd, (seats.full ? "FULL · " : "") + seats.taken + "/" + seats.cap + " SEATS TAKEN", 10, { f: "monob", c: seatsColor(seats) })
    w.addSpacer(big ? 8 : 5)
    if (big) {
      const nb = H(w, 8)
      nb.bottomAlignContent()
      T(nb, seats.full ? "FULL" : seats.free, 64, { f: "black", c: seatsColor(seats) })
      if (!seats.full) {
        const lb = V(nb, 0)
        T(lb, "SEATS", 11, { f: "monob", c: C.mute })
        T(lb, "FREE", 11, { f: "monob", c: C.mute })
        lb.addSpacer(8)
      }
      nb.addSpacer()
      const rb = V(nb, 0)
      rightLine(rb, seats.taken, 26, { f: "black" })
      rightLine(rb, "TAKEN", 9, { f: "mono", c: C.mute })
      w.addSpacer(8)
    }
    seatBar(w, seats, width, big ? 12 : 8)
    if (seats.waiting) {
      w.addSpacer(big ? 8 : 4)
      line(w, seats.waiting + (seats.waiting === 1 ? " DRIVER" : " DRIVERS") + " ON THE WAITING LIST", 9, { f: "monob", c: C.mute })
    } else if (big) {
      w.addSpacer(8)
      line(w, seats.full ? "The grid is full. New sign-ups join the waiting list." : "Seats are first come, first served.", 11, { f: "medium", c: C.mute })
    }
  } else {
    // the grid size is not known: show the plain count
    const nb = H(w, 8)
    nb.bottomAlignContent()
    T(nb, seats ? seats.taken : "–", big ? 56 : 36, { f: "black" })
    T(nb, "SIGNED UP", 10, { f: "monob", c: C.mute })
    nb.addSpacer()
  }

  if (big && Array.isArray(r.signedUpDrivers) && r.signedUpDrivers.length) {
    w.addSpacer(12)
    divider(w)
    w.addSpacer(8)
    line(w, "ON THE GRID", 10, { f: "monob", c: ACC })
    w.addSpacer(5)
    const names = r.signedUpDrivers.map(n => typeof n === "string" ? { driver: n } : n).slice(0, 16)
    const half = Math.ceil(names.length / 2)
    const cols = H(w, 14)
    cols.topAlignContent()
    ;[names.slice(0, half), names.slice(half)].forEach(list => {
      const c = V(cols, 3)
      list.forEach(n => {
        const rr = H(c, 6)
        bar(rr, teamColor(n), 3, 11)
        T(rr, n.driver, 12, { f: isMe(n.driver, d) ? "heavy" : "medium", c: isMe(n.driver, d) ? ACC : C.text })
        rr.addSpacer()
      })
    })
  }
  return w
}

// Form: your last six results as bars, the better the finish the taller the bar
function formStats(form) {
  const fin = form.filter(f => f.pos != null)
  const pos = fin.map(f => f.pos)
  return {
    best: pos.length ? Math.min.apply(null, pos) : null,
    avg: pos.length ? Math.round(10 * pos.reduce((a, b) => a + b, 0) / pos.length) / 10 : null,
    podiums: pos.filter(n => n <= 3).length,
    started: fin.length,
  }
}

// labels: "none" (bars only), "round" (R4) or "track" (R4 and the circuit name)
function formBars(p, form, width, height, labels) {
  const n = form.length
  // a short list keeps the same slim bars as a full one instead of stretching them
  const cw = Math.min(n < 6 ? 46 : 999, Math.floor((width - 8 * (n - 1)) / n))
  // The bars are scaled to your own results: your best one always reaches the top
  // and your worst keeps a bit under a third of the height, so a rough run still
  // looks good and a podium among them stands out.
  const fin = form.filter(f => f.pos != null).map(f => f.pos)
  const lo = fin.length ? Math.min.apply(null, fin) : 1
  const hi = fin.length ? Math.max.apply(null, fin) : 1
  const share = pos => (hi === lo ? 1 : 1 - 0.7 * (pos - lo) / (hi - lo))
  const labelH = labels === "track" ? 24 : labels === "round" ? 12 : 0
  const barMax = height - 14 - 4 - 8 - labelH
  const full = n >= 6
  const row = H(p, full ? 0 : 8)
  row.topAlignContent()
  form.forEach((f, i) => {
    if (full && i > 0) row.addSpacer()
    const col = V(row, 3)
    col.size = new Size(cw, height)
    col.addSpacer()
    const pc = f.pos != null ? posColor(f.pos) : null
    const fs = Math.min(11, Math.max(7, Math.round(cw * 0.42)))
    cellText(col, cw, f.pos == null ? "–" : "P" + f.pos, fs, { f: "black", c: pc || C.text })
    const b = col.addStack()
    b.size = new Size(cw, f.pos == null ? 4 : Math.max(8, Math.round(barMax * share(f.pos))))
    b.backgroundColor = pc || (f.pos == null ? C.border : new Color("#52525B"))
    b.cornerRadius = Math.min(6, Math.floor(cw / 2))
    if (labels !== "none") cellText(col, cw, "R" + f.round, Math.min(9, fs), { f: "mono", c: C.mute })
    if (labels === "track") cellText(col, cw, f.track || "", 8, { f: "mono", c: C.dim })
  })
  if (!full) row.addSpacer()
}

// Text centred in a fixed-width cell. No spacers: on iOS each keeps about 8 pt,
// which leaves nothing in a narrow column.
function cellText(p, w, str, size, o) {
  const c = p.addStack()
  c.size = new Size(w, 0)
  c.centerAlignContent()
  T(c, str, size, o)
}

function formData(d) {
  const me = d.me
  const form = me && Array.isArray(me.form) ? me.form.slice(-6) : []
  return form.length ? form : null
}

function formS(d) {
  if (!d.me) return noDriver()
  const form = formData(d)
  if (!form) return message("Form", "Coming soon, data not available yet.")
  const st = formStats(form)
  const w = W()
  const h = H(w, 6)
  kicker(h, "Form")
  h.addSpacer()
  sub(h, "Last " + form.length)
  w.addSpacer(5)
  line(w, "AVG FINISH", 8, { f: "mono", c: C.mute })
  line(w, st.avg == null ? "–" : "P" + st.avg, 26, { f: "black" })
  w.addSpacer()
  formBars(w, form, widgetWidth("small") - 28, 66, "round")
  return w
}

function formM(d) {
  if (!d.me) return noDriver()
  const form = formData(d)
  if (!form) return message("Form", "Coming soon, data not available yet.")
  const st = formStats(form)
  const w = W()
  const h = H(w, 6)
  kicker(h, "Form · " + d.myName)
  if (d.me.country) T(h, flag(d.me.country), 9)
  h.addSpacer()
  sub(h, "Last " + form.length + " races")
  w.addSpacer(6)
  const row = H(w, 14)
  row.topAlignContent()
  const left = V(row, 5)
  left.size = new Size(78, 0)
  ;[["BEST", st.best == null ? "–" : "P" + st.best, (st.best != null && posColor(st.best)) || C.text],
    ["AVERAGE", st.avg == null ? "–" : "P" + st.avg, C.text],
    ["PODIUMS", String(st.podiums), st.podiums ? C.gold : C.text]].forEach(([k, v, c]) => {
    const b = V(left, 0)
    line(b, k, 8, { f: "mono", c: C.mute })
    line(b, v, 18, { f: "black", c })
  })
  formBars(row, form, widgetWidth("medium") - 28 - 78 - 14, 104, "round")
  w.addSpacer()
  return w
}

function formL(d) {
  if (!d.me) return noDriver()
  const form = formData(d)
  if (!form) return message("Form", "Coming soon, data not available yet.")
  const st = formStats(form)
  const w = W()
  const hl = V(w, 3)
  const fh = H(hl, 4)
  T(fh, up((d.season ? shortSeason(d.season) + " · " : "") + d.myName), 10, { f: "monob", c: ACC })
  if (d.me.country) T(fh, flag(d.me.country), 10)
  fh.addSpacer()
  line(hl, "RACE FORM", 20, { f: "black" })
  w.addSpacer(10)
  const tiles = H(w, 8)
  ;[["BEST", st.best == null ? "–" : "P" + st.best], ["AVERAGE", st.avg == null ? "–" : "P" + st.avg], ["PODIUMS", String(st.podiums)], ["STARTS", st.started + "/" + form.length]].forEach(([k, v]) => {
    const b = V(tiles, 1)
    b.backgroundColor = C.rowAlt
    b.cornerRadius = 10
    b.setPadding(7, 10, 7, 10)
    line(b, k, 8, { f: "mono", c: C.mute })
    line(b, v, 20, { f: "black" })
  })
  w.addSpacer()
  formBars(w, form, widgetWidth("large") - 28, 168, "track")
  w.addSpacer()
  return w
}

// Rivals: the driver just ahead and the one just behind in the championship
function rivalsOf(d) {
  const rows = battleRows(d)
  return {
    ahead: rows.find(x => x.kind === "ahead") || null,
    behind: rows.find(x => x.kind === "behind") || null,
  }
}

function rivalCard(p, x, kind, w) {
  const ahead = kind === "ahead"
  const c = V(p, 3)
  c.size = new Size(w, 0)
  c.backgroundColor = C.rowAlt
  c.cornerRadius = 12
  c.setPadding(9, 10, 9, 10)
  line(c, ahead ? "AHEAD OF YOU" : "BEHIND YOU", 8, { f: "monob", c: C.mute })
  const n = H(c, 5)
  bar(n, teamColor(x), 4, 14)
  T(n, up(x.driver), fitSize(w - 20 - 4 - 10, up(x.driver), 13, 10, 1.0), { f: "heavy" })
  if (x.country) T(n, flag(x.country), 11)
  n.addSpacer()
  line(c, "P" + x.pos + (x.team ? " · " + x.team : ""), 10, { f: "medium", c: C.mute })
  c.addSpacer(3)
  const g = H(c, 4)
  g.bottomAlignContent()
  T(g, String(Math.abs(x.diff || 0)), 28, { f: "black", c: ahead ? new Color("#F87171") : C.green })
  T(g, "PTS", 9, { f: "mono", c: C.mute })
  g.addSpacer()
}

function rivalsS(d) {
  if (!d.me) return noDriver()
  const { ahead, behind } = rivalsOf(d)
  const w = W()
  const h = H(w, 6)
  kicker(h, "Rivals" + (d.scope && d.scope.tier ? " · T" + d.scope.tier : ""))
  h.addSpacer()
  sub(h, "P" + d.me.pos)
  w.addSpacer()
  ;[[ahead, "AHEAD", new Color("#F87171")], [behind, "BEHIND", C.green]].forEach(([x, label, col], i) => {
    if (!x) return
    if (i > 0 && ahead) w.addSpacer(8)
    const nl = H(w, 4)
    T(nl, label + " · " + up(x.driver), 9, { f: "monob", c: C.mute })
    if (x.country) T(nl, flag(x.country), 9)
    nl.addSpacer()
    const g = H(w, 4)
    g.bottomAlignContent()
    T(g, String(Math.abs(x.diff || 0)), 26, { f: "black", c: col })
    T(g, "PTS", 9, { f: "mono", c: C.mute })
    g.addSpacer()
  })
  if (!ahead && !behind) line(w, "Nobody around you yet", 12, { f: "medium", c: C.mute })
  w.addSpacer()
  return w
}

function rivalsM(d) {
  if (!d.me) return noDriver()
  const { ahead, behind } = rivalsOf(d)
  const w = W()
  const h = H(w, 6)
  kicker(h, "Rivals" + scopeTag(d))
  h.addSpacer()
  T(h, "YOU P" + d.me.pos + " · " + d.me.points + " PTS", 10, { f: "monob", c: ACC })
  w.addSpacer(8)
  const row = H(w, 8)
  row.topAlignContent()
  const cw = Math.floor((widgetWidth("medium") - 28 - 8) / 2)
  if (ahead) rivalCard(row, ahead, "ahead", cw)
  if (behind) rivalCard(row, behind, "behind", cw)
  if (!ahead && !behind) line(row, "Nobody around you yet", 12, { f: "medium", c: C.mute })
  w.addSpacer()
  return w
}

function rivalsL(d) {
  if (!d.me) return noDriver()
  const w = W()
  const hl = V(w, 3)
  line(hl, up((d.season ? shortSeason(d.season) + " · " : "") + "Points gaps" + scopeTag(d)), 10, { f: "monob", c: ACC })
  line(hl, "RIVALS", 20, { f: "black" })
  w.addSpacer(10)
  const st = d.standings || []
  const i = st.findIndex(x => isMe(x.driver, d))
  const rows = i >= 0
    ? st.slice(Math.max(0, i - 2), i + 3).map(x => Object.assign({}, x, { kind: isMe(x.driver, d) ? "me" : x.pos < st[i].pos ? "ahead" : "behind", diff: x.points - st[i].points }))
    : battleRows(d)
  const list = V(w, 5)
  rows.forEach(x => {
    const me = x.kind === "me"
    const r = H(list, 8)
    r.size = new Size(0, 46)
    r.setPadding(0, 8, 0, 10)
    r.cornerRadius = 10
    r.backgroundColor = me ? new Color(ACC_HEX, 0.16) : C.rowAlt
    numBox(r, x.pos, 22, me ? ACC : C.mute)
    bar(r, teamColor(x), 4, 26)
    const mid = V(r, 1)
    const nl = H(mid, 5)
    T(nl, me ? "YOU" : up(x.driver), 15, { f: "heavy", c: me ? ACC : C.text })
    if (x.country) T(nl, flag(x.country), 11)
    nl.addSpacer()
    line(mid, x.team || "", 10, { f: "medium", c: C.mute })
    const rt = V(r, 0)
    if (me) {
      rightLine(rt, x.points, 22, { f: "black", c: ACC })
      rightLine(rt, "PTS", 8, { f: "mono", c: C.mute })
    } else {
      const col = x.kind === "ahead" ? new Color("#F87171") : C.green
      rightLine(rt, (x.diff > 0 ? "+" : x.diff < 0 ? "−" : "±") + Math.abs(x.diff || 0), 22, { f: "black", c: col })
      rightLine(rt, x.points + " PTS", 8, { f: "mono", c: C.mute })
    }
  })
  w.addSpacer(8)
  line(w, "Gaps are points, seen from your seat.", 10, { f: "medium", c: C.mute })
  w.addSpacer()
  return w
}

function attendanceS(d) {
  const a = d.me && d.me.attendance
  if (!a) return message("Attendance", d.me ? "Coming soon, data not available yet." : "Driver not found")
  const w = W()
  kicker(w, "Attendance")
  w.addSpacer()
  line(w, a.driven + "/" + a.total, 40, { f: "black" })
  w.addSpacer(3)
  line(w, attStats(a), 10, { f: "mono", c: C.mute })
  const n = attNext(a, d)
  if (n) { w.addSpacer(3); line(w, n.text, 10, { f: "monob", c: n.ok ? ACC : C.red }) }
  return w
}

function attendanceM(d, big) {
  const a = d.me && d.me.attendance
  if (!a) return message("Attendance", d.me ? "Coming soon, data not available yet." : "Driver not found")
  const w = W()
  const sz = big ? 40 : 24
  const gap = big ? 7 : 5
  const head = H(w, 12)
  const l = V(head, 2)
  kicker(l, "Attendance" + (big && d.season ? " · " + shortSeason(d.season) : ""))
  if (big) l.addSpacer(10)
  else l.addSpacer()
  line(l, a.driven + "/" + a.total, big ? 48 : 36, { f: "black" })
  line(l, attStats(a), 10, { f: "mono", c: C.mute })
  const n = attNext(a, d)
  if (n) line(l, n.text, 10, { f: "monob", c: n.ok ? ACC : C.red })
  if (!big) {
    head.addSpacer()
    attGrid(head, a.rounds || [], sz, gap)
  } else {
    head.addSpacer()
    w.addSpacer()
    const g = H(w, 0)
    g.addSpacer()
    attGrid(g, a.rounds || [], sz, gap)
    g.addSpacer()
    w.addSpacer()
  }
  return w
}

function attStats(a) {
  const pct = a.total ? Math.round(100 * a.driven / a.total) : 0
  return pct + "%" + (a.streak ? " · " + a.streak + " IN A ROW" : "")
}

function attNext(a, d) {
  const r = d.nextRace
  if (!r) return null
  let st = a.next
  if (st == null && Array.isArray(a.rounds)) {
    const x = a.rounds.find(z => z.round === r.round)
    st = x ? x.status : null
  }
  if (st === "signed" || st === true) return { text: "R" + r.round + " · SIGNED UP", ok: true }
  if (st === "pending" || st === "notSigned" || st === false) return { text: "R" + r.round + " · NOT SIGNED UP", ok: false }
  return null
}

function attChip(h, x, sz) {
  const t = h.addStack()
  t.size = new Size(sz, sz)
  t.cornerRadius = Math.round(sz * 0.28)
  t.centerAlignContent()
  let fg = C.dim
  if (x.status === "attended") { t.backgroundColor = ACC; fg = ACC_DARK }
  else if (x.status === "missed") { t.backgroundColor = C.border }
  else if (x.status === "signed") { t.borderColor = ACC; t.borderWidth = 2; fg = ACC }
  else if (x.status === "pending") { t.borderColor = C.red; t.borderWidth = 1.5; fg = C.red }
  else { t.borderColor = new Color("#3F3F46"); t.borderWidth = 1.5 }
  // no spacers around the number: each would keep 8 pt, and a two-digit round
  // would not fit in a chip; the fixed size centres it anyway
  T(t, x.round, Math.round(sz * 0.4), { f: "monob", c: fg })
}

function attGrid(p, rounds, sz, gap) {
  const g = V(p, gap)
  const perRow = Math.ceil(rounds.length / 2) || 6
  for (let r = 0; r < 2; r++) {
    const h = H(g, gap)
    rounds.slice(r * perRow, (r + 1) * perRow).forEach(x => attChip(h, x, sz))
  }
}

// The whole season in one row, sized to fill the width
function attRow(p, rounds, width, gap) {
  const n = rounds.length || 1
  const sz = Math.min(26, Math.floor((width - gap * (n - 1)) / n))
  const h = H(p, gap)
  rounds.forEach(x => attChip(h, x, sz))
  h.addSpacer()
}

// Lock screen

function accessory(view, fam, d) {
  const w = new ListWidget()
  w.url = BASE_URL
  const r = d.nextRace
  const me = d.me
  const lr = d.lastRace
  const v = view === "auto" ? (showResultNow(d) ? "result" : "next") : view

  if (fam === "accessoryInline") {
    let s = r ? "R" + r.round + " " + r.track + " · " + fmt(new Date(r.date), "EEE HH:mm") : "NABS Racing"
    if ((v === "me" || v === "card") && me) s = me.driver + " P" + me.pos + " · " + me.points + " pts"
    else if ((v === "standings" || v === "top3") && d.standings[0]) s = "P1 " + d.standings[0].driver + " · " + d.standings[0].points
    else if (v === "result" && lr && lr.results[0]) s = "R" + lr.round + " " + lr.results[0].driver + " wins"
    else if (v === "attendance" && me && me.attendance) s = "Raced " + me.attendance.driven + "/" + me.attendance.total + (me.attendance.streak ? " · " + me.attendance.streak + " in a row" : "")
    else if (v === "form" && formData(d)) s = "Form " + formData(d).slice(-5).map(f => f.pos == null ? "–" : "P" + f.pos).join(" ")
    else if (v === "rivals" && me) { const rv = rivalsOf(d); s = [rv.ahead && "+" + Math.abs(rv.ahead.diff) + " to P" + rv.ahead.pos, rv.behind && "−" + Math.abs(rv.behind.diff) + " on P" + rv.behind.pos].filter(Boolean).join(" · ") || "P" + me.pos }
    else if (v === "signup" && r && seatsOf(r)) { const sx = seatsOf(r); s = "R" + r.round + " " + (sx.cap ? (sx.full ? "grid full" : sx.free + " seats free") : sx.taken + " signed up") }
    w.addText("🏁 " + s)
    return w
  }

  if (fam === "accessoryCircular") {
    w.addSpacer()
    if ((v === "me" || v === "card" || v === "standings") && me) {
      ctext(w, "P" + me.pos, 22, "black")
      ctext(w, String(me.points), 10, "semibold")
    } else if (v === "attendance" && me && me.attendance) {
      ctext(w, me.attendance.driven + "/" + me.attendance.total, 18, "black")
      ctext(w, "raced", 10, "semibold")
    } else if (v === "form" && formData(d)) {
      const fs = formStats(formData(d))
      ctext(w, fs.avg == null ? "–" : "P" + Math.round(fs.avg), 20, "black")
      ctext(w, "avg", 10, "semibold")
    } else if (v === "rivals" && me && rivalsOf(d).ahead) {
      ctext(w, "+" + Math.abs(rivalsOf(d).ahead.diff), 20, "black")
      ctext(w, "to P" + rivalsOf(d).ahead.pos, 10, "semibold")
    } else if (v === "signup" && r && seatsOf(r) && seatsOf(r).cap) {
      const sx = seatsOf(r)
      ctext(w, sx.full ? "FULL" : String(sx.free), 20, "black")
      ctext(w, "seats", 10, "semibold")
    } else if (r) {
      const ms = new Date(r.date).getTime() - Date.now()
      const big = ms <= 0 ? "GO" : ms >= 864e5 ? Math.floor(ms / 864e5) + "d" : Math.floor(ms / 36e5) + "h"
      ctext(w, big, 22, "black")
      ctext(w, "R" + r.round, 10, "semibold")
    } else {
      ctext(w, "NABS", 14, "black")
    }
    w.addSpacer()
    return w
  }

  // accessoryRectangular
  if ((v === "me" || v === "card") && me) {
    atext(w, "NABS · " + up(me.driver), 11, "bold")
    atext(w, "P" + me.pos + " · " + me.points + " pts", 15, "black")
    if (me.gapAhead != null) atext(w, signed(me.gapAhead) + " to P" + (me.pos - 1), 12, "medium")
    return w
  }
  if ((v === "standings" || v === "top3") && d.standings.length) {
    atext(w, "NABS · STANDINGS", 11, "bold")
    d.standings.slice(0, 3).forEach(s => atext(w, s.pos + "  " + s.driver + "  " + s.points, 12, "semibold"))
    return w
  }
  if (v === "attendance" && me && me.attendance) {
    atext(w, "NABS · ATTENDANCE", 11, "bold")
    atext(w, "Raced " + me.attendance.driven + "/" + me.attendance.total, 15, "black")
    if (me.attendance.streak) atext(w, me.attendance.streak + " in a row", 12, "medium")
    return w
  }
  if (v === "form" && formData(d)) {
    atext(w, "NABS · FORM", 11, "bold")
    atext(w, formData(d).slice(-4).map(f => f.pos == null ? "–" : "P" + f.pos).join("  "), 15, "black")
    const fs = formStats(formData(d))
    atext(w, fs.avg == null ? "" : "Average P" + fs.avg, 12, "medium")
    return w
  }
  if (v === "rivals" && me) {
    const rv = rivalsOf(d)
    atext(w, "NABS · RIVALS", 11, "bold")
    if (rv.ahead) atext(w, "+" + Math.abs(rv.ahead.diff) + " to P" + rv.ahead.pos + " " + up(rv.ahead.driver), 13, "bold")
    if (rv.behind) atext(w, "−" + Math.abs(rv.behind.diff) + " on P" + rv.behind.pos + " " + up(rv.behind.driver), 13, "bold")
    return w
  }
  if (v === "signup" && r && seatsOf(r)) {
    const sx = seatsOf(r)
    atext(w, "NABS · SIGN-UP R" + r.round, 11, "bold")
    atext(w, sx.cap ? (sx.full ? "Grid full" : sx.free + " seats free") : sx.taken + " signed up", 15, "black")
    if (sx.cap) atext(w, sx.taken + "/" + sx.cap + " taken", 12, "medium")
    return w
  }
  if (v === "result" && lr && lr.results.length) {
    atext(w, "NABS · R" + lr.round + " " + up(lr.track), 11, "bold")
    atext(w, "1  " + lr.results[0].driver, 15, "black")
    const mine = myResult(d)
    atext(w, mine ? "You P" + mine.pos : (lr.results[1] ? "2  " + lr.results[1].driver : ""), 12, "medium")
    return w
  }
  atext(w, "NABS · NEXT RACE", 11, "bold")
  if (r) {
    atext(w, "R" + r.round + " " + r.track, 15, "black")
    const ms = new Date(r.date).getTime() - Date.now()
    if (ms > 0 && ms < 864e5) {
      const t = w.addDate(new Date(r.date))
      t.applyTimerStyle()
      t.font = Font.mediumSystemFont(12)
    } else {
      atext(w, ms <= 0 ? "Lights out" : countdownText(ms).toLowerCase(), 12, "medium")
    }
  } else {
    atext(w, "Season finished", 14, "black")
  }
  return w
}

function ctext(w, s, size, weight) {
  const t = w.addText(s)
  t.font = fontFor(weight, size)
  t.centerAlignText()
  t.lineLimit = 1
  t.minimumScaleFactor = 0.5
}

function atext(w, s, size, weight) {
  const t = w.addText(s)
  t.font = fontFor(weight, size)
  t.lineLimit = 1
  t.minimumScaleFactor = 0.6
}

// Track outlines

// Track outlines: f1-circuits dataset by Tomislav Bacinger (MIT licence)
const TRACKS = {"au-1953":"44.7,49.8 36.7,41.7 37.3,38.8 37.0,36.7 29.0,27.9 24.7,20.7 25.3,19.9 29.4,18.8 29.4,11.4 30.0,10.7 34.7,7.4 42.3,4.0 45.4,5.9 50.2,6.9 52.4,9.0 53.3,11.1 54.3,18.4 52.0,22.6 50.8,29.7 51.2,33.7 52.4,36.5 58.3,42.6 64.3,43.6 70.1,48.5 72.3,51.9 75.3,62.7 67.3,66.0 65.5,65.1 61.8,58.8 58.5,61.7 56.5,61.7","bh-2002":"30.4,33.4 31.6,4.1 32.5,4.1 35.9,7.0 42.6,5.6 69.4,10.8 70.8,11.6 70.5,13.5 61.9,21.3 59.8,25.4 58.6,26.1 54.7,25.7 52.4,26.2 45.6,34.5 44.2,35.2 43.5,32.7 45.9,17.8 45.1,15.3 42.0,13.2 40.9,20.2 40.2,32.5 39.6,48.3 40.2,50.3 43.1,50.8 47.1,49.1 49.0,46.7 51.0,41.9 52.6,40.3 55.3,39.2 58.1,39.5 63.9,42.3 65.5,43.6 66.3,45.8 64.2,47.9 32.5,65.7 30.6,65.6 29.1,61.5","cn-2004":"33.4,59.5 25.9,60.9 22.0,58.4 21.3,54.9 22.7,52.2 25.2,51.7 26.5,52.4 26.1,56.4 27.9,57.9 29.4,57.3 30.1,56.1 30.5,52.5 19.4,39.2 14.6,25.6 16.5,25.1 18.4,26.5 21.6,30.3 26.8,39.3 28.6,41.2 30.8,42.2 33.3,42.4 36.8,41.0 38.8,39.1 41.8,33.0 44.5,31.4 46.6,31.4 48.3,32.2 52.3,38.5 54.3,38.4 56.7,35.2 56.8,33.4 43.3,10.8 42.2,10.8 39.2,13.3 37.8,12.5 36.3,10.1 36.4,7.2 37.4,5.4 39.2,4.3 42.3,4.1 45.5,5.3 47.9,8.1 85.1,64.3 85.3,65.6 84.2,65.9 81.1,64.0 71.2,50.8","es-1991":"64.6,31.7 44.5,63.2 43.0,63.4 39.0,61.9 33.9,65.2 31.4,66.0 28.7,65.6 26.6,64.2 24.9,60.9 25.3,55.6 33.7,41.6 35.2,41.0 37.0,41.6 38.7,43.7 38.9,45.7 37.7,49.4 32.9,56.8 32.9,58.3 33.7,59.2 35.2,59.4 43.6,55.4 46.3,52.8 49.4,47.7 49.1,45.8 45.5,42.6 41.7,33.5 41.6,31.2 42.4,29.3 43.8,28.1 67.8,15.5 67.6,13.5 64.4,12.1 62.3,12.3 58.0,15.0 56.3,15.0 54.4,12.9 54.4,10.9 55.4,9.7 61.3,4.8 64.3,4.0 73.2,9.2 74.9,11.2 75.2,14.6","mc-1929":"57.2,16.1 57.9,13.6 64.9,4.2 66.7,4.6 67.1,7.0 69.5,10.5 70.3,9.6 68.2,7.1 68.2,5.6 71.9,4.2 73.2,4.4 73.2,9.3 71.9,16.5 69.9,20.7 66.2,24.9 57.8,29.4 48.5,31.6 47.5,33.1 45.6,32.8 31.9,34.7 30.9,36.3 29.8,39.4 29.6,43.9 31.7,46.3 33.0,53.5 31.8,54.8 31.7,55.9 34.3,61.2 37.7,63.5 38.3,64.6 37.7,65.3 33.4,65.9 30.0,60.2 27.5,51.8 26.6,42.1 27.7,33.9 45.3,30.0 51.2,27.5 57.7,26.1 59.9,24.4 60.6,21.6 59.6,18.7","ca-1978":"56.8,48.9 58.4,57.0 58.1,63.4 60.1,64.8 59.1,66.0 56.4,65.4 53.5,64.0 50.1,60.9 49.9,58.2 44.9,52.4 44.5,45.7 42.0,45.4 40.7,43.6 40.1,32.2 41.7,24.8 44.4,22.9 45.9,17.2 46.6,10.6 45.8,4.1 46.7,4.3 47.0,7.5 51.7,19.2 56.3,40.9 55.4,42.3","fr-1969":"52.2,39.1 68.7,51.5 69.5,51.2 69.8,47.1 72.2,45.3 74.3,45.6 77.9,48.7 82.0,50.3 85.5,50.3 90.7,48.1 92.0,48.5 93.0,49.9 92.9,51.8 87.7,60.7 88.9,62.7 91.5,63.7 94.6,62.5 96.0,59.8 95.8,47.9 94.7,45.5 92.7,43.6 68.5,34.3 63.3,30.9 61.2,28.3 57.3,30.2 14.3,14.1 10.8,8.6 9.2,7.1 7.0,6.3 5.2,7.2 4.1,11.3 8.8,11.5 9.8,12.8 9.6,15.3 10.5,16.4 19.4,21.0 29.5,28.4 31.2,28.6 33.5,26.7 36.0,26.7","at-1969":"65.3,58.0 42.2,64.0 29.0,44.6 17.7,22.6 4.3,8.5 4.0,7.2 9.9,6.1 18.0,6.0 46.9,10.7 61.7,11.6 62.7,13.3 62.3,15.0 59.8,18.3 55.6,21.2 50.0,22.6 35.3,20.5 32.4,21.2 30.3,23.0 29.4,25.5 29.9,29.1 35.6,39.1 38.0,41.1 41.4,41.3 43.2,40.6 48.9,34.9 55.0,32.6 87.2,31.9 88.7,31.9 91.3,33.3 93.0,36.1 95.8,45.7 95.5,47.8 88.8,51.4","gb-1948":"53.5,4.6 61.5,4.1 63.0,4.8 64.2,6.6 65.9,14.0 66.4,22.7 67.9,26.0 66.6,31.6 68.6,36.4 67.7,38.0 64.0,40.5 50.9,63.9 49.5,65.4 47.3,65.9 45.4,65.0 43.2,61.0 37.2,54.0 34.7,55.1 33.6,54.5 31.4,50.1 43.2,34.8 51.5,34.8 58.6,29.8 60.5,34.0 62.1,33.7 63.2,30.6 63.1,27.6 46.0,11.9 44.1,11.1 42.5,11.6 41.5,15.9 40.4,16.6 39.0,16.5 37.9,15.3 40.6,9.0 43.7,6.1","de-1932":"11.5,48.7 4.1,34.2 4.2,33.2 9.2,23.6 26.0,6.2 27.1,6.3 28.3,7.8 29.0,12.9 30.9,15.1 44.0,21.9 54.3,24.5 60.8,25.0 68.5,24.1 94.6,14.8 95.9,15.3 95.5,16.4 73.5,30.7 56.1,28.8 55.3,30.1 55.4,33.2 57.9,38.6 56.7,41.7 37.3,54.8 34.7,55.1 32.4,54.1 22.5,42.7 21.2,41.8 19.1,42.1 18.0,44.7 19.8,50.2 24.7,53.5 27.9,58.5 27.2,60.4 22.3,63.8 19.9,63.7 18.3,62.4","hu-1986":"36.3,50.7 23.0,40.2 22.7,38.8 24.1,37.8 30.3,38.6 33.8,40.4 42.1,47.0 43.9,47.5 45.3,46.8 46.1,44.5 43.4,39.5 43.2,37.6 51.0,21.7 54.4,16.6 52.2,7.6 52.4,5.8 54.2,4.1 57.0,4.5 60.2,6.8 65.5,12.6 65.8,13.8 64.8,15.5 67.1,23.1 72.9,24.7 74.0,25.8 73.3,35.5 77.0,41.9 77.2,44.8 64.1,59.8 63.0,59.6 56.2,52.9 53.6,52.8 52.8,54.0 53.1,55.6 59.4,61.0 59.8,62.1 59.4,64.7 57.5,65.9 54.4,65.1","be-1925":"42.4,10.6 39.0,4.6 39.4,4.0 43.6,6.0 47.5,8.8 53.7,16.1 56.3,18.0 57.6,22.1 62.8,31.0 69.1,53.3 67.3,55.8 68.0,59.1 67.6,60.5 59.5,66.0 58.2,65.6 57.9,63.9 61.7,61.2 62.2,59.6 59.1,46.2 57.0,44.3 53.8,44.2 52.0,45.0 50.5,47.0 46.8,56.0 44.8,56.9 42.6,55.9 40.9,56.1 36.6,62.1 34.9,62.2 31.0,58.6 31.0,56.9 33.2,52.3 37.4,48.3 45.2,43.7 48.8,36.7 48.8,34.6 46.4,28.2 45.7,24.2 45.5,19.8 47.3,19.1","it-1922":"33.2,43.4 34.7,26.0 36.0,25.3 35.2,21.5 35.4,16.5 37.4,12.1 39.4,10.4 43.0,8.8 55.7,7.8 56.4,6.6 64.5,4.1 66.6,4.5 67.3,5.9 67.8,13.4 57.7,19.2 43.6,31.7 43.5,34.3 41.6,37.1 38.2,65.2 36.5,66.0 34.7,65.5 33.2,64.0 32.3,61.7 32.1,54.2","sg-2008":"94.0,27.9 96.0,43.7 92.2,49.6 74.7,48.0 73.4,47.0 72.7,43.5 41.5,41.3 30.1,32.1 28.6,32.1 27.6,32.9 26.4,36.5 21.0,63.7 20.2,64.7 19.0,64.8 16.6,61.4 10.4,55.7 9.8,53.8 10.2,51.0 7.1,49.6 4.2,46.9 4.0,44.8 16.1,23.1 18.7,21.7 21.3,23.4 27.2,29.6 28.2,29.7 35.2,18.1 56.0,29.5 81.3,31.2 83.4,30.5 85.0,28.7 85.0,25.0 81.2,12.5 81.5,7.4 82.9,5.3 84.2,5.4 87.8,8.4 90.6,8.6 91.8,9.5","ru-2014":"87.6,22.6 82.2,30.9 77.5,34.4 46.6,42.8 45.6,42.5 44.7,40.2 37.9,34.0 33.1,32.9 30.5,33.4 26.6,36.2 24.7,39.6 24.4,41.7 25.1,45.9 28.2,52.4 28.0,53.7 10.8,64.0 9.5,64.2 8.6,63.4 4.1,52.7 5.2,44.8 6.3,44.0 19.7,42.0 20.6,41.2 21.5,36.8 17.3,24.5 18.2,22.9 26.2,20.4 33.3,20.5 42.1,22.2 59.6,29.1 64.4,29.2 70.7,28.0 72.5,32.6 75.7,32.5 78.5,30.6 82.0,25.5 82.1,24.8 79.4,22.7 78.9,21.4 88.9,5.8 96.0,9.3","jp-1962":"82.6,36.7 95.5,52.5 96.0,55.0 95.1,58.0 93.8,59.4 92.2,59.5 90.7,58.7 85.2,50.9 79.9,49.7 77.2,43.3 75.6,42.3 71.2,41.9 69.7,41.0 68.6,37.7 70.1,32.4 69.3,30.4 67.3,29.2 63.0,27.7 59.8,27.9 55.6,30.4 50.0,37.0 42.6,37.7 40.9,32.6 39.4,23.8 39.6,21.7 41.3,17.5 40.7,16.6 39.5,16.8 35.7,22.9 33.5,24.9 31.5,25.8 26.5,26.1 20.1,23.9 17.0,21.6 14.6,18.3 11.2,11.0 9.5,10.4 6.4,10.8 4.2,12.6 4.1,14.3 5.1,16.3 14.2,23.2 20.3,26.0 43.0,33.9 45.7,33.6 50.0,31.4 59.5,23.3 61.7,24.7 65.2,22.5 68.8,22.7 73.4,25.6","us-2012":"22.5,51.7 30.8,58.3 36.0,61.3 36.5,60.4 33.8,52.0 34.2,49.1 35.6,47.0 44.0,41.7 46.8,36.8 50.4,34.9 51.8,30.3 53.5,28.2 57.4,26.8 63.9,29.4 70.1,24.4 72.1,24.9 74.0,27.0 83.5,24.9 95.3,10.9 95.9,9.1 94.9,8.7 78.9,13.5 63.4,16.9 37.3,20.3 37.0,21.0 41.4,26.8 42.9,29.9 42.0,30.6 38.7,30.5 34.7,24.9 31.8,24.8 31.6,25.7 36.3,33.9 36.3,35.3 34.9,39.0 30.9,41.0 27.9,40.9 24.5,39.3 18.5,31.2 17.3,30.6 4.9,35.6 4.0,36.8 4.6,37.6","mx-1962":"22.7,5.2 70.8,11.5 90.7,14.9 90.4,19.9 92.9,21.8 92.1,26.8 83.1,43.1 73.9,57.7 73.9,58.7 77.0,60.9 76.9,61.7 71.6,65.7 69.4,65.3 71.5,46.4 66.3,42.1 63.9,37.9 62.2,37.0 53.3,35.5 50.4,29.8 41.5,25.2 18.8,21.5 17.2,11.0 16.3,10.9 14.1,13.0 7.3,11.3 7.3,9.6 8.4,7.2 11.8,4.4 14.2,4.0","br-1940":"34.2,48.5 38.1,63.3 39.7,65.7 41.6,65.9 44.5,63.2 45.6,63.0 50.4,65.1 54.3,64.9 57.6,63.0 59.6,60.2 69.5,23.6 69.0,21.2 61.8,19.4 57.5,20.8 44.2,38.2 42.3,39.4 39.1,39.4 36.1,37.7 34.1,30.5 34.0,28.6 34.9,27.3 36.2,27.2 39.8,29.1 41.7,28.2 42.3,26.9 41.4,24.3 37.4,19.9 36.3,15.1 36.9,13.6 38.5,13.6 43.8,19.1 46.3,19.8 49.0,19.3 51.4,17.4 57.0,8.4 56.8,6.8 55.4,5.9 49.8,4.0 44.3,5.0 38.4,7.6 35.0,11.1 32.8,18.6 30.4,30.7","ae-2009":"49.6,38.7 58.3,37.6 59.3,36.1 57.3,28.6 52.4,26.3 50.8,24.0 51.9,15.5 50.6,5.1 49.2,4.0 48.1,5.0 35.5,44.6 37.7,44.7 40.8,52.0 51.5,60.9 61.7,66.0 63.6,65.5 64.6,63.6 64.2,61.9 63.0,60.7 54.4,59.7 50.1,57.0 49.2,52.4 53.1,51.3 53.0,47.2 51.0,46.9 44.2,47.8 42.0,47.0 39.4,42.4 39.5,40.3","it-1953":"62.4,16.8 44.8,14.2 34.2,15.1 28.3,16.8 27.3,19.7 21.1,23.4 13.3,42.6 13.8,47.8 4.4,56.0 4.5,58.2 6.2,58.8 22.6,56.7 34.0,58.1 36.3,55.6 37.8,51.1 35.9,38.9 38.5,34.5 42.5,35.3 63.8,35.2 65.2,36.6 73.7,33.1 78.4,30.1 87.2,21.6 95.9,17.1 95.9,15.8 93.5,11.4 91.8,11.4 76.4,16.8","de-1927":"66.0,13.8 52.4,27.6 47.8,30.9 46.9,30.8 46.9,29.8 48.9,25.0 47.8,22.8 43.6,22.8 40.2,24.3 40.7,26.4 43.3,26.6 44.1,27.7 42.8,36.6 40.2,45.3 41.3,47.3 45.1,49.3 45.3,51.3 37.5,56.1 33.5,60.1 30.2,65.3 28.1,65.8 27.3,65.0 27.4,63.5 36.2,54.1 35.8,48.3 40.6,32.7 40.0,31.3 34.1,28.4 33.5,26.5 34.0,25.4 44.2,13.4 61.4,8.7 61.5,6.9 64.3,5.5 71.3,4.0 72.8,5.8 72.6,7.1","pt-2008":"37.7,30.0 32.1,8.8 39.0,4.0 46.7,6.0 46.4,7.6 42.0,10.4 41.2,13.4 49.5,40.9 50.8,40.1 51.8,30.0 51.3,27.0 47.0,18.7 46.9,17.1 50.7,12.0 53.0,12.3 56.4,30.7 58.3,32.4 66.0,36.4 67.4,38.0 68.2,40.6 67.3,42.0 58.6,44.8 56.4,47.4 55.2,55.3 56.1,56.9 57.8,56.6 63.7,50.1 65.4,50.1 66.3,50.9 67.3,53.5 65.8,57.1 60.6,63.4 58.5,65.0 55.3,66.0 51.5,65.5 49.3,64.3 46.7,61.3","it-1914":"49.8,34.0 58.4,17.9 63.4,5.7 64.8,4.2 66.6,4.1 68.2,5.9 67.3,14.0 71.1,16.9 71.8,19.5 62.7,33.9 62.6,35.7 63.9,38.9 63.4,40.9 54.3,51.9 53.0,52.6 47.7,52.6 45.5,53.9 41.7,63.2 40.0,65.2 36.6,66.0 29.8,62.9 28.3,60.8 28.1,59.1 30.7,45.3 32.1,44.0 36.3,43.8 37.9,42.5 43.0,26.1 44.8,25.0 46.3,25.2 47.7,26.4 48.0,28.8 43.7,35.2 42.9,40.8 31.8,55.6 31.2,58.5 31.9,60.0 33.6,61.1 35.4,61.1 38.2,59.2","my-1999":"34.3,37.5 14.8,39.1 13.1,38.7 12.2,36.4 13.2,34.7 14.3,34.4 17.7,35.4 19.3,33.9 15.8,27.6 15.6,24.7 16.6,19.1 18.5,16.1 21.4,13.8 32.0,10.3 47.1,4.0 48.4,4.4 51.8,20.1 53.4,23.0 56.4,25.0 61.0,25.2 63.9,23.7 67.4,20.4 72.3,20.0 74.6,21.4 87.8,37.1 84.6,43.4 60.6,45.6 53.8,47.1 54.1,48.8 59.5,52.2 60.5,55.1 59.8,60.8 57.1,65.3 55.5,66.0 53.8,65.3 39.0,53.6 36.4,53.9 30.1,56.9 27.1,57.1 22.7,55.9 20.0,53.0 19.4,50.5 20.0,49.5 76.0,38.8 77.4,36.8 77.1,35.7 76.1,34.7 74.5,34.4","tr-2005":"39.6,62.1 51.3,59.3 51.7,58.5 50.5,52.3 51.8,48.9 53.4,47.3 61.0,43.8 73.8,42.5 75.5,39.3 75.2,34.9 75.7,34.5 80.8,34.8 82.4,33.9 82.0,30.1 80.9,28.8 63.1,19.8 61.6,18.1 62.3,16.1 65.1,14.9 79.5,17.8 83.7,15.6 85.3,10.8 83.6,7.7 80.5,4.5 76.7,4.2 52.9,11.6 52.5,13.0 53.9,16.7 46.7,38.9 45.8,40.1 14.8,57.7 15.4,59.9 18.0,60.0 18.8,60.7 18.2,64.9 18.7,66.0","nl-1948":"22.5,32.3 33.8,5.4 36.5,4.0 38.9,5.6 39.3,7.6 35.0,18.9 34.6,26.0 32.7,27.8 26.5,30.6 26.2,32.6 27.4,34.3 29.7,34.7 36.6,32.5 42.6,31.8 54.2,33.7 58.1,32.7 65.7,28.5 71.8,27.8 79.6,28.2 83.1,29.5 85.9,32.9 86.4,35.8 85.8,38.8 79.9,47.6 76.9,54.1 73.7,54.8 69.9,54.4 65.6,52.6 63.4,51.0 61.7,48.6 62.8,46.4 64.0,45.6 71.8,43.7 76.0,41.6 76.7,39.0 76.2,37.6 73.8,36.0 62.2,35.3 56.0,36.1 43.9,39.7 36.6,43.3 33.5,40.2 30.9,40.7 29.9,42.6 33.1,61.0 32.8,63.3 30.6,65.6 22.8,65.9 19.6,65.2 16.4,63.1 14.4,60.2 13.6,56.7 14.3,52.2","fr-1960":"45.7,32.9 55.0,25.3 55.7,24.1 56.1,15.2 54.5,10.8 54.7,8.7 56.1,6.1 59.3,4.2 63.5,4.5 66.2,7.3 68.3,11.6 70.0,17.8 71.0,34.8 70.3,40.2 64.5,60.9 63.3,60.2 62.4,54.4 63.8,45.4 63.4,29.3 65.6,26.3 66.2,21.3 64.0,13.6 61.9,12.3 60.6,12.6 59.5,13.9 61.4,18.2 61.7,21.2 59.6,29.6 59.8,49.0 56.8,53.0 57.0,58.3 58.8,65.6 56.5,65.8 53.7,64.2 44.5,54.0 40.7,50.8 29.1,46.4 30.0,44.0 32.1,41.6 32.8,41.1 34.3,41.9","pt-1972":"53.5,43.9 43.4,65.8 41.5,65.4 39.5,62.2 32.4,56.0 33.7,49.4 35.6,44.1 36.8,43.2 38.6,43.7 39.3,45.5 37.9,54.8 39.8,56.0 41.5,55.4 45.2,40.2 62.2,18.3 61.0,15.8 58.1,15.3 56.4,15.9 43.7,31.3 41.7,31.8 39.8,30.6 39.2,28.8 37.9,15.4 40.1,13.1 47.3,10.7 53.5,11.8 54.9,10.5 57.0,5.9 59.4,4.3 62.6,4.2 66.6,7.0 67.7,9.8 67.6,12.6","br-1977":"44.4,13.1 67.3,13.6 69.4,14.6 72.4,18.5 73.0,20.8 72.5,25.6 69.5,29.1 66.3,30.0 55.2,29.7 53.2,30.5 51.3,32.8 50.8,47.8 53.2,51.6 56.7,52.9 60.0,52.9 62.3,51.7 75.0,42.8 81.4,36.3 81.5,20.7 82.2,19.2 86.5,18.0 93.3,20.0 94.8,18.7 96.0,16.4 95.9,14.1 92.9,10.7 76.7,7.0 36.5,6.2 11.2,7.0 6.8,9.1 5.4,11.0 4.0,15.1 4.5,20.8 5.4,22.5 10.0,27.0 18.9,29.4 20.8,31.9 18.4,48.9 19.4,53.2 21.1,55.1 32.9,63.7 35.9,63.4 37.3,62.5 39.0,59.4 39.5,31.0 38.9,29.6 36.5,27.9 13.1,22.3 11.8,21.1 10.7,18.0 12.0,14.8 15.4,13.0","sa-2021":"53.2,51.7 50.0,42.5 48.4,42.0 49.1,38.9 48.1,32.5 46.1,30.3 47.0,26.4 45.2,23.4 45.3,20.8 47.6,19.0 48.6,14.4 48.3,5.0 47.1,4.0 46.0,4.5 45.6,5.7 47.2,9.7 47.3,12.4 45.8,17.3 43.6,18.9 43.4,21.3 45.2,27.0 45.4,31.2 47.9,36.8 47.6,42.3 49.3,44.5 49.7,46.3 47.5,51.3 47.3,54.6 48.3,58.4 50.4,61.9 56.1,65.9 56.6,65.0","us-2022":"49.4,26.9 62.2,35.3 61.7,36.6 58.2,39.5 57.9,44.9 57.3,46.3 54.9,48.2 50.3,49.6 45.6,49.3 29.1,39.7 26.1,39.6 19.7,42.6 16.8,41.8 14.1,39.2 11.2,38.2 7.8,39.1 5.4,40.7 4.0,43.8 4.3,46.1 5.8,47.2 10.3,46.9 20.1,48.9 36.7,48.3 49.4,52.6 57.1,53.3 61.2,52.6 78.3,46.3 86.8,42.0 90.7,39.1 87.4,36.1 86.7,33.7 87.8,31.5 93.0,31.1 94.5,29.8 96.0,27.1 94.5,25.8 95.7,21.1 95.1,20.0 16.1,16.7 15.2,17.0 15.3,18.7 20.2,22.2 23.2,22.5 31.2,19.4 36.7,19.5","qa-2004":"33.0,41.5 23.9,25.0 23.9,23.3 24.7,22.0 26.4,21.4 33.7,25.5 36.1,25.5 37.3,24.0 37.2,17.5 37.9,15.5 47.6,4.7 49.6,4.0 53.7,7.2 54.2,9.2 47.6,17.0 47.7,18.8 49.2,19.0 60.2,14.6 62.5,15.0 63.5,16.9 62.8,18.8 59.4,23.0 57.5,28.1 50.5,30.2 49.5,30.8 49.3,32.8 52.8,36.1 58.2,38.2 71.7,37.3 74.0,39.2 76.3,44.4 72.5,51.0 71.5,51.6 59.8,49.7 57.7,50.4 50.2,64.8 48.0,66.0 45.9,65.0","es-2026":"55.1,62.6 48.8,63.7 48.1,65.6 45.9,66.0 43.5,65.4 33.8,49.8 32.9,43.2 34.6,37.9 33.9,37.4 34.4,36.3 33.9,33.9 30.8,26.5 32.2,24.2 30.9,21.6 30.8,17.4 30.9,16.0 33.6,13.0 32.1,7.4 32.6,5.5 34.3,4.2 36.6,4.1 39.5,6.8 39.2,10.5 32.8,19.8 37.6,24.5 37.9,29.7 38.9,31.5 41.4,33.0 46.0,33.0 48.0,32.1 51.9,38.3 58.7,39.0 60.0,40.7 61.9,50.7 67.2,50.0 69.2,58.6 68.7,60.2","az-2016":"85.6,19.9 91.8,17.2 92.4,16.2 87.2,4.3 86.5,4.0 54.8,17.6 54.3,18.9 57.1,26.8 45.3,33.4 45.8,35.9 33.6,45.7 32.5,45.1 30.3,38.6 26.2,37.4 24.9,35.0 20.8,36.2 10.7,41.8 7.6,50.8 8.4,59.9 16.5,64.5 21.3,65.9 25.6,59.0 32.8,52.3 34.4,46.1 44.4,38.2","us-2023":"65.5,59.0 67.9,56.2 67.3,54.9 64.9,54.8 62.1,56.9 60.6,57.1 58.6,56.1 57.5,54.1 57.3,26.9 57.8,26.3 65.1,26.4 67.3,24.9 68.6,21.3 66.8,19.3 68.0,15.9 54.0,14.6 51.7,12.9 48.1,6.0 42.1,4.1 34.7,18.3 32.7,25.9 32.0,33.1 31.4,63.7 35.8,65.9 55.1,65.9 60.5,64.6","us-1909":"35.8,42.2 35.6,14.3 39.5,13.5 40.8,7.1 42.4,5.5 46.1,4.0 48.1,6.1 48.0,12.2 42.2,16.9 41.4,19.2 43.4,21.1 45.3,20.9 47.8,19.5 49.7,21.0 50.2,44.6 52.2,46.5 56.3,46.8 58.5,49.7 63.6,50.0 64.5,52.8 63.6,59.6 61.1,63.6 57.6,65.3 46.1,66.0 40.9,64.2 37.9,61.3 36.4,58.3","ar-1952":"45.4,28.3 58.1,9.3 61.7,4.7 62.9,4.0 64.7,4.2 67.3,7.2 67.2,18.5 54.9,32.0 54.6,35.2 56.6,36.9 58.8,37.0 73.1,29.5 74.9,25.4 72.9,17.8 74.3,9.0 76.0,7.2 78.2,6.4 82.5,7.3 84.2,8.8 85.0,12.6 81.1,48.6 78.8,53.4 75.0,56.9 71.9,58.4 55.8,60.7 53.3,59.8 52.7,58.5 53.8,55.8 60.8,54.6 64.3,51.9 69.8,51.4 72.2,49.3 72.8,47.9 72.8,39.8 71.1,38.1 68.5,37.8 45.0,50.3 44.2,52.4 47.6,56.1 42.8,62.1 16.0,65.9 14.9,63.2 15.4,61.8 18.4,59.6 21.6,60.6 22.8,60.2 25.5,57.8","za-1961":"64.3,48.1 74.7,36.5 93.7,24.0 96.0,21.5 94.6,19.6 87.5,17.9 84.5,12.9 78.8,9.4 77.3,10.0 59.2,34.6 55.8,36.1 50.9,35.5 48.5,33.6 41.7,24.0 39.9,23.2 37.9,23.6 28.6,36.4 28.6,39.2 30.2,43.7 29.8,45.8 28.0,48.3 17.9,52.8 12.1,53.4 5.1,55.5 4.4,56.1 4.0,57.9 7.2,60.2 10.0,60.5 29.3,51.6 32.1,48.6 33.0,46.6 34.9,36.0 36.9,31.6 37.9,31.0 40.3,32.0 43.1,37.1 49.7,42.8 51.9,59.4 53.7,59.5 54.8,58.5","us-1956":"38.1,16.7 39.1,4.5 41.0,4.0 49.2,5.6 51.2,6.6 52.7,8.6 54.3,15.1 60.2,21.5 61.7,26.1 62.5,56.4 60.4,58.7 56.9,58.8 49.5,50.5 48.2,50.0 46.4,50.4 45.1,53.0 45.7,64.0 44.9,65.5 43.7,66.0 42.4,65.7 41.1,64.0 39.5,43.8 40.5,43.0 41.8,43.0 49.9,46.4 51.5,45.3 51.9,43.9 49.5,33.8 48.7,32.7 46.9,31.9 39.2,31.4 37.4,29.5"}
const TRACK_ALIASES = {"a1ring":"at-1969","abudhabi":"ae-2009","albertpark":"au-1953","albertparkcircuit":"au-1953","austin":"us-2012","austria":"at-1969","autodromodoestoril":"pt-1972","autodromoenzoedinoferrari":"it-1953","autodromohermanosrodriguez":"mx-1962","autodromointernacionaldoalgarve":"pt-2008","autodromointernacionalnelsonpiquet":"br-1977","autodromointernazionaledelmugello":"it-1914","autodromojosecarlospaceinterlagos":"br-1940","autodromonazionalemonza":"it-1922","autodromooscaryjuangalvez":"ar-1952","bahrain":"bh-2002","bahraininternationalcircuit":"bh-2002","baku":"az-2016","bakucitycircuit":"az-2016","barcelona":"es-1991","brazil":"br-1940","budapest":"hu-1986","buenosaires":"ar-1952","catalunya":"es-1991","circuitdebarcelonacatalunya":"es-1991","circuitdemonaco":"mc-1929","circuitdeneversmagnycours":"fr-1960","circuitdespafrancorchamps":"be-1925","circuitgillesvilleneuve":"ca-1978","circuitodemadring":"es-2026","circuitoftheamericas":"us-2012","circuitpaulricard":"fr-1969","circuitzandvoort":"nl-1948","cota":"us-2012","dix":"us-1956","estoril":"pt-1972","hockenheim":"de-1932","hockenheimring":"de-1932","hungaroring":"hu-1986","imola":"it-1953","indianapolis":"us-1909","indianapolismotorspeedway":"us-1909","intercityistanbulpark":"tr-2005","interlagos":"br-1940","istanbul":"tr-2005","jacarepagua":"br-1977","jeddah":"sa-2021","jeddahcornichecircuit":"sa-2021","johannesburg":"za-1961","kyalami":"za-1961","kyalamigrandprixcircuit":"za-1961","lasvegas":"us-2023","lasvegasstreetcircuit":"us-2023","lecastellet":"fr-1969","losail":"qa-2004","losailinternationalcircuit":"qa-2004","lusail":"qa-2004","madrid":"es-2026","magnycours":"fr-1960","marinabay":"sg-2008","marinabaystreetcircuit":"sg-2008","melbourne":"au-1953","mexico":"mx-1962","mexicocity":"mx-1962","miami":"us-2022","miamiinternationalautodrome":"us-2022","monaco":"mc-1929","montreal":"ca-1978","monza":"it-1922","mugello":"it-1914","nurburg":"de-1927","nurburgring":"de-1927","paulricard":"fr-1969","portimao":"pt-2008","qatar":"qa-2004","redbullring":"at-1969","sakhir":"bh-2002","saopaulo":"br-1940","scarperiaesanpiero":"it-1914","sepang":"my-1999","sepanginternationalcircuit":"my-1999","shanghai":"cn-2004","shanghaiinternationalcircuit":"cn-2004","silverstone":"gb-1948","silverstonecircuit":"gb-1948","singapore":"sg-2008","sochi":"ru-2014","sochiautodrom":"ru-2014","spa":"be-1925","spafrancorchamps":"be-1925","spielberg":"at-1969","suzuka":"jp-1962","suzukainternationalracingcourse":"jp-1962","watkinsglen":"us-1956","watkinsgleninternational":"us-1956","yasmarina":"ae-2009","yasmarinacircuit":"ae-2009","zandvoort":"nl-1948"}

function trackKey(s) {
  return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function trackPoints(name, outline) {
  if (Array.isArray(outline) && outline.length > 2) return outline
  if (typeof outline === "string" && outline.trim()) return outline.trim().split(/\s+/).map(q => q.split(",").map(Number))
  const k = trackKey(name)
  if (!k) return null
  let id = TRACK_ALIASES[k]
  if (!id) {
    let best = ""
    for (const a in TRACK_ALIASES) if (a.length > best.length && a.length >= 3 && k.indexOf(a) >= 0) best = a
    if (best) id = TRACK_ALIASES[best]
  }
  if (!id || !TRACKS[id]) return null
  return TRACKS[id].split(" ").map(q => q.split(",").map(Number))
}

// Draws the track rotated so its long side is horizontal, fitted into w × h points.
function trackImage(name, outline, w, h) {
  let pts = trackPoints(name, outline)
  if (!pts || pts.length < 3) return null
  w = w || 96
  h = h || 67
  const n = pts.length
  let mx = 0, my = 0
  pts.forEach(q => { mx += q[0]; my += q[1] })
  mx /= n; my /= n
  let sxx = 0, syy = 0, sxy = 0
  pts.forEach(q => { const dx = q[0] - mx, dy = q[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy })
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ca = Math.cos(-ang), sa = Math.sin(-ang)
  pts = pts.map(q => { const dx = q[0] - mx, dy = q[1] - my; return [dx * ca - dy * sa, dx * sa + dy * ca] })
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1])
  const minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs)
  const miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys)
  const S = 3, pad = 5
  const W2 = Math.round(w * S), H2 = Math.round(h * S)
  const sc = Math.min((W2 - 2 * pad * S) / (maxx - minx || 1), (H2 - 2 * pad * S) / (maxy - miny || 1))
  const ox = (W2 - (maxx - minx) * sc) / 2, oy = (H2 - (maxy - miny) * sc) / 2
  const P2 = pts.map(q => [(q[0] - minx) * sc + ox, (q[1] - miny) * sc + oy])
  const dc = new DrawContext()
  dc.size = new Size(W2, H2)
  dc.opaque = false
  dc.respectScreenScale = false
  const path = new Path()
  path.move(new Point(P2[0][0], P2[0][1]))
  for (let i = 1; i < P2.length; i++) path.addLine(new Point(P2[i][0], P2[i][1]))
  path.closeSubpath()
  dc.addPath(path)
  dc.setStrokeColor(new Color("#3A3A40"))
  dc.setLineWidth(11)
  dc.strokePath()
  dc.addPath(path)
  dc.setStrokeColor(ACC)
  dc.setLineWidth(5)
  dc.strokePath()
  dc.setFillColor(Color.white())
  dc.fillEllipse(new Rect(P2[0][0] - 8, P2[0][1] - 8, 16, 16))
  return dc.getImage()
}

// Building blocks

function W() {
  const w = new ListWidget()
  w.backgroundColor = C.bg
  w.setPadding(13, 14, 13, 14)
  w.url = BASE_URL
  return w
}

function heroWidget() {
  const w = W()
  w.backgroundImage = stripes(C.bg, new Color(ACC_HEX, 0.14))
  return w
}

function stripedWidget() {
  const w = W()
  w.backgroundImage = stripes(C.bg)
  return w
}

function stripes(base, lineColor) {
  const dc = new DrawContext()
  dc.size = new Size(420, 420)
  dc.opaque = true
  dc.respectScreenScale = false
  dc.setFillColor(base)
  dc.fillRect(new Rect(0, 0, 420, 420))
  dc.setStrokeColor(lineColor || new Color("#FFFFFF", 0.05))
  dc.setLineWidth(1.5)
  for (let x = -420; x < 420; x += 16) {
    const p = new Path()
    p.move(new Point(x, 0))
    p.addLine(new Point(x + 420, 420))
    dc.addPath(p)
    dc.strokePath()
  }
  return dc.getImage()
}

function message(title, text) {
  const w = W()
  kicker(w, "NABS Racing")
  w.addSpacer()
  line(w, title, 16, { f: "heavy" })
  line(w, text, 12, { f: "medium", c: C.mute, lines: 3 })
  w.addSpacer()
  return w
}

function noDriver() {
  const name = P.arg || MY_DRIVER
  return message("Driver not found", name ? "\"" + name + "\" isn't in the data yet." : "Run \"NABS Setup\" and enter your driver name.")
}

function errorWidget(fam) {
  const w = W()
  if (String(fam).startsWith("accessory")) {
    w.addText("NABS · no data")
    return w
  }
  kicker(w, "NABS Racing")
  w.addSpacer(4)
  line(w, "No data available", 13, { f: "medium", c: C.mute })
  if (LAST_ERROR) {
    w.addSpacer(4)
    line(w, LAST_ERROR, 10, { f: "regular", c: C.dim, lines: 3 })
  }
  return w
}

function H(p, spacing) {
  const s = p.addStack()
  s.layoutHorizontally()
  s.centerAlignContent()
  if (spacing) s.spacing = spacing
  return s
}

function V(p, spacing) {
  const s = p.addStack()
  s.layoutVertically()
  if (spacing) s.spacing = spacing
  return s
}

function fontFor(w, size) {
  switch (w) {
    case "black": return Font.blackSystemFont(size)
    case "heavy": return Font.heavySystemFont(size)
    case "bold": return Font.boldSystemFont(size)
    case "semibold": return Font.semiboldSystemFont(size)
    case "medium": return Font.mediumSystemFont(size)
    case "mono": return Font.mediumMonospacedSystemFont(size)
    case "monob": return Font.boldMonospacedSystemFont(size)
    default: return Font.systemFont(size)
  }
}

function T(p, str, size, o) {
  o = o || {}
  const t = p.addText(String(str == null ? "" : str))
  t.font = fontFor(o.f, size)
  t.textColor = o.c || C.text
  t.lineLimit = o.lines || 1
  t.minimumScaleFactor = o.min || 0.6
  return t
}

function line(p, str, size, o) {
  const h = H(p, 0)
  const t = T(h, str, size, o)
  h.addSpacer()
  return t
}

function centerLine(p, str, size, o) {
  const h = H(p, 0)
  h.addSpacer()
  const t = T(h, str, size, o)
  t.centerAlignText()
  h.addSpacer()
  return t
}

function rightLine(p, str, size, o) {
  const h = H(p, 0)
  h.addSpacer()
  const t = T(h, str, size, o)
  t.rightAlignText()
  return t
}

function kicker(p, s, color) { return T(p, up(s), 10, { f: "monob", c: color || ACC }) }
function sub(p, s, color) { return T(p, up(s), 10, { f: "mono", c: color || C.mute }) }

function bar(p, color, w, h) {
  const b = p.addStack()
  b.size = new Size(w, h)
  b.backgroundColor = color
  b.cornerRadius = Math.min(w, h) / 2
  return b
}

function dot(p, color, size) { return bar(p, color, size, size) }

function tile(p, n, bg, size, fg) {
  const t = p.addStack()
  t.size = new Size(size, size)
  t.backgroundColor = bg
  t.cornerRadius = 6
  // No spacers around the number: on iOS each one keeps about 8 pt, which left the
  // digit almost no room in these small boxes. The fixed size centres it anyway.
  t.centerAlignContent()
  T(t, n, Math.round(size * 0.5), { f: "black", c: fg || C.ink })
  return t
}

function numBox(p, n, size, color) {
  const t = p.addStack()
  t.size = new Size(size, size)
  t.centerAlignContent()
  T(t, n, Math.round(size * 0.58), { f: "heavy", c: color || C.mute })
  return t
}

function badge(p, s, bg, fg) {
  const b = p.addStack()
  b.backgroundColor = bg
  b.cornerRadius = 8
  b.setPadding(2, 6, 2, 6)
  T(b, s, 10, { f: "monob", c: fg })
  return b
}

function statBox(p, label, value, w, h) {
  const s = p.addStack()
  s.layoutVertically()
  s.size = new Size(w || 78, h || 52)
  s.backgroundColor = C.card2
  s.cornerRadius = 10
  s.centerAlignContent()
  const a = H(s, 0); a.addSpacer(); T(a, label, 9, { f: "monob", c: C.cardText }); a.addSpacer()
  const b = H(s, 0); b.addSpacer(); T(b, value == null ? "–" : value, 24, { f: "black" }); b.addSpacer()
  return s
}

function infoRow(p, label, value) {
  const h = H(p, 6)
  T(h, up(label), 10, { f: "mono", c: C.mute })
  h.addSpacer()
  T(h, value, 13, { f: "heavy" })
}

function divider(p) {
  const s = p.addStack()
  s.size = new Size(0, 1)
  s.backgroundColor = C.border
  const inner = s.addStack()
  inner.addSpacer()
  return s
}

function posColor(pos) {
  if (pos === 1) return C.gold
  if (pos === 2) return C.silver
  if (pos === 3) return C.bronze
  return null
}

function teamColor(o) {
  if (o && o.teamColor) return new Color(o.teamColor)
  const k = low(o && o.team).replace(/\s*\(sub\)/, "")
  for (const key in TEAM_COLORS) if (k.startsWith(key)) return new Color(TEAM_COLORS[key])
  return C.dim
}

function flag(cc) {
  if (!cc || String(cc).length !== 2) return ""
  const s = String(cc).toUpperCase()
  return String.fromCodePoint(0x1F1E6 + s.charCodeAt(0) - 65, 0x1F1E6 + s.charCodeAt(1) - 65)
}

function isMe(name, d) {
  const mine = (d && d.myName) || MY_DRIVER
  return !!mine && low(name) === low(mine)
}

function shortSeason(s) {
  const m = String(s).match(/season\s*(\d+)/i)
  return m ? "Season " + m[1] : String(s).split("·")[0].trim()
}

function signed(n) { return n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "±0" }
function low(s) { return String(s || "").toLowerCase().trim() }
function up(s) { return String(s == null ? "" : s).toUpperCase() }

function fmt(date, f) {
  const df = new DateFormatter()
  df.locale = "en_GB"
  df.dateFormat = f
  return df.string(date)
}
