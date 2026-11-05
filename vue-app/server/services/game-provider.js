import { createCipheriv, createDecipheriv, createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { logger } from "../config/logger.js";

export class GameProviderError extends Error {
  constructor(message, status = 502, code = undefined) {
    super(message);
    this.name = "GameProviderError";
    this.status = status;
    this.code = code;
  }
}

function config() {
  const { HUIDU_SERVER_URL, HUIDU_AGENCY_UID, HUIDU_AES_KEY, HUIDU_PLAYER_PREFIX } = process.env;
  if (!HUIDU_SERVER_URL || !HUIDU_AGENCY_UID || !HUIDU_AES_KEY || !HUIDU_PLAYER_PREFIX) {
    throw new GameProviderError("HUIDU game provider is not configured", 503);
  }

  let baseUrl;
  try {
    baseUrl = new URL(HUIDU_SERVER_URL);
  } catch {
    throw new GameProviderError("HUIDU server URL is invalid", 503);
  }
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new GameProviderError("HUIDU server URL must be a clean HTTPS base URL", 503);
  }
  if (Buffer.byteLength(HUIDU_AES_KEY, "utf8") !== 32) {
    throw new GameProviderError("HUIDU AES key must be exactly 32 UTF-8 bytes", 503);
  }
  if (!/^[a-zA-Z0-9]{2,8}$/.test(HUIDU_PLAYER_PREFIX)) {
    throw new GameProviderError("HUIDU player prefix must contain 2–8 letters or numbers", 503);
  }

  return {
    baseUrl: baseUrl.toString().replace(/\/+$/, ""),
    agencyUid: HUIDU_AGENCY_UID,
    aesKey: Buffer.from(HUIDU_AES_KEY, "utf8"),
    playerPrefix: HUIDU_PLAYER_PREFIX,
  };
}

export function isHuiduConfigured() {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

export function encryptHuiduPayload(plaintext, aesKey) {
  const key = Buffer.isBuffer(aesKey) ? aesKey : Buffer.from(aesKey, "utf8");
  if (key.length !== 32) throw new TypeError("HUIDU AES key must be exactly 32 bytes");
  const cipher = createCipheriv("aes-256-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
}

export function decryptHuiduPayload(ciphertext, aesKey) {
  const key = Buffer.isBuffer(aesKey) ? aesKey : Buffer.from(aesKey, "utf8");
  if (key.length !== 32) throw new TypeError("HUIDU AES key must be exactly 32 bytes");
  const decipher = createDecipheriv("aes-256-ecb", key, null);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function currencyForCountry(country) {
  const currency = country === "IN"
    ? process.env.GAME_CURRENCY_IN || "INR"
    : country === "PK"
      ? process.env.GAME_CURRENCY_PK || "PKR"
      : country === "NP"
        ? process.env.GAME_CURRENCY_NP || "NPR"
        : "";
  if (!/^[A-Z]{3}$/.test(currency)) throw new GameProviderError("No game currency is configured for this account", 409);
  return currency;
}

export function displayCurrency(currency) {
  return currency === "INR" || currency === "NPR" ? "Rs." : currency;
}

export function huiduPlayerPrefix() {
  return config().playerPrefix;
}

async function readJsonResponse(response) {
  let result;
  try {
    result = await response.json();
  } catch {
    throw new GameProviderError("HUIDU returned an invalid response");
  }
  if (!response.ok) {
    const code = Number.isInteger(Number(result?.code)) ? Number(result.code) : undefined;
    throw new GameProviderError(typeof result?.msg === "string" && result.msg ? result.msg : "HUIDU rejected the request", 502, code);
  }
  if (!result || Number(result.code) !== 0) {
    const code = Number.isInteger(Number(result?.code)) ? Number(result.code) : undefined;
    throw new GameProviderError(typeof result?.msg === "string" && result.msg ? result.msg : "HUIDU rejected the request", 502, code);
  }
  return result;
}

async function providerGet(path, parameters) {
  const current = config();
  const url = new URL(`${current.baseUrl}${path}`);
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && String(value) !== "") url.searchParams.set(key, String(value));
  }

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GameProviderError("Could not reach HUIDU");
  }
  return readJsonResponse(response);
}

function parseEncryptedPayload(value, aesKey) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) throw new GameProviderError("HUIDU returned an invalid payload");

  for (const candidate of [value, (() => {
    try {
      return decryptHuiduPayload(value, aesKey);
    } catch {
      return "";
    }
  })()]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the other documented payload representation.
    }
  }
  throw new GameProviderError("HUIDU returned an invalid payload");
}

