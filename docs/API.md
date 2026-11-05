# API Reference

All routes are served by the Express API. During local development, Vite proxies `/api` to `http://127.0.0.1:3001`. Authenticated endpoints require `Authorization: Bearer <JWT>`, except where marked public. Request validation errors return HTTP 400 with an `error` message and an `issues` array.

## Health and public configuration

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Health response (`{ "ok": true }`) |
| `GET` | `/api/payment/details` | Public | Configured manual deposit destinations and instructions |
| `GET` | `/api/platform/settings` | Public | Public announcement, maintenance, and support details |
| `GET` | `/api/promotions` | User JWT | Active promotions for the signed-in user |

## Authentication and identity

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Create an account |
| `POST` | `/api/auth/login` | Public | Log in with username and password |
| `POST` | `/api/auth/google` | Public | Sign in or register with a Google credential |
| `POST` | `/api/auth/otp/send` | Public | Send an email or SMS verification code |
| `POST` | `/api/auth/otp/verify` | Public | Verify an email or phone code |
| `GET` | `/api/auth/me` | User JWT | Return the current active user |
| `GET` | `/api/auth/profile/avatar` | User JWT | Retrieve the current user's profile picture |
| `POST` | `/api/auth/profile/avatar` | User JWT | Upload or replace a JPEG, PNG, or WebP profile picture (maximum 3 MB; multipart field `avatar`) |
| `POST` | `/api/admin/auth/login` | Public, rate limited | Administrator login |

Email/SMS verification delivery requires the corresponding SMTP or Twilio environment variables. Google sign-in requires `GOOGLE_CLIENT_ID`; the server exposes the matching public client ID to the browser configuration endpoint.

Registration requires a country of `IN` or `PK`; Google Sign-In uses the selected country for new accounts. The saved account country determines its wallet and provider currency: `IN` maps to INR and `PK` to PKR. Existing `NP` accounts map to NPR. Currency configuration can override these provider codes using `GAME_CURRENCY_IN`, `GAME_CURRENCY_PK`, and `GAME_CURRENCY_NP`.

## Wallet and KYC

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/wallet/request` | User JWT | Submit a deposit or withdrawal request; multipart deposit requests include a `proof` file |
| `GET` | `/api/wallet/transactions` | User JWT | List the current user's recent transactions |
| `POST` | `/api/auth/kyc` | User JWT | Submit identity details and KYC document files |

Withdrawals require verified KYC and valid destination details. A deposit requires a payment reference and proof file. Uploads accept JPEG, PNG, and PDF files up to 5 MB.

Wallet amounts are numeric values in the account's currency. The customer interface displays INR and NPR as `Rs.` and PKR as `PKR`; game-provider APIs continue to use their configured ISO currency codes.

Deposits and withdrawals use a manual operations flow: an administrator must verify a deposit before approving its credit, and must verify and manually send a withdrawal before approving its debit. No payment gateway or automatic payout processor is integrated.

## Game provider

The integration uses the provider's **transfer wallet** flow. Funds move between the app wallet and the provider wallet through authenticated, idempotent transfers; wagers are handled inside the provider.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/games?page=1&search=&provider=&category=&sort=` | Public | Retrieve one page from the admin-enabled game catalog |
| `GET` | `/api/games/wallet` | User JWT | Read the authenticated user's provider-wallet balance |
| `POST` | `/api/games/:gameId/launch` | User JWT | Transfer a player-selected amount to the provider wallet and return an HTTPS game URL |
| `POST` | `/api/games/wallet/return` | User JWT | Transfer all provider-wallet funds back to the app wallet |

Launch requests include a JSON `amount` in the user's currency (100–100000000, at most two decimal places) and optional `platform`. The server validates available Main Wallet funds and pending withdrawal reservations atomically. Only the selected amount moves into the provider Game Wallet; the remaining Main Wallet balance is untouched. Winnings accrue in the provider Game Wallet while playing and remain there when the embedded game closes. Closing a game only removes its iframe and refreshes the displayed provider balance; no funds move to Main Wallet automatically. An authenticated user can explicitly request a transfer of the full provider-confirmed Game Wallet balance with `POST /api/games/wallet/return`.

