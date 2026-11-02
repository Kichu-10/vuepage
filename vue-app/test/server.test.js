import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vuepage-test-"));
process.env.SQLITE_PATH = path.join(tempDir, "test.sqlite");
process.env.JWT_SECRET = "test-jwt-secret-that-is-long-enough";
process.env.ADMIN_ALLOWED_IPS = "";
process.env.GAME_API_BASE_URL = "https://provider.test";
process.env.GAME_OPERATOR_ID = "test-operator";
process.env.GAME_SECRET = "test-game-secret";
process.env.GAME_SALT = "test-game-salt";

const database = await import("../server/database.js");
const { createAuthRouter, createAdminAuthRouter } = await import("../server/routers/auth.js");
const { createWalletRouter } = await import("../server/routers/wallet.js");
const { createAdminRouter } = await import("../server/routers/admin.js");
const { createGamesRouter } = await import("../server/routers/games.js");
const { createPromotionsRouter } = await import("../server/routers/promotions.js");
const { createProfileRouter } = await import("../server/routers/profile.js");
const { signGameProviderParameters } = await import("../server/services/game-provider.js");

const app = express();
app.use(express.json());
app.use("/api/auth", createAuthRouter());
app.use("/api/wallet", createWalletRouter(path.join(tempDir, "uploads")));
app.use("/api/games", createGamesRouter());
app.use("/api/promotions", createPromotionsRouter());
app.use("/api/auth", createProfileRouter(path.join(tempDir, "uploads")));
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
  for (const table of ["game_wallet_transfers", "game_players", "ledger_entries", "game_results"]) {
    database.db.exec(`DELETE FROM ${table}`);
  }
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

test("promotions are available only to signed-in users and admin settings control visibility", async () => {
  const memberHeaders = { Authorization: `Bearer ${tokenFor(account)}` };
  const adminHeaders = { Authorization: `Bearer ${tokenFor(admin)}` };
  await request(app).get("/api/promotions").expect(401);

  await request(app).patch("/api/admin/settings").set(adminHeaders).send({
    announcement: "",
    maintenanceMode: false,
    supportEmail: "",
    supportPhone: "",
    supportHours: "24/7",
    promotions: [
      { id: "welcome", title: "Welcome offer", description: "For eligible members", reward: "See terms", terms: "One per account", active: true },
      { id: "paused", title: "Paused offer", active: false },
    ],
  }).expect(200);

  const response = await request(app).get("/api/promotions").set(memberHeaders).expect(200);
  assert.equal(response.body.promotions.length, 1);
  assert.equal(response.body.promotions[0].id, "welcome");
  assert.equal(database.readDb().platformSettings.promotions.length, 2);
});

