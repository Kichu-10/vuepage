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
  reservedWithdrawalCents,
  toCents,
} from "../database.js";
import { logger } from "../config/logger.js";
import {
  createProviderPlayer,
  GameProviderError,
  currencyForCountry,
  getProviderGameWalletBalance,
  launchTransferWalletGame,
  listProviderGames,
  transferFundsFromProvider,
  transferFundsToProvider,
} from "../services/game-provider.js";

function providerFailure(res, error, fallback) {
  if (error instanceof GameProviderError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  logger.error("game_wallet_request_failed", { error: error instanceof Error ? error.message : String(error) });
  return res.status(500).json({ error: fallback });
}

async function ensureProviderPlayer(userId, country) {
  const player = ensureGamePlayer(userId, currencyForCountry(country));
  if (!player.providerCreated) {
    await createProviderPlayer(player);
    markGamePlayerCreated(userId);
  }
  return { ...player, providerCreated: true };
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
      const wallet = await getProviderGameWalletBalance(player.playerId);
      res.json(wallet);
    } catch (error) {
      providerFailure(res, error, "Could not check the game wallet");
    }
  });

  router.post("/:gameId/launch", authenticate, async (req, res) => {
    const gameId = Number(req.params.gameId);
    if (!Number.isSafeInteger(gameId) || gameId <= 0) {
      return res.status(400).json({ error: "Invalid game" });
    }
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

      const player = await ensureProviderPlayer(user.id, user.country);
      const pendingOut = findPendingGameWalletTransfer(user.id, "out");
      if (pendingOut) return res.status(409).json({ error: "A game balance return is pending. Retry returning funds first." });

      transfer = findPendingGameWalletTransfer(user.id, "in");
      if (!transfer) {
        const availableCents = toCents(user.balance) - reservedWithdrawalCents(user.id);
        if (availableCents > 0) {
          transfer = beginGameWalletTransfer({
            id: randomUUID(),
            userId: user.id,
            playerId: player.playerId,
            currency: player.currency,
            direction: "in",
            amountCents: availableCents,
          });
        }
      }

      if (transfer) {
        try {
          const result = await transferFundsToProvider({
            transactionId: transfer.id,
            playerId: player.playerId,
            amount: transfer.amountCents / 100,
          });
          transfer = completeGameWalletTransfer({
            id: transfer.id,
            amountCents: result.amountCents,
            providerBalanceCents: result.balanceCents,
          }).transfer;
        } catch (error) {
          if (error instanceof GameProviderError && error.code !== undefined) {
            failGameWalletTransfer(transfer.id);
          }
          throw error;
        }
      }

      const gameUrl = await launchTransferWalletGame({ gameId, playerId: player.playerId });
      const currentUser = readDb().users.find((item) => item.id === user.id);
      res.json({ gameUrl, balance: currentUser?.balance ?? 0 });
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
      providerFailure(res, error, "Could not launch game");
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
        transfer = beginGameWalletTransfer({
          id: randomUUID(),
          userId: user.id,
          playerId: player.playerId,
          currency: player.currency,
          direction: "out",
          amountCents: 0,
        });
      }

      try {
        const result = await transferFundsFromProvider({
          transactionId: transfer.id,
          playerId: player.playerId,
        });
        const completed = completeGameWalletTransfer({
          id: transfer.id,
          amountCents: result.amountCents,
          providerBalanceCents: result.balanceCents,
        });
        res.json({
          message: "Game funds returned to your main wallet",
          amount: completed.transfer.amountCents / 100,
          balance: completed.balance,
          currency: player.currency,
        });
      } catch (error) {
        if (error instanceof GameProviderError && error.code !== undefined) {
          failGameWalletTransfer(transfer.id);
          if (error.code === 1011) {
            return res.status(409).json({ error: "There are no funds to return from the game wallet." });
          }
        }
        providerFailure(res, error, "Could not return game wallet funds");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Another game wallet transfer is still pending") {
        return res.status(409).json({ error: error.message });
      }
      providerFailure(res, error, "Could not return game wallet funds");
    }
  });

  return router;
}
