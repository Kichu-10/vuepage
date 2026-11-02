import express from "express";
import fs from "node:fs";
import path from "node:path";
import { authenticate } from "../middleware/auth.js";
import { readDb } from "../database.js";

export function createPromotionsRouter(uploadDir) {
  const router = express.Router();
  const promotionImageDir = path.join(uploadDir, "promotion-banners");
  router.get("/:id/banner", (req, res) => {
    const promotion = (readDb().platformSettings?.promotions || []).find(
      (item) => item.id === req.params.id,
    );
    if (!promotion?.bannerImage) return res.status(404).json({ error: "Promotion banner not found" });
    const filename = path.basename(promotion.bannerImage);
    const filePath = path.join(promotionImageDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Promotion banner not found" });
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type(path.extname(filename));
    res.sendFile(filePath, { dotfiles: "deny" }, (error) => {
      if (error && !res.headersSent) res.status(error.statusCode || 500).json({ error: "Could not load promotion banner" });
    });
  });
  router.use(authenticate);
  router.get("/", (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user || user.status !== "active") return res.status(403).json({ error: "Account unavailable" });
    const promotions = (db.platformSettings?.promotions || []).filter((promotion) => promotion.active).map((promotion) => ({
      ...promotion,
      bannerUrl: promotion.bannerImage ? `/api/promotions/${encodeURIComponent(promotion.id)}/banner` : "",
    }));
    res.json({ promotions });
  });
  return router;
}
