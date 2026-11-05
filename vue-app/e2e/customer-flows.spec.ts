import { expect, test } from "@playwright/test";

test("admin game dashboard lists managed games without provider credentials", async ({ page }) => {
  const statistics = {
    totalUsers: 0, activeUsers: 0, totalBalance: 0, pendingRequests: 0,
    indiaUsers: 0, pakistanUsers: 0, pendingKyc: 0, approvedDeposits: 0, approvedWithdrawals: 0,
  };
  await page.route("**/api/admin/auth/login", (route) => route.fulfill({ json: { token: "admin-test-token" } }));
  await page.route("**/api/admin/stats", (route) => route.fulfill({ json: statistics }));
  await page.route("**/api/admin/users", (route) => route.fulfill({ json: { users: [] } }));
  await page.route("**/api/admin/transactions", (route) => route.fulfill({ json: { transactions: [] } }));
  await page.route("**/api/admin/activity", (route) => route.fulfill({ json: { logs: [] } }));
  await page.route("**/api/admin/support", (route) => route.fulfill({ json: { tickets: [] } }));
  await page.route("**/api/admin/settings", (route) => route.fulfill({ json: { settings: {} } }));
  await page.route("**/api/admin/game-management", (route) => route.fulfill({ json: {
    providers: [{ code: "pg", name: "PGSoft", enabled: true, gameCount: 1 }],
    games: [{
      id: "sample-game", providerCode: "pg", provider: "PGSoft", providerEnabled: true,
      externalId: "sample-game", name: "Sample Game", thumbnail: "", category: "Slots",
      isPopular: false, gameType: "Slot", sortOrder: 1, enabled: true, providerStatus: 0,
    }],
    stats: { totalProviders: 1, totalGames: 1, availableGames: 1, activeGames: 1, disabledGames: 0 },
    pageSize: 12,
    providerApiConfigured: true,
  } }));

  await page.goto("/admin");
  await page.getByRole("textbox", { name: "Username" }).fill("admin");
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: /Games/ }).click();
  await expect(page.getByRole("heading", { name: "Game and Provider Management", level: 2 })).toBeVisible();
  await expect(page.getByText("Total providers")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Sample Game name" })).toHaveValue("Sample Game");
  await expect(page.getByLabel("Sample Game provider")).toHaveValue("pg");
  await expect(page.getByLabel("Sample Game category")).toHaveValue("Slots");
  await expect(page.getByLabel("Mark Sample Game as popular")).not.toBeChecked();
  await expect(page.getByLabel("Upload Sample Game thumbnail")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  await expect(page.getByText("Provider API credentials are read from server environment variables")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("test-password");
});

test("navigation works, icons render, and the home page shows the first three games", async ({ page }) => {
  const games = Array.from({ length: 5 }, (_, index) => ({
        id: `game-${index + 1}`,
        name: `Game ${index + 1}`,
        provider: "PGSoft",
        providerCode: "PG",
        gameType: "Slot",
        category: "Slots",
        isPopular: true,
        status: 0,
      }));
  await page.route("**/api/games?*", (route) => {
    const url = new URL(route.request().url());
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const category = url.searchParams.get("category") || "";
    const selected = games.filter((game) => {
      const matchesCategory = !category || (category === "Popular" ? game.isPopular : game.category === category);
      return matchesCategory && (!search || `${game.name} ${game.provider}`.toLowerCase().includes(search));
    });
    return route.fulfill({ json: {
      games: selected,
      page: 1,
      pageSize: 12,
      total: selected.length,
      pageCount: selected.length ? 1 : 0,
      hasMore: false,
      providers: [{ code: "PG", name: "PGSoft" }],
      categories: [],
    } });
  });
  await page.route("**/api/payment/details", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/platform/settings", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: "Authentication required" } }));
  await page.route("**/api/promotions", (route) => route.fulfill({ json: { promotions: [] } }));

  await page.goto("/");
  await expect(page.locator(".bonus-banner__art")).toBeVisible();
  await expect(page.locator(".page-home .game-card")).toHaveCount(3);
  await expect(page.locator(".game-card img").first()).toHaveAttribute("src", /g-aviator\.jpg|g-slot\.jpg/);
  await expect(page.locator(".brand-emblem")).toBeVisible();
  await expect(page.locator(".header-actions svg")).toHaveCount(3);
  await expect(page.locator(".header-actions svg").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Deposit", exact: true })).toHaveCount(0);
  const homepageCategories = page.locator(".page-home .categories .category");
  await expect(homepageCategories).toHaveCount(5);
  await expect(homepageCategories).toHaveText(["Popular", "PG Slot", "Spribe", "Fishing", "InOut"]);
  await expect(homepageCategories.nth(4).locator("img")).toHaveAttribute("src", /05_inout\.png/);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator(".bottom-nav button svg")).toHaveCount(5);
  await expect(page.locator(".bottom-nav button svg").first()).toBeVisible();
  await expect(page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await expect(page.locator(".brand-emblem")).toHaveAttribute("src", /b9-logo.*\.jpg/);
  await expect(page.locator(".bonus-banner")).toHaveCSS("aspect-ratio", "1240 / 548");
  await expect(page.locator(".bonus-banner")).toHaveAttribute("aria-label", "first deposit bonus banner");
  await page.getByRole("button", { name: "Next banner" }).click();
  await expect(page.locator(".bonus-banner")).toHaveAttribute("aria-label", "games banner");
  await expect(page.getByRole("button", { name: "Show games" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "Play Games" })).toBeVisible();
  await page.getByRole("button", { name: "Play Games" }).click();
  await expect(page).toHaveURL(/\/games$/);

  await page.getByRole("button", { name: "Home", exact: true }).first().click();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".bonus-banner")).toHaveAttribute("aria-label", "games banner");
  await page.getByRole("button", { name: "Show promotions" }).click();
  await expect(page.locator(".bonus-banner")).toHaveAttribute("aria-label", "promotions banner");
  await expect(page.getByRole("button", { name: "View Offers" })).toBeVisible();
  await page.getByRole("button", { name: "View Offers" }).click();
  await expect(page).toHaveURL(/\/promotions$/);

  await page.getByRole("button", { name: "Home", exact: true }).first().click();
  await page.getByRole("button", { name: "Games", exact: true }).first().click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page.locator(".game-category-section").first().locator(".game-card")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "All Games", exact: true })).toHaveCount(0);
  await expect(page.locator(".games-heading, .games-toolbar, .games-summary")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Popular Games" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Slot Games" })).toBeVisible();
  await page.getByRole("button", { name: "View all popular games" }).click();
  await expect(page.locator(".page-games .game-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Search games" }).click();
  await page.getByRole("textbox", { name: "Search games" }).fill("Game 4");
  await expect(page.locator(".page-games .game-card")).toHaveCount(1);
  await expect(page.locator(".page-games .game-card").first()).toContainText("Game 4");
  await page.getByRole("button", { name: "Close search" }).click();
  await expect(page.locator(".page-games .game-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Back to categories" }).click();
  await expect(page.getByRole("heading", { name: "Popular Games" })).toBeVisible();

  await page.getByRole("button", { name: "Wallet", exact: true }).first().click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByRole("heading", { name: "Sign in to manage your wallet" })).toBeVisible();
});

