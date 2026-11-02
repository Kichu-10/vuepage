import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import multer from "multer";
import { OAuth2Client } from "google-auth-library";
import nodemailer from "nodemailer";
import twilio from "twilio";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { readDb, writeDb } from "./database.js";
import { createAuthRouter } from "./routers/auth.js";
import { createWalletRouter } from "./routers/wallet.js";
import { createAdminRouter } from "./routers/admin.js";
import { backupSqlite } from "./database.js";
import { logger } from "./config/logger.js";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.local") });

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
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, ["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype));
  },
});

app.use("/api/auth", createAuthRouter());
app.use("/api/wallet", createWalletRouter(uploadDir));
app.use("/api/admin", createAdminRouter());

function addAudit(db, adminUsername, action, target, details = "") {
  db.auditLogs ||= [];
  db.auditLogs.unshift({
    id: randomUUID(),
    adminUsername,
    action,
    target,
    details,
    createdAt: new Date().toISOString(),
  });
  if (db.auditLogs.length > 1000) db.auditLogs.length = 1000;
}

function addNotification(db, userId, type, title, message, relatedId = "") {
  db.notifications ||= [];
  db.notifications.unshift({
    id: randomUUID(),
    userId,
    type,
    title,
    message,
    relatedId,
    read: false,
    createdAt: new Date().toISOString(),
  });
  if (db.notifications.length > 1000) db.notifications.length = 1000;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    phone: user.phone,
    role: user.role,
    balance: user.balance,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    email: user.email || "",
    country: user.country || "",
    fullName: user.fullName || "",
    dateOfBirth: user.dateOfBirth || "",
    kycStatus: user.kycStatus || "not_submitted",
    emailVerified: Boolean(user.emailVerified),
    phoneVerified: Boolean(user.phoneVerified),
    documentType: user.documentType || "",
    documentNumber: user.documentNumber || "",
    kycDocuments: user.kycDocuments || {},
  };
}

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

function otpHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function uniqueUsername(db, preferred) {
  const base = String(preferred || "user").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20) || "user";
  let candidate = base;
  let suffix = 1;
  while (db.users.some((item) => item.username?.toLowerCase() === candidate.toLowerCase())) {
    const ending = `_${suffix++}`;
    candidate = `${base.slice(0, Math.max(1, 20 - ending.length))}${ending}`;
  }
  return candidate;
}

