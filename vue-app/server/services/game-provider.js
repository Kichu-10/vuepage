import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export class GameProviderError extends Error {
  constructor(message, status = 502, code = undefined) {
    super(message);
    this.name = "GameProviderError";
    this.status = status;
    this.code = code;
  }
}

function config() {
  const { GAME_API_BASE_URL, GAME_OPERATOR_ID, GAME_SECRET, GAME_SALT } = process.env;
  if (!GAME_API_BASE_URL || !GAME_OPERATOR_ID || !GAME_SECRET || !GAME_SALT) {
    throw new GameProviderError("Game provider is not configured", 503);
  }
  let baseUrl;
  try {
    baseUrl = new URL(GAME_API_BASE_URL);
  } catch {
    throw new GameProviderError("Game provider API URL is invalid", 503);
  }
  if (baseUrl.protocol !== "https:") {
    throw new GameProviderError("Game provider API must use HTTPS", 503);
  }
  return {
    baseUrl: baseUrl.toString().replace(/\/+$/, ""),
    operatorId: GAME_OPERATOR_ID,
    secret: GAME_SECRET,
    salt: GAME_SALT,
  };
}

function canonicalParameters(parameters, secret, salt) {
  const fields = Object.entries(parameters)
    .filter(([key, value]) => key !== "hash" && value !== undefined && value !== null && String(value) !== "")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${String(value)}`);
  fields.push(`secret=${secret}`, `salt=${salt}`);
  return fields.join("&");
}

export function signGameProviderParameters(parameters, secret, salt) {
  return createHash("md5").update(canonicalParameters(parameters, secret, salt)).digest("hex");
}

export function currencyForCountry(country) {
  const currency = country === "IN"
    ? process.env.GAME_CURRENCY_IN || "INR"
    : country === "PK"
      ? process.env.GAME_CURRENCY_PK || "PKR"
      : "";
  if (!/^[A-Z]{3}$/.test(currency)) throw new GameProviderError("No game currency is configured for this account", 409);
  return currency;
}

async function providerRequest(path, parameters) {
  const current = config();
  const body = { ...parameters, operatorId: current.operatorId };
  body.hash = signGameProviderParameters(body, current.secret, current.salt);

  let response;
  try {
    response = await fetch(`${current.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GameProviderError("Could not reach the game provider");
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new GameProviderError("Game provider returned an invalid response");
  }
  const code = Number(result?.error);
  if (!response.ok || !result || code !== 0) {
    const definitiveCode = response.ok && Number.isInteger(code) && code !== 0 ? code : undefined;
    throw new GameProviderError(
      typeof result?.message === "string" ? result.message :
        typeof result?.description === "string" ? result.description : "Game provider rejected the request",
      502,
      definitiveCode,
    );
  }
  return result.data;
}

const providerGameSchema = z.object({
  gameId: z.coerce.number().int().positive(),
  name: z.union([z.string(), z.object({ en: z.string().optional() })]),
  provider: z.string().trim().min(1).max(40),
  status: z.coerce.number().int().min(0).max(2),
});

export async function listProviderGames() {
  const data = await providerRequest("/gi/v2/getGameList", { traceId: randomUUID() });
  if (!Array.isArray(data)) throw new GameProviderError("Game provider returned an invalid game list");
  return data.map((item) => {
    const parsed = providerGameSchema.safeParse(item);
    if (!parsed.success) throw new GameProviderError("Game provider returned an invalid game entry");
    const name = typeof parsed.data.name === "string" ? parsed.data.name : parsed.data.name.en;
    if (!name?.trim()) throw new GameProviderError("Game provider returned a game without an English name");
    return {
      id: parsed.data.gameId,
      name: name.trim(),
      provider: parsed.data.provider,
      status: parsed.data.status,
    };
  });
}

export async function createProviderPlayer({ playerId, currency }) {
  try {
    await providerRequest("/gi/v2/player/create", {
      traceId: randomUUID(),
      playerId,
      currency,
    });
  } catch (error) {
    if (!(error instanceof GameProviderError) || error.code !== 1017) throw error;
  }
}

export async function getProviderGameWalletBalance(playerId) {
  const data = await providerRequest("/gi/v2/getBalance", {
    traceId: randomUUID(),
    playerIds: playerId,
  });
  const balances = Array.isArray(data) ? data : data ? [data] : [];
  const entry = balances.find((item) => item?.playerId === playerId);
  if (!entry || !/^\d+(?:\.\d{1,2})?$/.test(String(entry.balance))) {
    throw new GameProviderError("Game provider returned an invalid player balance");
  }
  return {
    currency: typeof entry.currency === "string" ? entry.currency : "",
    balance: Number(entry.balance),
  };
}

export async function transferFundsToProvider({ transactionId, playerId, amount }) {
  const data = await providerRequest("/gi/v2/transferIn", {
    traceId: randomUUID(),
    transactionId,
    playerId,
    amount: amount.toFixed(2),
  });
  return parseTransferResponse(data, transactionId);
}

export async function transferFundsFromProvider({ transactionId, playerId }) {
  const data = await providerRequest("/gi/v2/transferOut", {
    traceId: randomUUID(),
    transactionId,
    playerId,
    amount: "0.01",
    transferAll: 1,
  });
  return parseTransferResponse(data, transactionId);
}

function parseTransferResponse(data, transactionId) {
  if (!data || (data.transactionId && data.transactionId !== transactionId) ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(data.amount)) ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(data.balance))) {
    throw new GameProviderError("Game provider returned an invalid transfer response");
  }
  const amount = Number(data.amount);
  if (!Number.isSafeInteger(Math.round(amount * 100)) || amount <= 0) {
    throw new GameProviderError("Game provider returned an invalid transfer amount");
  }
  return {
    amountCents: Math.round(amount * 100),
    balanceCents: Math.round(Number(data.balance) * 100),
  };
}

export async function launchTransferWalletGame({ gameId, playerId }) {
  const data = await providerRequest("/gi/v2/loginGame", {
    traceId: randomUUID(),
    playerId,
    gameId,
    language: "en",
  });
  const gameUrl = typeof data?.gameUrl === "string" ? data.gameUrl : "";
  try {
    if (new URL(gameUrl).protocol !== "https:") throw new Error("Invalid URL protocol");
  } catch {
    throw new GameProviderError("Game provider returned an invalid launch URL");
  }
  return gameUrl;
}