test("games list loads unique games in server-configured pages while scrolling", async ({ page }) => {
  let catalogRequests = 0;
  const games = [
    ...Array.from({ length: 25 }, (_, index) => ({
      id: `scroll-game-${index + 1}`,
      name: `Scroll Game ${index + 1}`,
      provider: "PGSoft",
      providerCode: "PG",
      gameType: "Slot",
      category: "Mini Games",
      isPopular: true,
      status: 0,
    })),
    { id: "scroll-game-1", name: "Duplicate Game", provider: "PGSoft", providerCode: "PG", gameType: "Slot", category: "Mini Games", isPopular: true, status: 0 },
  ];
  await page.route("**/api/games?*", (route) => {
    catalogRequests += 1;
    const url = new URL(route.request().url());
    const category = url.searchParams.get("category") || "";
    const pageNumber = Number(url.searchParams.get("page") || 1);
    const pageSize = 12;
    const selectedGames = games.filter((game) => !category || (category === "Popular" ? game.isPopular : game.category === category));
    const pageGames = selectedGames.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    return route.fulfill({
      json: {
        games: pageGames,
        page: pageNumber,
        pageSize,
        total: selectedGames.length,
        pageCount: Math.ceil(selectedGames.length / pageSize),
        hasMore: pageNumber < Math.ceil(selectedGames.length / pageSize),
        providers: [{ code: "PG", name: "PGSoft" }],
        categories: [],
      },
    });
  });
  await page.route("**/api/payment/details", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/platform/settings", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: "Authentication required" } }));
  await page.route("**/api/promotions", (route) => route.fulfill({ json: { promotions: [] } }));

  await page.goto("/games");
  await expect(page.locator(".game-category-section").first().locator(".game-card")).toHaveCount(12);
  expect(catalogRequests).toBe(4);
  await page.getByRole("button", { name: "View all popular games" }).click();
  await expect(page.locator(".page-games .game-card")).toHaveCount(12);
  expect(catalogRequests).toBe(5);

  for (let attempt = 0; attempt < 4 && catalogRequests < 7; attempt += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);
  }
  await expect.poll(() => catalogRequests).toBe(7);
  await expect(page.locator(".page-games .game-card")).toHaveCount(25);
  await expect(page.locator(".games-end-message")).toContainText("end of the game list");
  expect(catalogRequests).toBe(7);
  await expect(page.locator(".page-games .game-card")).toHaveCount(25);
});

