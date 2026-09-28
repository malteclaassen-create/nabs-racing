// ---------------------------------------------------------------------------
// GET /api/changelog
//
// The site's commit count and the changelog entries of recently merged pull
// requests, read from GitHub and cached for an hour (lib/changelogFeed.js).
// Public, like the page it feeds. Never fails: without GitHub it answers with
// what it had, or with nothing, and the page shows the hand-written history.
// ---------------------------------------------------------------------------
import { Router } from "express";
import { getChangelogFeed } from "../lib/changelogFeed.js";

const router = Router();

router.get("/", async (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(await getChangelogFeed());
});

export default router;
