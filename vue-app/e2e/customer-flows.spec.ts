import { expect, test } from "@playwright/test";

test("admin sign-in displays the supplied B9 logo", async ({ page }) => {
  await page.goto("/admin");
  const logo = page.getByRole("img", { name: "B9 logo" });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", /b9-logo.*\.webp/);
  await expect(logo).toHaveJSProperty("naturalWidth", 108);
});

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
  await expect(page.getByRole("img", { name: "B9 logo" })).toBeVisible();
  await expect(page.getByRole("img", { name: "B9 logo" })).toHaveAttribute("src", /b9-logo.*\.webp/);
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

test("navigation works and the homepage shows responsive category game sections", async ({ page }) => {
  let paymentDetailsRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/payment/details") paymentDetailsRequests += 1;
  });
  const games = Array.from({ length: 5 }, (_, index) => ({
        id: `game-${index + 1}`,
        name: `Game ${index + 1}`,
        provider: "PGSoft",
        providerCode: "PG",
        gameType: "Slot",
        category: "Slots",
        isPopular: true,
        thumbnail: "/src/assets/g-aviator.jpg",
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
  expect(paymentDetailsRequests).toBe(0);
  await expect(page.locator(".bonus-banner__art")).toBeVisible();
  await expect(page.locator(".bonus-banner__art")).toHaveAttribute("fetchpriority", "high");
  await expect(page.locator(".bonus-banner__art")).toHaveAttribute("decoding", "async");
  await expect(page.locator(".page-home .categories .category")).toHaveCount(5);
  await expect(page.locator(".page-home .categories .category")).toHaveText(["Popular", "PG Slot", "Spribe", "Fishing", "InOut"]);
  await expect(page.locator(".page-home .categories .category").nth(4).locator("img")).toHaveAttribute("src", /05_inout\.webp/);
  await expect(page.locator(".page-home .home-game-card")).toHaveCount(10);
  await expect(page.locator(".page-home .home-game-card img").first()).toHaveAttribute("src", /g-aviator\.jpg/);
  await expect(page.locator(".page-home .home-game-card img").first()).toHaveAttribute("decoding", "async");
  await expect(page.locator(".brand-emblem")).toBeVisible();
  await expect(page.locator(".header-actions svg")).toHaveCount(3);
  await expect(page.locator(".header-actions svg").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Deposit", exact: true })).toHaveCount(0);
  const homepageCategories = page.locator(".page-home .categories .category");
  await expect(homepageCategories.nth(0)).toHaveAttribute("aria-pressed", "true");
  await homepageCategories.nth(1).click();
  await expect(homepageCategories.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#home-games-slots")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Back to top" })).toBeVisible();
  await page.getByRole("button", { name: "Back to top" }).click();
  await expect(page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await page.setViewportSize({ width: 375, height: 812 });
  const popularGames = page.locator("#home-games-popular .home-game-strip");
  await page.getByRole("button", { name: "Next Popular Games" }).click();
  await expect.poll(() => popularGames.evaluate((strip) => strip.scrollLeft)).toBeGreaterThan(0);
  await page.locator("#home-games-popular .favorite-button").first().click();
  await expect(page.locator("#home-games-popular .favorite-button").first()).toHaveAttribute("aria-label", "Remove favorite");
  await expect(page.locator(".bottom-nav button svg")).toHaveCount(5);
  await expect(page.locator(".bottom-nav button svg").first()).toBeVisible();
  await expect(page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await expect(page.locator(".brand-emblem")).toHaveAttribute("src", /b9-logo.*\.webp/);
  await expect(page.locator(".bonus-banner")).toHaveCSS("aspect-ratio", "1240 / 548");
  await expect(page.locator(".bonus-banner")).toHaveAttribute("aria-label", "first deposit bonus banner");
  await page.getByRole("button", { name: "Next banner" }).click();
  await expect(page.locator(".bonus-banner")).toHaveAttribute("aria-label", "games banner");
  await expect(page.getByRole("button", { name: "Show games" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "Play Games" })).toBeVisible();
  await page.getByRole("button", { name: "Play Games" }).click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page).toHaveTitle("Games | B9 Game");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Browse the game lobby, explore categories, and find games at B9 Game.",
  );

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
  await page.getByRole("searchbox", { name: "Search games" }).fill("Game 4");
  await expect(page.locator(".page-games .game-card")).toHaveCount(1);
  await expect(page.locator(".page-games .game-card").first()).toContainText("Game 4");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator(".page-games .game-card")).toHaveCount(5);
  await page.getByRole("tab", { name: "All" }).click();
  await expect(page.getByRole("heading", { name: "Popular Games" })).toBeVisible();

  await page.getByRole("button", { name: "Wallet", exact: true }).first().click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect.poll(() => paymentDetailsRequests).toBe(1);
  await expect(page.getByRole("heading", { name: "Sign in to manage your wallet" })).toBeVisible();
});

test("loads public settings and restores the session concurrently", async ({ page }) => {
  let settingsResponseSent = false;
  let sessionRequestedBeforeSettings = false;
  await page.addInitScript(() => localStorage.setItem("b9_token", "expired-test-token"));
  await page.route("**/api/platform/settings", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    settingsResponseSent = true;
    await route.fulfill({ json: {} });
  });
  await page.route("**/api/auth/me", async (route) => {
    sessionRequestedBeforeSettings = !settingsResponseSent;
    await route.fulfill({ status: 401, json: { error: "Authentication required" } });
  });

  await page.goto("/");
  await expect.poll(() => sessionRequestedBeforeSettings).toBe(true);
});

test("homepage loads additional category games without duplicates", async ({ page }) => {
  let popularPageTwoRequests = 0;
  const firstGame = {
    id: "popular-first",
    name: "Popular First",
    provider: "PGSoft",
    providerCode: "PG",
    gameType: "Slot",
    category: "Slots",
    isPopular: true,
    thumbnail: "/src/assets/g-aviator.jpg",
    status: 0,
  };
  const secondGame = { ...firstGame, id: "popular-second", name: "Popular Second" };
  await page.route("**/api/games?*", (route) => {
    const url = new URL(route.request().url());
    const category = url.searchParams.get("category") || "";
    const requestedPage = Number(url.searchParams.get("page") || "1");
    if (category === "Popular" && requestedPage === 2) popularPageTwoRequests += 1;
    const selectedGames = category === "Popular"
      ? requestedPage === 1 ? [firstGame] : [firstGame, secondGame]
      : [];
    return route.fulfill({ json: {
      games: selectedGames,
      page: requestedPage,
      pageSize: 1,
      total: category === "Popular" ? 2 : 0,
      pageCount: category === "Popular" ? 2 : 0,
      hasMore: category === "Popular" && requestedPage === 1,
      providers: [],
      categories: [],
    } });
  });
  await page.route("**/api/payment/details", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/platform/settings", (route) => route.fulfill({ json: {} }));

  await page.goto("/");
  const popularCards = page.locator("#home-games-popular .home-game-card");
  const popularSentinel = page.locator('.home-section-load-sentinel[data-game-category="Popular"]');
  await expect.poll(async () => popularPageTwoRequests > 0 || await popularSentinel.count() > 0).toBe(true);
  if (popularPageTwoRequests === 0) await popularSentinel.scrollIntoViewIfNeeded();
  await expect.poll(() => popularPageTwoRequests).toBe(1);
  await expect(popularCards).toHaveCount(2);
  await expect(popularCards).toContainText(["Popular First", "Popular Second"]);
});

test("games lobby filters enabled games by provider, search, hot, and favorites tabs", async ({ page }) => {
  const games = [
    {
      id: "pg-slot", name: "PG Slot One", provider: "PGSoft", providerCode: "PG",
      gameType: "Slot", category: "Slots", isPopular: true, thumbnail: "/src/assets/g-slot.webp", status: 0,
    },
    {
      id: "spribe-mini", name: "Spribe Mini One", provider: "Spribe", providerCode: "SPRIBE",
      gameType: "Mini Game", category: "Mini Games", isPopular: false, thumbnail: "/src/assets/g-chicken.jpg", status: 0,
    },
  ];
  await page.route("**/api/games?*", (route) => {
    const url = new URL(route.request().url());
    const category = url.searchParams.get("category") || "";
    const provider = url.searchParams.get("provider") || "";
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const matches = games.filter((game) =>
      (!provider || game.providerCode === provider)
      && (!category || (category === "Popular" ? game.isPopular : game.category === category))
      && (!search || game.name.toLowerCase().includes(search)),
    );
    return route.fulfill({ json: {
      games: matches,
      page: 1,
      pageSize: 12,
      total: matches.length,
      pageCount: matches.length ? 1 : 0,
      hasMore: false,
      providers: [{ code: "PG", name: "PGSoft" }, { code: "SPRIBE", name: "Spribe" }],
      categories: ["Mini Games", "Slots"],
    } });
  });
  await page.route("**/api/payment/details", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/platform/settings", (route) => route.fulfill({ json: {} }));

  await page.goto("/games");
  await expect(page.locator(".page-games")).toHaveCSS("background-color", "rgb(245, 248, 245)");
  await expect(page.locator(".game-lobby-search")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".game-lobby-layout")).toHaveCSS("display", "grid");
  await expect(page.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Show Spribe games" })).toBeVisible();
  await page.getByRole("button", { name: "Show Spribe games" }).click();
  const miniSection = page.locator(".page-games .game-category-section", { has: page.getByRole("heading", { name: "Mini Games" }) });
  await expect(miniSection.locator(".lobby-game-card")).toHaveCount(1);
  await expect(miniSection.locator(".lobby-game-card")).toContainText("Spribe Mini One");
  await miniSection.getByRole("button", { name: "Add favorite" }).click();
  await page.getByRole("tab", { name: "Favorites" }).click();
  await expect(page.locator(".game-lobby-results .lobby-game-card")).toHaveCount(1);
  await expect(page.locator(".game-lobby-results .lobby-game-card")).toContainText("Spribe Mini One");
  await page.getByRole("searchbox", { name: "Search games" }).fill("missing game");
  await expect(page.getByText("No games match your filters.")).toBeVisible();
  await expect(page.locator(".game-lobby-results .lobby-game-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator(".game-lobby-results .lobby-game-card")).toHaveCount(1);
  await page.getByRole("tab", { name: "Hot" }).click();
  await expect(page.getByRole("heading", { name: "Popular Games" })).toBeVisible();
  await expect(page.locator(".game-lobby-results .lobby-game-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Show all providers" }).click();
  await page.getByRole("tab", { name: "Recent" }).click();
  await expect(page.getByText("Games you play will appear here.")).toBeVisible();
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

test("game player uses the available viewport and toggles player fullscreen", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("b9_token", "playwright-test-token");
    let activeFullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => activeFullscreenElement,
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: function (this: HTMLElement) {
        activeFullscreenElement = this;
        document.documentElement.dataset.fullscreenTarget = this.className;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      },
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: () => {
        activeFullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      },
    });
  });
  let gameWalletChecks = 0;
  const launchRequests: Array<{ gameId: string; amount: number }> = [];
  await page.route("**/api/games?*", (route) => route.fulfill({
    json: {
      games: [
        { id: "sample-game", name: "Sample Game", provider: "PGSoft", providerCode: "PG", gameType: "Slot", status: 0 },
        { id: "another-game", name: "Another Game", provider: "PGSoft", providerCode: "PG", gameType: "Slot", status: 0 },
      ],
      page: 1,
      pageSize: 12,
      total: 2,
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
  await page.route("**/api/games/*/launch", async (route) => {
    const gameId = new URL(route.request().url()).pathname.split("/").at(-2) || "";
    const body = route.request().postDataJSON() as { amount: number };
    launchRequests.push({ gameId, amount: body.amount });
    await route.fulfill({
      json: {
        gameUrl: `https://game.example.test/${gameId}`,
        balance: 0,
        gameWalletBalance: body.amount > 0 ? 100 : 125,
      },
    });
  });
  await page.route("**/api/games/wallet", (route) => {
    gameWalletChecks += 1;
    return route.fulfill({ json: { balance: gameWalletChecks >= 2 ? 125 : 0 } });
  });
  await page.route("https://game.example.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>Test game</title>" }));

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/games");
  await page.locator(".game-category-section").first().getByRole("button", { name: "Play Sample Game" }).click();
  const fundingDialog = page.getByRole("dialog");
  await expect(fundingDialog).toBeVisible();
  await expect(fundingDialog.locator('input[type="number"]')).toHaveAttribute("max", "1000");
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
  await expect(page.locator("html")).toHaveAttribute("data-fullscreen-target", "game-player-frame");
  await expect(page.getByRole("button", { name: "Exit fullscreen" })).toBeVisible();
  await page.getByRole("button", { name: "Exit fullscreen" }).click();
  await expect(page.getByRole("button", { name: "Fullscreen" })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopFrame = await page.locator(".game-player-frame").boundingBox();
  expect(desktopFrame?.height).toBeGreaterThan(400);
  expect(desktopFrame?.width).toBeGreaterThan(1000);
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Games" })).toBeVisible();
  await page.getByRole("button", { name: "Back to Games" }).click();
  await page.locator(".game-category-section").first().getByRole("button", { name: "Play Another Game" }).click();
  await expect(page.locator(".page-frame.game-active")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(launchRequests).toEqual([
    { gameId: "sample-game", amount: 100 },
    { gameId: "another-game", amount: 0 },
  ]);
  await page.getByRole("button", { name: "Back to Games" }).click();
  await page.getByRole("tab", { name: "Recent" }).click();
  await expect(page.getByRole("button", { name: "Play Sample Game" })).toBeVisible();
});
