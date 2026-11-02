import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { readDb, writeDb, createWithdrawalRequest } from "../database.js";
import { currencyForCountry, displayCurrency } from "../services/game-provider.js";

const walletRequestSchema = z.object({
  type: z.enum(["deposit", "withdrawal"]),
  amount: z.coerce.number().min(100).max(100000000),
  paymentReference: z.string().trim().max(200).optional().default(""),
  paymentMethod: z.string().trim().max(100).optional().default(""),
  paymentNote: z.string().trim().max(500).optional().default(""),
});

export function createWalletRouter(uploadDir) {
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype)),
  });
  const router = express.Router();

  router.post("/play", authenticate, (_req, res) => {
    res.status(400).json({ error: "Choose a provider game and launch it through /api/games/:gameId/launch." });
  });

  router.post("/request", authenticate, upload.single("proof"), validate(walletRequestSchema), (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user || user.status !== "active") return res.status(403).json({ error: "Account unavailable" });
    const { type, amount, paymentReference, paymentMethod, paymentNote } = req.body;
    const roundedAmount = Number(amount.toFixed(2));
    if (type === "deposit" && (!req.file || !paymentReference)) {
      return res.status(400).json({ error: "Payment receipt and reference are required" });
    }
    if (type === "withdrawal") {
      if ((user.kycStatus || "not_submitted") !== "verified") return res.status(403).json({ error: "Complete KYC verification before requesting a withdrawal" });
      if (!paymentMethod || paymentNote.length < 6) return res.status(400).json({ error: "Valid withdrawal destination details are required" });
    }
    const transaction = {
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
    };
    const notification = {
      id: randomUUID(),
      userId: user.id,
      type,
      title: `${type === "deposit" ? "Deposit" : "Withdrawal"} request submitted`,
      message: `${displayCurrency(currencyForCountry(user.country))} ${roundedAmount.toLocaleString("en-US")} is pending administrator review.`,
      relatedId: transaction.id,
      read: false,
      createdAt: new Date().toISOString(),
    };
    if (type === "withdrawal") {
      try {
        createWithdrawalRequest(transaction, notification);
      } catch (error) {
        return res.status(400).json({ error: error instanceof Error ? error.message : "Could not reserve withdrawal" });
      }
    } else {
      db.transactions.unshift(transaction);
      db.notifications ||= [];
      db.notifications.unshift(notification);
      writeDb(db);
    }
    res.status(201).json({ message: `${type === "deposit" ? "Deposit" : "Withdrawal"} request submitted`, balance: user.balance });
  });

  router.get("/transactions", authenticate, (req, res) => {
    const db = readDb();
    res.json({ transactions: db.transactions.filter((item) => item.userId === req.user.id).slice(0, 100) });
  });

  return router;
}
