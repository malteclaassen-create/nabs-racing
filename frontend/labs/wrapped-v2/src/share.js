// The picture to share at the end: 1080 x 1920, drawn in the browser, handed
// to the share sheet where there is one, saved where there isn't.
export async function shareCard(d) {
  const W = 1080;
  const H = 1920;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  await document.fonts?.ready;
  const team = d.driver.team.color;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#050507");
  bg.addColorStop(1, "#0d2b06");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Ribbons of colour across the top.
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = i % 2 ? team : "#39ff14";
    ctx.globalAlpha = 0.5 - i * 0.06;
    ctx.lineWidth = 60 - i * 6;
    ctx.beginPath();
    ctx.moveTo(-100, 300 + i * 70);
    ctx.bezierCurveTo(300, 40 + i * 50, 700, 760 - i * 40, 1180, 380 + i * 60);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const logo = await new Promise((r) => {
    const i = new Image();
    i.onload = () => r(i);
    i.onerror = () => r(null);
    i.src = "logo.png";
  });
  if (logo) ctx.drawImage(logo, 72, 72, 120, 120);
  ctx.fillStyle = "#fff";
  ctx.font = "900 46px Archivo, sans-serif";
  ctx.fillText("NABS RACING", 214, 132);
  ctx.font = "700 30px 'JetBrains Mono', monospace";
  ctx.fillText(`${d.season.label.toUpperCase()} WRAPPED`, 214, 178);
  ctx.font = "900 150px Archivo, sans-serif";
  ctx.fillText(d.driver.name.toUpperCase(), 72, 1010);
  ctx.fillStyle = team;
  ctx.font = "700 40px 'JetBrains Mono', monospace";
  ctx.fillText(d.driver.team.name.toUpperCase(), 76, 1072);
  ctx.fillStyle = "#e39a5f";
  ctx.font = "900 300px Archivo, sans-serif";
  ctx.fillText(`P${d.championship.position}`, 60, 1380);
  const stats = [
    [d.championship.points, "POINTS"],
    [d.stats.wins, "WINS"],
    [d.stats.podiums, "PODIUMS"],
    [d.stats.overtakes, "OVERTAKES"],
    [d.stats.lapsLed, "LAPS LED"],
    [`+${d.climb.gained}`, "BEST CLIMB"],
  ];
  stats.forEach(([v, k], i) => {
    const x = 72 + (i % 3) * 320;
    const y = 1530 + Math.floor(i / 3) * 170;
    ctx.fillStyle = "#fff";
    ctx.font = "900 92px Archivo, sans-serif";
    ctx.fillText(String(v), x, y);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "700 26px 'JetBrains Mono', monospace";
    ctx.fillText(k, x, y + 44);
  });
  ctx.fillStyle = "#39ff14";
  ctx.font = "900 40px Archivo, sans-serif";
  ctx.fillText(d.type.title.toUpperCase(), 72, 1860);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
  const file = new File([blob], "nabs-season-wrapped.jpg", { type: "image/jpeg" });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: `${d.season.label} Wrapped` });
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