async function providerPost(path, parameters) {
  const current = config();
  const timestamp = Date.now();
  const responseBody = {
    agency_uid: current.agencyUid,
    timestamp: String(timestamp),
    payload: encryptHuiduPayload(JSON.stringify({
      ...parameters,
      agency_uid: current.agencyUid,
      timestamp: String(timestamp),
    }), current.aesKey),
  };

  let response;
  try {
    response = await fetch(`${current.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(responseBody),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GameProviderError("Could not reach HUIDU");
  }

  const result = await readJsonResponse(response);
  return parseEncryptedPayload(result.payload, current.aesKey);
}

const providerSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120).optional(),
  status: z.coerce.number().int().optional(),
});
const providerGameSchema = z.object({
  game_uid: z.union([z.string(), z.number()]).transform(String).pipe(z.string().trim().min(1).max(120)),
  game_name: z.string().trim().min(1).max(160),
  game_type: z.preprocess((value) => value === null ? "" : value, z.string().trim().max(80).optional().default("")),
  status: z.coerce.number().int(),
});

async function listGamesForProvider(provider) {
  const result = await providerGet("/game/list", {
    agency_uid: config().agencyUid,
    lang: "en",
    code: provider.code,
  });
  if (!Array.isArray(result.data)) throw new GameProviderError("HUIDU returned an invalid game list");

  return result.data.map((item) => {
    const parsed = providerGameSchema.safeParse(item);
    if (!parsed.success) throw new GameProviderError("HUIDU returned an invalid game entry");
    return {
      id: parsed.data.game_uid,
      name: parsed.data.game_name,
      provider: provider.name || provider.code,
      providerCode: provider.code,
      gameType: parsed.data.game_type,
      status: parsed.data.status === 1 ? 0 : 2,
    };
  });
}

let gamesCache;
let gamesCacheExpiresAt = 0;
let pendingCatalog;
let savedCatalogLoaded = false;
let savedCatalogLoading;
let catalogRetryAfter = 0;
let lastCatalogError;

const catalogCacheDurationMs = 6 * 60 * 60 * 1000;
const catalogRetryCooldownMs = 60 * 60 * 1000;
const catalogRequestIntervalMs = 5 * 1000;
const catalogCacheSchema = z.object({
  cachedAt: z.number().finite().optional(),
  retryAfter: z.number().finite().optional(),
  games: z.array(z.object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(160),
    provider: z.string().min(1).max(120),
    providerCode: z.string().min(1).max(80),
    gameType: z.string().max(80),
    status: z.number().int(),
  })).optional(),
}).refine((value) => value.games !== undefined || value.retryAfter !== undefined);

function catalogCachePath() {
  const current = config();
  const agencyKey = createHash("sha256")
    .update(`${current.baseUrl}\n${current.agencyUid}`)
    .digest("hex")
    .slice(0, 16);
  const cacheDirectory = process.env.HUIDU_CATALOG_CACHE_DIR
    ? path.resolve(process.env.HUIDU_CATALOG_CACHE_DIR)
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cache");
  return path.join(cacheDirectory, `huidu-games-${agencyKey}.json`);
}

async function saveCatalogCache() {
  if (!gamesCache && !catalogRetryAfter) return;
  const filePath = catalogCachePath();
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    const cache = {};
    if (gamesCache) {
      cache.cachedAt = gamesCacheExpiresAt - catalogCacheDurationMs;
      cache.games = gamesCache;
    }
    if (catalogRetryAfter) cache.retryAfter = catalogRetryAfter;
    await writeFile(temporaryPath, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    logger.warn("game_catalog_cache_write_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadSavedCatalog() {
  if (savedCatalogLoaded) return;
  if (!savedCatalogLoading) {
    savedCatalogLoading = (async () => {
      const filePath = catalogCachePath();
      try {
        const content = await readFile(filePath, "utf8");
        const parsed = catalogCacheSchema.safeParse(JSON.parse(content));
        if (!parsed.success) {
          logger.warn("game_catalog_cache_invalid", { path: filePath });
          return;
        }
        if (parsed.data.games && parsed.data.cachedAt) {
          gamesCache = parsed.data.games;
          gamesCacheExpiresAt = parsed.data.cachedAt + catalogCacheDurationMs;
        }
        catalogRetryAfter = parsed.data.retryAfter || 0;
        if (catalogRetryAfter > Date.now()) {
          lastCatalogError = new GameProviderError("HUIDU game catalog is cooling down after a rate limit", 503, 10030);
        }
        if (gamesCache) {
          logger.info("game_catalog_cache_loaded", {
            gameCount: gamesCache.length,
            stale: gamesCacheExpiresAt <= Date.now(),
          });
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          logger.warn("game_catalog_cache_read_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        savedCatalogLoaded = true;
      }
    })().finally(() => {
      savedCatalogLoading = undefined;
    });
  }
  await savedCatalogLoading;
}

function catalogRetryDelay() {
  return new Promise((resolve) => setTimeout(resolve, catalogRequestIntervalMs));
}

async function loadProviderGames() {
  const providers = await listAvailableProviderSources();

  const games = [];
  for (const [index, provider] of providers.entries()) {
    if (index > 0) await catalogRetryDelay();
    games.push(...await listGamesForProvider(provider));
  }
  return games;
}

async function refreshProviderGames() {
  if (catalogRetryAfter > Date.now()) {
    throw lastCatalogError || new GameProviderError("HUIDU game catalog is cooling down after a rate limit", 503, 10030);
  }
  if (!pendingCatalog) {
    pendingCatalog = loadProviderGames().then((games) => {
      gamesCache = games;
      gamesCacheExpiresAt = Date.now() + catalogCacheDurationMs;
      catalogRetryAfter = 0;
      lastCatalogError = undefined;
      return saveCatalogCache().then(() => games);
    }).catch(async (error) => {
      if (error instanceof GameProviderError && error.code === 10030) {
        lastCatalogError = error;
        catalogRetryAfter = Date.now() + catalogRetryCooldownMs;
        await saveCatalogCache();
      }
      throw error;
    }).finally(() => {
      pendingCatalog = undefined;
    });
  }
  return pendingCatalog;
}

export async function listAvailableProviderSources() {
  const current = config();
  const result = await providerGet("/game/providers", {
    agency_uid: current.agencyUid,
    lang: "en",
  });
  if (!Array.isArray(result.data)) throw new GameProviderError("HUIDU returned an invalid provider list");
  return result.data.map((provider) => {
    const parsed = providerSchema.safeParse(provider);
    if (!parsed.success) throw new GameProviderError("HUIDU returned an invalid provider entry");
    return parsed.data;
  }).filter((provider) => provider.status === undefined || provider.status === 1);
}

export async function listGamesFromProviderCode(providerCode) {
  if (typeof providerCode !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(providerCode)) {
    throw new GameProviderError("Invalid game provider", 400);
  }
  const provider = (await listAvailableProviderSources()).find((item) => item.code === providerCode);
  if (!provider) throw new GameProviderError("Provider is not available from HUIDU", 404);
  return listGamesForProvider(provider);
}

export async function listProviderGames() {
  await loadSavedCatalog();
  if (gamesCache && gamesCacheExpiresAt > Date.now()) return gamesCache;
  if (gamesCache) {
    if (catalogRetryAfter <= Date.now() && !pendingCatalog) {
      void refreshProviderGames().catch((error) => {
        logger.warn("game_catalog_refresh_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return gamesCache;
  }
  return refreshProviderGames();
}

function amountCents(value, label) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw new GameProviderError(`HUIDU returned an invalid ${label}`);
  }
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents)) throw new GameProviderError(`HUIDU returned an invalid ${label}`);
  return cents;
}

function validateTransferResult(payload, requestedCents) {
  const transferStatus = payload.transfer_status === undefined ? undefined : Number(payload.transfer_status);
  if (transferStatus !== undefined && transferStatus !== 1) {
    throw new GameProviderError("HUIDU could not complete the wallet transfer", 502, transferStatus);
  }
  const balanceValue = payload.after_amount ?? payload.credit_amount;
  const balanceCents = amountCents(balanceValue, "player balance");
  if (requestedCents !== 0 && transferStatus !== 1) {
    throw new GameProviderError("HUIDU did not confirm the wallet transfer status");
  }
  if (requestedCents !== 0 && payload.transfer_amount === undefined) {
    throw new GameProviderError("HUIDU did not confirm the wallet transfer amount");
  }
  if (requestedCents !== 0) {
    const transferredCents = amountCents(String(payload.transfer_amount).replace(/^-/, ""), "transfer amount");
    if (transferredCents !== Math.abs(requestedCents)) {
      throw new GameProviderError("HUIDU returned a mismatched transfer amount");
    }
  }
  return { amountCents: Math.abs(requestedCents), balanceCents };
}

async function gameWalletRequest({ playerId, currency, gameId, amountCents, transferId, platform }) {
  if (!Number.isSafeInteger(amountCents)) throw new TypeError("Game transfer amount must be a safe integer");
  const payload = await providerPost("/game/v2", {
    member_account: playerId,
    ...(gameId ? { game_uid: gameId } : {}),
    credit_amount: (amountCents / 100).toFixed(2),
    currency_code: currency,
    language: "en",
    ...(platform === undefined ? {} : { platform }),
    transfer_id: transferId,
  });
  const transfer = validateTransferResult(payload, amountCents);
  let gameUrl;
  if (gameId) {
    try {
      const url = new URL(payload.game_launch_url);
      if (url.protocol !== "https:") throw new Error("Invalid URL protocol");
      gameUrl = url.toString();
    } catch {
      throw new GameProviderError("HUIDU returned an invalid game launch URL");
    }
  }
  return { ...transfer, gameUrl };
}

export async function getProviderGameWalletBalance(playerId, currency) {
  const result = await gameWalletRequest({
    playerId,
    currency,
    amountCents: 0,
    transferId: randomUUID(),
  });
  return { currency, balance: result.balanceCents / 100 };
}

export async function launchTransferWalletGame({ gameId, playerId, currency, amountCents, transferId, platform }) {
  return gameWalletRequest({ gameId, playerId, currency, amountCents, transferId, platform });
}

export async function transferFundsFromProvider({ transactionId, playerId, currency, amountCents }) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new TypeError("Game wallet return amount must be positive");
  }
  return gameWalletRequest({
    playerId,
    currency,
    amountCents: -amountCents,
    transferId: transactionId,
  });
}
