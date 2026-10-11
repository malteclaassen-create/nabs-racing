// A browser stand-in for the Scriptable app.
// It offers the classes a widget script expects (ListWidget, WidgetStack, Color,
// Font, DrawContext, Request, FileManager, ...) and turns the finished widget
// into HTML that lays out like the iPhone widget. It is a close copy, not a
// perfect one: fonts and SwiftUI's spacing rules differ a little, so the last
// check always happens on the phone.

const RealDate = Date
const NONE = { h: false, v: false }

// ─── Geometry ────────────────────────────────────────────────

export class Size {
  constructor(width, height) { this.width = Number(width) || 0; this.height = Number(height) || 0 }
}

export class Point {
  constructor(x, y) { this.x = Number(x) || 0; this.y = Number(y) || 0 }
}

export class Rect {
  constructor(x, y, width, height) {
    this.x = Number(x) || 0
    this.y = Number(y) || 0
    this.width = Number(width) || 0
    this.height = Number(height) || 0
  }
  get minX() { return this.x }
  get minY() { return this.y }
  get maxX() { return this.x + this.width }
  get maxY() { return this.y + this.height }
  get origin() { return new Point(this.x, this.y) }
  get size() { return new Size(this.width, this.height) }
}

// ─── Color & Font ───────────────────────────────────────────

export class Color {
  constructor(hex, alpha) {
    let h = String(hex == null ? "" : hex).trim().replace(/^#/, "")
    if (h.length === 3) h = h.split("").map(c => c + c).join("")
    let a = 1
    if (h.length === 8) { a = parseInt(h.slice(6), 16) / 255; h = h.slice(0, 6) }
    if (!/^[0-9a-f]{6}$/i.test(h)) h = "000000"
    this.hex = h.toUpperCase()
    this.red = parseInt(h.slice(0, 2), 16) / 255
    this.green = parseInt(h.slice(2, 4), 16) / 255
    this.blue = parseInt(h.slice(4, 6), 16) / 255
    this.alpha = alpha == null ? a : Number(alpha)
  }
  static black() { return new Color("000000") }
  static white() { return new Color("FFFFFF") }
  static clear() { return new Color("000000", 0) }
  static gray() { return new Color("8E8E93") }
  static darkGray() { return new Color("555555") }
  static lightGray() { return new Color("AAAAAA") }
  static red() { return new Color("FF3B30") }
  static green() { return new Color("34C759") }
  static blue() { return new Color("007AFF") }
  static yellow() { return new Color("FFCC00") }
  static orange() { return new Color("FF9500") }
  static purple() { return new Color("AF52DE") }
  static magenta() { return new Color("FF00FF") }
  static cyan() { return new Color("32ADE6") }
  static brown() { return new Color("A2845E") }
  // The preview always shows the dark appearance
  static dynamic(light, dark) { return dark }
}

export function cssColor(c, fallback) {
  if (!c) return fallback || "transparent"
  return "rgba(" + Math.round(c.red * 255) + "," + Math.round(c.green * 255) + "," + Math.round(c.blue * 255) + "," + c.alpha + ")"
}

const FAMILIES = {
  sans: '"SF Pro Display", "SF Pro Text", -apple-system, Inter, "Segoe UI", system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  rounded: '"SF Pro Rounded", -apple-system, Inter, "Segoe UI", system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  mono: '"SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace, "Apple Color Emoji", "Segoe UI Emoji"',
}
const WEIGHTS = { ultraLight: 200, thin: 100, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900 }
const TEXT_STYLES = {
  largeTitle: [34, 400], title1: [28, 400], title2: [22, 400], title3: [20, 400], headline: [17, 600],
  subheadline: [15, 400], body: [17, 400], callout: [16, 400], footnote: [13, 400], caption1: [12, 400], caption2: [11, 400],
}

export class Font {
  constructor(name, size) {
    this.name = String(name || "")
    this.size = Number(size) || 17
    this.family = /mono|menlo|courier|consol/i.test(this.name) ? "mono" : "sans"
    this.italic = /italic|oblique/i.test(this.name)
    const w = Object.keys(WEIGHTS).find(k => new RegExp(k, "i").test(this.name))
    this.weight = w ? WEIGHTS[w] : /semibold/i.test(this.name) ? 600 : 400
  }
  static _make(family, weight, size, italic) {
    const f = new Font("", size)
    f.family = family
    f.weight = weight
    f.italic = !!italic
    return f
  }
}
Font.systemFont = s => Font._make("sans", 400, s)
Font.italicSystemFont = s => Font._make("sans", 400, s, true)
for (const [k, w] of Object.entries(WEIGHTS)) {
  if (k !== "regular") Font[k + "SystemFont"] = s => Font._make("sans", w, s)
  Font[k + "MonospacedSystemFont"] = s => Font._make("mono", w, s)
  Font[k + "RoundedSystemFont"] = s => Font._make("rounded", w, s)
}
for (const [k, [size, w]] of Object.entries(TEXT_STYLES)) Font[k] = () => Font._make("sans", w, size)

export function cssFont(font, scale) {
  const f = font || Font.body()
  return (f.italic ? "italic " : "") + f.weight + " " + (f.size * (scale || 1)) + "px " + FAMILIES[f.family]
}

export class LinearGradient {
  constructor() {
    this.colors = []
    this.locations = []
    this.startPoint = new Point(0, 0)
    this.endPoint = new Point(0, 1)
  }
}

function cssGradient(g) {
  if (!g || !g.colors || !g.colors.length) return ""
  const dx = g.endPoint.x - g.startPoint.x
  const dy = g.endPoint.y - g.startPoint.y
  const angle = Math.atan2(dx, -dy) * 180 / Math.PI
  const stops = g.colors.map((c, i) => cssColor(c) + (g.locations && g.locations[i] != null ? " " + (g.locations[i] * 100) + "%" : ""))
  return "linear-gradient(" + angle + "deg, " + stops.join(", ") + ")"
}

// ─── Images & drawing ───────────────────────────────────────

export class Image {
  constructor(source, width, height) {
    this._source = source
    this.size = new Size(width, height)
    this._url = null
  }
  get _src() {
    if (!this._url) this._url = this._source instanceof HTMLCanvasElement ? this._source.toDataURL("image/png") : this._source.src
    return this._url
  }
  static fromData(data) { return data && data._image ? data._image : null }
}

export async function imageFromBlob(blob) {
  const url = URL.createObjectURL(blob)
  const el = new window.Image()
  await new Promise((ok, fail) => {
    el.onload = ok
    el.onerror = () => fail(new Error("The image could not be decoded"))
    el.src = url
  })
  return new Image(el, el.naturalWidth, el.naturalHeight)
}

export class Path {
  constructor() { this._ops = [] }
  move(p) { this._ops.push(g => g.moveTo(p.x, p.y)) }
  addLine(p) { this._ops.push(g => g.lineTo(p.x, p.y)) }
  addLines(points) { (points || []).forEach((p, i) => i === 0 ? this.move(p) : this.addLine(p)) }
  addCurve(p, c1, c2) { this._ops.push(g => g.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y)) }
  addQuadCurve(p, c) { this._ops.push(g => g.quadraticCurveTo(c.x, c.y, p.x, p.y)) }
  addRect(r) { this._ops.push(g => g.rect(r.x, r.y, r.width, r.height)) }
  addRects(rs) { (rs || []).forEach(r => this.addRect(r)) }
  addEllipse(r) { this._ops.push(g => { g.moveTo(r.x + r.width, r.y + r.height / 2); g.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2) }) }
  addRoundedRect(r, cw, ch) { this._ops.push(g => g.roundRect(r.x, r.y, r.width, r.height, Math.min(cw, ch))) }
  closeSubpath() { this._ops.push(g => g.closePath()) }
  _build() { const g = new Path2D(); this._ops.forEach(op => op(g)); return g }
}

