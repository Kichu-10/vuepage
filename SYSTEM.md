# System Documentation

## Purpose and scope

This repository contains a standalone Vue 3 implementation of the B9 Game application. The Vue application is in [`vue-app/`](./vue-app/); the separate React application under `.dist/` is not part of this system's runtime.

This document describes the application's architecture, data flow, security boundaries, and operations. See [API Reference](./docs/API.md) for HTTP routes and [Operations Guide](./docs/OPERATIONS.md) for setup and deployment procedures.

## Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | Vue 3, TypeScript, Vite, Vue Router, Pinia |
| Backend | Node.js 22+, Express 5 |
| Database | SQLite using Node's built-in `node:sqlite` API |
| Validation | Zod |
| Authentication | JSON Web Tokens; bcrypt password hashing |
| File uploads | Multer; files stored on the server filesystem |
| Security and reliability | Helmet, Express rate limiting, structured JSON logs, optional Sentry |
| Tests and CI | Node test runner, Supertest, GitHub Actions |

## Architecture

```text
Browser
  └── Vue app (src/main.ts)
      ├── Vue Router selects public App.vue or AdminApp.vue
      └── Pinia session store persists user/admin tokens
          └── /api requests
              └── Express app (server/index.js)
                  ├── Routers: auth, wallet, KYC, admin, support
                  ├── Middleware: JWT/admin authorization, Zod validation
                  ├── Wallet service and transactional SQLite operations
                  └── SQLite database, uploads, scheduled database snapshots
```

### Frontend

- `src/main.ts` initializes Vue, Pinia, and Vue Router.
- `src/router.ts` maps the configured admin URL to `AdminApp.vue`; all other URLs render `App.vue`.
- `src/stores/session.ts` persists separate user and administrator JWTs in browser local storage.
- Shared page elements live in `src/components/`.
- Vite proxies `/api` requests to `http://127.0.0.1:3001` during development.

### Backend

- `server/index.js` configures Express middleware, public endpoints, router mounts, error handling, startup, and scheduled backups.
- `server/routers/` contains route handlers for authentication, wallet, KYC, administration, and support.
- `server/middleware/auth.js` verifies JWTs and checks administrator role, account state, and optional IP allowlisting.
- `server/middleware/validate.js` applies Zod schemas to request bodies.
- `server/services/wallet.js` contains wallet-facing helpers; SQLite transaction primitives are in `server/database.js`.
- `server/config/logger.js` writes structured JSON log entries to standard output/error.

## Data and money handling

SQLite is stored at `server/database.sqlite` by default. Set `SQLITE_PATH` to use another file. The database uses foreign keys and write-ahead logging. Core tables include:

- `users`: identity, credentials, account state, KYC details, and integer-cent balance.
- `transactions`: deposit and withdrawal requests, payment details, status, and timestamps.
- `ledger_entries`: signed balance changes and resulting balances, linked to users and optionally transactions.
- `kyc_documents`, `otps`, `verifications`, `notifications`, `support_tickets`, `audit_logs`, `game_results`, and `platform_settings`.

Money is stored as integer cents to avoid floating-point arithmetic. The database layer uses SQLite transactions for balance changes, withdrawal reservation, and administrator decisions:

1. A withdrawal request checks the user's verified KYC status and available funds while holding a write transaction. Pending withdrawals reserve funds so concurrent requests cannot overdraw the available balance.
2. Approving a deposit or withdrawal updates the balance, ledger, transaction status, notification, and audit log atomically.
3. Already-processed requests cannot be approved a second time.
4. Rejected requests do not create a balance movement.

On startup, the database layer creates or updates the relational schema and migrates recognized legacy SQLite JSON records. A legacy `server/database.json`, when present, is also used as an import source. Keep a verified backup before deploying schema changes.

## Authentication and authorization

- User registration and login return a signed JWT. Passwords are hashed with bcrypt.
- Authenticated API calls use `Authorization: Bearer <token>`.
- Administrator endpoints require an active administrator account and, when configured, an allowed source IP.
- The admin panel URL can be customized with `VITE_ADMIN_PANEL_PATH`; hiding the URL is not a substitute for authentication.
- Auth and admin-login endpoints have separate rate limits.
- Production startup requires a strong `JWT_SECRET` (at least 32 characters) and `ADMIN_PASSWORD`.

## Uploads

KYC and deposit proof uploads are limited to JPEG, PNG, or PDF files up to 5 MB each. Files are stored under `server/uploads`. Uploaded documents are served only through an authenticated administrator endpoint. Back up this directory alongside the SQLite database if document retention is required.

## Logging, monitoring, and backups

- The logger writes JSON records with level, message, timestamp, and supplied context.
- Setting `SENTRY_DSN` enables Sentry error reporting. The configuration disables default PII collection.
- SQLite backups are created at startup and then on a configurable interval. The default destination is `server/backups`, the default interval is 24 hours, and retention defaults to 14 snapshots.
- Configure `DB_BACKUP_INTERVAL_MS` and `DB_BACKUP_RETENTION` to change scheduling and retention. Backups on the same host are not a substitute for off-site backup storage; periodically copy them to a protected location and test a restore.

## Quality checks

From `vue-app/`, run:

```powershell
npm test
npm run build
```

GitHub Actions runs `npm ci`, `npm test`, and `npm run build` on pushes and pull requests that touch `vue-app/` or the workflow.

## Documentation

- [API Reference](./docs/API.md)
- [Operations Guide](./docs/OPERATIONS.md)
- [Vue app README](./vue-app/README.md)
