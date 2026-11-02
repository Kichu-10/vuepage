import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vuepage-test-"));
process.env.SQLITE_PATH = path.join(tempDir, "test.sqlite");
process.env.JWT_SECRET = "test-jwt-secret-that-is-long-enough";
process.env.ADMIN_ALLOWED_IPS = "";

const database = await import("../server/database.js");
const { createAuthRouter, createAdminAuthRouter } = await import("../server/routers/auth.js");
const { createWalletRouter } = await import("../server/routers/wallet.js");
const { createAdminRouter } = await import("../server/routers/admin.js");

const app = express();
app.use(express.json());
app.use("/api/auth", createAuthRouter());
app.use("/api/wallet", createWalletRouter(path.join(tempDir, "uploads")));
app.use("/api/admin", createAdminAuthRouter());
app.use("/api/admin", createAdminRouter());

const account = {
  id: "user-1",
  username: "testuser",
  passwordHash: "unused",
  role: "user",
  balance: 0,
  status: "active",
  kycStatus: "verified",
};
const admin = {
  id: "admin-1",
  username: "administrator",
  passwordHash: "unused",
  role: "admin",
  balance: 0,
  status: "active",
};

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET);
}

function resetDatabase({ users = [account, admin], transactions = [] } = {}) {
  database.writeDb({
    users,
    transactions,
    otps: [],
    verifications: {},
    notifications: [],
    supportTickets: [],
    auditLogs: [],
    gameResults: [],
    platformSettings: {},
  });
}

beforeEach(() => resetDatabase());
after(() => {
  database.db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("auth validates registration and authenticates a registered user", async () => {
  const registered = await request(app)
    .post("/api/auth/register")
    .send({ username: "newuser", email: "new@example.com", password: "pass1234", country: "IN" })
    .expect(201);
  assert.equal(registered.body.user.username, "newuser");
  assert.equal("passwordHash" in registered.body.user, false);

  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "newuser", password: "pass1234" })
    .expect(200);
  assert.ok(login.body.token);

  await request(app)
    .post("/api/auth/register")
    .send({ username: "x", email: "not-an-email", password: "123", country: "XX" })
    .expect(400);
});

test("withdrawal requests reserve available funds", async () => {
  resetDatabase({ users: [{ ...account, balance: 500 }] });
  const token = tokenFor(account);
  await request(app)
    .post("/api/wallet/request")
    .set("Authorization", `Bearer ${token}`)
    .field("type", "withdrawal")
    .field("amount", "400")
    .field("paymentMethod", "Bank")
    .field("paymentNote", "Account number 12345")
    .expect(201);

  const secondRequest = await request(app)
    .post("/api/wallet/request")
    .set("Authorization", `Bearer ${token}`)
    .field("type", "withdrawal")
    .field("amount", "200")
    .field("paymentMethod", "Bank")
    .field("paymentNote", "Account number 12345")
    .expect(400);
  assert.match(secondRequest.body.error, /Insufficient available balance/);
});

test("admin approval changes balance and ledger exactly once", async () => {
  resetDatabase({
    users: [{ ...account, balance: 25.5 }, admin],
    transactions: [{
      id: "deposit-1",
      userId: account.id,
      username: account.username,
      type: "deposit",
      amount: 100,
      status: "pending",
      paymentReference: "payment-1",
      createdAt: new Date().toISOString(),
    }],
  });
  const endpoint = "/api/admin/transactions/deposit-1";
  const headers = { Authorization: `Bearer ${tokenFor(admin)}` };
  const approved = await request(app).patch(endpoint).set(headers).send({ status: "approved" }).expect(200);
  assert.equal(approved.body.balance, 125.5);
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 1);
  await request(app).patch(endpoint).set(headers).send({ status: "approved" }).expect(409);
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 1);
});

test("admin endpoints reject anonymous and regular-user requests", async () => {
  await request(app).patch("/api/admin/transactions/missing").send({ status: "approved" }).expect(401);
  await request(app)
    .patch("/api/admin/transactions/missing")
    .set("Authorization", `Bearer ${tokenFor(account)}`)
    .send({ status: "approved" })
    .expect(403);
});

test("admin login works through the split router without weakening admin guards", async () => {
  const bcrypt = await import("bcryptjs");
  resetDatabase({ users: [account, { ...admin, passwordHash: await bcrypt.hash("safe-test-password", 4) }] });
  const login = await request(app)
    .post("/api/admin/auth/login")
    .send({ username: admin.username, password: "safe-test-password" })
    .expect(200);
  assert.ok(login.body.token);
  await request(app).get("/api/admin/stats")
    .set("Authorization", `Bearer ${login.body.token}`)
    .expect(200);
});

test("legacy JSON columns migrate into normalized columns and ledger schema", () => {
  const legacyPath = path.join(tempDir, "legacy.sqlite");
  const legacyDb = new DatabaseSync(legacyPath);
  legacyDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL, balance REAL NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  legacyDb.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)").run(
    "legacy-user", "legacy", "user", 12.34, "active",
    JSON.stringify({ id: "legacy-user", username: "legacy", role: "user", balance: 12.34, status: "active", email: "legacy@example.com" }),
  );
  legacyDb.prepare("INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "legacy-transaction", "legacy-user", "legacy", "deposit", 5, "pending",
    JSON.stringify({ id: "legacy-transaction", userId: "legacy-user", username: "legacy", type: "deposit", amount: 5, status: "pending" }),
  );
  legacyDb.prepare("INSERT INTO app_state VALUES (?, ?)").run(
    "platformSettings",
    JSON.stringify({ announcement: "Maintenance notice", maintenanceMode: true }),
  );
  legacyDb.close();

  const script = `
    import { readDb, db } from "./server/database.js";
    const data = readDb();
    const userColumns = db.prepare("PRAGMA table_info(users)").all().map(row => row.name);
    const transactionColumns = db.prepare("PRAGMA table_info(transactions)").all().map(row => row.name);
    const ledgerTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_entries'").get();
    console.log(JSON.stringify({ user: data.users[0], transaction: data.transactions[0], settings: data.platformSettings, userColumns, transactionColumns, ledgerTable: Boolean(ledgerTable) }));
    db.close();
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, SQLITE_PATH: legacyPath },
  });
  assert.equal(result.status, 0, result.stderr);
  const migrated = JSON.parse(result.stdout.trim());
  assert.equal(migrated.user.balance, 12.34);
  assert.equal(migrated.user.email, "legacy@example.com");
  assert.equal(migrated.transaction.amount, 5);
  assert.equal(migrated.settings.announcement, "Maintenance notice");
  assert.equal(migrated.settings.maintenanceMode, true);
  assert.ok(migrated.userColumns.includes("balance_cents"));
  assert.equal(migrated.userColumns.includes("data"), false);
  assert.equal(migrated.transactionColumns.includes("data"), false);
  assert.equal(migrated.ledgerTable, true);
});