async function sendOtp(channel, destination, code) {
  if (channel === "email" && process.env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      } : undefined,
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: destination,
      subject: "Your B9 verification code",
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    });
  } else if (channel === "sms" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      body: `Your B9 verification code is ${code}. It expires in 10 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: destination,
    });
  }
}

app.post("/api/auth/otp/send", async (req, res) => {
  const channel = req.body.channel === "sms" ? "sms" : "email";
  const destination = String(req.body.destination || "").trim();
  if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }
  if (channel === "sms" && !/^\+[1-9]\d{7,14}$/.test(destination)) {
    return res.status(400).json({ error: "Enter a phone number with country code, for example +91..." });
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const db = readDb();
  db.otps ||= [];
  db.otps = db.otps.filter((item) => item.destination !== destination && item.channel !== channel);
  db.otps.push({
    channel,
    destination,
    codeHash: otpHash(code),
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  writeDb(db);
  try {
    await sendOtp(channel, destination, code);
    res.json({
      message: `Verification code sent to ${destination}`,
    });
  } catch (error) {
    res.status(502).json({ error: "Could not deliver verification code" });
  }
});

app.post("/api/auth/otp/verify", (req, res) => {
  const channel = req.body.channel === "sms" ? "sms" : "email";
  const destination = String(req.body.destination || "").trim();
  const code = String(req.body.code || "").trim();
  const db = readDb();
  db.otps ||= [];
  const otp = db.otps.find((item) => item.channel === channel && item.destination === destination);
  if (!otp || otp.expiresAt < Date.now()) return res.status(400).json({ error: "Verification code expired or not found" });
  if (otp.codeHash !== otpHash(code)) return res.status(400).json({ error: "Invalid verification code" });
  db.otps = db.otps.filter((item) => item !== otp);
  db.verifications ||= {};
  db.verifications[`${channel}:${destination}`] = true;
  writeDb(db);
  res.json({ verified: true });
});

app.post("/api/auth/register", async (req, res) => {
  const username = String(req.body.username || "").trim().replace(/\s+/g, "");
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const country = req.body.country === "IN" ? "IN" : req.body.country === "PK" ? "PK" : "";
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-20 letters, numbers, or underscores" });
  }
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
  if (!country) return res.status(400).json({ error: "Select India or Pakistan" });
  const db = readDb();
  if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "Username already exists" });
  }
  if (db.users.some((user) => user.email?.toLowerCase() === email)) {
    return res.status(409).json({ error: "Email already registered" });
  }
  const user = {
    id: randomUUID(),
    username,
    phone: "",
    email,
    country,
    passwordHash: await bcrypt.hash(password, 12),
    role: "user",
    balance: 0,
    status: "active",
    emailVerified: false,
    phoneVerified: false,
    kycStatus: "not_submitted",
    kycDocuments: {},
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
  db.users.push(user);
  writeDb(db);
  const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: "7d" });
  res.status(201).json({ token, user: publicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const db = readDb();
  const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  if (user.status !== "active") return res.status(403).json({ error: "This account is suspended" });
  user.lastLoginAt = new Date().toISOString();
  writeDb(db);
  const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: "7d" });
  res.json({ token, user: publicUser(user) });
});

app.post("/api/auth/google", async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: "Google Sign-In is not configured" });
  try {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: String(req.body.credential || ""),
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) return res.status(401).json({ error: "Google account email is unavailable" });
    const requestedCountry = req.body.country === "IN" ? "IN" : req.body.country === "PK" ? "PK" : "";
    const db = readDb();
    let user = db.users.find((item) => item.email?.toLowerCase() === payload.email?.toLowerCase());
    if (!user) {
      if (!requestedCountry) return res.status(400).json({ error: "Select India or Pakistan before Google Sign-In" });
      user = {
        id: randomUUID(),
        username: uniqueUsername(db, payload.email.split("@")[0]),
        phone: "",
        email: payload.email.toLowerCase(),
        country: requestedCountry,
        passwordHash: await bcrypt.hash(randomUUID(), 12),
        role: "user",
        balance: 0,
        status: "active",
        emailVerified: true,
        phoneVerified: false,
        kycStatus: "not_submitted",
        kycDocuments: {},
        googleId: payload.sub,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
      db.users.push(user);
    }
    if (user.status !== "active") return res.status(403).json({ error: "This account is suspended" });
    user.googleId ||= payload.sub;
    user.emailVerified = true;
    if (!user.country && requestedCountry) user.country = requestedCountry;
    user.lastLoginAt = new Date().toISOString();
    writeDb(db);
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: "7d" });
    res.json({ token, user: publicUser(user) });
  } catch (error) {
    console.error("Google verification failed:", error instanceof Error ? error.message : error);
    const message = error instanceof Error ? error.message : "";
    if (!isProduction && message) {
      return res.status(401).json({ error: `Google verification failed: ${message}` });
    }
    res.status(401).json({ error: "Google verification failed" });
  }
});

app.post("/api/admin/auth/login", async (req, res) => {
  if (!ipIsAllowed(req)) return res.status(403).json({ error: "Admin access is not permitted from this network" });
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const db = readDb();
  const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase() && item.role === "admin");
  if (user?.lockedUntil && Number(user.lockedUntil) > Date.now()) {
    return res.status(423).json({ error: "Admin login temporarily locked" });
  }
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    if (user) {
      user.failedAdminAttempts = Number(user.failedAdminAttempts || 0) + 1;
      if (user.failedAdminAttempts >= 5) {
        user.lockedUntil = Date.now() + 15 * 60 * 1000;
        user.failedAdminAttempts = 0;
      }
      writeDb(db);
    }
    return res.status(401).json({ error: "Invalid admin credentials" });
  }
  if (user.status !== "active") return res.status(403).json({ error: "Admin account is suspended" });
  user.failedAdminAttempts = 0;
  user.lockedUntil = 0;
  user.lastLoginAt = new Date().toISOString();
  writeDb(db);
  const token = jwt.sign({ id: user.id, role: "admin" }, jwtSecret, { expiresIn: "8h" });
  res.json({ token, user: publicUser(user) });
});

app.get("/api/auth/me", auth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user || user.status !== "active") return res.status(403).json({ error: "Account unavailable" });
  res.json({ user: publicUser(user) });
});

app.post(
  "/api/auth/kyc",
  auth,
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
    { name: "selfie", maxCount: 1 },
  ]),
  (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user || user.status !== "active") return res.status(403).json({ error: "Account unavailable" });
    const country = req.body.country === "IN" ? "IN" : req.body.country === "PK" ? "PK" : "";
    const fullName = String(req.body.fullName || "").trim();
    const dateOfBirth = String(req.body.dateOfBirth || "").trim();
    const documentType = String(req.body.documentType || "").trim();
    const documentNumber = String(req.body.documentNumber || "").trim();
    const files = req.files || {};
    if (!country || !fullName || !dateOfBirth || !documentType || !documentNumber) {
      return res.status(400).json({ error: "Complete every KYC field" });
    }
    const validDocumentType = country === "IN"
      ? ["aadhaar", "pan", "passport"].includes(documentType)
      : ["cnic", "passport"].includes(documentType);
    if (!validDocumentType) return res.status(400).json({ error: "Select a valid document type for the chosen country" });
    if (!files.front || !files.selfie || (country === "PK" && documentType === "cnic" && !files.back)) {
      return res.status(400).json({ error: country === "PK" && documentType === "cnic" ? "Upload CNIC front, back, and selfie" : "Upload front and selfie" });
    }
    const saveName = (file) => file ? `/uploads/${path.basename(file.path)}` : "";
    for (const documentUrl of Object.values(user.kycDocuments || {})) {
      const oldName = path.basename(String(documentUrl || ""));
      const oldPath = path.join(uploadDir, oldName);
      if (oldName && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    user.country = country;
    user.fullName = fullName;
    user.dateOfBirth = dateOfBirth;
    user.documentType = documentType;
    user.documentNumber = documentNumber;
    user.address = String(req.body.address || "").trim();
    user.kycStatus = "pending";
    user.kycDocuments = {
      front: saveName(files.front?.[0]),
      back: saveName(files.back?.[0]),
      selfie: saveName(files.selfie?.[0]),
    };
    writeDb(db);
    addNotification(db, user.id, "kyc", "KYC submitted", "Your identity documents are pending administrator review.", user.id);
    writeDb(db);
    res.status(201).json({ message: "KYC submitted for review", user: publicUser(user) });
  },
);

app.post("/api/wallet/play", auth, (req, res) => {
  res.status(503).json({ error: "Game provider is not connected. This account will not be charged." });
});

app.post("/api/wallet/request", auth, upload.single("proof"), (req, res) => {
  const type = req.body.type === "withdrawal" ? "withdrawal" : "deposit";
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 100) return res.status(400).json({ error: "Minimum amount is Rs. 100" });
  if (amount > 100000000) return res.status(400).json({ error: "Amount is too large" });
  const roundedAmount = Number(amount.toFixed(2));
  const paymentReference = String(req.body.paymentReference || "").trim();
  const paymentNote = String(req.body.paymentNote || "").trim();
  const paymentMethod = String(req.body.paymentMethod || "").trim();
  if (type === "deposit" && !req.file) return res.status(400).json({ error: "Payment receipt or screenshot is required" });
  if (type === "deposit" && !paymentReference) return res.status(400).json({ error: "Payment reference is required" });
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user || user.status !== "active") return res.status(403).json({ error: "Account unavailable" });
  if (type === "withdrawal") {
    if ((user.kycStatus || "not_submitted") !== "verified") {
      return res.status(403).json({ error: "Complete KYC verification before requesting a withdrawal" });
    }
    if (!paymentMethod) return res.status(400).json({ error: "Withdrawal destination is required" });
    if (!paymentNote || paymentNote.length < 6) return res.status(400).json({ error: "Enter valid bank, UPI, or wallet account details" });
    const reserved = db.transactions
      .filter((item) => item.userId === user.id && item.type === "withdrawal" && item.status === "pending")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const availableBalance = Number((Number(user.balance || 0) - reserved).toFixed(2));
    if (availableBalance < roundedAmount) return res.status(400).json({ error: "Insufficient available balance" });
  }
  db.transactions.unshift({
    id: randomUUID(),
    userId: user.id,
    username: user.username,
    type,
    amount: roundedAmount,
    status: "pending",
    paymentMethod,
    paymentReference,
    paymentNote,
    proofFile: req.file ? req.file.filename : "",
    createdAt: new Date().toISOString(),
  });
  addNotification(
    db,
    user.id,
    type,
    `${type === "deposit" ? "Deposit" : "Withdrawal"} request submitted`,
    `Rs. ${amount.toLocaleString("en-US")} is pending administrator review.`,
    db.transactions[0].id,
  );
  writeDb(db);
  res.status(201).json({ message: `${type === "deposit" ? "Deposit" : "Withdrawal"} request submitted`, balance: user.balance });
});

app.get("/api/wallet/transactions", auth, (req, res) => {
  const db = readDb();
  const transactions = db.transactions
    .filter((item) => item.userId === req.user.id)
    .slice(0, 100);
  res.json({ transactions });
});

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

app.get("/api/admin/stats", auth, admin, (req, res) => {
  const db = readDb();
  const pending = db.transactions.filter((item) => item.status === "pending").length;
  const users = db.users.filter((item) => item.role !== "admin");
  const approvedDeposits = db.transactions.filter((item) => item.type === "deposit" && item.status === "approved");
  const approvedWithdrawals = db.transactions.filter((item) => item.type === "withdrawal" && item.status === "approved");
  res.json({
    totalUsers: users.length,
    activeUsers: users.filter((item) => item.status === "active").length,
    totalBalance: Number(users.reduce((sum, item) => sum + item.balance, 0).toFixed(2)),
    pendingRequests: pending,
    indiaUsers: users.filter((item) => item.country === "IN").length,
    pakistanUsers: users.filter((item) => item.country === "PK").length,
    pendingKyc: users.filter((item) => item.kycStatus === "pending").length,
    approvedDeposits: Number(approvedDeposits.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)),
    approvedWithdrawals: Number(approvedWithdrawals.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)),
  });
});

app.get("/api/admin/activity", auth, admin, (req, res) => {
  const db = readDb();
  res.json({ logs: (db.auditLogs || []).slice(0, 100) });
});

app.get("/api/admin/settings", auth, admin, (req, res) => {
  const db = readDb();
  res.json({ settings: db.platformSettings || {} });
});

app.patch("/api/admin/settings", auth, admin, (req, res) => {
  const db = readDb();
  db.platformSettings = {
    announcement: String(req.body.announcement || "").trim(),
    maintenanceMode: Boolean(req.body.maintenanceMode),
    supportEmail: String(req.body.supportEmail || "").trim(),
    supportPhone: String(req.body.supportPhone || "").trim(),
    supportHours: String(req.body.supportHours || "").trim(),
  };
  const adminUser = db.users.find((item) => item.id === req.user.id);
  addAudit(db, adminUser?.username || "admin", "SETTINGS_UPDATED", "Platform settings", "Announcement and support settings updated");
  writeDb(db);
  res.json({ settings: db.platformSettings });
});

app.post("/api/support/tickets", auth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const subject = String(req.body.subject || "").trim();
  const message = String(req.body.message || "").trim();
  if (!subject || !message) return res.status(400).json({ error: "Subject and message are required" });
  db.supportTickets ||= [];
  const ticket = {
    id: randomUUID(),
    userId: user.id,
    username: user.username,
    subject,
    message,
    status: "open",
    reply: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.supportTickets.unshift(ticket);
  if (db.supportTickets.length > 500) db.supportTickets.length = 500;
  writeDb(db);
  res.status(201).json({ ticket });
});

app.get("/api/support/tickets", auth, (req, res) => {
  const db = readDb();
  res.json({ tickets: (db.supportTickets || []).filter((item) => item.userId === req.user.id).slice(0, 50) });
});

app.get("/api/admin/support", auth, admin, (req, res) => {
  const db = readDb();
  res.json({ tickets: (db.supportTickets || []).slice(0, 100) });
});

app.patch("/api/admin/support/:id", auth, admin, (req, res) => {
  const db = readDb();
  const ticket = db.supportTickets?.find((item) => item.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: "Support ticket not found" });
  if (!["open", "pending", "resolved"].includes(req.body.status)) return res.status(400).json({ error: "Invalid ticket status" });
  ticket.status = req.body.status;
  ticket.reply = String(req.body.reply || "").trim();
  ticket.updatedAt = new Date().toISOString();
  const user = db.users.find((item) => item.id === ticket.userId);
  if (user && ticket.reply) addNotification(db, user.id, "support", "Support reply received", ticket.reply, ticket.id);
  const adminUser = db.users.find((item) => item.id === req.user.id);
  addAudit(db, adminUser?.username || "admin", "SUPPORT_TICKET_UPDATED", ticket.username, `${ticket.status} · ${ticket.subject}`);
  writeDb(db);
  res.json({ ticket });
});

app.get("/api/admin/users", auth, admin, (req, res) => {
  const db = readDb();
  res.json({ users: db.users.filter((item) => item.role !== "admin").map(publicUser) });
});

app.get("/api/admin/transactions", auth, admin, (req, res) => {
  const db = readDb();
  res.json({ transactions: db.transactions.slice(0, 100) });
});

app.patch("/api/admin/users/:id", auth, admin, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const adminUser = db.users.find((item) => item.id === req.user.id);
  if (typeof req.body.status === "string" && ["active", "suspended"].includes(req.body.status)) {
    user.status = req.body.status;
    addAudit(db, adminUser?.username || "admin", "USER_STATUS_CHANGED", user.username, `Status changed to ${req.body.status}`);
  }
  if (typeof req.body.balance === "number" && Number.isFinite(req.body.balance) && req.body.balance >= 0) {
    const previousBalance = Number(user.balance || 0);
    user.balance = Number(req.body.balance.toFixed(2));
    addAudit(db, adminUser?.username || "admin", "BALANCE_ADJUSTED", user.username, `Rs. ${previousBalance} -> Rs. ${user.balance}; ${String(req.body.reason || "Manual adjustment").trim()}`);
  }
  writeDb(db);
  res.json({ user: publicUser(user) });
});

app.patch("/api/admin/users/:id/kyc", auth, admin, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!["verified", "rejected"].includes(req.body.status)) return res.status(400).json({ error: "Invalid KYC status" });
  const adminUser = db.users.find((item) => item.id === req.user.id);
  user.kycStatus = req.body.status;
  user.kycReviewedAt = new Date().toISOString();
  user.kycReviewNote = String(req.body.note || "");
  addAudit(db, adminUser?.username || "admin", req.body.status === "verified" ? "KYC_VERIFIED" : "KYC_REJECTED", user.username, String(req.body.note || ""));
  db.notifications ||= [];
  addNotification(
    db,
    user.id,
    "kyc",
    req.body.status === "verified" ? "KYC verification approved" : "KYC verification rejected",
    req.body.status === "verified"
      ? "Your identity verification has been approved."
      : `Your identity verification was rejected${req.body.note ? `: ${String(req.body.note).trim()}` : "."}`,
  );
  writeDb(db);
  res.json({ user: publicUser(user) });
});

app.patch("/api/admin/transactions/:id", auth, admin, (req, res) => {
  const db = readDb();
  const transaction = db.transactions.find((item) => item.id === req.params.id);
  if (!transaction) return res.status(404).json({ error: "Transaction not found" });
  if (!["approved", "rejected"].includes(req.body.status)) return res.status(400).json({ error: "Invalid status" });
  if (transaction.status !== "pending") return res.status(409).json({ error: "Request already processed" });
  const adminUser = db.users.find((item) => item.id === req.user.id);
  transaction.status = req.body.status;
  transaction.processedAt = new Date().toISOString();
  const user = db.users.find((item) => item.id === transaction.userId);
  if (user && req.body.status === "approved") {
    if (transaction.type === "withdrawal" && user.balance < transaction.amount) {
      return res.status(409).json({ error: "Insufficient balance to approve this withdrawal" });
    }
    user.balance = Number((user.balance + (transaction.type === "deposit" ? transaction.amount : -transaction.amount)).toFixed(2));
    if (user.balance < 0) user.balance = 0;
  }
  if (user) {
    addNotification(
      db,
      user.id,
      transaction.type,
      `${transaction.type === "deposit" ? "Deposit" : "Withdrawal"} ${req.body.status}`,
      req.body.status === "approved"
        ? `Rs. ${Number(transaction.amount).toLocaleString("en-US")} was ${transaction.type === "deposit" ? "added to" : "deducted from"} your wallet.`
        : `Your Rs. ${Number(transaction.amount).toLocaleString("en-US")} ${transaction.type} request was rejected.`,
      transaction.id,
    );
  }
  addAudit(
    db,
    adminUser?.username || "admin",
    transaction.type === "deposit" ? (req.body.status === "approved" ? "DEPOSIT_APPROVED" : "DEPOSIT_REJECTED") : (req.body.status === "approved" ? "WITHDRAWAL_APPROVED" : "WITHDRAWAL_REJECTED"),
    transaction.username || user?.username || transaction.userId,
    `Rs. ${Number(transaction.amount).toLocaleString("en-US")} · Ref: ${transaction.paymentReference || "N/A"}`,
  );
  writeDb(db);
  res.json({ transaction, balance: user ? user.balance : 0 });
});

app.post("/api/admin/game-results", auth, admin, (req, res) => {
  const { userId, category, gameName, outcome, amount, reference } = req.body;
  if (!["bet", "lottery", "game"].includes(category)) return res.status(400).json({ error: "Invalid result category" });
  if (!["won", "lost"].includes(outcome)) return res.status(400).json({ error: "Invalid game outcome" });
  const winnings = Number(amount);
  if (!Number.isFinite(winnings) || winnings < 0) return res.status(400).json({ error: "Invalid winnings amount" });
  const db = readDb();
  const user = db.users.find((item) => item.id === userId && item.role !== "admin");
  if (!user) return res.status(404).json({ error: "User not found" });
  const adminUser = db.users.find((item) => item.id === req.user.id);
  if (outcome === "won" && winnings > 0) {
    user.balance = Number((user.balance + winnings).toFixed(2));
  }
  const eventId = String(reference || randomUUID()).trim();
  db.transactions.unshift({
    id: eventId,
    userId: user.id,
    username: user.username,
    type: category,
    amount: outcome === "won" ? winnings : 0,
    status: outcome === "won" ? "won" : "lost",
    gameName: String(gameName || category),
    createdAt: new Date().toISOString(),
  });
  addNotification(
    db,
    user.id,
    category,
    outcome === "won"
      ? `${category === "lottery" ? "Lottery win" : category === "bet" ? "Bet win" : "Game win"}: ${String(gameName || "")}`
      : `${category === "lottery" ? "Lottery result" : category === "bet" ? "Bet result" : "Game result"}`,
    outcome === "won"
      ? `You won Rs. ${winnings.toLocaleString("en-US")} and the amount has been added to your wallet.`
      : `Your ${category === "lottery" ? "lottery" : category === "bet" ? "bet" : "game"} result was recorded as no win.`,
    eventId,
  );
  addAudit(db, adminUser?.username || "admin", "GAME_RESULT_RECORDED", user.username, `${category} · ${gameName || category} · ${outcome} · Rs. ${winnings} · Ref: ${eventId}`);
  writeDb(db);
  res.status(201).json({ message: "Game result recorded", user: publicUser(user) });
});

await seedAdmin();
app.listen(port, () => console.log(`API server running on http://127.0.0.1:${port}`));