export class DrawContext {
  constructor() {
    this.size = new Size(200, 200)
    this.opaque = true
    this.respectScreenScale = false
    this._fill = Color.black()
    this._stroke = Color.black()
    this._lineWidth = 1
    this._font = Font.body()
    this._textColor = Color.black()
    this._align = "left"
    this._paths = []
    this._g = null
  }
  _ctx() {
    if (this._g) return this._g
    const scale = this.respectScreenScale ? 3 : 1
    const c = document.createElement("canvas")
    c.width = Math.max(1, Math.round(this.size.width * scale))
    c.height = Math.max(1, Math.round(this.size.height * scale))
    const g = c.getContext("2d")
    g.scale(scale, scale)
    this._g = g
    return g
  }
  setFillColor(c) { this._fill = c }
  setStrokeColor(c) { this._stroke = c }
  setLineWidth(w) { this._lineWidth = w }
  setFont(f) { this._font = f }
  setTextColor(c) { this._textColor = c }
  setTextAlignedLeft() { this._align = "left" }
  setTextAlignedCenter() { this._align = "center" }
  setTextAlignedRight() { this._align = "right" }
  fill(r) { this.fillRect(r) }
  fillRect(r) { const g = this._ctx(); g.fillStyle = cssColor(this._fill); g.fillRect(r.x, r.y, r.width, r.height) }
  fillEllipse(r) {
    const g = this._ctx()
    g.fillStyle = cssColor(this._fill)
    g.beginPath()
    g.ellipse(r.x + r.width / 2, r.y + r.height / 2, Math.abs(r.width / 2), Math.abs(r.height / 2), 0, 0, Math.PI * 2)
    g.fill()
  }
  stroke(r) { this.strokeRect(r) }
  strokeRect(r) { const g = this._ctx(); g.strokeStyle = cssColor(this._stroke); g.lineWidth = this._lineWidth; g.strokeRect(r.x, r.y, r.width, r.height) }
  strokeEllipse(r) {
    const g = this._ctx()
    g.strokeStyle = cssColor(this._stroke)
    g.lineWidth = this._lineWidth
    g.beginPath()
    g.ellipse(r.x + r.width / 2, r.y + r.height / 2, Math.abs(r.width / 2), Math.abs(r.height / 2), 0, 0, Math.PI * 2)
    g.stroke()
  }
  addPath(p) { this._paths.push(p) }
  _takePath() { const all = new Path2D(); this._paths.forEach(p => all.addPath(p._build())); this._paths = []; return all }
  fillPath() { const g = this._ctx(); g.fillStyle = cssColor(this._fill); g.fill(this._takePath()) }
  strokePath() {
    const g = this._ctx()
    g.strokeStyle = cssColor(this._stroke)
    g.lineWidth = this._lineWidth
    g.lineJoin = "miter"
    g.stroke(this._takePath())
  }
  drawImageInRect(img, r) { if (img && img._source) this._ctx().drawImage(img._source, r.x, r.y, r.width, r.height) }
  drawImageAtPoint(img, p) { if (img && img._source) this._ctx().drawImage(img._source, p.x, p.y, img.size.width, img.size.height) }
  drawText(text, p) {
    const g = this._ctx()
    g.font = cssFont(this._font)
    g.fillStyle = cssColor(this._textColor)
    g.textAlign = "left"
    g.textBaseline = "top"
    g.fillText(String(text), p.x, p.y)
  }
  drawTextInRect(text, r) {
    const g = this._ctx()
    g.save()
    g.beginPath()
    g.rect(r.x, r.y, r.width, r.height)
    g.clip()
    g.font = cssFont(this._font)
    g.fillStyle = cssColor(this._textColor)
    g.textAlign = this._align
    g.textBaseline = "top"
    const x = this._align === "center" ? r.x + r.width / 2 : this._align === "right" ? r.x + r.width : r.x
    const lineH = this._font.size * 1.2
    let y = r.y
    for (const ln of wrapCanvasText(g, String(text), r.width)) {
      g.fillText(ln, x, y)
      y += lineH
    }
    g.restore()
  }
  getImage() {
    const g = this._ctx()
    return new Image(g.canvas, this.size.width, this.size.height)
  }
}

