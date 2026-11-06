import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  addManagedGame,
  changeBalance,
  db,
  decideTransaction,
  getGameCatalogPageSize,
  getGameManagementStats,
  getManagedGame,
  getManagedProvider,
  listGameCategories,
  listManagedGames,
  listManagedProviders,
  readDb,
  saveManagedProvider,
  setGameCatalogPageSize,
  updateManagedGame,
  updateManagedGameEnabled,
  writeDb,
} from "../database.js";
import { approveTransaction } from "../services/wallet.js";
import { logger } from "../config/logger.js";
import {
  GameProviderError,
  currencyForCountry,
  displayCurrency,
  isHuiduConfigured,
  listAvailableProviderSources,
  listGamesFromProviderCode,
} from "../services/game-provider.js";

const transactionDecisionSchema = z.object({ status: z.enum(["approved", "rejected"]) });
const userUpdateSchema = z.object({
  status: z.enum(["active", "suspended"]).optional(),
  balance: z.number().finite().min(0).max(100000000).optional(),
  reason: z.string().trim().max(500).optional(),
}).refine((value) => value.status !== undefined || value.balance !== undefined, "Provide a status or balance update");
const kycReviewSchema = z.object({ status: z.enum(["verified", "rejected"]), note: z.string().trim().max(1000).optional().default("") });
const settingsSchema = z.object({
  announcement: z.string().trim().max(500).default(""),
  maintenanceMode: z.boolean().default(false),
  supportEmail: z.string().trim().email().or(z.literal("")).default(""),
  supportPhone: z.string().trim().max(40).default(""),
  supportHours: z.string().trim().max(100).default(""),
  promotions: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).default(""),
    reward: z.string().trim().max(160).default(""),
    terms: z.string().trim().max(1000).default(""),
    bannerImage: z.string().trim().max(100).regex(/^(|promotion-[a-f0-9-]+\.(jpg|png|webp))$/i).default(""),
    bannerIncludesText: z.boolean().default(false),
    active: z.boolean().default(true),
  })).max(20).default([]),
});
const gameResultSchema = z.object({
  userId: z.string().min(1),
  category: z.enum(["bet", "lottery", "game"]),
  gameName: z.string().trim().max(100).optional().default(""),
  outcome: z.enum(["won", "lost"]),
  amount: z.coerce.number().finite().min(0).max(100000000),
  reference: z.string().trim().max(150).optional().default(""),
});
const providerCodeSchema = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const managedProviderSchema = z.object({
  code: providerCodeSchema,
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional().default(false),
});
const providerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.enabled !== undefined, "Provide provider changes");
function validThumbnail(value) {
  return !value || (value.startsWith("/") && !value.startsWith("//")) || /^https:\/\//i.test(value);
}
const gameImportSchema = z.object({
  providerCode: providerCodeSchema,
  externalId: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/),
  category: z.enum(["Mini Games", "Slots", "Fishing"]).optional().default("Mini Games"),
  isPopular: z.boolean().optional().default(false),
  thumbnail: z.string().trim().max(500).optional().default("").refine(
    validThumbnail,
    "Thumbnail must be an HTTPS URL or a site-relative path",
  ),
  sortOrder: z.number().int().min(-100000).max(100000).optional().default(0),
});
const gameUpdateSchema = z.object({
  providerCode: providerCodeSchema.optional(),
  name: z.string().trim().min(1).max(160).optional(),
  thumbnail: z.string().trim().max(500).optional().refine(
    (value) => value === undefined || validThumbnail(value),
    "Thumbnail must be an HTTPS URL or a site-relative path",
  ),
  category: z.enum(["Mini Games", "Slots", "Fishing"]).optional(),
  sortOrder: z.number().int().min(-100000).max(100000).optional(),
  isPopular: z.boolean().optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "Provide game changes");
const catalogSettingsSchema = z.object({
  pageSize: z.number().int().min(1).max(100),
});

function recordGameManagementAudit(adminUserId, action, target, details) {
  const admin = db.prepare("SELECT username FROM users WHERE id = ?").get(adminUserId);
  db.prepare(`
    INSERT INTO audit_logs (id, admin_username, action, target, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), admin?.username || "admin", action, target, details, new Date().toISOString());
  db.prepare(`
    DELETE FROM audit_logs
    WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY created_at DESC, rowid DESC LIMIT 1000)
  `).run();
}

function catalogFailure(res, error, fallback) {
  if (error instanceof GameProviderError) {
    return res.status(error.status).json({ error: error.message, ...(error.code === undefined ? {} : { code: error.code }) });
  }
  logger.error("admin_game_management_failed", { error: error instanceof Error ? error.message : String(error) });
  return res.status(502).json({ error: fallback });
}

function addAudit(db, adminUsername, action, target, details = "") {
  db.auditLogs ||= [];
  db.auditLogs.unshift({ id: randomUUID(), adminUsername, action, target, details, createdAt: new Date().toISOString() });
  db.auditLogs.length = Math.min(db.auditLogs.length, 1000);
}

function addNotification(db, userId, type, title, message, relatedId = "") {
  db.notifications ||= [];
  db.notifications.unshift({
    id: randomUUID(), userId, type, title, message, relatedId, read: false, createdAt: new Date().toISOString(),
  });
  db.notifications.length = Math.min(db.notifications.length, 1000);
}

function publicUser(user) {
  const { passwordHash, avatarPath, ...safeUser } = user;
  return safeUser;
}

function identifyPromotionImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return "";
}

export function createAdminRouter(uploadDir) {
  const router = express.Router();
  const promotionImageDir = path.join(uploadDir, "promotion-banners");
  const gameThumbnailDir = path.join(uploadDir, "game-thumbnails");
  const providerLogoDir = path.join(uploadDir, "provider-logos");
  fs.mkdirSync(promotionImageDir, { recursive: true });
  fs.mkdirSync(gameThumbnailDir, { recursive: true });
  fs.mkdirSync(providerLogoDir, { recursive: true });
  const uploadPromotionImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
  });
  const uploadGameThumbnail = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 3 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
  });
  const uploadProviderLogo = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 3 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
  });
  router.use((req, res, next) => req.path === "/auth/login" ? next() : authenticate(req, res, next));
  router.use((req, res, next) => req.path === "/auth/login" ? next() : requireAdmin(req, res, next));

  router.get("/promotions/:id/banner", (req, res) => {
    const promotion = (readDb().platformSettings?.promotions || []).find((item) => item.id === req.params.id);
    if (!promotion?.bannerImage) return res.status(404).json({ error: "Promotion banner not found" });
    const filename = path.basename(promotion.bannerImage);
    const filePath = path.join(promotionImageDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Promotion banner not found" });
    res.setHeader("Cache-Control", "private, no-store");
    res.type(path.extname(filename));
    res.sendFile(filePath, { dotfiles: "deny" }, (error) => {
      if (error && !res.headersSent) res.status(error.statusCode || 500).json({ error: "Could not load promotion banner" });
    });
  });

  router.post("/promotions/:id/banner", (req, res, next) => {
    uploadPromotionImage.single("banner")(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Promotion banners must be 5 MB or smaller" });
      }
      if (error) return next(error);
      next();
    });
  }, (req, res) => {
    const db = readDb();
    const promotion = (db.platformSettings?.promotions || []).find((item) => item.id === req.params.id);
    if (!promotion) return res.status(404).json({ error: "Promotion not found" });
    if (!req.file) return res.status(400).json({ error: "Upload a valid JPEG, PNG, or WebP banner image" });

    const extension = identifyPromotionImage(req.file.buffer);
    if (!extension) return res.status(400).json({ error: "The banner is not a valid JPEG, PNG, or WebP image" });

    const previousImage = promotion.bannerImage;
    promotion.bannerImage = `promotion-${randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(promotionImageDir, promotion.bannerImage), req.file.buffer, { flag: "wx" });
    try {
      const admin = db.users.find((item) => item.id === req.user.id);
      addAudit(db, admin?.username || "admin", "PROMOTION_BANNER_UPLOADED", promotion.title || promotion.id, "Promotion banner artwork updated");
      writeDb(db);
    } catch (error) {
      fs.rmSync(path.join(promotionImageDir, promotion.bannerImage), { force: true });
      throw error;
    }

    if (previousImage && previousImage !== promotion.bannerImage) {
      try {
        fs.rmSync(path.join(promotionImageDir, path.basename(previousImage)), { force: true });
      } catch (error) {
        logger.warn("promotion_banner_cleanup_failed", {
          promotionId: promotion.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    res.json({ promotion });
  });

  router.get("/game-management", (_req, res) => {
    const providers = listManagedProviders();
    const games = listManagedGames();
    res.json({
      providers,
      games,
      categories: listGameCategories(),
      stats: getGameManagementStats(),
      pageSize: getGameCatalogPageSize(),
      providerApiConfigured: isHuiduConfigured(),
    });
  });

  router.get("/game-management/provider-catalog", async (_req, res) => {
    try {
      const providers = await listAvailableProviderSources();
      res.json({
        providers: providers.map(({ code, name }) => ({ code, name: name || code })),
        providerApiConfigured: true,
      });
    } catch (error) {
      catalogFailure(res, error, "Could not load available providers");
    }
  });

  router.post("/game-management/providers", validate(managedProviderSchema), async (req, res) => {
    try {
      const sources = await listAvailableProviderSources();
      const source = sources.find((provider) => provider.code === req.body.code);
      if (!source) return res.status(400).json({ error: "Select a provider available from HUIDU" });
      const provider = saveManagedProvider({
        code: source.code,
        name: req.body.name || source.name || source.code,
        enabled: req.body.enabled,
      });
      recordGameManagementAudit(req.user.id, "GAME_PROVIDER_SAVED", provider.name, `Provider ${provider.enabled ? "enabled" : "added disabled"}`);
      res.status(201).json({ provider });
    } catch (error) {
      catalogFailure(res, error, "Could not add game provider");
    }
  });

  router.patch("/game-management/providers/:code", validate(providerUpdateSchema), (req, res) => {
    const existing = getManagedProvider(req.params.code);
    if (!existing) return res.status(404).json({ error: "Game provider not found" });
    const provider = saveManagedProvider({
      code: existing.code,
      name: req.body.name || existing.name,
      enabled: req.body.enabled ?? existing.enabled,
    });
    try {
      recordGameManagementAudit(
        req.user.id,
        "GAME_PROVIDER_UPDATED",
        provider.name,
        `Provider ${provider.enabled ? "enabled" : "disabled"}`,
      );
      res.json({ provider });
    } catch (error) {
      logger.error("admin_game_provider_audit_failed", { providerCode: provider.code, error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Provider was updated, but its audit record could not be saved" });
    }
  });

  router.post("/game-management/providers/:code/logo", (req, res, next) => {
    uploadProviderLogo.single("logo")(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Provider logos must be 3 MB or smaller" });
      }
      if (error) return next(error);
      next();
    });
  }, async (req, res) => {
    const provider = getManagedProvider(req.params.code);
    if (!provider) return res.status(404).json({ error: "Game provider not found" });
    if (!req.file) return res.status(400).json({ error: "Upload a valid JPEG, PNG, or WebP logo" });

    const extension = identifyPromotionImage(req.file.buffer);
    if (!extension) return res.status(400).json({ error: "The logo is not a valid JPEG, PNG, or WebP image" });

    const filename = `${randomUUID()}.${extension}`;
    const filePath = path.join(providerLogoDir, filename);
    const logoUrl = `/api/games/providers/${encodeURIComponent(provider.code)}/logo/${filename}`;
    let logoUpdated = false;
    try {
      await fs.promises.writeFile(filePath, req.file.buffer, { flag: "wx" });
      const updatedProvider = saveManagedProvider({
        code: provider.code,
        name: provider.name,
        enabled: provider.enabled,
        logo: logoUrl,
      });
      logoUpdated = true;
      recordGameManagementAudit(req.user.id, "GAME_PROVIDER_LOGO_UPDATED", provider.name, "Provider logo uploaded");
      if (provider.logo.startsWith(`/api/games/providers/${encodeURIComponent(provider.code)}/logo/`)) {
        const oldFilename = path.basename(provider.logo);
        if (oldFilename !== filename) {
          await fs.promises.rm(path.join(providerLogoDir, oldFilename), { force: true }).catch((error) => {
            logger.warn("admin_provider_logo_cleanup_failed", { providerCode: provider.code, error: error instanceof Error ? error.message : String(error) });
          });
        }
      }
      res.json({ logo: logoUrl, provider: updatedProvider });
    } catch (error) {
      if (!logoUpdated) await fs.promises.rm(filePath, { force: true });
      logger.error("admin_provider_logo_upload_failed", { providerCode: provider.code, error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({
        error: logoUpdated
          ? "Provider logo was updated, but its audit record could not be saved"
          : "Could not update provider logo",
      });
    }
  });

  router.get("/game-management/providers/:code/catalog", async (req, res) => {
    if (!getManagedProvider(req.params.code)) return res.status(404).json({ error: "Game provider not found" });
    try {
      res.json({ games: await listGamesFromProviderCode(req.params.code) });
    } catch (error) {
      catalogFailure(res, error, "Could not load games from this provider");
    }
  });

  router.post("/game-management/games", validate(gameImportSchema), async (req, res) => {
    const provider = getManagedProvider(req.body.providerCode);
    if (!provider) return res.status(404).json({ error: "Add this provider before importing its games" });
    try {
      const sourceGames = await listGamesFromProviderCode(provider.code);
      const sourceGame = sourceGames.find((game) => game.id === req.body.externalId);
      if (!sourceGame) return res.status(400).json({ error: "Select a game available from the chosen provider" });
      const game = addManagedGame({
        providerCode: provider.code,
        externalId: sourceGame.id,
        name: sourceGame.name,
        thumbnail: req.body.thumbnail,
        category: req.body.category,
        isPopular: req.body.isPopular,
        gameType: sourceGame.gameType,
        sortOrder: req.body.sortOrder,
        enabled: false,
        providerStatus: sourceGame.status,
      });
      recordGameManagementAudit(req.user.id, "GAME_IMPORTED", game.name, `Imported from ${provider.name}; disabled until explicitly enabled`);
      res.status(201).json({ game });
    } catch (error) {
      if (String(error?.code || "").startsWith("ERR_SQLITE_CONSTRAINT") || String(error?.message || "").includes("constraint failed")) {
        return res.status(409).json({ error: "This game or a game with the same name is already managed" });
      }
      catalogFailure(res, error, "Could not add game");
    }
  });

  router.patch("/game-management/games/:id", validate(gameUpdateSchema), async (req, res) => {
    const existing = getManagedGame(req.params.id);
    if (!existing) return res.status(404).json({ error: "Managed game not found" });
    if (req.body.enabled === true && existing.providerStatus !== 0) {
      return res.status(409).json({ error: "This provider currently reports the game as unavailable" });
    }
    let selectedSourceGame;
    if (req.body.providerCode && req.body.providerCode !== existing.providerCode) {
      const provider = getManagedProvider(req.body.providerCode);
      if (!provider) return res.status(404).json({ error: "Select a managed game provider" });
      try {
        const sourceGames = await listGamesFromProviderCode(provider.code);
        selectedSourceGame = sourceGames.find((game) => game.id === existing.externalId);
        if (!selectedSourceGame) {
          return res.status(400).json({ error: "The selected provider does not have this game ID" });
        }
      } catch (error) {
        return catalogFailure(res, error, "Could not verify the selected game provider");
      }
      if (req.body.enabled === true && selectedSourceGame.status !== 0) {
        return res.status(409).json({ error: "The selected provider reports this game as unavailable" });
      }
    }
    try {
      const game = updateManagedGame(existing.id, {
        ...req.body,
        ...(selectedSourceGame ? {
          gameType: selectedSourceGame.gameType,
          providerStatus: selectedSourceGame.status,
        } : {}),
      });
      recordGameManagementAudit(req.user.id, "GAME_UPDATED", game.name, `Game ${game.enabled ? "enabled" : "disabled or updated"}`);
      res.json({ game });
    } catch (error) {
      if (String(error?.code || "").startsWith("ERR_SQLITE_CONSTRAINT") || String(error?.message || "").includes("constraint failed")) {
        return res.status(409).json({ error: "A managed game with this name already exists" });
      }
      logger.error("admin_managed_game_update_failed", { gameId: existing.id, error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Could not update game" });
    }
  });

  router.post("/game-management/games/:id/thumbnail", (req, res, next) => {
    uploadGameThumbnail.single("thumbnail")(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Game thumbnails must be 3 MB or smaller" });
      }
      if (error) return next(error);
      next();
    });
  }, async (req, res) => {
    const game = getManagedGame(req.params.id);
    if (!game) return res.status(404).json({ error: "Managed game not found" });
    if (!req.file) return res.status(400).json({ error: "Upload a valid JPEG, PNG, or WebP thumbnail" });
    const extension = identifyPromotionImage(req.file.buffer);
    if (!extension) return res.status(400).json({ error: "The thumbnail is not a valid JPEG, PNG, or WebP image" });

    const filename = `${randomUUID()}.${extension}`;
    const filePath = path.join(gameThumbnailDir, filename);
    const thumbnailUrl = `/api/games/${encodeURIComponent(game.id)}/thumbnail/${filename}`;
    let thumbnailUpdated = false;
    try {
      await fs.promises.writeFile(filePath, req.file.buffer, { flag: "wx" });
      const updatedGame = updateManagedGame(game.id, { thumbnail: thumbnailUrl });
      if (!updatedGame) throw new Error("Managed game disappeared during thumbnail upload");
      thumbnailUpdated = true;
      recordGameManagementAudit(req.user.id, "GAME_THUMBNAIL_UPDATED", game.name, "Game thumbnail uploaded");
      if (game.thumbnail.startsWith(`/api/games/${encodeURIComponent(game.id)}/thumbnail/`)) {
        const oldFilename = path.basename(game.thumbnail);
        if (oldFilename !== filename) {
          await fs.promises.rm(path.join(gameThumbnailDir, oldFilename), { force: true }).catch((error) => {
            logger.warn("admin_game_thumbnail_cleanup_failed", { gameId: game.id, error: error instanceof Error ? error.message : String(error) });
          });
        }
      }
      res.json({ thumbnail: thumbnailUrl, game: getManagedGame(game.id) });
    } catch (error) {
      if (!thumbnailUpdated) await fs.promises.rm(filePath, { force: true });
      logger.error("admin_game_thumbnail_upload_failed", { gameId: game.id, error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({
        error: thumbnailUpdated
          ? "Thumbnail was updated, but its audit record could not be saved"
          : "Could not update game thumbnail",
      });
    }
  });

  router.delete("/game-management/games/:id", (req, res) => {
    const existing = getManagedGame(req.params.id);
    if (!existing) return res.status(404).json({ error: "Managed game not found" });
    try {
      const game = updateManagedGameEnabled(existing.id, false);
      recordGameManagementAudit(req.user.id, "GAME_REMOVED_FROM_PUBLIC_LIST", game.name, "Game disabled; provider and game records retained");
      res.json({ game });
    } catch (error) {
      logger.error("admin_managed_game_disable_failed", { gameId: existing.id, error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Could not remove game from the public listing" });
    }
  });

  router.patch("/game-management/catalog-settings", validate(catalogSettingsSchema), (req, res) => {
    const pageSize = setGameCatalogPageSize(req.body.pageSize);
    try {
      recordGameManagementAudit(req.user.id, "GAME_CATALOG_PAGE_SIZE_UPDATED", "Public game catalog", `Page size set to ${pageSize}`);
      res.json({ pageSize });
    } catch (error) {
      logger.error("admin_game_catalog_settings_audit_failed", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Catalog page size was updated, but its audit record could not be saved" });
    }
  });

  router.get("/stats", (_req, res) => {
    const db = readDb();
    const users = db.users.filter((item) => item.role !== "admin");
    const approvedDeposits = db.transactions.filter((item) => item.type === "deposit" && item.status === "approved");
    const approvedWithdrawals = db.transactions.filter((item) => item.type === "withdrawal" && item.status === "approved");
    res.json({
      totalUsers: users.length,
      activeUsers: users.filter((item) => item.status === "active").length,
      totalBalance: Number(users.reduce((sum, item) => sum + item.balance, 0).toFixed(2)),
      pendingRequests: db.transactions.filter((item) => item.status === "pending").length,
      indiaUsers: users.filter((item) => item.country === "IN").length,
      pakistanUsers: users.filter((item) => item.country === "PK").length,
      pendingKyc: users.filter((item) => item.kycStatus === "pending").length,
      approvedDeposits: Number(approvedDeposits.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)),
      approvedWithdrawals: Number(approvedWithdrawals.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)),
    });
  });
  router.get("/activity", (_req, res) => res.json({ logs: readDb().auditLogs.slice(0, 100) }));
  router.get("/settings", (_req, res) => res.json({ settings: readDb().platformSettings || {} }));
  router.patch("/settings", validate(settingsSchema), (req, res) => {
    const db = readDb();
    const previousBannerImages = (db.platformSettings?.promotions || [])
      .map((promotion) => promotion.bannerImage)
      .filter(Boolean);
    db.platformSettings = req.body;
    const admin = db.users.find((item) => item.id === req.user.id);
    addAudit(db, admin?.username || "admin", "SETTINGS_UPDATED", "Platform settings", "Announcement, support, and promotion settings updated");
    writeDb(db);
    const retainedBannerImages = new Set(db.platformSettings.promotions.map((promotion) => promotion.bannerImage).filter(Boolean));
    for (const filename of previousBannerImages) {
      if (retainedBannerImages.has(filename)) continue;
      try {
        fs.rmSync(path.join(promotionImageDir, path.basename(filename)), { force: true });
      } catch (error) {
        logger.warn("promotion_banner_cleanup_failed", {
          filename: path.basename(filename),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    res.json({ settings: db.platformSettings });
  });
  router.get("/users", (_req, res) => res.json({ users: readDb().users.filter((item) => item.role !== "admin").map(publicUser) }));
  router.get("/transactions", (_req, res) => res.json({ transactions: readDb().transactions.slice(0, 100) }));

  router.patch("/users/:id", validate(userUpdateSchema), (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.params.id);
    if (!user || user.role === "admin") return res.status(404).json({ error: "User not found" });
    const admin = db.users.find((item) => item.id === req.user.id);
    if (req.body.status) {
      user.status = req.body.status;
      addAudit(db, admin?.username || "admin", "USER_STATUS_CHANGED", user.username, `Status changed to ${req.body.status}`);
    }
    if (req.body.balance !== undefined) {
      const previousBalance = user.balance;
      const diff = Number((req.body.balance - previousBalance).toFixed(2));
      if (diff !== 0) {
        try {
          user.balance = changeBalance({
            userId: user.id,
            amount: Math.abs(diff),
            type: diff > 0 ? "credit" : "debit",
            reference: req.body.reason || "Manual adjustment",
          });
        } catch (error) {
          return res.status(400).json({ error: error instanceof Error ? error.message : "Balance adjustment failed" });
        }
      }
      const currency = displayCurrency(currencyForCountry(user.country));
      addAudit(db, admin?.username || "admin", "BALANCE_ADJUSTED", user.username, `${currency} ${previousBalance} -> ${currency} ${user.balance}; ${req.body.reason || "Manual adjustment"}`);
    }
    writeDb(db);
    res.json({ user: publicUser(user) });
  });

  router.patch("/users/:id/kyc", validate(kycReviewSchema), (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.params.id && item.role !== "admin");
    if (!user) return res.status(404).json({ error: "User not found" });
    const admin = db.users.find((item) => item.id === req.user.id);
    user.kycStatus = req.body.status;
    user.kycReviewedAt = new Date().toISOString();
    user.kycReviewNote = req.body.note;
    addAudit(db, admin?.username || "admin", req.body.status === "verified" ? "KYC_VERIFIED" : "KYC_REJECTED", user.username, req.body.note);
    addNotification(
      db,
      user.id,
      "kyc",
      req.body.status === "verified" ? "KYC verification approved" : "KYC verification rejected",
      req.body.status === "verified" ? "Your identity verification has been approved." :
        `Your identity verification was rejected${req.body.note ? `: ${req.body.note}` : "."}`,
    );
    writeDb(db);
    res.json({ user: publicUser(user) });
  });

  router.get("/support", (_req, res) => res.json({ tickets: readDb().supportTickets.slice(0, 100) }));
  router.patch("/support/:id", validate(z.object({
    status: z.enum(["open", "pending", "resolved"]),
    reply: z.string().trim().max(3000).optional().default(""),
  })), (req, res) => {
    const db = readDb();
    const ticket = db.supportTickets.find((item) => item.id === req.params.id);
    if (!ticket) return res.status(404).json({ error: "Support ticket not found" });
    ticket.status = req.body.status;
    ticket.reply = req.body.reply;
    ticket.updatedAt = new Date().toISOString();
    const user = db.users.find((item) => item.id === ticket.userId);
    if (user && ticket.reply) addNotification(db, user.id, "support", "Support reply received", ticket.reply, ticket.id);
    const admin = db.users.find((item) => item.id === req.user.id);
    addAudit(db, admin?.username || "admin", "SUPPORT_TICKET_UPDATED", ticket.username, `${ticket.status} · ${ticket.subject}`);
    writeDb(db);
    res.json({ ticket });
  });

  router.patch("/transactions/:id", validate(transactionDecisionSchema), (req, res) => {
    try {
      const result = req.body.status === "approved"
        ? approveTransaction(req.params.id, req.user.id)
        : decideTransaction({ transactionId: req.params.id, status: req.body.status, adminUsername: req.user.id });
      logger.info("wallet_transaction_processed", {
        transactionId: result.transactionId, status: req.body.status, adminId: req.user.id,
      });
      const transaction = readDb().transactions.find((item) => item.id === result.transactionId);
      res.json({ transaction, balance: result.balance });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction decision failed";
      const status = message === "Request already processed" ? 409 :
        message === "Request not found" || message === "User not found" ? 404 : 409;
      res.status(status).json({ error: message });
    }
  });

  router.post("/game-results", validate(gameResultSchema), (req, res) => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.body.userId && item.role !== "admin");
    if (!user) return res.status(404).json({ error: "User not found" });
    const admin = db.users.find((item) => item.id === req.user.id);
    const eventId = req.body.reference || randomUUID();
    const winnings = req.body.outcome === "won" ? req.body.amount : 0;
    if (winnings > 0) {
      user.balance = changeBalance({
        userId: user.id, amount: winnings, type: "credit", transactionId: eventId, reference: eventId,
      });
    }
    db.transactions.unshift({
      id: eventId, userId: user.id, username: user.username, type: req.body.category,
      amount: winnings, status: req.body.outcome, gameName: req.body.gameName || req.body.category,
      createdAt: new Date().toISOString(),
    });
    addNotification(
      db,
      user.id,
      req.body.category,
      `${req.body.gameName || req.body.category} ${req.body.outcome}`,
      winnings ? `You won ${displayCurrency(currencyForCountry(user.country))} ${winnings.toLocaleString("en-US")} and the amount has been added to your wallet.` :
        `Your ${req.body.category} result was recorded as no win.`,
      eventId,
    );
    addAudit(db, admin?.username || "admin", "GAME_RESULT_RECORDED", user.username,
      `${req.body.category} · ${req.body.gameName || req.body.category} · ${req.body.outcome} · ${displayCurrency(currencyForCountry(user.country))} ${winnings} · Ref: ${eventId}`);
    writeDb(db);
    res.status(201).json({ message: "Game result recorded", user: publicUser(user) });
  });

  return router;
}
