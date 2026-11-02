import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { changeBalance, decideTransaction, readDb, writeDb } from "../database.js";
import { approveTransaction } from "../services/wallet.js";
import { logger } from "../config/logger.js";
import { currencyForCountry, displayCurrency } from "../services/game-provider.js";

const transactionDecisionSchema = z.object({ status: z.enum(["approved", "rejected"]) });
const userUpdateSchema = z.object({
  status: z.enum(["active", "suspended"]).optional(),
  balance: z.number().finite().min(0).max(100000000).optional(),
  reason: z.string().trim().max(500).optional(),
}).refine((value) => value.status !== undefined || value.balance !== undefined, "Provide a status or balance update");
const kycReviewSchema = z.object({ status: z.enum(["verified", "rejected"]), note: z.string().trim().max(1000).optional().default("") });
const settingsSchema = z.object({
  announcement: z.string().trim().max(500).default(""),
  maintenanceMode: z.boolean().default(false),
  supportEmail: z.string().trim().email().or(z.literal("")).default(""),
  supportPhone: z.string().trim().max(40).default(""),
  supportHours: z.string().trim().max(100).default(""),
  promotions: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).default(""),
    reward: z.string().trim().max(160).default(""),
    terms: z.string().trim().max(1000).default(""),
    bannerImage: z.string().trim().max(100).regex(/^(|promotion-[a-f0-9-]+\.(jpg|png|webp))$/i).default(""),
    bannerIncludesText: z.boolean().default(false),
    active: z.boolean().default(true),
  })).max(20).default([]),
});
const gameResultSchema = z.object({
  userId: z.string().min(1),
  category: z.enum(["bet", "lottery", "game"]),
  gameName: z.string().trim().max(100).optional().default(""),
  outcome: z.enum(["won", "lost"]),
  amount: z.coerce.number().finite().min(0).max(100000000),
  reference: z.string().trim().max(150).optional().default(""),
});

function addAudit(db, adminUsername, action, target, details = "") {
  db.auditLogs ||= [];
  db.auditLogs.unshift({ id: randomUUID(), adminUsername, action, target, details, createdAt: new Date().toISOString() });
  db.auditLogs.length = Math.min(db.auditLogs.length, 1000);
}

function addNotification(db, userId, type, title, message, relatedId = "") {
  db.notifications ||= [];
  db.notifications.unshift({
    id: randomUUID(), userId, type, title, message, relatedId, read: false, createdAt: new Date().toISOString(),
  });
  db.notifications.length = Math.min(db.notifications.length, 1000);
}

function publicUser(user) {
  const { passwordHash, avatarPath, ...safeUser } = user;
  return safeUser;
}

function identifyPromotionImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return "";
}