// SF Symbols only exist on Apple devices. The few the widgets use are drawn by hand
// as black template images, so tintColor colours them like on iOS.
export class SFSymbol {
  constructor(name) { this.name = String(name); this._weight = null; this._font = null }
  static named(name) { return new SFSymbol(name) }
  applyFont(font) { this._font = font }
  applyUltraLightWeight() { this._weight = 200 } applyThinWeight() { this._weight = 100 } applyLightWeight() { this._weight = 300 }
  applyRegularWeight() { this._weight = 400 } applyMediumWeight() { this._weight = 500 } applySemiboldWeight() { this._weight = 600 }
  applyBoldWeight() { this._weight = 700 } applyHeavyWeight() { this._weight = 800 } applyBlackWeight() { this._weight = 900 }
  get image() {
    const weight = this._weight || (this._font && this._font.weight) || 400
    const size = (this._font && this._font.size) || 17
    return drawSymbol(this.name, weight, size)
  }
}

function drawSymbol(name, weight, size) {
  const P = 96
  const c = document.createElement("canvas")
  c.width = P
  c.height = P
  const g = c.getContext("2d")
  const lw = 4 + weight / 100
  const parts = name.split(".")
  const glyph = parts[0]
  const circle = parts.includes("circle")
  const filled = parts.includes("fill")
  g.fillStyle = g.strokeStyle = "#000"
  g.lineCap = g.lineJoin = "round"
  g.lineWidth = lw
  if (circle) {
    g.beginPath()
    g.arc(P / 2, P / 2, P / 2 - lw / 2 - 2, 0, Math.PI * 2)
    if (filled) g.fill(); else g.stroke()
    if (filled) g.globalCompositeOperation = "destination-out"
  }
  const k = circle ? 0.55 : 0.85
  g.save()
  g.translate(P / 2, P / 2)
  g.scale(k, k)
  g.lineWidth = lw * 1.25 / k
  g.beginPath()
  if (glyph === "checkmark") { g.moveTo(-30, 2); g.lineTo(-9, 24); g.lineTo(32, -24); g.stroke() }
  else if (glyph === "xmark") { g.moveTo(-26, -26); g.lineTo(26, 26); g.moveTo(26, -26); g.lineTo(-26, 26); g.stroke() }
  else if (glyph === "plus") { g.moveTo(0, -30); g.lineTo(0, 30); g.moveTo(-30, 0); g.lineTo(30, 0); g.stroke() }
  else if (glyph === "minus") { g.moveTo(-30, 0); g.lineTo(30, 0); g.stroke() }
  else if (glyph === "exclamationmark") { g.moveTo(0, -32); g.lineTo(0, 10); g.stroke(); g.beginPath(); g.arc(0, 30, lw * 0.9 / k, 0, Math.PI * 2); g.fill() }
  else {
    g.font = weight + " 78px Inter, sans-serif"
    g.textAlign = "center"
    g.textBaseline = "middle"
    g.fillText(glyph === "questionmark" ? "?" : glyph === "info" ? "i" : glyph.charAt(0).toUpperCase(), 0, 4)
  }
  g.restore()
  return new Image(c, size, size)
}

function wrapCanvasText(g, text, width) {
  const out = []
  for (const para of text.split("\n")) {
    let cur = ""
    for (const word of para.split(" ")) {
      const next = cur ? cur + " " + word : word
      if (cur && g.measureText(next).width > width) { out.push(cur); cur = word } else cur = next
    }
    out.push(cur)
  }
  return out
}

// ─── Widget elements ────────────────────────────────────────

export class WidgetText {
  constructor(text) {
    this.text = String(text == null ? "" : text)
    this.textColor = null
    this.font = null
    this.textOpacity = 1
    this.lineLimit = 0
    this.minimumScaleFactor = 1
    this.shadowColor = null
    this.shadowRadius = 0
    this.shadowOffset = new Point(0, 0)
    this.url = null
    this._align = "left"
  }
  leftAlignText() { this._align = "left" }
  centerAlignText() { this._align = "center" }
  rightAlignText() { this._align = "right" }
}

export class WidgetDate extends WidgetText {
  constructor(date) {
    super("")
    this.date = date
    this._style = "date"
  }
  applyTimeStyle() { this._style = "time" }
  applyDateStyle() { this._style = "date" }
  applyRelativeStyle() { this._style = "relative" }
  applyOffsetStyle() { this._style = "offset" }
  applyTimerStyle() { this._style = "timer" }
}

export class WidgetImage {
  constructor(image) {
    this.image = image
    this.resizable = true
    this.imageSize = null
    this.imageOpacity = 1
    this.cornerRadius = 0
    this.borderWidth = 0
    this.borderColor = null
    this.containerRelativeShape = false
    this.tintColor = null
    this.url = null
    this._align = "center"
    this._mode = "fit"
  }
  leftAlignImage() { this._align = "left" }
  centerAlignImage() { this._align = "center" }
  rightAlignImage() { this._align = "right" }
  applyFittingContentMode() { this._mode = "fit" }
  applyFillingContentMode() { this._mode = "fill" }
}

export class WidgetSpacer {
  constructor(length) { this.length = length == null ? null : Number(length) }
}

class Container {
  constructor() {
    this._children = []
    this._padding = null
    this.backgroundColor = null
    this.backgroundImage = null
    this.backgroundGradient = null
    this.spacing = 0
    this.url = null
  }
  addText(text) { return this._add(new WidgetText(text)) }
  addDate(date) { return this._add(new WidgetDate(date)) }
  addImage(image) { return this._add(new WidgetImage(image)) }
  addSpacer(length) { return this._add(new WidgetSpacer(length)) }
  addStack() { return this._add(new WidgetStack()) }
  setPadding(top, leading, bottom, trailing) { this._padding = [top, leading, bottom, trailing].map(n => Number(n) || 0) }
  useDefaultPadding() { this._padding = null }
  _add(x) { this._children.push(x); return x }
}

