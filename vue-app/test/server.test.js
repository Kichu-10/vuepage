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
process.env.HUIDU_SERVER_URL = "https://provider.test";
process.env.HUIDU_AGENCY_UID = "test-agency";
process.env.HUIDU_AES_KEY = "0123456789abcdef0123456789abcdef";
process.env.HUIDU_PLAYER_PREFIX = "h2f9cc";
process.env.GAME_CURRENCY_IN = "INR";
process.env.GAME_CURRENCY_PK = "PKR";
process.env.GAME_CURRENCY_NP = "NPR";
process.env.HUIDU_CATALOG_CACHE_DIR = path.join(tempDir, "catalog-cache");

const database = await import("../server/database.js");
const { createAuthRouter, createAdminAuthRouter, googleVerificationFailure } = await import("../server/routers/auth.js");
const { createWalletRouter } = await import("../server/routers/wallet.js");
const { createAdminRouter } = await import("../server/routers/admin.js");
const { createGamesRouter } = await import("../server/routers/games.js");
const { createPromotionsRouter } = await import("../server/routers/promotions.js");
const { createProfileRouter } = await import("../server/routers/profile.js");
const { createInboxRouter } = await import("../server/routers/inbox.js");
const { authenticate } = await import("../server/middleware/auth.js");
const { decryptHuiduPayload, displayCurrency, encryptHuiduPayload } = await import("../server/services/game-provider.js");
const testAesKey = process.env.HUIDU_AES_KEY;

const app = express();
app.use(express.json());
app.use("/api/auth", createAuthRouter());
app.use("/api/wallet", createWalletRouter(path.join(tempDir, "uploads")));
app.use("/api/games", createGamesRouter(path.join(tempDir, "uploads")));
app.use("/api/promotions", createPromotionsRouter(path.join(tempDir, "uploads")));
app.use("/api/auth", createProfileRouter(path.join(tempDir, "uploads")));
app.use("/api/admin", createAdminAuthRouter());
app.use("/api/admin", createAdminRouter(path.join(tempDir, "uploads")));
app.use("/api/inbox", createInboxRouter(authenticate));

