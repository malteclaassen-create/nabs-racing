// Rasterise an inline <svg> (e.g. a circuit outline) to a PNG the user can
// download and annotate. The stroke is inlined explicitly because the on-page
// SVG usually paints with `currentColor`, which wouldn't resolve in a
// standalone image. Transparent background by default so it drops onto anything.
export async function exportSvgToPng(svgEl, { width = 2000, background = "transparent", stroke = "#0f172a", fileName = "circuit.png" } = {}) {
  if (!svgEl) return;
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  // Aspect ratio from the viewBox.
  const vb = (svgEl.getAttribute("viewBox") || "0 0 100 100").split(/\s+/).map(Number);
  const vbW = vb[2] || 100;
  const vbH = vb[3] || 100;
  const height = Math.round((width * vbH) / vbW);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  // Inline the stroke on every path (currentColor won't resolve standalone).
  for (const path of clone.querySelectorAll("path")) {
    path.setAttribute("stroke", stroke);
    path.removeAttribute("class"); // drop animation classes
    path.style && (path.style.animation = "none");
  }
  // Drop the looping "car" trace overlay (2nd path) — a clean single outline.
  const paths = clone.querySelectorAll("path");
  if (paths.length > 1) paths[paths.length - 1].remove();

  const svgText = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Could not render the circuit image"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (background && background !== "transparent") {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