test("profile pictures are authenticated, validated, and not exposed as server paths", async () => {
  const headers = { Authorization: `Bearer ${tokenFor(account)}` };
  await request(app).get("/api/auth/profile/avatar").expect(401);
  const profile = await request(app).get("/api/auth/me").set(headers).expect(200);
  assert.equal("avatarPath" in profile.body.user, false);

  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  await request(app)
    .post("/api/auth/profile/avatar")
    .set(headers)
    .attach("avatar", png, { filename: "profile.png", contentType: "image/png" })
    .expect(200);
  assert.match(database.readDb().users.find((user) => user.id === account.id).avatarPath, /^avatar-[\w-]+\.png$/);

  const image = await request(app).get("/api/auth/profile/avatar").set(headers).expect(200);
  assert.match(image.headers["content-type"], /image\/png/);
  assert.deepEqual(image.body, png);

  await request(app)
    .post("/api/auth/profile/avatar")
    .set(headers)
    .attach("avatar", Buffer.from("<svg/>"), { filename: "profile.svg", contentType: "image/svg+xml" })
    .expect(400);

  await request(app)
    .post("/api/auth/profile/avatar")
    .set(headers)
    .attach("avatar", Buffer.alloc(3 * 1024 * 1024 + 1, 0), { filename: "large.png", contentType: "image/png" })
    .expect(400);
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

test("provider request signing matches the documented sample", () => {
  const hash = signGameProviderParameters({
    traceId: "b3f37e57-2873-40b1aa95-f126c25ed311",
    operatorId: "abc123",
    token: "e89045458a990e04d684418a2b8a2228",
    gameId: 31010,
    language: "en",
  }, "2b5b996469686a8966c1205318811f08", "sfnbDdWvsRSHJvRdpiilKfxjZ8ZWRe3i");
  assert.equal(hash, "fbf68f91e250e4894e0f11923d3fc246");
});

test.skip("obsolete seamless game catalog and launch test", async () => {
  resetDatabase({ users: [{ ...account, country: "IN", balance: 500 }, admin] });
  const signingPayload = {
    gameId: 32001,
    language: "en",
    operatorId: process.env.GAME_OPERATOR_ID,
    traceId: "5c34af9c-1302-4934-9f31-cf9dfe712f98",
  };
  const canonical = "gameId=32001&language=en&operatorId=test-operator&traceId=5c34af9c-1302-4934-9f31-cf9dfe712f98&secret=test-game-secret&salt=test-game-salt";
  assert.equal(
    signGameProviderParameters(signingPayload),
    createHash("md5").update(canonical).digest("hex"),
  );
  const originalFetch = globalThis.fetch;
  const providerCalls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    providerCalls.push({ url: String(url), body });
    assert.equal(body.operatorId, process.env.GAME_OPERATOR_ID);
    assert.equal(body.hash, signGameProviderParameters(body));
    if (String(url).endsWith("/getGameList")) {
      return { ok: true, json: async () => ({
        data: [{ gameId: 32001, name: { en: "Mahjong Ways" }, provider: "PG", status: 0 }],
        error: 0,
      }) };
    }
    if (String(url).endsWith("/getGameURL")) {
      return { ok: true, json: async () => ({ data: { gameUrl: "https://games.provider.test/session" }, error: 0 }) };
    }
    throw new Error(`Unexpected provider URL ${url}`);
  };
  try {
    const token = tokenFor(account);
    const catalog = await request(app).get("/api/games").expect(200);
    assert.deepEqual(catalog.body.games, [{ id: 32001, name: "Mahjong Ways", provider: "PG", status: 0 }]);
    const launched = await request(app)
      .post("/api/games/32001/launch")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(200);
    assert.equal(launched.body.gameUrl, "https://games.provider.test/session");
    const launchRequest = providerCalls.find((call) => call.url.endsWith("/getGameURL"));
    assert.ok(launchRequest.body.token);
    assert.equal(launchRequest.body.language, "en");
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM game_sessions").get().count, 1);
    const storedTokenHash = database.db.prepare("SELECT token_hash FROM game_sessions").get().token_hash;
    assert.notEqual(storedTokenHash, launchRequest.body.token);
    assert.match(storedTokenHash, /^[a-f0-9]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.skip("obsolete seamless provider callback test", async () => {
  resetDatabase({ users: [{ ...account, country: "IN", balance: 500 }, admin] });
  const originalFetch = globalThis.fetch;
  let launchRequest;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith("/getGameList")) {
      return { ok: true, json: async () => ({
        data: [{ gameId: 32001, name: { en: "Mahjong Ways" }, provider: "PG", status: 0 }],
        error: 0,
      }) };
    }
    if (String(url).endsWith("/getGameURL")) {
      launchRequest = body;
      return { ok: true, json: async () => ({ data: { gameUrl: "https://games.provider.test/session" }, error: 0 }) };
    }
    throw new Error(`Unexpected provider URL ${url}`);
  };
  try {
    await request(app).post("/api/games/32001/launch")
      .set("Authorization", `Bearer ${tokenFor(account)}`)
      .send({})
      .expect(200);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const signed = (payload) => ({ ...payload, hash: signGameProviderParameters(payload) });
  const identity = {
    traceId: "5c34af9c-1302-4934-9f31-cf9dfe712f98",
    operatorId: process.env.GAME_OPERATOR_ID,
    token: launchRequest.token,
    gameId: 32001,
  };
  const verified = await request(app).post("/api/game-provider/verify").send(signed(identity)).expect(200);
  assert.equal(verified.body.error, 0);
  assert.equal(verified.body.data.currency, "INR");

  const balancePayload = signed({
    ...identity,
    traceId: "3eb05f54-48e2-47c6-85ac-7f07ad2844f2",
    playerId: verified.body.data.playerId,
    currency: verified.body.data.currency,
  });
  const balance = await request(app).post("/api/game-provider/balance").send(balancePayload).expect(200);
  assert.equal(balance.body.data.balance, 500);

  const bet = {
    ...identity,
    traceId: "e09a47fc-1592-4379-b702-50db1ca1b703",
    transactionId: "provider-bet-1",
    playerId: verified.body.data.playerId,
    currency: verified.body.data.currency,
    betAmount: 25,
    winAmount: 100,
    transferAmount: 75,
    isFeature: false,
    isEnd: true,
    isExtra: false,
    settleTime: 1727255876,
  };
  const first = await request(app).post("/api/game-provider/bet").send(signed(bet)).expect(200);
  assert.equal(first.body.error, 0);
  assert.equal(first.body.data.balance, 575);
  const retry = await request(app).post("/api/game-provider/bet").send(signed({
    ...bet,
    traceId: "23695949-27df-4e16-ad3b-dc74b4529c8b",
  })).expect(200);
  assert.equal(retry.body.error, 0);
  assert.equal(retry.body.data.balance, 575);
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 2);
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM provider_bets").get().count, 1);
});

test.skip("obsolete seamless game bet and signature test", async () => {
  resetDatabase({
    users: [{ ...account, country: "IN", balance: 500 }, admin],
    transactions: [{
      id: "reserved-withdrawal",
      userId: account.id,
      username: account.username,
      type: "withdrawal",
      amount: 200,
      status: "pending",
      createdAt: new Date().toISOString(),
    }],
  });
  database.ensureGamePlayer(account.id, "INR");
  database.createGameSession({
    token: "game-session-token",
    userId: account.id,
    playerId: database.db.prepare("SELECT player_id FROM game_players WHERE user_id = ?").get(account.id).player_id,
    currency: "INR",
    gameId: 32001,
    expiresAt: Date.now() + 60_000,
  });
  const signed = (payload) => ({ ...payload, hash: signGameProviderParameters(payload) });
  const payload = {
    traceId: "493df56c-3be6-47ab-9c2c-c44d90f08ed6",
    operatorId: process.env.GAME_OPERATOR_ID,
    token: "game-session-token",
    transactionId: "insufficient-bet",
    playerId: database.db.prepare("SELECT player_id FROM game_players WHERE user_id = ?").get(account.id).player_id,
    currency: "INR",
    gameId: 32001,
    betAmount: 301,
    winAmount: 500,
    transferAmount: 199,
    isFeature: false,
    isEnd: true,
    isExtra: false,
    settleTime: 1727255876,
  };
  const rejected = await request(app).post("/api/game-provider/bet").send(signed(payload)).expect(200);
  assert.equal(rejected.body.error, 1011);
  assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 500);
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 0);

  const invalidSignature = await request(app).post("/api/game-provider/balance").send({
    traceId: "9efba42c-34ed-4dda-8ed4-237bc2f0f9f4",
    operatorId: process.env.GAME_OPERATOR_ID,
    token: "game-session-token",
    playerId: payload.playerId,
    currency: "INR",
    hash: "00000000000000000000000000000000",
  }).expect(200);
  assert.equal(invalidSignature.body.error, 1004);
});

test("game catalog exposes provider signature rejection as an upstream error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ error: 1004, description: "Invalid hash code" }),
  });
  try {
    const response = await request(app).get("/api/games").expect(502);
    assert.equal(response.body.error, "Invalid hash code");
    assert.equal(response.body.code, 1004);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("game launch transfers only available funds once using a stable provider transaction", async () => {
  resetDatabase({
    users: [{ ...account, country: "IN", balance: 500 }, admin],
    transactions: [{
      id: "reserved-withdrawal",
      userId: account.id,
      username: account.username,
      type: "withdrawal",
      amount: 200,
      status: "pending",
      createdAt: new Date().toISOString(),
    }],
  });
  const originalFetch = globalThis.fetch;
  const transferIds = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith("/getGameList")) {
      return { ok: true, json: async () => ({
        data: [{ gameId: 32001, name: { en: "Mahjong Ways" }, provider: "PG", status: 0 }],
        error: 0,
      }) };
    }
    if (String(url).endsWith("/player/create")) {
      return { ok: true, json: async () => ({ data: {}, error: 0 }) };
    }
    if (String(url).endsWith("/transferIn")) {
      transferIds.push(body.transactionId);
      assert.equal(body.amount, "300.00");
      return { ok: true, json: async () => ({
        data: { transactionId: body.transactionId, amount: 300, balance: 300 },
        error: 0,
      }) };
    }
    if (String(url).endsWith("/loginGame")) {
      return { ok: true, json: async () => ({ data: { gameUrl: "https://games.provider.test/session" }, error: 0 }) };
    }
    throw new Error(`Unexpected provider URL ${url}`);
  };
  try {
    const token = tokenFor(account);
    const response = await request(app)
      .post("/api/games/32001/launch")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(200);
    assert.equal(response.body.gameUrl, "https://games.provider.test/session");
    assert.equal(response.body.balance, 200);
    assert.equal(transferIds.length, 1);
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 200);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 1);
    assert.equal(database.db.prepare("SELECT status FROM game_wallet_transfers").get().status, "completed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ambiguous game transfer retries with the same provider transaction ID", async () => {
  resetDatabase({ users: [{ ...account, country: "IN", balance: 500 }, admin] });
  const originalFetch = globalThis.fetch;
  const transferIds = [];
  let simulateTimeout = true;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith("/getGameList")) {
      return { ok: true, json: async () => ({
        data: [{ gameId: 32001, name: { en: "Mahjong Ways" }, provider: "PG", status: 0 }],
        error: 0,
      }) };
    }
    if (String(url).endsWith("/player/create")) {
      return { ok: true, json: async () => ({ data: {}, error: 0 }) };
    }
    if (String(url).endsWith("/transferIn")) {
      transferIds.push(body.transactionId);
      if (simulateTimeout) {
        simulateTimeout = false;
        throw new Error("simulated network timeout");
      }
      return { ok: true, json: async () => ({
        data: { transactionId: body.transactionId, amount: 500, balance: 500 },
        error: 0,
      }) };
    }
    if (String(url).endsWith("/loginGame")) {
      return { ok: true, json: async () => ({ data: { gameUrl: "https://games.provider.test/session" }, error: 0 }) };
    }
    throw new Error(`Unexpected provider URL ${url}`);
  };
  try {
    const token = tokenFor(account);
    await request(app).post("/api/games/32001/launch")
      .set("Authorization", `Bearer ${token}`).send({}).expect(502);
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 0);
    await request(app).post("/api/games/32001/launch")
      .set("Authorization", `Bearer ${token}`).send({}).expect(200);
    assert.equal(transferIds.length, 2);
    assert.equal(transferIds[0], transferIds[1]);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returning game funds credits the main wallet and ledger exactly once", async () => {
  resetDatabase({ users: [{ ...account, country: "IN", balance: 100 }, admin] });
  const player = database.ensureGamePlayer(account.id, "INR");
  database.markGamePlayerCreated(account.id);
  const originalFetch = globalThis.fetch;
  const transferIds = [];
  let simulateTimeout = true;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith("/getBalance")) {
      return { ok: true, json: async () => ({
        data: [{ playerId: player.playerId, currency: "INR", balance: 42.5 }],
        error: 0,
      }) };
    }
    if (String(url).endsWith("/transferOut")) {
      transferIds.push(body.transactionId);
      if (simulateTimeout) {
        simulateTimeout = false;
        throw new Error("simulated network timeout");
      }
      return { ok: true, json: async () => ({
        data: { transactionId: body.transactionId, amount: 42.5, balance: 0 },
        error: 0,
      }) };
    }
    throw new Error(`Unexpected provider URL ${url}`);
  };
  try {
    const token = tokenFor(account);
    const wallet = await request(app).get("/api/games/wallet")
      .set("Authorization", `Bearer ${token}`).expect(200);
    assert.equal(wallet.body.balance, 42.5);
    await request(app).post("/api/games/wallet/return")
      .set("Authorization", `Bearer ${token}`).send({}).expect(502);
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 100);
    const returned = await request(app).post("/api/games/wallet/return")
      .set("Authorization", `Bearer ${token}`).send({}).expect(200);
    assert.equal(transferIds.length, 2);
    assert.equal(transferIds[0], transferIds[1]);
    assert.equal(returned.body.amount, 42.5);
    assert.equal(returned.body.balance, 142.5);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 1);
    assert.equal(database.db.prepare("SELECT direction FROM game_wallet_transfers").get().direction, "out");
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 142.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
