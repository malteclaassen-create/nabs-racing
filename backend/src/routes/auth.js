import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import { signAdminToken } from "../middleware/auth.js";

const router = Router();

// Brake against PIN guessing: after MAX_FAILS wrong attempts from the same
// address, further tries are rejected until the window has passed. In-memory
// on purpose (resets on server restart — fine for this: it only needs to make
// brute-forcing impractical, not survive reboots).
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;
const failsByIp = new Map(); // ip -> { count, first }

function tooManyFails(ip) {
  const rec = failsByIp.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > FAIL_WINDOW_MS) {
    failsByIp.delete(ip);
    return false;
  }
  return rec.count >= MAX_FAILS;
}

function recordFail(ip) {
  const rec = failsByIp.get(ip);
  if (!rec || Date.now() - rec.first > FAIL_WINDOW_MS) {
    failsByIp.set(ip, { count: 1, first: Date.now() });
  } else {
    rec.count++;
  }
}

// POST /api/admin/login  { pin }
router.post("/login", async (req, res, next) => {
  try {
    const ip = req.ip || "unknown";
    if (tooManyFails(ip)) {
      return res.status(429).json({ error: "Too many wrong attempts. Try again in 15 minutes." });
    }

    const { pin } = req.body || {};
    if (!pin) return res.status(400).json({ error: "PIN required" });

    const setting = await prisma.setting.findUnique({ where: { key: "admin_pin_hash" } });
    if (!setting) return res.status(500).json({ error: "Admin PIN not configured" });

    const ok = await bcrypt.compare(String(pin), setting.value);
    if (!ok) {
      recordFail(ip);
      return res.status(401).json({ error: "Invalid PIN" });
    }

    failsByIp.delete(ip);
    res.json({ token: signAdminToken() });
  } catch (e) {
    next(e);
  }
});

export default router;