const account = {
  id: "user-1",
  username: "testuser",
  country: "IN",
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

function decodeHuiduRequest(options) {
  const outer = JSON.parse(options.body);
  const payload = JSON.parse(decryptHuiduPayload(outer.payload, testAesKey));
  assert.equal(outer.agency_uid, process.env.HUIDU_AGENCY_UID);
  assert.equal(typeof payload.timestamp, "string");
  assert.equal(outer.timestamp, payload.timestamp);
  assert.equal(payload.agency_uid, process.env.HUIDU_AGENCY_UID);
  return payload;
}

function huiduResponse(payload) {
  return { ok: true, json: async () => ({ code: 0, msg: "", payload }) };
}

function resetDatabase({ users = [account, admin], transactions = [], notifications = [] } = {}) {
  for (const table of ["managed_games", "game_providers", "game_wallet_transfers", "game_players", "ledger_entries", "game_results"]) {
    database.db.exec(`DELETE FROM ${table}`);
  }
  database.db.prepare("UPDATE game_catalog_settings SET page_size = 24 WHERE id = 1").run();
  database.writeDb({
    users,
    transactions,
    otps: [],
    verifications: {},
    notifications,
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
  const session = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${login.body.token}`)
    .expect(200);
  assert.equal(session.body.user.username, "newuser");

  await request(app)
    .post("/api/auth/register")
    .send({ username: "x", email: "not-an-email", password: "123", country: "XX" })
    .expect(400);
});

test("platform settings are read independently from the application database snapshot", () => {
  database.writeDb({
    users: [account],
    transactions: [],
    otps: [],
    verifications: {},
    notifications: [],
    supportTickets: [],
    auditLogs: [],
    gameResults: [],
    platformSettings: { announcement: "Maintenance tonight", maintenanceMode: true },
  });
  assert.deepEqual(database.readPlatformSettings(), {
    announcement: "Maintenance tonight",
    maintenanceMode: true,
    supportEmail: "",
    supportPhone: "",
    supportHours: "",
    promotions: [],
  });
});

test("inbox reads are limited to the user's newest notifications and mark only that user's rows", async () => {
  const notifications = Array.from({ length: 105 }, (_, index) => ({
    id: `notification-${index}`,
    userId: account.id,
    type: "message",
    title: `Message ${index}`,
    message: `Body ${index}`,
    read: false,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  }));
  notifications.push({
    id: "other-user-notification",
    userId: "other-user",
    type: "message",
    title: "Other user's message",
    message: "Body",
    read: false,
    createdAt: new Date().toISOString(),
  });
  resetDatabase({
    users: [account, admin, { id: "other-user", username: "other", role: "user", balance: 0 }],
    notifications,
  });

  const response = await request(app)
    .get("/api/inbox")
    .set("Authorization", `Bearer ${tokenFor(account)}`)
    .expect(200);
  assert.equal(response.body.notifications.length, 100);
  assert.equal(response.body.notifications[0].id, "notification-104");
  assert.equal(response.body.unreadCount, 100);

  await request(app)
    .patch("/api/inbox/read")
    .set("Authorization", `Bearer ${tokenFor(account)}`)
    .expect(200);
  assert.equal(database.db.prepare("SELECT is_read FROM notifications WHERE id = ?").get("notification-104").is_read, 1);
  assert.equal(database.db.prepare("SELECT is_read FROM notifications WHERE id = ?").get("other-user-notification").is_read, 0);

  const plan = database.db.prepare(`
    EXPLAIN QUERY PLAN SELECT id FROM notifications
    WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100
  `).all(account.id);
  assert.ok(plan.some((row) => row.detail.includes("idx_notifications_user_created")));
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

test("admin bulk game actions import only available games and toggle selected listings", async () => {
  const originalFetch = globalThis.fetch;
  database.saveManagedProvider({ code: "pg", name: "PGSoft", enabled: true });
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname === "/game/providers") {
      return { ok: true, json: async () => ({
        code: 0,
        data: [{ code: "pg", name: "PGSoft", status: 1 }],
      }) };
    }
    if (requestUrl.pathname === "/game/list") {
      return { ok: true, json: async () => ({
        code: 0,
        data: [
          { game_uid: "game-1", game_name: "Game One", game_type: "Slots", status: 1 },
          { game_uid: "game-2", game_name: "Game Two", game_type: "Fishing", status: 1 },
          { game_uid: "game-3", game_name: "Unavailable Game", game_type: "Slots", status: 0 },
        ],
      }) };
    }
    throw new Error(`Unexpected provider URL ${url}`);
  };
  try {
    const headers = { Authorization: ["Bearer", tokenFor(admin)].join(" ") };
    const imported = await request(app).post("/api/admin/game-management/games/bulk").set(headers)
      .send({ providerCode: "pg", externalIds: ["game-1", "game-2", "game-3"] })
      .expect(201);
    assert.equal(imported.body.importedCount, 2);
    assert.equal(imported.body.skippedCount, 1);
    assert.equal(imported.body.skippedGames[0].reason, "unavailable");
    assert.equal(database.getManagedGame("game-1").enabled, false);
    assert.equal(database.getManagedGame("game-1").thumbnail, "");
    assert.equal(database.getManagedGame("game-2").category, "Fishing");

    const duplicate = await request(app).post("/api/admin/game-management/games/bulk").set(headers)
      .send({ providerCode: "pg", externalIds: ["game-1"] })
      .expect(200);
    assert.equal(duplicate.body.importedCount, 0);
    assert.equal(duplicate.body.skippedGames[0].reason, "already managed");
    await request(app).post("/api/admin/game-management/games/bulk").set(headers)
      .send({ providerCode: "pg", externalIds: ["game-1", "game-1"] })
      .expect(400);
    await request(app).post("/api/admin/game-management/games/bulk").set(headers)
      .send({ providerCode: "pg", externalIds: Array.from({ length: 501 }, (_, index) => `game-${index}`) })
      .expect(400);

    database.addManagedGame({
      providerCode: "pg",
      externalId: "game-4",
      name: "Unavailable Managed Game",
      providerStatus: 2,
    });
    const enabled = await request(app).patch("/api/admin/game-management/bulk-enabled").set(headers)
      .send({ gameIds: ["game-1", "game-2"], enabled: true })
      .expect(200);
    assert.equal(enabled.body.updatedCount, 2);
    assert.equal(database.getManagedGame("game-1").enabled, true);
    assert.equal(database.getManagedGame("game-2").enabled, true);

    await request(app).patch("/api/admin/game-management/bulk-enabled").set(headers)
      .send({ gameIds: ["game-1", "game-4"], enabled: true })
      .expect(409);
    assert.equal(database.getManagedGame("game-1").enabled, true);
    assert.equal(database.getManagedGame("game-4").enabled, false);

    const disabled = await request(app).patch("/api/admin/game-management/bulk-enabled").set(headers)
      .send({ gameIds: ["game-1", "game-2"], enabled: false })
      .expect(200);
    assert.equal(disabled.body.updatedCount, 2);
    assert.equal(database.getManagedGame("game-1").enabled, false);
    assert.equal(database.getManagedGame("game-2").enabled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin game management imports, publishes, paginates, and disables catalog entries", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname === "/game/providers") {
      return { ok: true, json: async () => ({
        code: 0,
        data: [
          { code: "pg", name: "PGSoft", status: 1 },
          { code: "jili", name: "JILI", status: 1 },
        ],
      }) };
    }
    if (requestUrl.pathname === "/game/list") {
      if (requestUrl.searchParams.get("code") === "jili") {
        return { ok: true, json: async () => ({
          code: 0,
          data: [{ game_uid: "game-3", game_name: "Game One", game_type: "Slots", status: 1 }],
        }) };
      }
      return { ok: true, json: async () => ({
        code: 0,
        data: [
          { game_uid: "game-1", game_name: "Game One", game_type: "Slots", status: 1 },
          { game_uid: "game-2", game_name: "Game Two", game_type: "Fishing", status: 1 },
        ],
      }) };
    }
    throw new Error(`Unexpected provider URL ${url}`);
  };
  try {
    const headers = { Authorization: `Bearer ${tokenFor(admin)}` };
    const initial = await request(app).get("/api/admin/game-management").set(headers).expect(200);
    assert.deepEqual(initial.body.stats, { totalProviders: 0, totalGames: 0, availableGames: 0, activeGames: 0, disabledGames: 0 });
    assert.deepEqual(initial.body.categories, ["Popular", "Mini Games", "Slots", "Fishing"]);
    assert.equal(initial.body.providerApiConfigured, true);
    assert.doesNotMatch(JSON.stringify(initial.body), /test-agency|0123456789abcdef/);

    const sources = await request(app).get("/api/admin/game-management/provider-catalog").set(headers).expect(200);
    assert.deepEqual(sources.body.providers, [{ code: "pg", name: "PGSoft" }, { code: "jili", name: "JILI" }]);
    const provider = await request(app).post("/api/admin/game-management/providers").set(headers)
      .send({ code: "pg" }).expect(201);
    assert.equal(provider.body.provider.enabled, false);

    const providerGames = await request(app).get("/api/admin/game-management/providers/pg/catalog").set(headers).expect(200);
    assert.equal(providerGames.body.games.length, 2);
    const firstGame = await request(app).post("/api/admin/game-management/games").set(headers)
      .send({ providerCode: "pg", externalId: "game-1", category: "Slots", thumbnail: "", sortOrder: 1 }).expect(201);
    assert.equal(firstGame.body.game.enabled, false);
    assert.equal(firstGame.body.game.isPopular, false);
    await request(app).post("/api/admin/game-management/games").set(headers)
      .send({ providerCode: "pg", externalId: "game-2", category: "Fishing", isPopular: true, sortOrder: 2 }).expect(201);
    await request(app).post("/api/admin/game-management/games").set(headers)
      .send({ providerCode: "pg", externalId: "game-1", category: "ProviderName" }).expect(400);
    await request(app).post("/api/admin/game-management/games").set(headers)
      .send({ providerCode: "pg", externalId: "game-1" }).expect(409);
    await request(app).post("/api/admin/game-management/providers").set(headers)
      .send({ code: "jili" }).expect(201);
    await request(app).post("/api/admin/game-management/games").set(headers)
      .send({ providerCode: "jili", externalId: "game-3" }).expect(409);
    assert.equal((await request(app).get("/api/games").expect(200)).body.total, 0);
    await request(app).post("/api/games/game-1/launch")
      .set("Authorization", `Bearer ${tokenFor(account)}`).send({ amount: 100 }).expect(404);

    await request(app).patch("/api/admin/game-management/providers/pg").set(headers)
      .send({ enabled: true }).expect(200);
    await request(app).patch("/api/admin/game-management/games/game-1").set(headers)
      .send({ enabled: true }).expect(200);
    await request(app).patch("/api/admin/game-management/games/game-2").set(headers)
      .send({ enabled: true }).expect(200);
    await request(app).patch("/api/admin/game-management/catalog-settings").set(headers)
      .send({ pageSize: 1 }).expect(200);

    const firstPage = await request(app).get("/api/games?page=1").expect(200);
    assert.equal(firstPage.body.pageSize, 1);
    assert.equal(firstPage.body.total, 2);
    assert.equal(firstPage.body.hasMore, true);
    const secondPage = await request(app).get("/api/games?page=2").expect(200);
    assert.equal(secondPage.body.games.length, 1);
    const categoryPage = await request(app).get("/api/games?category=Fishing").expect(200);
    assert.deepEqual(categoryPage.body.games.map((game) => game.id), ["game-2"]);
    assert.equal(categoryPage.body.games[0].isPopular, true);
    const popularPage = await request(app).get("/api/games?category=Popular").expect(200);
    assert.deepEqual(popularPage.body.games.map((game) => game.id), ["game-2"]);
    await request(app).patch("/api/admin/game-management/games/game-1").set(headers)
      .send({ category: "Mini Games", isPopular: true }).expect(200);
    const updatedPopularPage = await request(app).get("/api/games?category=Popular").expect(200);
    assert.equal(updatedPopularPage.body.total, 2);
    assert.deepEqual(updatedPopularPage.body.games.map((game) => game.id), ["game-1"]);
    await request(app).patch("/api/admin/game-management/games/game-1").set(headers)
      .send({ providerCode: "jili" }).expect(400);
    const miniGamesPage = await request(app).get("/api/games?category=Mini%20Games").expect(200);
    assert.equal(miniGamesPage.body.total, 1);
    await request(app).get("/api/games?category=Unknown").expect(400);
    const searchPage = await request(app).get("/api/games?search=Game%20One").expect(200);
    assert.deepEqual(searchPage.body.games.map((game) => game.id), ["game-1"]);

    const thumbnail = await request(app).post("/api/admin/game-management/games/game-1/thumbnail").set(headers)
      .attach("thumbnail", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), { filename: "game.png", contentType: "image/png" })
      .expect(200);
    assert.match(thumbnail.body.thumbnail, /^\/api\/games\/game-1\/thumbnail\/[a-f0-9-]+\.png$/);
    await request(app).get(thumbnail.body.thumbnail).expect(200);

    await request(app).delete("/api/admin/game-management/games/game-1").set(headers).expect(200);
    await request(app).get(thumbnail.body.thumbnail).expect(200);
    assert.equal((await request(app).get("/api/games").expect(200)).body.total, 1);
    assert.equal(database.getManagedGame("game-1").enabled, false);
    assert.equal(database.getManagedProvider("pg").enabled, true);
    assert.equal((await request(app).get("/api/admin/game-management").set(headers).expect(200)).body.stats.activeGames, 1);
    await request(app).patch("/api/admin/game-management/providers/pg").set(headers)
      .send({ enabled: false }).expect(200);
    assert.equal((await request(app).get("/api/games").expect(200)).body.total, 0);
    await request(app).get("/api/admin/game-management").expect(401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("homepage legacy categories filter enabled games without changing their managed category", async () => {
  const providerGames = [
    { code: "pg", name: "PGSoft", gameId: "pg-game", category: "Mini Games", gameType: "Table" },
    { code: "spribe", name: "Spribe", gameId: "spribe-game", category: "Mini Games", gameType: "Crash" },
    { code: "inout", name: "InOut", gameId: "inout-game", category: "Mini Games", gameType: "Arcade" },
  ];
  for (const item of providerGames) {
    database.saveManagedProvider({ code: item.code, name: item.name, enabled: true });
    database.addManagedGame({
      providerCode: item.code,
      externalId: item.gameId,
      name: item.name + " game",
      category: item.category,
      gameType: item.gameType,
      enabled: true,
      providerStatus: 0,
    });
  }

  const pgSlot = await request(app).get("/api/games?category=PG%20Slot").expect(200);
  assert.deepEqual(pgSlot.body.games.map((game) => game.id), ["pg-game"]);
  const spribe = await request(app).get("/api/games?category=Spribe").expect(200);
  assert.deepEqual(spribe.body.games.map((game) => game.id), ["spribe-game"]);
  const inout = await request(app).get("/api/games?category=InOut").expect(200);
  assert.deepEqual(inout.body.games.map((game) => game.id), ["inout-game"]);
  assert.equal(database.getManagedGame("spribe-game").category, "Mini Games");
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
      { id: "welcome", title: "Welcome offer", description: "For eligible members", reward: "See terms", terms: "One per account", bannerIncludesText: true, active: true },
      { id: "paused", title: "Paused offer", active: false },
    ],
  }).expect(200);

  const response = await request(app).get("/api/promotions").set(memberHeaders).expect(200);
  assert.equal(response.body.promotions.length, 1);
  assert.equal(response.body.promotions[0].id, "welcome");
  assert.equal(response.body.promotions[0].bannerIncludesText, true);
  assert.equal(database.readDb().platformSettings.promotions.length, 2);

  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const upload = await request(app)
    .post("/api/admin/promotions/welcome/banner")
    .set(adminHeaders)
    .attach("banner", png, { filename: "offer.png", contentType: "image/png" })
    .expect(200);
  assert.match(upload.body.promotion.bannerImage, /^promotion-[\w-]+\.png$/);
  const updatedPromotions = await request(app).get("/api/promotions").set(memberHeaders).expect(200);
  assert.equal(updatedPromotions.body.promotions[0].bannerUrl, "/api/promotions/welcome/banner");
  assert.equal((await request(app).get(updatedPromotions.body.promotions[0].bannerUrl).expect(200)).body.length, png.length);
  await request(app).post("/api/admin/promotions/welcome/banner")
    .set(memberHeaders)
    .attach("banner", png, { filename: "offer.png", contentType: "image/png" })
    .expect(403);
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

test("Google profile picture URLs persist in user records", () => {
  const pictureUrl = "https://lh3.googleusercontent.com/a/test-photo";
  resetDatabase({ users: [{ ...account, googlePictureUrl: pictureUrl }] });
  assert.equal(database.readDb().users[0].googlePictureUrl, pictureUrl);
});

test("Google clock-skew errors explain the fix without exposing token claims", () => {
  const error = new Error(
    'Token used too early, 1793692448.138 < 1793712847: {"email":"private@example.com","sub":"private-subject"}',
  );
  const failure = googleVerificationFailure(error);

  assert.equal(failure.reason, "token_clock_ahead");
  assert.equal(failure.skewHours, 5.7);
  assert.match(failure.message, /automatic date, time, and time zone/i);
  assert.doesNotMatch(JSON.stringify(failure), /private@example.com|private-subject/);
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

test("HUIDU uses AES-256-ECB with base64 and PKCS padding", () => {
  const plaintext = JSON.stringify({ agency_uid: "test-agency", timestamp: 1711524622000 });
  const ciphertext = encryptHuiduPayload(plaintext, testAesKey);
  assert.equal(decryptHuiduPayload(ciphertext, testAesKey), plaintext);
});

test("INR and NPR display as rupees while PKR keeps its currency code", () => {
  assert.equal(displayCurrency("INR"), "Rs.");
  assert.equal(displayCurrency("NPR"), "Rs.");
  assert.equal(displayCurrency("PKR"), "PKR");
});

test("game wallet currency follows the signed-in user's country", async () => {
  for (const [country, currency] of [["IN", "INR"], ["PK", "PKR"], ["NP", "NPR"]]) {
    const countryAccount = { ...account, country };
    resetDatabase({ users: [countryAccount, admin] });

    const wallet = await request(app)
      .get("/api/games/wallet")
      .set("Authorization", `Bearer ${tokenFor(countryAccount)}`)
      .expect(200);

    assert.deepEqual(wallet.body, { currency, balance: 0 });
  }
});

test("pending game-wallet lookups use the user and direction index", () => {
  const plan = database.db.prepare(`
    EXPLAIN QUERY PLAN SELECT * FROM game_wallet_transfers
    WHERE user_id = ? AND direction = ? AND status = 'pending'
    ORDER BY created_at LIMIT 1
  `).all(account.id, "in");
  assert.ok(plan.some((row) => row.detail.includes("idx_game_wallet_transfers_pending")));
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

test.skip("obsolete legacy-provider catalog error test", async () => {
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

test.skip("obsolete legacy-provider launch transfer test", async () => {
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

test.skip("obsolete legacy-provider transfer retry test", async () => {
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

test.skip("obsolete legacy-provider return-funds test", async () => {
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

test("Admin provider catalog errors are surfaced without exposing request credentials", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/game\/providers\?/);
    return { ok: true, json: async () => ({ code: 10022, msg: "Invalid parameters" }) };
  };
  try {
    const response = await request(app).get("/api/admin/game-management/provider-catalog")
      .set("Authorization", `Bearer ${tokenFor(admin)}`).expect(502);
    assert.equal(response.body.error, "Invalid parameters");
    assert.equal(response.body.code, 10022);
    assert.doesNotMatch(JSON.stringify(response.body), /test-agency|0123456789/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HUIDU maps supplier game UIDs and launches with an atomic wallet credit", async () => {
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
  database.saveManagedProvider({ code: "pg", name: "PGSoft", enabled: true });
  database.addManagedGame({
    providerCode: "pg",
    externalId: "83a6890cf84e4c5a6bacf96d5355d472",
    name: "Queen of Bounty",
    gameType: "Slot Game",
    category: "Slot Game",
    sortOrder: 1,
    enabled: true,
    providerStatus: 0,
  });
  database.addManagedGame({
    providerCode: "pg",
    externalId: "null-game-type",
    name: "Game without a type",
    sortOrder: 2,
    enabled: true,
    providerStatus: 0,
  });
  const originalFetch = globalThis.fetch;
  const transferIds = [];
  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname === "/game/providers") {
      return {
        ok: true,
        json: async () => ({ code: 0, msg: "Success", data: [{ code: "pg", name: "PGSoft", status: 1 }] }),
      };
    }
    if (requestUrl.pathname === "/game/list") {
      assert.equal(requestUrl.searchParams.get("code"), "pg");
      return {
        ok: true,
        json: async () => ({
          code: 0,
          msg: "Success",
          data: [{
            game_uid: "83a6890cf84e4c5a6bacf96d5355d472",
            game_name: "Queen of Bounty",
            game_type: "Slot Game",
            status: 1,
          }, {
            game_uid: "null-game-type",
            game_name: "Game without a type",
            game_type: null,
            status: 1,
          }],
        }),
      };
    }
    if (requestUrl.pathname === "/game/v2") {
      const payload = decodeHuiduRequest(options);
      transferIds.push(payload.transfer_id);
      assert.ok(payload.member_account.startsWith(process.env.HUIDU_PLAYER_PREFIX));
      assert.ok(payload.member_account.length <= 20);
      assert.equal(payload.game_uid, "83a6890cf84e4c5a6bacf96d5355d472");
      assert.equal(payload.credit_amount, "300.00");
      assert.equal(payload.currency_code, "INR");
      assert.equal(payload.platform, 2);
      return huiduResponse({
        game_launch_url: "https://games.provider.test/session",
        transfer_amount: "300.00",
        after_amount: "300.00",
        transfer_status: 1,
      });
    }
    throw new Error(`Unexpected HUIDU URL ${url}`);
  };
  try {
    const catalog = await request(app).get("/api/games").expect(200);
    assert.deepEqual(catalog.body.games, [{
      id: "83a6890cf84e4c5a6bacf96d5355d472",
      name: "Queen of Bounty",
      provider: "PGSoft",
      providerCode: "pg",
      gameType: "Slot Game",
      category: "Slots",
      isPopular: false,
      thumbnail: "",
      status: 0,
    }, {
      id: "null-game-type",
      name: "Game without a type",
      provider: "PGSoft",
      providerCode: "pg",
      gameType: "",
      category: "Mini Games",
      isPopular: false,
      thumbnail: "",
      status: 0,
    }]);

    const response = await request(app)
      .post("/api/games/83a6890cf84e4c5a6bacf96d5355d472/launch")
      .set("Authorization", `Bearer ${tokenFor(account)}`)
      .send({ amount: 300, platform: 2 })
      .expect(200);
    assert.equal(response.body.gameUrl, "https://games.provider.test/session");
    assert.equal(response.body.balance, 200);
    assert.equal(response.body.gameWalletBalance, 300);
    assert.equal(response.body.fundedAmount, 300);
    assert.equal(response.body.transactionId, transferIds[0]);
    assert.equal(transferIds.length, 1);
    assert.ok(transferIds[0]);
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 200);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 1);
    assert.equal(database.db.prepare("SELECT status FROM game_wallet_transfers").get().status, "completed");
    const insufficient = await request(app)
      .post("/api/games/83a6890cf84e4c5a6bacf96d5355d472/launch")
      .set("Authorization", `Bearer ${tokenFor(account)}`)
      .send({ amount: 100, platform: 2 })
      .expect(409);
    assert.equal(insufficient.body.error, "Insufficient available balance");
    assert.equal(transferIds.length, 1);
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 200);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("game funding rejects invalid decimal precision before contacting HUIDU", async () => {
  resetDatabase({ users: [{ ...account, country: "IN", balance: 500 }, admin] });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("HUIDU should not be called for invalid amounts");
  };
  try {
    const response = await request(app)
      .post("/api/games/83a6890cf84e4c5a6bacf96d5355d472/launch")
      .set("Authorization", `Bearer ${tokenFor(account)}`)
      .send({ amount: 100.001 })
      .expect(400);
    assert.match(response.body.error, /valid game wallet funding amount/i);
    assert.equal(fetchCalls, 0);
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 500);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM game_wallet_transfers").get().count, 0);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HUIDU ambiguous launch retries reuse the original transfer ID", async () => {
  resetDatabase({ users: [{ ...account, country: "IN", balance: 500 }, admin] });
  database.saveManagedProvider({ code: "pg", name: "PGSoft", enabled: true });
  database.addManagedGame({
    providerCode: "pg",
    externalId: "83a6890cf84e4c5a6bacf96d5355d472",
    name: "Queen of Bounty",
    enabled: true,
    providerStatus: 0,
  });
  const originalFetch = globalThis.fetch;
  const transferIds = [];
  let simulateTimeout = true;
  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname === "/game/v2") {
      const payload = decodeHuiduRequest(options);
      transferIds.push(payload.transfer_id);
      if (simulateTimeout) {
        simulateTimeout = false;
        throw new Error("simulated network timeout");
      }
      return huiduResponse({
        game_launch_url: "https://games.provider.test/session",
        transfer_amount: "500.00",
        after_amount: "500.00",
        transfer_status: 1,
      });
    }
    throw new Error(`Unexpected HUIDU URL ${url}`);
  };
  try {
    const headers = { Authorization: `Bearer ${tokenFor(account)}` };
    await request(app).post("/api/games/83a6890cf84e4c5a6bacf96d5355d472/launch")
      .set(headers).send({ amount: 500 }).expect(502);
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 0);
    const mismatch = await request(app).post("/api/games/83a6890cf84e4c5a6bacf96d5355d472/launch")
      .set(headers).send({ amount: 100 }).expect(409);
    assert.equal(mismatch.body.pendingAmount, 500);
    assert.equal(mismatch.body.transactionId, transferIds[0]);
    assert.equal(transferIds.length, 1);
    await request(app).post("/api/games/83a6890cf84e4c5a6bacf96d5355d472/launch")
      .set(headers).send({ amount: 500 }).expect(200);
    assert.equal(transferIds.length, 2);
    assert.equal(transferIds[0], transferIds[1]);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HUIDU wallet return queries the balance and credits the main wallet once", async () => {
  resetDatabase({ users: [{ ...account, country: "IN", balance: 100 }, admin] });
  const player = database.ensureGamePlayer(account.id, "INR");
  database.markGamePlayerCreated(account.id);
  const originalFetch = globalThis.fetch;
  const transferIds = [];
  let simulateTimeout = true;
  let providerBalanceCents = 4250;
  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname !== "/game/v2") throw new Error(`Unexpected HUIDU URL ${url}`);
    const payload = decodeHuiduRequest(options);
    if (Number(payload.credit_amount) === 0) {
      assert.equal(payload.currency_code, player.currency);
      return huiduResponse({ after_amount: (providerBalanceCents / 100).toFixed(2), transfer_status: 1 });
    }
    transferIds.push(payload.transfer_id);
    assert.equal(payload.credit_amount, "-42.50");
    if (simulateTimeout) {
      simulateTimeout = false;
      throw new Error("simulated network timeout");
    }
    providerBalanceCents = 0;
    return huiduResponse({
      transfer_amount: "42.50",
      after_amount: "0.00",
      transfer_status: 1,
    });
  };
  try {
    const headers = { Authorization: `Bearer ${tokenFor(account)}` };
    const wallet = await request(app).get("/api/games/wallet").set(headers).expect(200);
    assert.equal(wallet.body.currency, player.currency);
    assert.equal(wallet.body.balance, 42.5);
    await request(app).post("/api/games/wallet/return").set(headers).send({ balance: 999999, amount: 999999 }).expect(502);
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 100);
    const returned = await request(app).post("/api/games/wallet/return").set(headers).send({ balance: 999999, amount: 999999 }).expect(200);
    assert.equal(transferIds.length, 2);
    assert.equal(transferIds[0], transferIds[1]);
    assert.equal(returned.body.amount, 42.5);
    assert.equal(returned.body.remainingGameBalance, 0);
    assert.equal(returned.body.balance, 142.5);
    assert.equal(returned.body.transactionId, transferIds[0]);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 1);
    assert.equal(database.db.prepare("SELECT transaction_id FROM ledger_entries").get().transaction_id, returned.body.transactionId);
    assert.equal(database.db.prepare("SELECT direction FROM game_wallet_transfers").get().direction, "out");
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 142.5);
    assert.ok(player.playerId.startsWith(process.env.HUIDU_PLAYER_PREFIX));
    const repeated = await request(app).post("/api/games/wallet/return").set(headers).send({}).expect(200);
    assert.equal(repeated.body.amount, 0);
    assert.equal(repeated.body.transactionId, null);
    assert.equal(transferIds.length, 2);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 1);
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 142.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HUIDU duplicate return responses keep the original transfer pending for safe retry", async () => {
  resetDatabase({ users: [{ ...account, country: "IN", balance: 100 }, admin] });
  const player = database.ensureGamePlayer(account.id, "INR");
  database.markGamePlayerCreated(account.id);
  const originalFetch = globalThis.fetch;
  const transferIds = [];
  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname !== "/game/v2") throw new Error(`Unexpected HUIDU URL ${url}`);
    const payload = decodeHuiduRequest(options);
    if (Number(payload.credit_amount) === 0) {
      return huiduResponse({ after_amount: "12.00", transfer_status: 1 });
    }
    transferIds.push(payload.transfer_id);
    return {
      ok: true,
      json: async () => ({ code: 10027, msg: "Transfer already exists" }),
    };
  };
  try {
    const headers = { Authorization: `Bearer ${tokenFor(account)}` };
    const first = await request(app).post("/api/games/wallet/return").set(headers).send({}).expect(409);
    const second = await request(app).post("/api/games/wallet/return").set(headers).send({}).expect(409);
    assert.match(first.body.error, /outcome is uncertain and remains pending/i);
    assert.equal(second.body.code, 10027);
    assert.equal(transferIds.length, 2);
    assert.equal(transferIds[0], transferIds[1]);
    assert.equal(first.body.transactionId, transferIds[0]);
    assert.equal(database.db.prepare("SELECT status FROM game_wallet_transfers").get().status, "pending");
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 0);
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 100);
    assert.ok(player.playerId.startsWith(process.env.HUIDU_PLAYER_PREFIX));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Concurrent HUIDU wallet returns create at most one provider transfer", async () => {
  resetDatabase({ users: [{ ...account, country: "IN", balance: 100 }, admin] });
  database.ensureGamePlayer(account.id, "INR");
  database.markGamePlayerCreated(account.id);
  const originalFetch = globalThis.fetch;
  const transferIds = [];
  let balanceReads = 0;
  let releaseBalanceReads;
  const bothBalanceReads = new Promise((resolve) => {
    releaseBalanceReads = resolve;
  });
  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname !== "/game/v2") throw new Error(`Unexpected HUIDU URL ${url}`);
    const payload = decodeHuiduRequest(options);
    if (Number(payload.credit_amount) === 0) {
      balanceReads += 1;
      if (balanceReads === 2) releaseBalanceReads();
      await bothBalanceReads;
      return huiduResponse({ after_amount: "12.00", transfer_status: 1 });
    }
    transferIds.push(payload.transfer_id);
    return huiduResponse({
      transfer_amount: "12.00",
      after_amount: "0.00",
      transfer_status: 1,
    });
  };
  try {
    const headers = { Authorization: `Bearer ${tokenFor(account)}` };
    const [first, second] = await Promise.all([
      request(app).post("/api/games/wallet/return").set(headers).send({}),
      request(app).post("/api/games/wallet/return").set(headers).send({}),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    assert.equal(balanceReads, 2);
    assert.equal(transferIds.length, 1);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM game_wallet_transfers").get().count, 1);
    assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get().count, 1);
    assert.equal(database.readDb().users.find((user) => user.id === account.id).balance, 112);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