export class ListWidget extends Container {
  constructor() {
    super()
    this.refreshAfterDate = null
    this.addAccessoryWidgetBackground = false
    this._presented = null
  }
  async presentSmall() { this._presented = "small" }
  async presentMedium() { this._presented = "medium" }
  async presentLarge() { this._presented = "large" }
  async presentExtraLarge() { this._presented = "extraLarge" }
  async presentAccessoryRectangular() { this._presented = "accessoryRectangular" }
  async presentAccessoryCircular() { this._presented = "accessoryCircular" }
  async presentAccessoryInline() { this._presented = "accessoryInline" }
}

export class WidgetStack extends Container {
  constructor() {
    super()
    this.size = null
    this.cornerRadius = 0
    this.borderWidth = 0
    this.borderColor = null
    this._layout = "h"
    this._align = "top"
  }
  layoutHorizontally() { this._layout = "h" }
  layoutVertically() { this._layout = "v" }
  topAlignContent() { this._align = "top" }
  centerAlignContent() { this._align = "center" }
  bottomAlignContent() { this._align = "bottom" }
}

// ─── Dates ──────────────────────────────────────────────────

const pad2 = n => String(n).padStart(2, "0")

export function formatPattern(date, pattern, locale) {
  const loc = String(locale || "en_US").replace("_", "-")
  const part = opts => new Intl.DateTimeFormat(loc, opts).format(date)
  return String(pattern || "").replace(/'([^']*)'|E{1,5}|M{1,5}|L{1,5}|d{1,2}|y{1,4}|H{1,2}|h{1,2}|m{1,2}|s{1,2}|a/g, (tok, lit) => {
    if (lit !== undefined) return lit === "" ? "'" : lit
    const n = tok.length
    switch (tok[0]) {
      case "E": return n >= 4 ? part({ weekday: "long" }) : part({ weekday: "short" })
      case "M": case "L":
        if (n >= 4) return part({ month: "long" })
        if (n === 3) return part({ month: "short" })
        return n === 2 ? pad2(date.getMonth() + 1) : String(date.getMonth() + 1)
      case "d": return n === 2 ? pad2(date.getDate()) : String(date.getDate())
      case "y": return n === 2 ? String(date.getFullYear()).slice(-2) : String(date.getFullYear())
      case "H": return n === 2 ? pad2(date.getHours()) : String(date.getHours())
      case "h": { const h = date.getHours() % 12 || 12; return n === 2 ? pad2(h) : String(h) }
      case "m": return n === 2 ? pad2(date.getMinutes()) : String(date.getMinutes())
      case "s": return n === 2 ? pad2(date.getSeconds()) : String(date.getSeconds())
      case "a": return date.getHours() < 12 ? "AM" : "PM"
    }
    return tok
  })
}

export class DateFormatter {
  constructor() { this.locale = "en_US"; this.dateFormat = "" }
  string(date) { return formatPattern(date, this.dateFormat, this.locale) }
  date(str) { const d = new RealDate(str); return isNaN(d) ? null : d }
  useNoDateStyle() {} useShortDateStyle() {} useMediumDateStyle() {} useLongDateStyle() {} useFullDateStyle() {}
  useNoTimeStyle() {} useShortTimeStyle() {} useMediumTimeStyle() {} useLongTimeStyle() {} useFullTimeStyle() {}
}

export function timerText(target, now) {
  const s = Math.floor(Math.abs(target - now) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? h + ":" + pad2(m) + ":" + pad2(s % 60) : m + ":" + pad2(s % 60)
}

function relativeText(target, now) {
  let s = Math.round(Math.abs(target - now) / 1000)
  const d = Math.floor(s / 86400); s %= 86400
  const h = Math.floor(s / 3600); s %= 3600
  const m = Math.floor(s / 60)
  if (d) return d + (d === 1 ? " day" : " days") + (h ? ", " + h + " hr" : "")
  if (h) return h + " hr" + (m ? ", " + m + " min" : "")
  return m + " min"
}

// ─── Runtime: the globals one script run sees ───────────────

export function fakeDate(offset) {
  class D extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(RealDate.now() + offset)
      else super(...a)
    }
    static now() { return RealDate.now() + offset }
  }
  return D
}

export const LOCAL_DOCS = "/var/mobile/Containers/Data/Application/NABS-PREVIEW/Documents"
const ICLOUD_DOCS = "/private/var/mobile/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents"

