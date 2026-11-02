import express from "express";
import * as Sentry from "@sentry/node";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { readDb, writeDb } from "./database.js";
import { createAuthRouter, createAdminAuthRouter } from "./routers/auth.js";
import { createWalletRouter } from "./routers/wallet.js";
import { createAdminRouter } from "./routers/admin.js";
import { createKycRouter } from "./routers/kyc.js";
import { createSupportRouter } from "./routers/support.js";
import { createGamesRouter } from "./routers/games.js";
import { backupSqlite } from "./database.js";
import { logger } from "./config/logger.js";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.local") });
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    sendDefaultPii: false,
  });
}

const app = express();
const port = Number(process.env.PORT || 3001);
const jwtSecret = process.env.JWT_SECRET || "change-this-secret-in-production";
const isProduction = process.env.NODE_ENV === "production";
if (isProduction && (!process.env.JWT_SECRET || jwtSecret.length < 32)) {
  throw new Error("JWT_SECRET must contain at least 32 characters in production");
}
if (isProduction && !process.env.ADMIN_PASSWORD) {
  throw new Error("ADMIN_PASSWORD is required in production");
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: "1mb" }));
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false }));
app.use("/api/admin/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }));
app.use("/api/admin", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
  next();
});
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/payment/details", (_req, res) => {
  res.json({
    bankName: process.env.MANUAL_PAYMENT_BANK_NAME || "Admin will provide bank details",
    accountName: process.env.MANUAL_PAYMENT_ACCOUNT_NAME || "",
    accountNumber: process.env.MANUAL_PAYMENT_ACCOUNT_NUMBER || "",
    iban: process.env.MANUAL_PAYMENT_IBAN || "",
    upiId: process.env.MANUAL_PAYMENT_UPI_ID || "",
    walletName: process.env.MANUAL_PAYMENT_WALLET_NAME || "",
    walletNumber: process.env.MANUAL_PAYMENT_WALLET_NUMBER || "",
    instructions: process.env.MANUAL_PAYMENT_INSTRUCTIONS || "Transfer the exact amount, then submit the request with your payment reference and proof.",
  });
});

app.get("/api/platform/settings", (_req, res) => {
  const db = readDb();
  const settings = db.platformSettings || {};
  res.json({
    announcement: settings.announcement || "Get 100% Bonus on Your First Deposit & Start Winning!",
    maintenanceMode: Boolean(settings.maintenanceMode),
    supportEmail: settings.supportEmail || "",
    supportPhone: settings.supportPhone || "",
    supportHours: settings.supportHours || "24/7",
  });
});
const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
app.use("/api/auth", createAuthRouter());
app.use("/api/wallet", createWalletRouter(uploadDir));
app.use("/api/auth", createKycRouter(uploadDir));
app.use("/api/admin", createAdminAuthRouter());
app.use("/api/admin", createAdminRouter());
app.use("/api", createSupportRouter());
app.use("/api/games", createGamesRouter());

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

function admin(req, res, next) {
  if (!ipIsAllowed(req)) {
    return res.status(403).json({ error: "Admin access is not permitted from this network" });
  }
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user || user.role !== "admin" || user.status !== "active") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0]?.trim();
  return forwarded || req.ip || req.socket.remoteAddress || "";
}

function ipIsAllowed(req) {
  const allowlist = String(process.env.ADMIN_ALLOWED_IPS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return allowlist.length === 0 || allowlist.includes(clientIp(req));
}

app.get("/uploads/:filename", auth, admin, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Document not found" });
  res.sendFile(filePath);
});

async function seedAdmin() {
  const db = readDb();
  const configuredUsername = process.env.ADMIN_USERNAME?.trim();
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredUsername || !configuredPassword) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD are required");
  }
  let admin = db.users.find((user) => user.role === "admin");
  if (!admin) {
    db.users.push({
      id: randomUUID(),
      username: configuredUsername,
      phone: "",
      passwordHash: await bcrypt.hash(configuredPassword, 12),
      role: "admin",
      balance: 0,
      status: "active",
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });
    writeDb(db);
  } else {
    admin.username = configuredUsername;
    if (!(await bcrypt.compare(configuredPassword, admin.passwordHash || ""))) {
      admin.passwordHash = await bcrypt.hash(configuredPassword, 12);
    }
    admin.status = "active";
    writeDb(db);
  }
}

app.get("/api/inbox", auth, (req, res) => {
  const db = readDb();
  const notifications = (db.notifications || [])
    .filter((item) => item.userId === req.user.id)
    .slice(0, 100);
  res.json({
    notifications,
    unreadCount: notifications.filter((item) => !item.read).length,
  });
});

app.patch("/api/inbox/read", auth, (req, res) => {
  const db = readDb();
  db.notifications ||= [];
  for (const item of db.notifications) {
    if (item.userId === req.user.id) item.read = true;
  }
  writeDb(db);
  res.json({ unreadCount: 0 });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const requestId = req.headers["x-request-id"] || randomUUID();
  logger.error("request_failed", {
    requestId,
    method: req.method,
    path: req.path,
    error: error instanceof Error ? error.message : String(error),
  });
  if (process.env.SENTRY_DSN) Sentry.captureException(error, { tags: { requestId } });
  res.status(500).json({ error: "Internal server error", requestId });
});

await seedAdmin();
const backupDir = path.join(__dirname, "backups");
const runDatabaseBackup = () => {
  try {
    const backupPath = backupSqlite(backupDir);
    logger.info("database_backup_completed", { backupPath });
  } catch (error) {
    logger.error("database_backup_failed", { error: error instanceof Error ? error.message : String(error) });
  }
};
runDatabaseBackup();
const backupInterval = Math.max(60_000, Number(process.env.DB_BACKUP_INTERVAL_MS || 86_400_000));
const backupTimer = setInterval(runDatabaseBackup, backupInterval);
backupTimer.unref();
app.listen(port, () => logger.info("api_server_started", { host: "127.0.0.1", port }));