test("sign-in validates required fields and submits credentials", async ({ page }) => {
  await page.route("**/api/games?*", (route) => route.fulfill({ json: { games: [] } }));
  await page.route("**/api/payment/details", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/platform/settings", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/promotions", (route) => route.fulfill({ json: { promotions: [] } }));
  await page.route("**/api/auth/login", async (route) => {
    const body = route.request().postDataJSON();
    if (body.username !== "demo_user" || body.password !== "secret123") {
      await route.fulfill({ status: 401, json: { error: "Invalid username or password" } });
      return;
    }
    await route.fulfill({
      json: {
        token: "playwright-test-token",
        user: {
          id: "demo-user",
          username: "demo_user",
          email: "demo@example.test",
          country: "IN",
          kycStatus: "not_submitted",
          role: "user",
          balance: 0,
          status: "active",
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        },
      },
    });
  });
  await page.route("**/api/auth/inbox", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/auth/profile/avatar", (route) => route.fulfill({ status: 404 }));

  await page.goto("/");
  const headerSignIn = page.getByRole("button", { name: "Sign in", exact: true });
  if (await headerSignIn.count()) {
    await headerSignIn.first().click();
  } else {
    await page.getByRole("button", { name: "Account", exact: true }).first().click();
    await page.getByRole("button", { name: "Sign in or create account" }).click();
  }
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Sign In" })).toBeVisible();
  const username = dialog.getByRole("textbox", { name: "Username" });
  const password = dialog.getByLabel("Password");
  await expect(username).toHaveAttribute("required", "");
  await expect(password).toHaveAttribute("minlength", "6");

  await username.fill("demo_user");
  await password.fill("secret123");
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toHaveCount(0);
  await page.route("**/api/inbox", (route) => route.fulfill({
    json: {
      notifications: [{
        id: "inbox-1",
        type: "account",
        title: "Test update",
        message: "Inbox polling delivered this message.",
        read: false,
        createdAt: new Date().toISOString(),
      }],
      unreadCount: 1,
    },
  }));
  await page.waitForTimeout(5500);
  const headerInbox = page.getByRole("button", { name: /Open inbox/ });
  if (await headerInbox.count()) {
    await expect(headerInbox).toHaveAttribute("aria-label", "Open inbox");
    await expect(headerInbox).toContainText("1");
    await headerInbox.click();
  } else {
    await page.getByRole("button", { name: "Account", exact: true }).first().click();
    await page.getByRole("button", { name: /^Inbox/ }).click();
  }
  await expect(page.getByText("Inbox polling delivered this message.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Account", exact: true }).first().click();
  await expect(page.getByText("demo_user", { exact: true })).toBeVisible();
});

test("wallet request validates before submit and completes a valid deposit", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("b9_token", "playwright-test-token");
  });
  await page.route("**/api/games?*", (route) => route.fulfill({ json: { games: [] } }));
  await page.route("**/api/payment/details", (route) => route.fulfill({ json: { bankName: "Test Bank", instructions: "Test only" } }));
  await page.route("**/api/platform/settings", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/me", (route) => route.fulfill({
    json: {
      user: {
        id: "demo-user",
        username: "demo_user",
        email: "demo@example.test",
        country: "IN",
        kycStatus: "not_submitted",
        role: "user",
        balance: 0,
        status: "active",
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      },
    },
  }));
  await page.route("**/api/games/wallet", (route) => route.fulfill({ json: { currency: "INR", balance: 0 } }));
  await page.route("**/api/wallet/transactions", (route) => route.fulfill({ json: { transactions: [] } }));
  await page.route("**/api/wallet/request", async (route) => {
    const body = route.request().postData() || "";
    if (!body.includes("Test Ref") || !body.includes("proof")) {
      await route.fulfill({ status: 400, json: { error: "Payment receipt and reference are required" } });
      return;
    }
    await route.fulfill({ status: 201, json: { message: "Deposit request submitted", balance: 0 } });
  });

  await page.goto("/wallet");
  await expect(page.getByRole("heading", { name: "Wallet", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit Deposit Request" }).click();
  await expect(page.locator(".toast")).toHaveText("Enter the payment method");
  const depositButton = page.getByRole("button", { name: "Submit Deposit Request" });

  await page.getByPlaceholder("Payment method (bank, UPI, wallet)").fill("UPI");
  await page.getByPlaceholder("Transaction or payment reference").fill("Test Ref");
  await page.locator('input[type="file"]').setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from("test receipt"),
  });
  await depositButton.click();
  await expect(page.getByText("Deposit request submitted for admin approval", { exact: true })).toBeVisible();
});

