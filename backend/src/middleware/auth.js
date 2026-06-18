import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Sign a short admin token.
export function signAdminToken() {
  return jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
}

// Sign a token for a logged-in driver (via Discord).
export function signUserToken(payload) {
  return jwt.sign({ role: "user", ...payload }, JWT_SECRET, { expiresIn: "30d" });
}

// Reads & verifies a user token if present; sets req.user. Never blocks.
export function optionalUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.role === "user") req.user = payload;
    } catch {
      /* ignore invalid token */
    }
  }
  next();
}

// Express middleware: requires a valid admin JWT in the Authorization header.
export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") throw new Error("not admin");
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