export function createAdminRouter(uploadDir) {
  const router = express.Router();
  const promotionImageDir = path.join(uploadDir, "promotion-banners");
  fs.mkdirSync(promotionImageDir, { recursive: true });
  const uploadPromotionImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
  });
  router.use((req, res, next) => req.path === "/auth/login" ? next() : authenticate(req, res, next));
  router.use((req, res, next) => req.path === "/auth/login" ? next() : requireAdmin(req, res, next));

  router.get("/promotions/:id/banner", (req, res) => {
    const promotion = (readDb().platformSettings?.promotions || []).find((item) => item.id === req.params.id);
    if (!promotion?.bannerImage) return res.status(404).json({ error: "Promotion banner not found" });
    const filename = path.basename(promotion.bannerImage);
    const filePath = path.join(promotionImageDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Promotion banner not found" });
    res.setHeader("Cache-Control", "private, no-store");
    res.type(path.extname(filename));
    res.sendFile(filePath, { dotfiles: "deny" }, (error) => {
      if (error && !res.headersSent) res.status(error.statusCode || 500).json({ error: "Could not load promotion banner" });
    });
  });

  router.post("/promotions/:id/banner", (req, res, next) => {
    uploadPromotionImage.single("banner")(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Promotion banners must be 5 MB or smaller" });
      }
      if (error) return next(error);
      next();
    });
  }, (req, res) => {
    const db = readDb();
    const promotion = (db.platformSettings?.promotions || []).find((item) => item.id === req.params.id);
    if (!promotion) return res.status(404).json({ error: "Promotion not found" });
    if (!req.file) return res.status(400).json({ error: "Upload a valid JPEG, PNG, or WebP banner image" });

    const extension = identifyPromotionImage(req.file.buffer);
    if (!extension) return res.status(400).json({ error: "The banner is not a valid JPEG, PNG, or WebP image" });

    const previousImage = promotion.bannerImage;
    promotion.bannerImage = `promotion-${randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(promotionImageDir, promotion.bannerImage), req.file.buffer, { flag: "wx" });
    try {
      const admin = db.users.find((item) => item.id === req.user.id);
      addAudit(db, admin?.username || "admin", "PROMOTION_BANNER_UPLOADED", promotion.title || promotion.id, "Promotion banner artwork updated");
      writeDb(db);
    } catch (error) {
      fs.rmSync(path.join(promotionImageDir, promotion.bannerImage), { force: true });
      throw error;
    }

    if (previousImage && previousImage !== promotion.bannerImage) {
      try {
        fs.rmSync(path.join(promotionImageDir, path.basename(previousImage)), { force: true });
      } catch (error) {
        logger.warn("promotion_banner_cleanup_failed", {
          promotionId: promotion.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    res.json({ promotion });
  });

  router.get("/stats", (_req, res) => {
    const db = readDb();
    const users = db.users.filter((item) => item.role !== "admin");
    const approvedDeposits = db.transactions.filter((item) => item.type === "deposit" && item.status === "approved");
    const approvedWithdrawals = db.transactions.filter((item) => item.type === "withdrawal" && item.status === "approved");
    res.json({
      totalUsers: users.length,
      activeUsers: users.filter((item) => item.status === "active").length,
      totalBalance: Number(users.reduce((sum, item) => sum + item.balance, 0).toFixed(2)),
      pendingRequests: db.transactions.filter((item) => item.status === "pending").length,
      indiaUsers: users.filter((item) => item.country === "IN").length,
      pakistanUsers: users.filter((item) => item.country === "PK").length,
      pendingKyc: users.filter((item) => item.kycStatus === "pending").length,
      approvedDeposits: Number(approvedDeposits.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)),
      approvedWithdrawals: Number(approvedWithdrawals.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)),
    });
  });
  router.get("/activity", (_req, res) => res.json({ logs: readDb().auditLogs.slice(0, 100) }));
  router.get("/settings", (_req, res) => res.json({ settings: readDb().platformSettings || {} }));
  router.patch("/settings", validate(settingsSchema), (req, res) => {
    const db = readDb();
    const previousBannerImages = (db.platformSettings?.promotions || [])
      .map((promotion) => promotion.bannerImage)
      .filter(Boolean);
    db.platformSettings = req.body;
    const admin = db.users.find((item) => item.id === req.user.id);
    addAudit(db, admin?.username || "admin", "SETTINGS_UPDATED", "Platform settings", "Announcement, support, and promotion settings updated");
    writeDb(db);
    const retainedBannerImages = new Set(db.platformSettings.promotions.map((promotion) => promotion.bannerImage).filter(Boolean));
    for (const filename of previousBannerImages) {
      if (retainedBannerImages.has(filename)) continue;
      try {
        fs.rmSync(path.join(promotionImageDir, path.basename(filename)), { force: true });
      } catch (error) {
        logger.warn("promotion_banner_cleanup_failed", {
          filename: path.basename(filename),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    res.json({ settings: db.platformSettings });
  });
  router.get("/users", (_req, res) => res.json({ users: readDb().users.filter((item) => item.role !== "admin").map(publicUser) }));
  router.get("/transactions", (_req, res) => res.json({ transactions: readDb().transactions.slice(0, 100) }));

  router.patch("/users/:id", validate(userUpdateSchema), (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.params.id);
    if (!user || user.role === "admin") return res.status(404).json({ error: "User not found" });
    const admin = db.users.find((item) => item.id === req.user.id);
    if (req.body.status) {
      user.status = req.body.status;
      addAudit(db, admin?.username || "admin", "USER_STATUS_CHANGED", user.username, `Status changed to ${req.body.status}`);
    }
    if (req.body.balance !== undefined) {
      const previousBalance = user.balance;
      const diff = Number((req.body.balance - previousBalance).toFixed(2));
      if (diff !== 0) {
        try {
          user.balance = changeBalance({
            userId: user.id,
            amount: Math.abs(diff),
            type: diff > 0 ? "credit" : "debit",
            reference: req.body.reason || "Manual adjustment",
          });
        } catch (error) {
          return res.status(400).json({ error: error instanceof Error ? error.message : "Balance adjustment failed" });
        }
      }
      const currency = displayCurrency(currencyForCountry(user.country));
      addAudit(db, admin?.username || "admin", "BALANCE_ADJUSTED", user.username, `${currency} ${previousBalance} -> ${currency} ${user.balance}; ${req.body.reason || "Manual adjustment"}`);
    }
    writeDb(db);
    res.json({ user: publicUser(user) });
  });

  router.patch("/users/:id/kyc", validate(kycReviewSchema), (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.params.id && item.role !== "admin");
    if (!user) return res.status(404).json({ error: "User not found" });
    const admin = db.users.find((item) => item.id === req.user.id);
    user.kycStatus = req.body.status;
    user.kycReviewedAt = new Date().toISOString();
    user.kycReviewNote = req.body.note;
    addAudit(db, admin?.username || "admin", req.body.status === "verified" ? "KYC_VERIFIED" : "KYC_REJECTED", user.username, req.body.note);
    addNotification(
      db,
      user.id,
      "kyc",
      req.body.status === "verified" ? "KYC verification approved" : "KYC verification rejected",
      req.body.status === "verified" ? "Your identity verification has been approved." :
        `Your identity verification was rejected${req.body.note ? `: ${req.body.note}` : "."}`,
    );
    writeDb(db);
    res.json({ user: publicUser(user) });
  });

  router.get("/support", (_req, res) => res.json({ tickets: readDb().supportTickets.slice(0, 100) }));
  router.patch("/support/:id", validate(z.object({
    status: z.enum(["open", "pending", "resolved"]),
    reply: z.string().trim().max(3000).optional().default(""),
  })), (req, res) => {
    const db = readDb();
    const ticket = db.supportTickets.find((item) => item.id === req.params.id);
    if (!ticket) return res.status(404).json({ error: "Support ticket not found" });
    ticket.status = req.body.status;
    ticket.reply = req.body.reply;
    ticket.updatedAt = new Date().toISOString();
    const user = db.users.find((item) => item.id === ticket.userId);
    if (user && ticket.reply) addNotification(db, user.id, "support", "Support reply received", ticket.reply, ticket.id);
    const admin = db.users.find((item) => item.id === req.user.id);
    addAudit(db, admin?.username || "admin", "SUPPORT_TICKET_UPDATED", ticket.username, `${ticket.status} · ${ticket.subject}`);
    writeDb(db);
    res.json({ ticket });
  });

  router.patch("/transactions/:id", validate(transactionDecisionSchema), (req, res) => {
    try {
      const result = req.body.status === "approved"
        ? approveTransaction(req.params.id, req.user.id)
        : decideTransaction({ transactionId: req.params.id, status: req.body.status, adminUsername: req.user.id });
      logger.info("wallet_transaction_processed", {
        transactionId: result.transactionId, status: req.body.status, adminId: req.user.id,
      });
      const transaction = readDb().transactions.find((item) => item.id === result.transactionId);
      res.json({ transaction, balance: result.balance });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction decision failed";
      const status = message === "Request already processed" ? 409 :
        message === "Request not found" || message === "User not found" ? 404 : 409;
      res.status(status).json({ error: message });
    }
  });

  router.post("/game-results", validate(gameResultSchema), (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.body.userId && item.role !== "admin");
    if (!user) return res.status(404).json({ error: "User not found" });
    const admin = db.users.find((item) => item.id === req.user.id);
    const eventId = req.body.reference || randomUUID();
    const winnings = req.body.outcome === "won" ? req.body.amount : 0;
    if (winnings > 0) {
      user.balance = changeBalance({
        userId: user.id, amount: winnings, type: "credit", transactionId: eventId, reference: eventId,
      });
    }
    db.transactions.unshift({
      id: eventId, userId: user.id, username: user.username, type: req.body.category,
      amount: winnings, status: req.body.outcome, gameName: req.body.gameName || req.body.category,
      createdAt: new Date().toISOString(),
    });
    addNotification(
      db,
      user.id,
      req.body.category,
      `${req.body.gameName || req.body.category} ${req.body.outcome}`,
      winnings ? `You won ${displayCurrency(currencyForCountry(user.country))} ${winnings.toLocaleString("en-US")} and the amount has been added to your wallet.` :
        `Your ${req.body.category} result was recorded as no win.`,
      eventId,
    );
    addAudit(db, admin?.username || "admin", "GAME_RESULT_RECORDED", user.username,
      `${req.body.category} · ${req.body.gameName || req.body.category} · ${req.body.outcome} · ${displayCurrency(currencyForCountry(user.country))} ${winnings} · Ref: ${eventId}`);
    writeDb(db);
    res.status(201).json({ message: "Game result recorded", user: publicUser(user) });
  });

  return router;
}
