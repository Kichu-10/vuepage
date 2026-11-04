import { expect, test } from "@playwright/test";

test("navigation works, icons render, and the home page shows the first three games", async ({ page }) => {
  await page.route("**/api/games", (route) => route.fulfill({
    json: {
      games: Array.from({ length: 5 }, (_, index) => ({
        id: `game-${index + 1}`,
        name: `Game ${index + 1}`,
        provider: "PGSoft",
        providerCode: "PG",
        gameType: "Slot",
        status: 0,
      })),
    },
  }));
  await page.route("**/api/payment/details", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/platform/settings", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: "Authentication required" } }));
  await page.route("**/api/promotions", (route) => route.fulfill({ json: { promotions: [] } }));

  await page.goto("/");
  await expect(page.locator(".bonus-banner__art")).toBeVisible();
  await expect(page.locator(".page-home .game-card")).toHaveCount(3);
  await expect(page.locator(".game-card img").first()).toHaveAttribute("src", /g-aviator\.jpg|g-slot\.jpg/);
  await expect(page.locator(".brand-emblem")).toBeVisible();
  await expect(page.locator(".header-actions svg")).toHaveCount(4);
  await expect(page.locator(".header-actions svg").first()).toBeVisible();
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
  await expect(page.locator(".page-games .game-card")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "All Games", exact: true })).toBeVisible();
  await expect(page.locator(".page-games .category-label").filter({ hasText: "PGSoft" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Filter by provider" })).toContainText("PGSoft");
  await page.getByRole("searchbox", { name: "Search games or providers" }).fill("Game 4");
  await expect(page.locator(".page-games .game-card")).toHaveCount(1);
  await expect(page.locator(".page-games .game-card").first()).toContainText("Game 4");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".page-games .game-card")).toHaveCount(5);

  await page.getByRole("button", { name: "Wallet", exact: true }).first().click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByRole("heading", { name: "Sign in to manage your wallet" })).toBeVisible();
});

test("games list loads unique games in batches of twelve while scrolling", async ({ page }) => {
  let catalogRequests = 0;
  await page.route("**/api/games", (route) => {
    catalogRequests += 1;
    return route.fulfill({
      json: {
        games: [
          ...Array.from({ length: 25 }, (_, index) => ({
            id: `scroll-game-${index + 1}`,
            name: `Scroll Game ${index + 1}`,
            provider: "PGSoft",
            providerCode: "PG",
            gameType: "Slot",
            status: 0,
          })),
          { id: "scroll-game-1", name: "Duplicate Game", provider: "PGSoft", providerCode: "PG", gameType: "Slot", status: 0 },
        ],
      },
    });
  });
  await page.route("**/api/payment/details", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/platform/settings", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: "Authentication required" } }));
  await page.route("**/api/promotions", (route) => route.fulfill({ json: { promotions: [] } }));

  await page.goto("/games");
  await expect(page.locator(".page-games .game-card")).toHaveCount(12);
  expect(catalogRequests).toBe(1);

  for (const count of [24, 25]) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator(".page-games .game-card")).toHaveCount(count);
  }
  await expect(page.locator(".games-end-message")).toContainText("end of the game list");
  expect(catalogRequests).toBe(1);
  await expect(page.locator(".page-games .game-card")).toHaveCount(25);
});

test("sign-in validates required fields and submits credentials", async ({ page }) => {
  await page.route("**/api/games", (route) => route.fulfill({ json: { games: [] } }));
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
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
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
  await expect(page.getByRole("button", { name: /Open inbox/ })).toHaveAttribute("aria-label", "Open inbox");
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
  await expect(page.getByRole("button", { name: /Open inbox/ })).toContainText("1");
  await page.getByRole("button", { name: /Open inbox/ }).click();
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
  await page.route("**/api/games", (route) => route.fulfill({ json: { games: [] } }));
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
