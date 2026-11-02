import express from "express";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { readDb, writeDb, changeBalance } from "../database.js";
import { logger } from "../config/logger.js";

const transactionDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

export function createAdminRouter() {
  const router = express.Router();
  router.use(authenticate, requireAdmin);

  router.patch("/transactions/:id", validate(transactionDecisionSchema), (req, res) => {
    let db = readDb();
    let transaction = db.transactions.find((item) => item.id === req.params.id);
    if (!transaction) return res.status(404).json({ error: "Request not found" });
    if (transaction.status !== "pending") return res.status(409).json({ error: "Request already processed" });
    const user = db.users.find((item) => item.id === transaction.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    transaction.status = req.body.status;
    transaction.processedAt = new Date().toISOString();
    if (req.body.status === "approved") {
      try {
        changeBalance({
          userId: user.id,
          amount: transaction.amount,
          type: transaction.type === "deposit" ? "credit" : "debit",
          transactionId: transaction.id,
          reference: transaction.paymentReference || transaction.id,
        });
      } catch (error) {
        return res.status(409).json({ error: error instanceof Error ? error.message : "Balance update failed" });
      }
    }
    db = readDb();
    transaction = db.transactions.find((item) => item.id === req.params.id);
    transaction.status = req.body.status;
    transaction.processedAt = new Date().toISOString();
    db.notifications ||= [];
    db.notifications.unshift({
      id: globalThis.crypto.randomUUID(),
      userId: user.id,
      type: transaction.type,
      title: `${transaction.type === "deposit" ? "Deposit" : "Withdrawal"} ${req.body.status}`,
      message: `Your request for Rs. ${Number(transaction.amount).toLocaleString("en-US")} was ${req.body.status}.`,
      relatedId: transaction.id,
      read: false,
      createdAt: new Date().toISOString(),
    });
    db.auditLogs ||= [];
    db.auditLogs.unshift({
      id: globalThis.crypto.randomUUID(),
      adminUsername: req.user.id,
      action: `${transaction.type.toUpperCase()}_${req.body.status.toUpperCase()}`,
      target: user.username,
      details: `Rs. ${Number(transaction.amount).toLocaleString("en-US")}`,
      createdAt: new Date().toISOString(),
    });
    writeDb(db);
    const balance = readDb().users.find((item) => item.id === user.id)?.balance || 0;
    logger.info("wallet_transaction_processed", { transactionId: transaction.id, userId: user.id, status: req.body.status, adminId: req.user.id });
    res.json({ transaction, balance });
  });

  return router;
}
