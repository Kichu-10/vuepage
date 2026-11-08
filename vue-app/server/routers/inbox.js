import express from "express";
import { db } from "../database.js";

export function createInboxRouter(authenticate) {
  const router = express.Router();

  router.get("/", authenticate, (req, res) => {
    const notifications = db.prepare(`
      SELECT id, user_id, type, title, message, related_id, is_read, created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `).all(req.user.id).map((row) => ({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      message: row.message,
      relatedId: row.related_id,
      read: Boolean(row.is_read),
      createdAt: row.created_at,
    }));
    res.json({
      notifications,
      unreadCount: notifications.filter((item) => !item.read).length,
    });
  });

  router.patch("/read", authenticate, (req, res) => {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(req.user.id);
    res.json({ unreadCount: 0 });
  });

  return router;
}