function makeFileManager(store, D) {
  const LOCAL = LOCAL_DOCS
  const ICLOUD = ICLOUD_DOCS
  class FileManager {
    constructor(root) { this._root = root }
    static local() { return new FileManager(LOCAL) }
    static iCloud() { return new FileManager(ICLOUD) }
    documentsDirectory() { return this._root }
    libraryDirectory() { return this._root.replace(/Documents$/, "Library") }
    cacheDirectory() { return this._root.replace(/Documents$/, "Library/Caches") }
    temporaryDirectory() { return this._root.replace(/Documents$/, "tmp") }
    joinPath(a, b) { return String(a).replace(/\/+$/, "") + "/" + String(b).replace(/^\/+/, "") }
    fileExists(p) { return store.has(p) || this.isDirectory(p) }
    isDirectory(p) { const pre = String(p).replace(/\/+$/, "") + "/"; for (const k of store.keys()) if (k.startsWith(pre)) return true; return false }
    createDirectory() {}
    readString(p) { const e = store.get(p); return e && typeof e.value === "string" ? e.value : null }
    writeString(p, s) { store.set(p, { value: String(s), mtime: D.now() }) }
    readImage(p) { const e = store.get(p); return e && e.value instanceof Image ? e.value : null }
    writeImage(p, img) { store.set(p, { value: img, mtime: D.now() }) }
    read(p) { const e = store.get(p); return e ? e.value : null }
    write(p, data) { store.set(p, { value: data, mtime: D.now() }) }
    remove(p) { store.delete(p) }
    move(a, b) { const e = store.get(a); if (e) { store.set(b, e); store.delete(a) } }
    copy(a, b) { const e = store.get(a); if (e) store.set(b, { ...e }) }
    listContents(dir) {
      const pre = String(dir).replace(/\/+$/, "") + "/"
      const names = new Set()
      for (const k of store.keys()) if (k.startsWith(pre)) names.add(k.slice(pre.length).split("/")[0])
      return [...names]
    }
    listContentsRecursively(dir) { const pre = String(dir).replace(/\/+$/, "") + "/"; return [...store.keys()].filter(k => k.startsWith(pre)).map(k => k.slice(pre.length)) }
    modificationDate(p) { const e = store.get(p); return e ? new D(e.mtime) : null }
    creationDate(p) { return this.modificationDate(p) }
    isFileStoredIniCloud() { return false }
    isFileDownloaded() { return true }
    async downloadFileFromiCloud() {}
    fileName(p, withExt) { const n = String(p).split("/").pop(); return withExt ? n : n.replace(/\.[^.]*$/, "") }
    fileExtension(p) { const m = String(p).match(/\.([^./]+)$/); return m ? m[1] : "" }
    fileSize(p) { const e = store.get(p); return e && typeof e.value === "string" ? e.value.length / 1000 : 0 }
    allFileBookmarks() { return [] }
    bookmarkExists() { return false }
    bookmarkedPath(name) { throw new Error("No bookmark named " + name + " in the preview") }
    allTags() { return [] }
    getUTI() { return "public.data" }
  }
  return FileManager
}

