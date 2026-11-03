import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const providerEnvironment = {
  HUIDU_SERVER_URL: "https://provider.test",
  HUIDU_AGENCY_UID: "catalog-test-agency",
  HUIDU_AES_KEY: "0123456789abcdef0123456789abcdef",
  HUIDU_PLAYER_PREFIX: "h2f9cc",
};

function setProviderEnvironment(cacheDirectory) {
  Object.assign(process.env, providerEnvironment, { HUIDU_CATALOG_CACHE_DIR: cacheDirectory });
}

function catalogResponse(data) {
  return { ok: true, json: async () => ({ code: 0, msg: "Success", data }) };
}

test("catalog refresh is paced and cached across service reloads", async () => {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "huidu-catalog-cache-test-"));
  const originalFetch = globalThis.fetch;
  setProviderEnvironment(cacheDirectory);
  const requestTimes = [];
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    requestTimes.push({ path: requestUrl.pathname, time: Date.now() });
    if (requestUrl.pathname === "/game/providers") {
      return catalogResponse([
        { code: "provider-one", name: "Provider One", status: 1 },
        { code: "provider-two", name: "Provider Two", status: 1 },
      ]);
    }
    return catalogResponse([{
      game_uid: `game-${requestUrl.searchParams.get("code")}`,
      game_name: "Test Game",
      game_type: null,
      status: 1,
    }]);
  };

  try {
    const firstService = await import("../server/services/game-provider.js?catalog-pacing-test");
    const games = await firstService.listProviderGames();
    assert.equal(games.length, 2);
    assert.equal(games[0].gameType, "");
    const gameListTimes = requestTimes.filter((request) => request.path === "/game/list").map((request) => request.time);
    assert.equal(gameListTimes.length, 2);
    assert.ok(gameListTimes[1] - gameListTimes[0] >= 900);

    globalThis.fetch = async () => {
      throw new Error("Fresh saved catalog should not call HUIDU");
    };
    const reloadedService = await import("../server/services/game-provider.js?catalog-cache-reload-test");
    assert.deepEqual(await reloadedService.listProviderGames(), games);
    assert.equal(requestTimes.length, 3);
    const cacheFiles = fs.readdirSync(cacheDirectory);
    assert.equal(cacheFiles.length, 1);
    const savedCache = JSON.parse(fs.readFileSync(path.join(cacheDirectory, cacheFiles[0]), "utf8"));
    assert.equal(savedCache.games.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }
});

test("HUIDU rate-limit responses trigger a persisted cooldown", async () => {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "huidu-catalog-cooldown-test-"));
  const originalFetch = globalThis.fetch;
  setProviderEnvironment(cacheDirectory);
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return { ok: true, json: async () => ({ code: 10030, msg: "Too many requests, please try again later" }) };
  };

  try {
    const service = await import("../server/services/game-provider.js?catalog-cooldown-test");
    await assert.rejects(service.listProviderGames(), { code: 10030 });
    await assert.rejects(service.listProviderGames(), { code: 10030 });
    assert.equal(requestCount, 1);

    const cacheFile = path.join(cacheDirectory, fs.readdirSync(cacheDirectory)[0]);
    const savedState = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    assert.ok(savedState.retryAfter > Date.now());
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }
});
