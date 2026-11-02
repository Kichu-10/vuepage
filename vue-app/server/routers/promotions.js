import express from "express";
import { authenticate } from "../middleware/auth.js";
import { readDb } from "../database.js";

export function createPromotionsRouter() {
  const router = express.Router();
  router.use(authenticate);
  router.get("/", (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user || user.status !== "active") return res.status(403).json({ error: "Account unavailable" });
    const promotions = (db.platformSettings?.promotions || []).filter((promotion) => promotion.active);
    res.json({ promotions });
  });
  return router;
}
