import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import nodemailer from "nodemailer";
import twilio from "twilio";
import { readDb, writeDb } from "../database.js";
import { authenticate, jwtSecret, ipIsAllowed } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { logger } from "../config/logger.js";

const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, "Invalid username format"),
  password: z.string().min(6).max(128),
});
const adminCredentialsSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(128),
});

const registerSchema = credentialsSchema.extend({
  email: z.string().trim().email().max(254),
  country: z.enum(["IN", "PK"]),
});
const otpSendSchema = z.object({
  channel: z.enum(["email", "sms"]),
  destination: z.string().trim().min(1).max(254),
}).superRefine(({ channel, destination }, context) => {
  const valid = channel === "email"
    ? z.string().email().safeParse(destination).success
    : /^\+[1-9]\d{7,14}$/.test(destination);
  if (!valid) context.addIssue({ code: "custom", message: channel === "email" ? "Enter a valid email address" : "Enter a valid phone number with country code" });
});
const otpVerifySchema = z.object({
  channel: z.enum(["email", "sms"]),
  destination: z.string().trim().min(1).max(254),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit verification code"),
});
const googleSchema = z.object({
  credential: z.string().min(1).max(10000),
  country: z.enum(["IN", "PK"]).optional(),
});

function publicUser(user) {
  const { passwordHash, avatarPath, ...safe } = user;
  return safe;
}

function googlePictureUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/(^|\.)googleusercontent\.com$/i.test(url.hostname)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function hashOtp(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function googleVerificationFailure(error) {
  const message = error instanceof Error ? error.message : "";
  const earlyToken = message.match(/^Token used too early,\s*(\d+(?:\.\d+)?)\s*<\s*(\d+(?:\.\d+)?)/);
  if (earlyToken) {
    const skewSeconds = Math.max(0, Number(earlyToken[2]) - Number(earlyToken[1]));
    const skewHours = Math.round((skewSeconds / 3600) * 10) / 10;
    return {
      reason: "token_clock_ahead",
      skewHours,
      message: `Google sign-in time is about ${skewHours} hours ahead of the server. Set automatic date, time, and time zone on the device used to sign in, then try again.`,
    };
  }
  if (message.startsWith("Token used too late")) {
    return { reason: "token_expired", message: "Google sign-in expired. Please try again." };
  }
  if (message.startsWith("Invalid token signature")) {
    return {
      reason: "invalid_token_signature",
      message: "Google could not verify this sign-in. Please check the device time and try again.",
    };
  }
  return { reason: "verification_failed", message: "Google verification failed. Please try again." };
}

function uniqueUsername(users, preferred) {
  const base = String(preferred || "user").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20) || "user";
  let candidate = base;
  let suffix = 1;
  while (users.some((item) => item.username.toLowerCase() === candidate.toLowerCase())) {
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
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: destination,
      subject: "Your B9 verification code",
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    });
    return;
  }
  if (channel === "sms" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    await twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN).messages.create({
      body: `Your B9 verification code is ${code}. It expires in 10 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: destination,
    });
    return;
  }
  throw new Error(`${channel.toUpperCase()} verification delivery is not configured`);
}

export function createAuthRouter() {
  const router = express.Router();

  router.post("/otp/send", validate(otpSendSchema), async (req, res) => {
    const { channel, destination } = req.body;
    const code = String(randomInt(100000, 1000000));
    const db = readDb();
    db.otps = (db.otps || []).filter((item) => !(item.destination === destination && item.channel === channel));
    db.otps.push({ channel, destination, codeHash: hashOtp(code), expiresAt: Date.now() + 10 * 60 * 1000 });
    writeDb(db);
    try {
      await sendOtp(channel, destination, code);
      res.json({ message: `Verification code sent to ${destination}` });
    } catch (error) {
      db.otps = db.otps.filter((item) => !(item.destination === destination && item.channel === channel));
      writeDb(db);
      logger.error("otp_delivery_failed", { channel, error: error instanceof Error ? error.message : String(error) });
      res.status(502).json({ error: "Could not deliver verification code" });
    }
  });

  router.post("/otp/verify", validate(otpVerifySchema), (req, res) => {
    const { channel, destination, code } = req.body;
    const db = readDb();
    const otp = db.otps.find((item) => item.channel === channel && item.destination === destination);
    if (!otp || otp.expiresAt < Date.now()) return res.status(400).json({ error: "Verification code expired or not found" });
    if (otp.codeHash !== hashOtp(code)) return res.status(400).json({ error: "Invalid verification code" });
    db.otps = db.otps.filter((item) => item !== otp);
    db.verifications[`${channel}:${destination}`] = true;
    writeDb(db);
    res.json({ verified: true });
  });

  router.post("/register", validate(registerSchema), async (req, res) => {
    const db = readDb();
    const username = req.body.username;
    const email = req.body.email.toLowerCase();
    if (db.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
      return res.status(409).json({ error: "Username already exists" });
    }
    if (db.users.some((item) => item.email?.toLowerCase() === email)) {
      return res.status(409).json({ error: "Email already registered" });
    }
    const user = {
      id: randomUUID(),
      username,
      phone: "",
      email,
      country: req.body.country,
      passwordHash: await bcrypt.hash(req.body.password, 12),
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
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret(), { expiresIn: "7d" });
    res.status(201).json({ token, user: publicUser(user) });
  });

  router.post("/login", validate(credentialsSchema), async (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.username.toLowerCase() === req.body.username.toLowerCase());
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash || ""))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    if (user.status !== "active") return res.status(403).json({ error: "This account is suspended" });
    user.lastLoginAt = new Date().toISOString();
    writeDb(db);
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret(), { expiresIn: "7d" });
    res.json({ token, user: publicUser(user) });
  });

  router.get("/me", authenticate, (req, res) => {
    const user = readDb().users.find((item) => item.id === req.user.id);
    if (!user || user.status !== "active") return res.status(403).json({ error: "Account unavailable" });
    res.json({ user: publicUser(user) });
  });

  router.post("/google", validate(googleSchema), async (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: "Google Sign-In is not configured" });
    try {
      const ticket = await new OAuth2Client(process.env.GOOGLE_CLIENT_ID).verifyIdToken({
        idToken: req.body.credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload?.email) return res.status(401).json({ error: "Google account email is unavailable" });
      const pictureUrl = googlePictureUrl(payload.picture);
      const db = readDb();
      const email = payload.email.toLowerCase();
      let user = db.users.find((item) => item.email?.toLowerCase() === email);
      if (!user) {
        if (!req.body.country) return res.status(400).json({ error: "Select India or Pakistan before Google Sign-In" });
        user = {
          id: randomUUID(), username: uniqueUsername(db.users, email.split("@")[0]), phone: "", email,
          country: req.body.country, passwordHash: await bcrypt.hash(randomUUID(), 12), role: "user", balance: 0,
          status: "active", emailVerified: true, phoneVerified: false, kycStatus: "not_submitted",
          kycDocuments: {}, googleId: payload.sub, googlePictureUrl: pictureUrl, createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        };
        db.users.push(user);
      }
      if (user.status !== "active") return res.status(403).json({ error: "This account is suspended" });
      user.googleId ||= payload.sub;
      if (pictureUrl) user.googlePictureUrl = pictureUrl;
      user.emailVerified = true;
      if (!user.country && req.body.country) user.country = req.body.country;
      user.lastLoginAt = new Date().toISOString();
      writeDb(db);
      res.json({
        token: jwt.sign({ id: user.id, role: user.role }, jwtSecret(), { expiresIn: "7d" }),
        user: publicUser(user),
      });
    } catch (error) {
      const failure = googleVerificationFailure(error);
      logger.warn("google_verification_failed", {
        reason: failure.reason,
        ...(failure.skewHours === undefined ? {} : { skewHours: failure.skewHours }),
      });
      res.status(401).json({ error: failure.message });
    }
  });

  return router;
}

export function createAdminAuthRouter() {
  const router = express.Router();
  router.post("/auth/login", (req, res, next) => {
    if (!ipIsAllowed(req)) return res.status(403).json({ error: "Admin access is not permitted from this network" });
    next();
  }, validate(adminCredentialsSchema), async (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.username.toLowerCase() === req.body.username.toLowerCase() && item.role === "admin");
    if (user?.lockedUntil && user.lockedUntil > Date.now()) return res.status(423).json({ error: "Admin login temporarily locked" });
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash || ""))) {
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
    res.json({
      token: jwt.sign({ id: user.id, role: "admin" }, jwtSecret(), { expiresIn: "8h" }),
      user: publicUser(user),
    });
  });
  return router;
}
