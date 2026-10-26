import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PORT, UPLOAD_DIR, IS_PROD } from "./config.js";
import { attachAuth } from "./auth.js";
import publicRoutes from "./routes/public.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import { attachLive } from "./live/relay.js";
import { publicSettings } from "./lib/settings.js";
import prisma from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(here, "../../frontend/dist");

const app = express();
app.disable("x-powered-by");
// Railway (and most hosts) sit behind one proxy; req.ip is then the visitor.
app.set("trust proxy", 1);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
});

// Uploaded downloads always come as a download, never shown in the browser
// (a file shown from our own address could run script on it), and under the
// download's title rather than the random name it is stored under.
app.get("/api/uploads/files/:name", async (req, res) => {
  const download = await prisma.download.findFirst({ where: { fileName: req.params.name } });
  if (!download) return res.status(404).send("Not found.");
  const ext = path.extname(download.fileName);
  const base = download.title.replace(/[^\w .()-]+/g, "").trim() || "download";
  res.download(path.join(UPLOAD_DIR, "files", download.fileName), base.endsWith(ext) ? base : base + ext);
});
app.use("/api/uploads/images", express.static(path.join(UPLOAD_DIR, "images"), { maxAge: "30d" }));

app.use(express.json({ limit: "15mb" }));
app.use("/api", attachAuth);
app.use("/api", authRoutes);
app.use("/api", publicRoutes);
app.use("/api", adminRoutes);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// The built site. Every page address answers with index.html (the browser
// app picks the page), with the league's name already in the title so a
// link shared in Discord shows it.
if (fs.existsSync(FRONTEND_DIST)) {
  const indexHtml = fs.readFileSync(path.join(FRONTEND_DIST, "index.html"), "utf8");
  app.use(express.static(FRONTEND_DIST, { index: false, maxAge: "1h" }));
  app.get("*", async (_req, res) => {
    const { leagueName, tagline } = await publicSettings();
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    res
      .type("html")
      .set("Cache-Control", "no-cache")
      .send(
        indexHtml
          .replace(/<title>.*?<\/title>/, `<title>${esc(leagueName)}</title>`)
          .replace("</head>", `<meta property="og:title" content="${esc(leagueName)}" />\n<meta name="description" content="${esc(tagline)}" />\n</head>`),
      );
  });
} else if (IS_PROD) {
  console.warn("frontend/dist is missing - run the build first.");
}

const server = app.listen(PORT, () => console.log(`Rain Racers on http://localhost:${PORT}`));
attachLive(server);
