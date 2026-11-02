import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readDb, writeDb } from "../database.js";
import { authenticate, jwtSecret, clientIp } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, "Invalid username format"),
  password: z.string().min(6).max(128),
});

const registerSchema = credentialsSchema.extend({
  email: z.string().trim().email().max(254),
  country: z.enum(["IN", "PK"]),
});

function publicUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

export function createAuthRouter() {
  const router = express.Router();

  router.post("/register", validate(registerSchema), async (req, res) => {
    const db = readDb();
    const username = req.body.username;
    const email = req.body.email.toLowerLowerCase();
    if (db.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
      return res.status(409).json({ error: "Username already exists" });
    }
    if (db.users.some((item) => item.email?.toLowerCase() === email)) {
      return res.status(409).json({ error: "Email already registered" });
    }
    const user = {
      id: randomUUID(),
      username,
      phone: "",
      email,
      country: req.body.country,
      passwordHash: await bcrypt.hash(req.body.password, 12),
      role: "user",
      balance: 0,
      status: "active",
      emailVerified: false,
      phoneVerified: false,
      kycStatus: "not_submitted",
      kycDocuments: {},
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    db.users.push(user);
    writeDb(db);
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret(), { expiresIn: "7d" });
    res.status(201).json({ token, user: publicUser(user) });
  });

  router.post("/login", validate(credentialsSchema), async (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.username.toLowerCase() === req.body.username.toLowerCase());
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash || ""))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    if (user.status !== "active") return res.status(403).json({ error: "This account is suspended" });
    user.lastLoginAt = new Date().toISOString();
    writeDb(db);
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret(), { expiresIn: "7d" });
    res.json({ token, user: publicUser(user) });
  });

  router.get("/me", authenticate, (req, res) => {
    const user = readDb().users.find((item) => item.id === req.user.id);
    if (!user || user.status !== "active") return res.status(403).json({ error: "Account unavailable" });
    res.json({ user: publicUser(user) });
  });

  return router;
}