class Data {
  constructor(bytes) { this._bytes = bytes || new Uint8Array() }
  static fromString(s) { return new Data(new TextEncoder().encode(String(s))) }
  static fromBase64String(s) { return new Data(Uint8Array.from(atob(s), c => c.charCodeAt(0))) }
  toRawString() { return new TextDecoder().decode(this._bytes) }
  toBase64String() { let s = ""; this._bytes.forEach(b => { s += String.fromCharCode(b) }); return btoa(s) }
  getBytes() { return [...this._bytes] }
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// Chrome counts the lines of new Function() code from the wrapper it adds around
// the body, so error line numbers are shifted. Measure the shift once.
export const LINE_SHIFT = (() => {
  try { new Function("a", "\nthrow new Error('probe')\n//# sourceURL=__probe.js")() } catch (e) {
    const m = String(e.stack).match(/__probe\.js:(\d+)/)
    if (m) return Number(m[1]) - 2
  }
  return 2
})()

// ctx: { family, param, source, offset, store, modules, logs, requests, name }
export function createRuntime(ctx) {
  const D = fakeDate(ctx.offset || 0)
  const say = kind => (...a) => ctx.logs.push({ kind, text: a.map(x => typeof x === "string" ? x : safeJson(x)).join(" ") })
  const consoleObj = { log: say("log"), warn: say("warn"), error: say("error"), info: say("log"), debug: say("log") }

  class Request {
    constructor(url) {
      this.url = url
      this.method = "GET"
      this.headers = {}
      this.body = null
      this.timeoutInterval = 60
      this.response = null
      this.allowInsecureRequest = false
      this.onRedirect = null
    }
    async _go() {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), (Number(this.timeoutInterval) || 60) * 1000)
      const target = ctx.fetchUrl ? ctx.fetchUrl(String(this.url)) : "/proxy?" + new URLSearchParams({ url: String(this.url), src: ctx.source || "live" })
      try {
        const res = await fetch(target, { signal: ctrl.signal })
        const type = res.headers.get("content-type") || ""
        this.response = { statusCode: res.status, url: String(this.url), mimeType: type.split(";")[0], headers: { "Content-Type": type } }
        ctx.requests.push({ url: String(this.url), status: res.status })
        return res
      } catch (e) {
        ctx.requests.push({ url: String(this.url), status: 0 })
        if (e && e.name === "AbortError") throw new Error("The request timed out.")
        throw e
      } finally {
        clearTimeout(timer)
      }
    }
    async loadString() {
      const text = await (await this._go()).text()
      // optional test data from the preview page, to see fields the live data does not carry yet
      if (ctx.mock && /\/api\/widget/.test(String(this.url))) {
        try {
          const j = JSON.parse(text)
          if (ctx.mock.maxGrid && j.nextRace) { j.nextRace.maxGrid = ctx.mock.maxGrid; j.nextRace.waiting = ctx.mock.waiting || 0 }
          if (ctx.mock.liveCount != null && j.live && Array.isArray(j.live.best)) {
            const base = j.live.best
            const n = ctx.mock.liveCount
            const all = Array.from({ length: n }, (_, i) => {
              const b = base[i % base.length]
              return Object.assign({}, b, { pos: i + 1, driver: b.driver + (i >= base.length ? " " + (i + 1) : ""), gap: i === 0 ? null : "+" + (i * 0.137).toFixed(3) })
            })
            j.live.best = all.slice(0, 12)
            j.live.timed = n
            // beyond the twelfth, the asking driver's own line, like the backend sends it
            j.live.me = n > 12 && j.me ? Object.assign({}, all[n - 1], { driver: String(j.me.driver).toUpperCase() }) : null
          }
          if (ctx.mock.stats && j.me && j.me.ahead === undefined) {
            Object.assign(j.me, { ahead: "Tester One", aheadCountry: "GB", aheadTeam: "Ferrari", aheadColor: "#E10600", behind: "Tester Two", behindCountry: "NL", behindTeam: "Lotus", behindColor: "#2E9E5B" })
          }
          if (ctx.mock.stats && j.me && j.me.teammate) {
            j.me.stats = { wins: 0, podiums: 2, bestFinish: 2, avgFinish: 12.8, poles: 0, bestGrid: 5, avgGrid: 9.1 }
            if (!j.me.teammate.country) j.me.teammate.country = "GB"
            j.me.teammate.stats = { wins: 1, podiums: 3, bestFinish: 1, avgFinish: 6.4, poles: 1, bestGrid: 1, avgGrid: 4.2 }
          }
          return JSON.stringify(j)
        } catch (_) {}
      }
      return text
    }
    async loadJSON() { return JSON.parse(await this.loadString()) }
    async loadData() { const r = await this._go(); return new Data(new Uint8Array(await r.arrayBuffer())) }
    async loadImage() {
      const r = await this._go()
      if (!r.ok) throw new Error("HTTP " + r.status)
      return imageFromBlob(await r.blob())
    }
  }

  const FileManager = makeFileManager(ctx.store, D)

  class Alert {
    constructor() { this.title = ""; this.message = ""; this._fields = [] }
    addAction() {} addDestructiveAction() {} addCancelAction() {}
    addTextField(placeholder, value) { this._fields.push(value || "") }
    addSecureTextField(placeholder, value) { this._fields.push(value || "") }
    textFieldValue(i) { return this._fields[i] || "" }
    async present() { consoleObj.log("[Alert] " + this.title + (this.message ? ": " + this.message : "")); return -1 }
    async presentAlert() { return this.present() }
    async presentSheet() { return this.present() }
  }

  const PreviewImage = class extends Image {}
  PreviewImage.fromFile = p => FileManager.local().readImage(p)
  PreviewImage.fromData = Image.fromData

  const accessory = String(ctx.family).startsWith("accessory")
  const config = {
    runsInWidget: !accessory,
    runsInAccessoryWidget: accessory,
    runsInApp: false,
    runsInActionExtension: false,
    runsWithSiri: false,
    runsInNotification: false,
    runsFromHomeScreen: false,
    widgetFamily: ctx.family,
  }
  const args = {
    widgetParameter: ctx.param || null,
    queryParameters: {}, plainTexts: [], urls: [], fileURLs: [], images: [], notification: null, shortcutParameter: null, length: 0,
  }
  const Script = {
    setWidget(w) { ctx.widget = w },
    complete() {},
    setShortcutOutput() {},
    name() { return ctx.name || "NABS" },
  }
  const Device = {
    screenScale: () => 3, screenSize: () => new Size(...(ctx.screen || [393, 852])),
    screenResolution: () => new Size(...(ctx.screen || [393, 852]).map(n => n * 3)),
    isUsingDarkAppearance: () => true, model: () => "iPhone", name: () => "iPhone", systemName: () => "iOS",
    systemVersion: () => "18.0", isPhone: () => true, isPad: () => false, locale: () => "de_DE", language: () => "de",
    preferredLanguages: () => ["de-DE", "en-GB"], batteryLevel: () => 0.8, isCharging: () => false, volume: () => 0.5,
  }
  const Safari = { open(url) { consoleObj.log("[Safari.open] " + url) }, openInApp: async url => consoleObj.log("[Safari.openInApp] " + url) }
  const Keychain = { contains: () => false, get: key => { throw new Error("Keychain has no " + key) }, set() {}, remove() {} }
  class Notification { constructor() { this.title = ""; this.body = "" } async schedule() {} static async removeAllPending() {} static async allPending() { return [] } }
  const Location = { current: async () => { throw new Error("No location in the preview") }, setAccuracyToBest() {}, setAccuracyToHundredMeters() {}, setAccuracyToKilometer() {}, setAccuracyToThreeKilometers() {} }
  const Pasteboard = { copy() {}, paste: () => null, copyString() {}, pasteString: () => null }
  const Timer = { schedule: (ms, repeats, fn) => (repeats ? setInterval : setTimeout)(fn, ms) }
  const QuickLook = { present: async () => {} }
  const Speech = { speak() {} }
  const Photos = { latestPhoto: async () => { throw new Error("No photos in the preview") } }

  const globals = {
    Size, Point, Rect, Color, Font, LinearGradient, Image: PreviewImage, Data, DrawContext, Path, SFSymbol,
    ListWidget, WidgetStack, WidgetText, WidgetDate, WidgetImage, WidgetSpacer, DateFormatter,
    Request, FileManager, Alert, Device, Safari, Keychain, Notification, Location, Pasteboard, Timer,
    QuickLook, Speech, Photos, Script, config, args, console: consoleObj, Date: D,
  }

  function importModule(name) {
    const key = String(name).replace(/\.js$/i, "")
    const src = ctx.modules[key]
    if (src == null) throw new Error("Module \"" + name + "\" not found")
    const module = { exports: {}, filename: undefined }
    const names = Object.keys(globals).concat(["importModule", "module", "exports"])
    const fn = new Function(...names, src + "\n//# sourceURL=" + fileNameFor(key))
    fn(...Object.values(globals), importModule, module, module.exports)
    return module.exports
  }

  return {
    async runScript(src, name) {
      const module = { exports: {}, filename: undefined }
      const names = Object.keys(globals).concat(["importModule", "module", "exports"])
      const fn = new AsyncFunction(...names, src + "\n//# sourceURL=" + fileNameFor(name))
      await fn(...Object.values(globals), importModule, module, module.exports)
      return ctx.widget
    },
  }
}

function fileNameFor(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".js"
}

function safeJson(x) {
  try { return x instanceof Error ? String(x.stack || x) : JSON.stringify(x) } catch (_) { return String(x) }
}

// ─── Renderer: widget object → HTML ─────────────────────────

function div(cls) {
  const el = document.createElement("div")
  el.className = cls
  return el
}

