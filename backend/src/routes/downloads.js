// ---------------------------------------------------------------------------
// Member-only download catalogue. Everything here requires a logged-in Discord
// member, except the actual file stream, which is gated by a short-lived ticket
// (a browser download can't send an Authorization header, so the member trades
// their session for a ticket first — see /:id/ticket).
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireUser, signDownloadTicket, verifyDownloadTicket } from "../middleware/auth.js";
import {
  dbListDownloads, dbGetDownload, statFile, resolveDownloadPath, fmtSize,
} from "../lib/downloads.js";

const router = Router();

// GET /api/downloads — the published catalogue (members only).
router.get("/", requireUser, async (req, res, next) => {
  try {
    const rows = await dbListDownloads(prisma, { publishedOnly: true });
    const downloads = rows.map((r) => {
      const st = statFile(r.fileName);
      const external = !!r.externalUrl;
      return {
        id: r.id,
        title: r.title,
        category: r.category,
        description: r.description ?? null,
        version: r.version ?? null,
        installNote: r.installNote ?? null,
        external,
        available: external ? true : st.exists,
        size: external ? null : st.size,
        sizeText: external ? null : fmtSize(st.size),
      };
    });
    res.json({ downloads });
  } catch (e) { next(e); }
});

// POST /api/downloads/:id/ticket — members only. Returns a download URL: a
// short-lived, ticketed link for a self-hosted file, or the external link.
router.post("/:id/ticket", requireUser, async (req, res, next) => {
  try {
    const d = await dbGetDownload(prisma, req.params.id);
    if (!d || !Number(d.published)) return res.status(404).json({ error: "Not found" });
    if (d.externalUrl) return res.json({ url: d.externalUrl, external: true });
    if (!statFile(d.fileName).exists) return res.status(404).json({ error: "File not available yet" });
    const ticket = signDownloadTicket(d.id);
    res.json({ url: `/api/downloads/${d.id}/file?ticket=${encodeURIComponent(ticket)}`, external: false });
  } catch (e) { next(e); }
});

// GET /api/downloads/:id/file?ticket=... — streams the file with HTTP range /
// resume support (res.download -> sendFile). Gated by the ticket, not a session.
router.get("/:id/file", async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!verifyDownloadTicket(req.query.ticket, id)) {
      return res.status(403).json({ error: "Invalid or expired download link" });
    }
    const d = await dbGetDownload(prisma, id);
    if (!d || !Number(d.published)) return res.status(404).json({ error: "Not found" });
    const path = resolveDownloadPath(d.fileName);
    if (!path || !statFile(d.fileName).exists) return res.status(404).json({ error: "File not available" });
    res.download(path, d.fileName);
  } catch (e) { next(e); }
});

export default router;
