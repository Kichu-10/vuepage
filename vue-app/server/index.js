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

const app = express();
const port = Number(process.env.PORT || 3001);
const jwtSecret = process.env.JWT_SECRET || "change-this-secret-in-production";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(__dirname, "database.json");

app.use(express.json({ limit: "1mb" }));
const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, ["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype));
  },
});

function readDb() {
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify({ users: [], transactions: [], otps: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

function writeDb(db) {
  const tempFile = `${dataFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, dataFile);
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
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user || user.role !== "admin" || user.status !== "active") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

app.get("/uploads/:filename", auth, admin, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Document not found" });
  res.sendFile(filePath);
});

async function seedAdmin() {
  const db = readDb();
  if (!db.users.some((user) => user.role === "admin")) {
    db.users.push({
      id: randomUUID(),
      username: process.env.ADMIN_USERNAME || "admin",
      phone: "",
      passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || "admin123", 12),
      role: "admin",
      balance: 0,
      status: "active",
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });
    writeDb(db);
  }
}

function otpHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
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
    return res.status(400).json({ error: "Enter a phone number with country code, for example +977..." });
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
      devCode: process.env.OTP_DEV_MODE === "true" || (!process.env.SMTP_HOST && !process.env.TWILIO_ACCOUNT_SID) ? code : undefined,
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
  const phone = String(req.body.phone || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const country = req.body.country === "IN" ? "IN" : req.body.country === "NP" ? "NP" : "";
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-20 letters, numbers, or underscores" });
  }
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (!country) return res.status(400).json({ error: "Select Nepal or India" });
  if (!email || !phone) return res.status(400).json({ error: "Email and phone are required" });
  const db = readDb();
  db.verifications ||= {};
  if (!db.verifications[`email:${email}`]) return res.status(403).json({ error: "Verify your email first" });
  if (!db.verifications[`sms:${phone}`]) return res.status(403).json({ error: "Verify your phone first" });
  if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "Username already exists" });
  }
  if (db.users.some((user) => user.email?.toLowerCase() === email)) {
    return res.status(409).json({ error: "Email already registered" });
  }
  if (db.users.some((user) => user.phone === phone)) {
    return res.status(409).json({ error: "Phone number already registered" });
  }
  const user = {
    id: randomUUID(),
    username,
    phone,
    email,
    country,
    passwordHash: await bcrypt.hash(password, 12),
    role: "user",
    balance: 0,
    status: "active",
    emailVerified: true,
    phoneVerified: true,
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
    const db = readDb();
    let user = db.users.find((item) => item.email?.toLowerCase() === payload.email?.toLowerCase());
    if (!user) {
      user = {
        id: randomUUID(),
        username: String(payload.email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "_")).slice(0, 20),
        phone: "",
        email: payload.email.toLowerCase(),
        country: "",
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
    user.lastLoginAt = new Date().toISOString();
    writeDb(db);
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: "7d" });
    res.json({ token, user: publicUser(user) });
  } catch {
    res.status(401).json({ error: "Google verification failed" });
  }
});

app.post("/api/admin/auth/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const db = readDb();
  const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase() && item.role === "admin");
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid admin credentials" });
  }
  if (user.status !== "active") return res.status(403).json({ error: "Admin account is suspended" });
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
    const country = req.body.country === "IN" ? "IN" : req.body.country === "NP" ? "NP" : "";
    const fullName = String(req.body.fullName || "").trim();
    const dateOfBirth = String(req.body.dateOfBirth || "").trim();
    const documentType = String(req.body.documentType || "").trim();
    const documentNumber = String(req.body.documentNumber || "").trim();
    const files = req.files || {};
    if (!country || !fullName || !dateOfBirth || !documentType || !documentNumber) {
      return res.status(400).json({ error: "Complete every KYC field" });
    }
    if (!files.front || !files.selfie || (country === "NP" && !files.back)) {
      return res.status(400).json({ error: country === "NP" ? "Upload front, back, and selfie" : "Upload front and selfie" });
    }
    const saveName = (file) => file ? `/uploads/${path.basename(file.path)}` : "";
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
    res.status(201).json({ message: "KYC submitted for review", user: publicUser(user) });
  },
);

app.post("/api/wallet/play", auth, (req, res) => {
  const bet = 10;
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user || user.status !== "active") return res.status(403).json({ error: "Account unavailable" });
  if (user.balance < bet) return res.status(400).json({ error: "Low balance" });
  const win = Math.random() < 0.45 ? Math.round(bet * (1 + Math.random() * 4)) : 0;
  user.balance = Number((user.balance - bet + win).toFixed(2));
  db.transactions.unshift({
    id: randomUUID(),
    userId: user.id,
    username: user.username,
    type: "play",
    amount: win ? win - bet : -bet,
    status: "completed",
    createdAt: new Date().toISOString(),
  });
  writeDb(db);
  res.json({ balance: user.balance, win, netChange: win ? win - bet : -bet });
});

app.post("/api/wallet/request", auth, (req, res) => {
  const type = req.body.type === "withdrawal" ? "withdrawal" : "deposit";
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 100) return res.status(400).json({ error: "Minimum amount is Rs. 100" });
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user || user.status !== "active") return res.status(403).json({ error: "Account unavailable" });
  if (type === "withdrawal" && user.balance < amount) return res.status(400).json({ error: "Insufficient balance" });
  db.transactions.unshift({
    id: randomUUID(),
    userId: user.id,
    username: user.username,
    type,
    amount,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  writeDb(db);
  res.status(201).json({ message: `${type === "deposit" ? "Deposit" : "Withdrawal"} request submitted`, balance: user.balance });
});

app.get("/api/admin/stats", auth, admin, (req, res) => {
  const db = readDb();
  const pending = db.transactions.filter((item) => item.status === "pending").length;
  const users = db.users.filter((item) => item.role !== "admin");
  res.json({
    totalUsers: users.length,
    activeUsers: users.filter((item) => item.status === "active").length,
    totalBalance: Number(users.reduce((sum, item) => sum + item.balance, 0).toFixed(2)),
    pendingRequests: pending,
  });
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
  if (typeof req.body.status === "string" && ["active", "suspended"].includes(req.body.status)) {
    user.status = req.body.status;
  }
  if (typeof req.body.balance === "number" && Number.isFinite(req.body.balance) && req.body.balance >= 0) {
    user.balance = Number(req.body.balance.toFixed(2));
  }
  writeDb(db);
  res.json({ user: publicUser(user) });
});

app.patch("/api/admin/users/:id/kyc", auth, admin, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!["verified", "rejected"].includes(req.body.status)) return res.status(400).json({ error: "Invalid KYC status" });
  user.kycStatus = req.body.status;
  user.kycReviewedAt = new Date().toISOString();
  user.kycReviewNote = String(req.body.note || "");
  writeDb(db);
  res.json({ user: publicUser(user) });
});

app.patch("/api/admin/transactions/:id", auth, admin, (req, res) => {
  const db = readDb();
  const transaction = db.transactions.find((item) => item.id === req.params.id);
  if (!transaction) return res.status(404).json({ error: "Transaction not found" });
  if (!["approved", "rejected"].includes(req.body.status)) return res.status(400).json({ error: "Invalid status" });
  if (transaction.status !== "pending") return res.status(409).json({ error: "Request already processed" });
  transaction.status = req.body.status;
  transaction.processedAt = new Date().toISOString();
  const user = db.users.find((item) => item.id === transaction.userId);
  if (user && req.body.status === "approved") {
    user.balance = Number((user.balance + (transaction.type === "deposit" ? transaction.amount : -transaction.amount)).toFixed(2));
    if (user.balance < 0) user.balance = 0;
  }
  writeDb(db);
  res.json({ transaction, balance: user ? user.balance : 0 });
});

await seedAdmin();
app.listen(port, () => console.log(`API server running on http://127.0.0.1:${port}`));
