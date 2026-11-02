import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { readDb, writeDb } from "../database.js";

const createTicketSchema = z.object({
  subject: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(3000),
});
export function createSupportRouter() {
  const router = express.Router();
  router.post("/support/tickets", authenticate, validate(createTicketSchema), (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.user.id && item.status === "active");
    if (!user) return res.status(404).json({ error: "User not found" });
    const now = new Date().toISOString();
    const ticket = {
      id: randomUUID(), userId: user.id, username: user.username, subject: req.body.subject,
      message: req.body.message, status: "open", reply: "", createdAt: now, updatedAt: now,
    };
    db.supportTickets ||= [];
    db.supportTickets.unshift(ticket);
    db.supportTickets.length = Math.min(db.supportTickets.length, 500);
    writeDb(db);
    res.status(201).json({ ticket });
  });
  router.get("/support/tickets", authenticate, (req, res) => {
    const db = readDb();
    res.json({ tickets: (db.supportTickets || []).filter((item) => item.userId === req.user.id).slice(0, 50) });
  });

  return router;
}
