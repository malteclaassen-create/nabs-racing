// ---------------------------------------------------------------------------
// The picture at the end of a Season Wrapped story: one driver's season on a
// 9:16 card, the size a phone's story or status takes (Instagram, WhatsApp),
// with the driver's car from the story's 3D on it where there is one.
//
// Drawn here, in the browser, rather than on the server like the link
// previews (backend lib/sharePictures.js): the car is a WebGL render, and the
// browser is where WebGL is. Text is drawn in the site's own fonts, once they
// are in.
// ---------------------------------------------------------------------------

export const CARD_W = 1080;
export const CARD_H = 1920;

const DISPLAY = "Archivo, Inter, system-ui, sans-serif";
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SANS = "Inter, system-ui, sans-serif";

async function fontsIn() {
  const f = document.fonts;
  if (!f?.load) return;
  await Promise.race([
    Promise.all([f.load(`900 120px ${DISPLAY}`), f.load(`700 32px ${MONO}`), f.load(`600 40px ${SANS}`)]).catch(() => {}),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
}

// The largest size (down to `min`) at which `text` fits in `width`.
function fitFont(g, text, weight, family, max, min, width) {
  let size = max;
  for (; size > min; size -= 4) {
    g.font = `${weight} ${size}px ${family}`;
    if (g.measureText(text).width <= width) break;
  }
  g.font = `${weight} ${size}px ${family}`;
  return size;
}

function spaced(g, px) {
  if ("letterSpacing" in g) g.letterSpacing = `${px}px`;
}

function pill(g, x, y, w, h) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, h / 2);
  else g.rect(x, y, w, h);
}

// The league's mark, or null when it cannot be had (it then reads as text).
async function loadImage(src) {
  if (!src) return null;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

// `card`: the summary slide (utils/wrappedStory.mjs). `car`: a canvas with the
// car on a transparent background, or null. `logo`: the address of the
// league's mark for a dark background. Resolves to a JPEG Blob.
export async function drawShareCard({ card, data, car = null, address = "", logo = null }) {
  const [mark] = await Promise.all([loadImage(logo), fontsIn()]);
  const c = document.createElement("canvas");
  c.width = CARD_W;
  c.height = CARD_H;
  const g = c.getContext("2d");
  const paint = card.paint;
  const { driver, season, championship } = data;

  // Night, the team's colour glowing in from the top, a band of it across.
  g.fillStyle = "#0B0A12";
  g.fillRect(0, 0, CARD_W, CARD_H);
  const glow = g.createRadialGradient(CARD_W * 0.85, 260, 40, CARD_W * 0.85, 260, 1100);
  glow.addColorStop(0, `${paint}99`);
  glow.addColorStop(1, `${paint}00`);
  g.fillStyle = glow;
  g.fillRect(0, 0, CARD_W, CARD_H);
  g.save();
  g.translate(0, 1080);
  g.rotate(-0.16);
  g.fillStyle = `${paint}2e`;
  g.fillRect(-200, 0, CARD_W + 400, 220);
  g.restore();

  // The masthead: the league's mark in the corner, the name beside it.
  const textX = mark ? 212 : 72;
  if (mark) g.drawImage(mark, 44, 36, 160, 160);
  g.fillStyle = "#FFFFFF";
  g.textBaseline = "alphabetic";
  spaced(g, 6);
  g.font = `900 40px ${DISPLAY}`;
  g.fillText("NABS RACING", textX, 118);
  g.font = `700 28px ${MONO}`;
  g.fillStyle = "rgba(255,255,255,0.85)";
  spaced(g, 4);
  g.fillText(`${season.label} WRAPPED`.toUpperCase(), textX, 168);
  spaced(g, 0);

  // The car, or the race number where there is no 3D.
  if (car) {
    const w = CARD_W;
    const h = (car.height / car.width) * w;
    g.drawImage(car, 0, 190, w, h);
  } else {
    g.strokeStyle = paint;
    g.lineWidth = 18;
    g.beginPath();
    g.arc(CARD_W / 2, 520, 250, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "#FFFFFF";
    g.textAlign = "center";
    fitFont(g, String(driver.number ?? "NABS"), 900, DISPLAY, 260, 80, 420);
    g.fillText(String(driver.number ?? "NABS"), CARD_W / 2, 610);
    g.textAlign = "left";
  }

  // Who.
  const name = driver.name.toUpperCase();
  g.fillStyle = "#FFFFFF";
  fitFont(g, name, 900, DISPLAY, 150, 64, CARD_W - 144);
  g.fillText(name, 72, 1030);
  if (driver.team?.name) {
    g.fillStyle = paint;
    g.fillRect(72, 1062, 34, 34);
    g.fillStyle = "rgba(255,255,255,0.88)";
    g.font = `600 38px ${SANS}`;
    g.fillText(driver.team.name, 124, 1092);
  }

  // Where they finished.
  if (card.position != null) {
    const medal = card.position === 1 ? "#F5C542" : card.position === 2 ? "#DFE3EA" : card.position === 3 ? "#E39A5F" : "#FFFFFF";
    g.fillStyle = medal;
    g.font = `900 250px ${DISPLAY}`;
    const big = `P${card.position}`;
    g.fillText(big, 64, 1370);
    const bw = g.measureText(big).width;
    g.fillStyle = "rgba(255,255,255,0.85)";
    spaced(g, 3);
    g.font = `700 30px ${MONO}`;
    g.fillText(card.position === 1 ? "CHAMPION" : `OF ${card.fieldSize || championship.fieldSize} DRIVERS`, 64 + bw + 34, 1300);
    g.fillText("FINAL TABLE", 64 + bw + 34, 1350);
    spaced(g, 0);
  }

  // The numbers, three by two.
  const stats = card.stats.slice(0, 6);
  const colW = (CARD_W - 144) / 3;
  stats.forEach((s, i) => {
    const x = 72 + (i % 3) * colW;
    const y = 1500 + Math.floor(i / 3) * 170;
    g.fillStyle = "#FFFFFF";
    g.font = `900 92px ${DISPLAY}`;
    g.fillText(`${s.prefix || ""}${Number(s.value).toLocaleString("en-US")}`, x, y);
    g.fillStyle = "rgba(255,255,255,0.8)";
    spaced(g, 2);
    g.font = `700 26px ${MONO}`;
    g.fillText(s.label.toUpperCase(), x, y + 44);
    spaced(g, 0);
  });

  // The verdict, and where to find the rest.
  if (card.type) {
    g.font = `900 40px ${DISPLAY}`;
    const t = card.type.toUpperCase();
    const w = g.measureText(t).width + 64;
    g.fillStyle = "#C6F432";
    pill(g, 72, 1752, w, 72);
    g.fill();
    g.fillStyle = "#0B0F00";
    g.fillText(t, 104, 1802);
  }
  if (address) {
    g.fillStyle = "rgba(255,255,255,0.75)";
    fitFont(g, address, 700, MONO, 26, 16, CARD_W - 144);
    g.fillText(address, 72, 1872);
  }

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("No picture"))), "image/jpeg", 0.92));
}
