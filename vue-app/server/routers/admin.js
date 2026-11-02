import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { changeBalance, decideTransaction, readDb, writeDb } from "../database.js";
import { approveTransaction } from "../services/wallet.js";
import { logger } from "../config/logger.js";

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
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

export function createAdminRouter() {
  const router = express.Router();
  router.use((req, res, next) => req.path === "/auth/login" ? next() : authenticate(req, res, next));
  router.use((req, res, next) => req.path === "/auth/login" ? next() : requireAdmin(req, res, next));

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
    db.platformSettings = req.body;
    const admin = db.users.find((item) => item.id === req.user.id);
    addAudit(db, admin?.username || "admin", "SETTINGS_UPDATED", "Platform settings", "Announcement and support settings updated");
    writeDb(db);
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
      addAudit(db, admin?.username || "admin", "BALANCE_ADJUSTED", user.username, `Rs. ${previousBalance} -> Rs. ${user.balance}; ${req.body.reason || "Manual adjustment"}`);
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
      winnings ? `You won Rs. ${winnings.toLocaleString("en-US")} and the amount has been added to your wallet.` :
        `Your ${req.body.category} result was recorded as no win.`,
      eventId,
    );
    addAudit(db, admin?.username || "admin", "GAME_RESULT_RECORDED", user.username,
      `${req.body.category} · ${req.body.gameName || req.body.category} · ${req.body.outcome} · Rs. ${winnings} · Ref: ${eventId}`);
    writeDb(db);
    res.status(201).json({ message: "Game result recorded", user: publicUser(user) });
  });

  return router;
}