// Like SwiftUI: a stack grows along an axis when something inside it does
// (a flexible spacer, a timer text, another growing stack) and it has no fixed size there.
function flexOf(node, axis) {
  if (node instanceof WidgetSpacer) return node.length == null ? { h: axis === "h", v: axis === "v" } : NONE
  if (node instanceof WidgetDate) return node._style === "timer" || node._style === "relative" || node._style === "offset" ? { h: true, v: false } : NONE
  if (node instanceof WidgetText) return NONE
  if (node instanceof WidgetImage) return node.imageSize || !node.resizable ? NONE : { h: true, v: true }
  if (node instanceof WidgetStack) {
    if (node._flex) return node._flex
    const fw = node.size && node.size.width > 0
    const fh = node.size && node.size.height > 0
    let h = false
    let v = false
    for (const c of node._children) {
      const f = flexOf(c, node._layout)
      h = h || f.h
      v = v || f.v
    }
    node._flex = { h: h && !fw, v: v && !fh }
    return node._flex
  }
  return NONE
}

function place(el, f, axis, fixedW, fixedH) {
  el.style.minWidth = "0"
  if (axis === "h") {
    // Blocks start from their content width and only share what is left over, like
    // on iOS, where a name gets its room before a spacer next to it takes anything
    el.style.flex = fixedW ? "0 0 auto" : f.h ? "1 1 auto" : "0 1 auto"
    if (f.v && !fixedH) el.style.alignSelf = "stretch"
  } else {
    if (fixedH) el.style.flex = "0 0 auto"
    else if (f.v) { el.style.flex = "1 1 0"; el.style.minHeight = "0" } else el.style.flex = "0 0 auto"
    if (f.h && !fixedW) el.style.alignSelf = "stretch"
    else el.style.maxWidth = "100%"
  }
}

function addBorder(el, width, color, radius) {
  if (!width || !color) return
  const b = div("sw-border")
  b.style.borderWidth = width + "px"
  b.style.borderColor = cssColor(color)
  if (radius) b.style.borderRadius = radius + "px"
  el.appendChild(b)
}

function padCss(p) {
  return p[0] + "px " + p[3] + "px " + p[2] + "px " + p[1] + "px"
}

const isFlagLetter = c => c >= 0x1F1E6 && c <= 0x1F1FF

// Flag emoji do not exist on Windows, so they are swapped for the site's flag images.
function appendRich(el, str) {
  const cps = Array.from(String(str))
  let buf = ""
  for (let i = 0; i < cps.length; i++) {
    const a = cps[i].codePointAt(0)
    const b = i + 1 < cps.length ? cps[i + 1].codePointAt(0) : 0
    if (isFlagLetter(a) && isFlagLetter(b)) {
      if (buf) { el.appendChild(document.createTextNode(buf)); buf = "" }
      const cc = String.fromCharCode(97 + a - 0x1F1E6, 97 + b - 0x1F1E6)
      const img = document.createElement("img")
      img.className = "sw-flag"
      img.src = "/flags/w80/" + cc + ".png"
      img.alt = cc.toUpperCase()
      el.appendChild(img)
      i++
    } else buf += cps[i]
  }
  if (buf) el.appendChild(document.createTextNode(buf))
}

function renderText(node, axis, inWidget, env) {
  const el = div("sw-text")
  const font = node.font || (env.inline ? Font._make("sans", 600, 16) : Font.body())
  el.style.font = cssFont(font)
  el.style.lineHeight = "1.2"
  // Inter stands in for SF Pro and runs a little wider, this pulls it closer
  if (font.family !== "mono") el.style.letterSpacing = "-0.015em"
  el.style.color = cssColor(node.textColor, env.textColor)
  if (node.textOpacity != null && node.textOpacity < 1) el.style.opacity = node.textOpacity
  if (node.shadowColor && node.shadowRadius) {
    el.style.textShadow = node.shadowOffset.x + "px " + node.shadowOffset.y + "px " + node.shadowRadius + "px " + cssColor(node.shadowColor)
  }
  const lines = env.inline ? 1 : Number(node.lineLimit) || 0
  if (lines === 1) el.classList.add("sw-one")
  else if (lines > 1) { el.classList.add("sw-clamp"); el.style.webkitLineClamp = String(lines) }
  el.style.textAlign = node._align
  el.dataset.size = font.size
  el.dataset.min = node.minimumScaleFactor == null ? 1 : node.minimumScaleFactor
  el.dataset.lines = lines

  if (node instanceof WidgetDate) {
    const target = new RealDate(node.date).getTime()
    const now = env.now()
    if (node._style === "timer") { el.classList.add("sw-timer"); el.dataset.target = target; el.textContent = timerText(target, now) }
    else if (node._style === "relative") el.textContent = relativeText(target, now)
    else if (node._style === "offset") el.textContent = (target >= now ? "+" : "-") + relativeText(target, now)
    else if (node._style === "time") el.textContent = formatPattern(new RealDate(target), "HH:mm", "en_GB")
    else el.textContent = formatPattern(new RealDate(target), "d MMMM yyyy", "en_GB")
  } else {
    appendRich(el, node.text)
  }

  place(el, flexOf(node, axis), axis, false, false)
  // SwiftUI lets short texts (a points value) keep their full width and squeezes the
  // long ones (a name) first. Weighting the shrink by length copies that.
  if (axis === "h") {
    const len = Array.from(el.textContent).length + 2 * el.querySelectorAll("img").length
    el.style.flexShrink = String(Math.max(1, len) ** 2)
  }
  if (inWidget) { el.style.alignSelf = "stretch"; el.style.maxWidth = "" }
  if (node.url) el.title = node.url
  return el
}

