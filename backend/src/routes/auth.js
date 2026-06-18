import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import { signAdminToken } from "../middleware/auth.js";

const router = Router();

// POST /api/admin/login  { pin }
router.post("/login", async (req, res, next) => {
  try {
    const { pin } = req.body || {};
    if (!pin) return res.status(400).json({ error: "PIN required" });

    const setting = await prisma.setting.findUnique({ where: { key: "admin_pin_hash" } });
    if (!setting) return res.status(500).json({ error: "Admin PIN not configured" });

    const ok = await bcrypt.compare(String(pin), setting.value);
    if (!ok) return res.status(401).json({ error: "Invalid PIN" });

    res.json({ token: signAdminToken() });
  } catch (e) {
    next(e);
  }
});

export default router;
