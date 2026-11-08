import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { authenticate } from "../middleware/auth.js";
import { readDb, readUserById, writeDb } from "../database.js";
import { logger } from "../config/logger.js";

const avatarLimit = 3 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function identifyImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { extension: "jpg", contentType: "image/jpeg" };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: "png", contentType: "image/png" };
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return { extension: "webp", contentType: "image/webp" };
  return null;
}

export function createProfileRouter(uploadDir) {
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: avatarLimit, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, allowedTypes.has(file.mimetype)),
  });
  const router = express.Router();

  router.get("/profile/avatar", authenticate, (req, res) => {
    const user = readUserById(req.user.id);
    if (!user || user.status !== "active") return res.status(403).json({ error: "Account unavailable" });
    if (!user.avatarPath) return res.status(404).json({ error: "Profile picture not found" });
    const filename = path.basename(user.avatarPath);
    const filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Profile picture not found" });
    res.setHeader("Cache-Control", "private, no-store");
    res.type(path.extname(filename));
    res.sendFile(filePath, { dotfiles: "deny" }, (error) => {
      if (error && !res.headersSent) res.status(error.statusCode || 500).json({ error: "Could not load profile picture" });
    });
  });

  router.post("/profile/avatar", authenticate, (req, res, next) => {
    upload.single("avatar")(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Profile pictures must be 3 MB or smaller" });
      }
      if (error) return next(error);
      next();
    });
  }, (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.user.id);
    if (!user || user.status !== "active") {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      return res.status(403).json({ error: "Account unavailable" });
    }
    if (!req.file) return res.status(400).json({ error: "Upload a valid JPEG, PNG, or WebP image" });

    const image = identifyImage(fs.readFileSync(req.file.path));
    if (!image) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: "The uploaded file is not a valid JPEG, PNG, or WebP image" });
    }

    const previousPath = user.avatarPath;
    const filename = `avatar-${randomUUID()}.${image.extension}`;
    const savedPath = path.join(uploadDir, filename);
    try {
      fs.renameSync(req.file.path, savedPath);
      user.avatarPath = filename;
      writeDb(db);
    } catch (error) {
      fs.rmSync(savedPath, { force: true });
      fs.rmSync(req.file.path, { force: true });
      throw error;
    }

    if (previousPath && previousPath !== filename) {
      const oldPath = path.join(uploadDir, path.basename(previousPath));
      try {
        fs.rmSync(oldPath, { force: true });
      } catch (error) {
        logger.warn("profile_picture_cleanup_failed", {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    res.json({ message: "Profile picture updated" });
  });

  return router;
}
