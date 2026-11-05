import express from "express";
import { randomUUID } from "node:crypto";
import { authenticate } from "../middleware/auth.js";
import {
  beginGameWalletTransfer,
  completeGameWalletTransfer,
  ensureGamePlayer,
  failGameWalletTransfer,
  findPendingGameWalletTransfer,
  getGamePlayer,
  markGamePlayerCreated,
  readDb,
  toCents,
} from "../database.js";
import { logger } from "../config/logger.js";
import {
  GameProviderError,
  currencyForCountry,
  getProviderGameWalletBalance,
  huiduPlayerPrefix,
  launchTransferWalletGame,
  listProviderGames,
  transferFundsFromProvider,
} from "../services/game-provider.js";

function providerFailure(res, error, fallback, transferId = undefined) {
  if (error instanceof GameProviderError) {
    if (error.code === 10027) {
      return res.status(409).json({
        error: "HUIDU reports this transfer ID already exists. Its outcome is uncertain and remains pending; contact support for reconciliation.",
        code: error.code,
        ...(transferId ? { transactionId: transferId } : {}),
      });
    }
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  logger.error("game_wallet_request_failed", { error: error instanceof Error ? error.message : String(error) });
  return res.status(500).json({ error: fallback });
}

function ensureProviderPlayer(userId, country) {
  return ensureGamePlayer(userId, currencyForCountry(country), huiduPlayerPrefix());
}

export function createGamesRouter() {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    try {
      res.json({ games: await listProviderGames() });
    } catch (error) {
      const status = error instanceof GameProviderError ? error.status : 502;
      logger.warn("game_catalog_unavailable", {
        status,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(status).json({
        error: error instanceof GameProviderError ? error.message : "Could not load games",
        ...(error instanceof GameProviderError && error.code !== undefined ? { code: error.code } : {}),
      });
    }
  });

  router.get("/wallet", authenticate, async (req, res) => {
    try {
      const player = getGamePlayer(req.user.id);
      if (!player?.providerCreated) {
        const user = readDb().users.find((item) => item.id === req.user.id && item.status === "active");
        if (!user) return res.status(403).json({ error: "Account unavailable" });
        return res.json({ currency: currencyForCountry(user.country), balance: 0 });
      }
      const wallet = await getProviderGameWalletBalance(player.playerId, player.currency);
      res.json(wallet);
    } catch (error) {
      providerFailure(res, error, "Could not check the game wallet");
    }
  });

  router.post("/:gameId/launch", authenticate, async (req, res) => {
    const gameId = req.params.gameId;
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(gameId)) {
      return res.status(400).json({ error: "Invalid game" });
    }
    const amountValue = req.body?.amount;
    const amountText = typeof amountValue === "string" ? amountValue.trim() : String(amountValue ?? "");
    const amountCents = /^\d+(?:\.\d{1,2})?$/.test(amountText)
      ? toCents(Number(amountText))
      : null;
    const validAmount = Number.isSafeInteger(amountCents) && amountCents >= 10_000 && amountCents <= 10_000_000_000;
    if (amountText && !validAmount) {
      return res.status(400).json({ error: "Enter a valid game wallet funding amount" });
    }
    const platform = req.body?.platform === undefined ? 1 : Number(req.body.platform);
    if (![1, 2].includes(platform)) return res.status(400).json({ error: "Invalid game platform" });
    let transfer;
    try {
      const user = readDb().users.find(
        (item) => item.id === req.user.id && item.status === "active",
      );
      if (!user) return res.status(403).json({ error: "Account unavailable" });

      const games = await listProviderGames();
      const game = games.find((item) => item.id === gameId);
      if (!game) return res.status(404).json({ error: "Game not found" });
      if (game.status !== 0) return res.status(409).json({ error: "This game is currently unavailable" });

      const player = ensureProviderPlayer(user.id, user.country);
      const pendingOut = findPendingGameWalletTransfer(user.id, "out");
      if (pendingOut) return res.status(409).json({ error: "A game balance return is pending. Retry returning funds first." });

      transfer = findPendingGameWalletTransfer(user.id, "in");
      if (transfer && amountText && amountCents !== transfer.amountCents) {
        return res.status(409).json({
          error: `A previous funding transfer for ${transfer.amountCents / 100} is pending. Retry with that amount to safely complete it.`,
          transactionId: transfer.id,
          pendingAmount: transfer.amountCents / 100,
        });
      }
      if (!transfer) {
        if (!validAmount) {
          return res.status(400).json({ error: "Game wallet funding must be between 100 and 100000000" });
        }
        transfer = beginGameWalletTransfer({
          id: randomUUID(),
          userId: user.id,
          playerId: player.playerId,
          currency: player.currency,
          direction: "in",
          amountCents,
        });
      }

      try {
        const result = await launchTransferWalletGame({
          gameId,
          playerId: player.playerId,
          currency: player.currency,
          amountCents: transfer.amountCents,
          transferId: transfer.id,
          platform,
        });
        completeGameWalletTransfer({
          id: transfer.id,
          amountCents: transfer.amountCents,
          providerBalanceCents: result.balanceCents,
        });
        markGamePlayerCreated(user.id);
        const currentUser = readDb().users.find((item) => item.id === user.id);
        return res.json({
          gameUrl: result.gameUrl,
          balance: currentUser?.balance ?? 0,
          gameWalletBalance: result.balanceCents / 100,
          fundedAmount: transfer.amountCents / 100,
          transactionId: transfer.id,
        });
      } catch (error) {
        if (error instanceof GameProviderError && error.code !== undefined && error.code !== 10027) {
          failGameWalletTransfer(transfer.id);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Game currency is already fixed for this account") {
        return res.status(409).json({ error: error.message });
      }
      if (error instanceof Error && error.message === "Account unavailable") {
        return res.status(403).json({ error: error.message });
      }
      if (error instanceof Error && error.message === "Insufficient available balance") {
        return res.status(409).json({ error: error.message });
      }
      if (error instanceof Error && error.message === "Another game wallet transfer is still pending") {
        return res.status(409).json({ error: error.message });
      }
      providerFailure(res, error, "Could not launch game", transfer?.id);
    }
  });

  router.post("/wallet/return", authenticate, async (req, res) => {
    let transfer;
    try {
      const user = readDb().users.find(
        (item) => item.id === req.user.id && item.status === "active",
      );
      if (!user) return res.status(403).json({ error: "Account unavailable" });
      const player = getGamePlayer(user.id);
      if (!player?.providerCreated) return res.status(409).json({ error: "No game wallet has been created" });

      transfer = findPendingGameWalletTransfer(user.id, "out");
      if (!transfer) {
        const pendingIn = findPendingGameWalletTransfer(user.id, "in");
        if (pendingIn) return res.status(409).json({ error: "A transfer to the game wallet is pending. Retry launching the game first." });
        const wallet = await getProviderGameWalletBalance(player.playerId, player.currency);
        const amountCents = toCents(wallet.balance);
        if (amountCents <= 0) {
          const currentUser = readDb().users.find((item) => item.id === user.id && item.status === "active");
          if (!currentUser) return res.status(403).json({ error: "Account unavailable" });
          return res.json({
            message: "There are no funds to return from the game wallet.",
            amount: 0,
            remainingGameBalance: 0,
            balance: currentUser.balance,
            currency: player.currency,
            transactionId: null,
          });
        }
        transfer = beginGameWalletTransfer({
          id: randomUUID(),
          userId: user.id,
          playerId: player.playerId,
          currency: player.currency,
          direction: "out",
          amountCents,
        });
      }

      try {
        const result = await transferFundsFromProvider({
          transactionId: transfer.id,
          playerId: player.playerId,
          currency: player.currency,
          amountCents: transfer.amountCents,
        });
        const completed = completeGameWalletTransfer({
          id: transfer.id,
          amountCents: transfer.amountCents,
          providerBalanceCents: result.balanceCents,
        });
        res.json({
          message: "Game funds returned to your main wallet",
          amount: completed.transfer.amountCents / 100,
          remainingGameBalance: completed.transfer.providerBalanceCents / 100,
          balance: completed.balance,
          currency: player.currency,
          transactionId: completed.transfer.id,
        });
      } catch (error) {
        if (error instanceof GameProviderError && error.code !== undefined && error.code !== 10027) {
          failGameWalletTransfer(transfer.id);
          if (error.code === 1011) {
            return res.status(409).json({ error: "There are no funds to return from the game wallet." });
          }
        }
        providerFailure(res, error, "Could not return game wallet funds", transfer?.id);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Another game wallet transfer is still pending") {
        return res.status(409).json({ error: error.message });
      }
      providerFailure(res, error, "Could not return game wallet funds", transfer?.id);
    }
  });

  return router;
}