The public catalog returns only games explicitly enabled by an administrator under an enabled provider. The response includes `games`, `page`, `pageSize`, `total`, `pageCount`, `hasMore`, `providers`, and `categories`. `pageSize` is selected by an administrator (1–100); the website loads further pages as the player scrolls. Game IDs are unique across providers, and normalized game names are unique in the managed catalog.

Games are assigned one primary category (`Mini Games`, `Slots`, or `Fishing`) and may independently be marked `Popular`; Popular is an additional listing, not a duplicate game record. The public Games page loads a page for each category and its View All action uses the same paginated catalog endpoint. Administrators upload JPEG, PNG, or WebP thumbnails (up to 3 MB) through `POST /api/admin/game-management/games/:id/thumbnail`; the returned image URL is served by `/api/games/:gameId/thumbnail/:filename`.

Transfers use a stable local transaction ID as the provider idempotency key. A timeout or duplicate-transfer response leaves the transfer pending so retrying reuses the same ID; refunds are never retried under a new ID while an earlier outcome is uncertain. A duplicate-transfer response returns HTTP 409 with its transaction ID for support reconciliation. HUIDU's published API does not document a separate server-side game-session close endpoint.

`GET /api/games/wallet` returns the provider ISO currency code and numeric balance. New player accounts use the currency mapped from the signed-in user's saved country.

The `/api/wallet/play` endpoint is retained only as a compatibility response and does not launch a game; use the game-specific launch endpoint instead.

## Support and inbox

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/support/tickets` | User JWT | Create a support ticket |
| `GET` | `/api/support/tickets` | User JWT | List the current user's tickets |
| `GET` | `/api/inbox` | User JWT | List notifications and unread count |
| `PATCH` | `/api/inbox/read` | User JWT | Mark the current user's notifications as read |

## Administration

All routes below require an administrator JWT, an active administrator account, and any configured IP allowlist.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/stats` | Summary statistics |
| `GET` | `/api/admin/activity` | Recent audit log |
| `GET` | `/api/admin/settings` | Read platform settings |
| `PATCH` | `/api/admin/settings` | Update platform settings |
| `GET` | `/api/admin/users` | List non-administrator users |
| `PATCH` | `/api/admin/users/:id` | Update user account details/status |
| `PATCH` | `/api/admin/users/:id/kyc` | Review a user's KYC submission |
| `GET` | `/api/admin/transactions` | List recent transactions |
| `PATCH` | `/api/admin/transactions/:id` | Approve or reject a pending wallet request |
| `GET` | `/api/admin/support` | List support tickets |
| `PATCH` | `/api/admin/support/:id` | Update or reply to a support ticket |
| `POST` | `/api/admin/game-results` | Record a game result |
| `GET` | `/api/admin/game-management` | List managed providers and games, catalog counts, and page size |
| `GET` | `/api/admin/game-management/provider-catalog` | List providers available from the configured HUIDU API |
| `POST` | `/api/admin/game-management/providers` | Add an available provider; new records default to disabled |
| `PATCH` | `/api/admin/game-management/providers/:code` | Edit provider display name or enabled state |
| `GET` | `/api/admin/game-management/providers/:code/catalog` | List games available from a managed provider |
| `POST` | `/api/admin/game-management/games` | Import a game from its provider; imported games default to disabled |
| `PATCH` | `/api/admin/game-management/games/:id` | Edit game display metadata/order or enabled state |
| `DELETE` | `/api/admin/game-management/games/:id` | Disable a game from public listings without deleting its record |
| `PATCH` | `/api/admin/game-management/catalog-settings` | Set public games per page (1–100) |
| `GET` | `/uploads/:filename` | Retrieve an uploaded document; administrator authentication required |

HUIDU API credentials remain configured on the backend through server environment variables. Admin responses expose only whether the integration is configured; they never return agency IDs or encryption keys. Provider/game records and public selection state are persisted in SQLite.

## Error behavior

Validation failures return HTTP 400. Missing or invalid JWTs return HTTP 401. Authorization failures return HTTP 403. The Express error handler logs an internal request identifier, reports exceptions to Sentry when configured, and returns a generic HTTP 500 response with the request ID.