test("game player uses the available viewport and requests fullscreen on the iframe", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("b9_token", "playwright-test-token");
    Object.defineProperty(HTMLIFrameElement.prototype, "requestFullscreen", {
      configurable: true,
      value: function (this: HTMLIFrameElement) {
        document.documentElement.dataset.fullscreenTarget = this.title;
        return Promise.resolve();
      },
    });
  });
  await page.route("**/api/games?*", (route) => route.fulfill({
    json: {
      games: [{ id: "sample-game", name: "Sample Game", provider: "PGSoft", providerCode: "PG", gameType: "Slot", status: 0 }],
      page: 1,
      pageSize: 12,
      total: 1,
      pageCount: 1,
      hasMore: false,
      providers: [{ code: "PG", name: "PGSoft" }],
      categories: [],
    },
  }));
  await page.route("**/api/payment/details", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/platform/settings", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/promotions", (route) => route.fulfill({ json: { promotions: [] } }));
  await page.route("**/api/auth/me", (route) => route.fulfill({
    json: {
      user: {
        id: "demo-user",
        username: "demo_user",
        email: "demo@example.test",
        country: "IN",
        kycStatus: "not_submitted",
        role: "user",
        balance: 1000,
        status: "active",
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      },
    },
  }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/games/sample-game/launch", (route) => route.fulfill({
    json: {
      gameUrl: "https://game.example.test/session",
      balance: 900,
      gameWalletBalance: 100,
    },
  }));
  await page.route("https://game.example.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>Test game</title>" }));

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/games");
  await page.locator(".game-category-section").first().getByRole("button", { name: "Play Sample Game" }).click();
  const fundingDialog = page.getByRole("dialog");
  await fundingDialog.locator('input[type="number"]').fill("100");
  await fundingDialog.getByRole("button", { name: "Continue to game" }).click();

  const player = page.locator(".page-frame.game-active");
  await expect(player).toBeVisible();
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Games" })).toBeVisible();
  await expect(page.locator(".bottom-nav")).toBeHidden();
  const mobileFrame = await page.locator(".game-player-frame").boundingBox();
  expect(mobileFrame?.height).toBeGreaterThan(400);
  await expect(page.locator(".game-player-frame iframe")).toHaveAttribute("allowfullscreen", "");
  await page.getByRole("button", { name: "Fullscreen" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-fullscreen-target", "Sample Game game");

  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopFrame = await page.locator(".game-player-frame").boundingBox();
  expect(desktopFrame?.height).toBeGreaterThan(400);
  expect(desktopFrame?.width).toBeGreaterThan(1000);
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Games" })).toBeVisible();
});
