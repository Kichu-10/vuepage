# API Reference

All routes are served by the Express API. During local development, Vite proxies `/api` to `http://127.0.0.1:3001`. Authenticated endpoints require `Authorization: Bearer <JWT>`, except where marked public. Request validation errors return HTTP 400 with an `error` message and an `issues` array.

## Health and public configuration

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Health response (`{ "ok": true }`) |
| `GET` | `/api/payment/details` | Public | Configured manual deposit destinations and instructions |
| `GET` | `/api/platform/settings` | Public | Public announcement, maintenance, and support details |

## Authentication and identity

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Create an account |
| `POST` | `/api/auth/login` | Public | Log in with username and password |
| `POST` | `/api/auth/google` | Public | Sign in or register with a Google credential |
| `POST` | `/api/auth/otp/send` | Public | Send an email or SMS verification code |
| `POST` | `/api/auth/otp/verify` | Public | Verify an email or phone code |
| `GET` | `/api/auth/me` | User JWT | Return the current active user |
| `POST` | `/api/admin/auth/login` | Public, rate limited | Administrator login |

Email/SMS verification delivery requires the corresponding SMTP or Twilio environment variables. Google sign-in requires `GOOGLE_CLIENT_ID`.

## Wallet and KYC

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/wallet/request` | User JWT | Submit a deposit or withdrawal request; multipart deposit requests include a `proof` file |
| `GET` | `/api/wallet/transactions` | User JWT | List the current user's recent transactions |
| `POST` | `/api/wallet/play` | User JWT | Returns HTTP 503 until a game provider is connected; no account charge is made |
| `POST` | `/api/auth/kyc` | User JWT | Submit identity details and KYC document files |

Withdrawals require verified KYC and valid destination details. A deposit requires a payment reference and proof file. Uploads accept JPEG, PNG, and PDF files up to 5 MB.

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
| `GET` | `/uploads/:filename` | Retrieve an uploaded document; administrator authentication required |

## Error behavior

Validation failures return HTTP 400. Missing or invalid JWTs return HTTP 401. Authorization failures return HTTP 403. The Express error handler logs an internal request identifier, reports exceptions to Sentry when configured, and returns a generic HTTP 500 response with the request ID.
