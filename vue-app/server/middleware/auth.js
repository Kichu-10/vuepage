import jwt from "jsonwebtoken";
import { readDb } from "../database.js";

export function jwtSecret() {
  return process.env.JWT_SECRET || "change-this-secret-in-production";
}

export function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = jwt.verify(token, jwtSecret());
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

export function clientIp(req) {
  return req.socket.remoteAddress || "";
}

export function ipIsAllowed(req) {
  const allowlist = String(process.env.ADMIN_ALLOWED_IPS || "").split(",").map((item) => item.trim()).filter(Boolean);
  return allowlist.length === 0 || allowlist.includes(clientIp(req));
}

export function requireAdmin(req, res, next) {
  if (!ipIsAllowed(req)) return res.status(403).json({ error: "Admin access is not permitted from this network" });
  const user = readDb().users.find((item) => item.id === req.user.id);
  if (!user || user.role !== "admin" || user.status !== "active") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