function renderImage(node, axis, inWidget) {
  const el = div("sw-image")
  const src = node.image && node.image._src
  if (node.tintColor && src) {
    const tint = div("sw-tint")
    tint.style.background = cssColor(node.tintColor)
    tint.style.maskImage = tint.style.webkitMaskImage = "url(\"" + src + "\")"
    tint.style.maskSize = tint.style.webkitMaskSize = node._mode === "fill" ? "cover" : "contain"
    el.appendChild(tint)
  } else if (src) {
    const img = document.createElement("img")
    img.src = src
    img.draggable = false
    img.style.objectFit = node._mode === "fill" ? "cover" : "contain"
    el.appendChild(img)
  }
  const fixed = !!node.imageSize || (!node.resizable && node.image)
  if (node.imageSize) {
    el.style.width = node.imageSize.width + "px"
    el.style.height = node.imageSize.height + "px"
  } else if (!node.resizable && node.image) {
    el.style.width = node.image.size.width + "px"
    el.style.height = node.image.size.height + "px"
  }
  const radius = node.containerRelativeShape ? 14 : node.cornerRadius
  if (radius) el.style.borderRadius = radius + "px"
  if (node.imageOpacity != null && node.imageOpacity < 1) el.style.opacity = node.imageOpacity
  addBorder(el, node.borderWidth, node.borderColor, radius)
  place(el, flexOf(node, axis), axis, fixed, fixed)
  if (fixed) el.style.flexShrink = "0"
  if (inWidget) el.style.alignSelf = { left: "flex-start", center: "center", right: "flex-end" }[node._align]
  if (node.url) el.title = node.url
  return el
}

function renderStack(node, axis, env) {
  const el = div("sw-stack")
  const row = node._layout === "h"
  el.style.flexDirection = row ? "row" : "column"
  el.style.alignItems = { top: "flex-start", center: "center", bottom: "flex-end" }[node._align]
  if (node.spacing) el.style.gap = node.spacing + "px"
  if (node._padding) el.style.padding = padCss(node._padding)
  const fw = !!(node.size && node.size.width > 0)
  const fh = !!(node.size && node.size.height > 0)
  if (fw) { el.style.width = node.size.width + "px"; if (row) el.style.justifyContent = "center" }
  if (fh) { el.style.height = node.size.height + "px"; if (!row) el.style.justifyContent = "center" }
  if (node.backgroundColor) el.style.backgroundColor = cssColor(node.backgroundColor)
  const bgs = []
  if (node.backgroundImage) bgs.push("url(\"" + node.backgroundImage._src + "\")")
  if (node.backgroundGradient) bgs.push(cssGradient(node.backgroundGradient))
  if (bgs.length) { el.style.backgroundImage = bgs.join(", "); el.style.backgroundSize = "cover"; el.style.backgroundPosition = "center" }
  if (node.cornerRadius) { el.style.borderRadius = node.cornerRadius + "px"; el.style.overflow = "hidden" }
  for (const c of node._children) el.appendChild(renderNode(c, row ? "h" : "v", false, env))
  addBorder(el, node.borderWidth, node.borderColor, node.cornerRadius)
  place(el, flexOf(node, axis), axis, fw, fh)
  if (node.url) el.title = node.url
  return el
}

// On iOS a flexible spacer never shrinks below about 8 points (SwiftUI's default
// minimum). Inside small fixed boxes that eats the room the text needs, so the
// preview copies it to show the same squeeze as the phone.
const SPACER_MIN = 8

function renderSpacer(node, axis) {
  const el = div("sw-spacer")
  if (node.length == null) {
    el.style.flex = "1 0 0"
    el.style[axis === "h" ? "minWidth" : "minHeight"] = SPACER_MIN + "px"
  } else {
    el.style.flex = "0 0 " + node.length + "px"
    el.style[axis === "h" ? "width" : "height"] = node.length + "px"
  }
  return el
}

function renderNode(node, axis, inWidget, env) {
  if (node instanceof WidgetSpacer) return renderSpacer(node, axis)
  if (node instanceof WidgetText) return renderText(node, axis, inWidget, env)
  if (node instanceof WidgetImage) return renderImage(node, axis, inWidget)
  if (node instanceof WidgetStack) return renderStack(node, axis, env)
  return div("sw-unknown")
}

// env: { now: () => ms }
export function renderWidget(widget, family, width, height, env) {
  const accessory = String(family).startsWith("accessory")
  const inline = family === "accessoryInline"
  const root = div("sw-widget sw-" + family)
  root.style.width = width + "px"
  root.style.height = height + "px"
  const e = Object.assign({ textColor: "#FFFFFF", inline }, env)

  if (!accessory) {
    root.style.backgroundColor = cssColor(widget.backgroundColor, "#1C1C1E")
    if (widget.backgroundGradient) root.style.backgroundImage = cssGradient(widget.backgroundGradient)
  } else if (widget.addAccessoryWidgetBackground) {
    root.classList.add("sw-acc-bg")
  }
  if (widget.backgroundImage && !accessory) {
    const bg = div("sw-bg")
    bg.style.backgroundImage = "url(\"" + widget.backgroundImage._src + "\")"
    root.appendChild(bg)
  }

  const body = div("sw-body")
  body.style.padding = padCss(widget._padding || (accessory ? [0, 0, 0, 0] : [16, 16, 16, 16]))
  if (widget.spacing) body.style.gap = widget.spacing + "px"
  if (inline) body.classList.add("sw-inline")
  for (const c of widget._children) body.appendChild(renderNode(c, inline ? "h" : "v", !inline, e))
  root.appendChild(body)
  return root
}

// Second pass once the widget is on the page: texts that do not fit shrink
// down to their minimumScaleFactor, then get cut with "…", like on iOS.
export function fitTexts(root) {
  const jobs = []
  for (const el of root.querySelectorAll(".sw-text.sw-one")) {
    const min = Number(el.dataset.min)
    const cw = el.clientWidth
    const sw = el.scrollWidth
    // widths come back rounded to whole pixels, so leave a little headroom or a
    // fraction of a pixel too much still shows the "…"
    if (sw > cw + 0.5 && min < 1 && cw > 0) jobs.push([el, Math.max(min, (cw / sw) * 0.97), cw])
  }
  for (const [el, scale, cw] of jobs) {
    // in a column the flex basis would be read as a height, so only rows get it
    if (el.parentElement && getComputedStyle(el.parentElement).flexDirection === "row") el.style.flex = "0 0 " + cw + "px"
    el.style.width = cw + "px"
    el.style.fontSize = Number(el.dataset.size) * scale + "px"
  }
}

export function tickTimers(root, now) {
  for (const el of root.querySelectorAll(".sw-timer")) el.textContent = timerText(Number(el.dataset.target), now)
}
