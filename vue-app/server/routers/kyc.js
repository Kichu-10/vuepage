import express from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { readDb, writeDb } from "../database.js";

const kycSchema = z.object({
  country: z.enum(["IN", "PK"]),
  fullName: z.string().trim().min(2).max(120),
  dateOfBirth: z.string().trim().min(8).max(10),
  documentType: z.string().trim().min(2).max(20),
  documentNumber: z.string().trim().min(3).max(80),
  address: z.string().trim().max(300).optional().default(""),
});

export function createKycRouter(uploadDir) {
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype)),
  });
  const router = express.Router();
  router.post(
    "/kyc",
    authenticate,
    upload.fields([
      { name: "front", maxCount: 1 },
      { name: "back", maxCount: 1 },
      { name: "selfie", maxCount: 1 },
    ]),
    validate(kycSchema),
    (req, res) => {
      const db = readDb();
      const user = db.users.find((item) => item.id === req.user.id);
      if (!user || user.status !== "active") return res.status(403).json({ error: "Account unavailable" });
      const { country, fullName, dateOfBirth, documentType, documentNumber, address } = req.body;
      const validTypes = country === "IN" ? ["aadhaar", "pan", "passport"] : ["cnic", "passport"];
      const files = req.files || {};
      const needsBack = country === "PK" && documentType === "cnic";
      if (!validTypes.includes(documentType)) return res.status(400).json({ error: "Select a valid document type for the chosen country" });
      if (!files.front || !files.selfie || (needsBack && !files.back)) {
        return res.status(400).json({ error: needsBack ? "Upload CNIC front, back, and selfie" : "Upload front and selfie" });
      }

      const savedFiles = Object.values(files).flat();
      try {
        user.country = country;
        user.fullName = fullName;
        user.dateOfBirth = dateOfBirth;
        user.documentType = documentType;
        user.documentNumber = documentNumber;
        user.address = address;
        user.kycStatus = "pending";
        user.kycDocuments = {
          front: files.front[0].filename,
          back: files.back?.[0]?.filename || "",
          selfie: files.selfie[0].filename,
        };
        db.notifications ||= [];
        db.notifications.unshift({
          id: randomUUID(),
          userId: user.id,
          type: "kyc",
          title: "KYC submitted",
          message: "Your identity documents are pending administrator review.",
          relatedId: user.id,
          read: false,
          createdAt: new Date().toISOString(),
        });
        writeDb(db);
      } catch (error) {
        for (const file of savedFiles) {
          const filePath = path.join(uploadDir, path.basename(file.path));
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        throw error;
      }
      const { passwordHash, ...safeUser } = user;
      res.status(201).json({ message: "KYC submitted for review", user: safeUser });
    },
  );
  return router;
}
