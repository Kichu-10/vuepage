# Operations Guide

## Requirements

- Node.js 22 or newer (the backend uses Node's built-in `node:sqlite` API).
- npm.
- Persistent writable storage for the SQLite file, uploads, and backups.

## Local development

From the repository root, open two PowerShell terminals:

```powershell
Set-Location .\vue-app
npm ci
Copy-Item .env.example .env.local
npm run dev
```

In the second terminal, start the API:

```powershell
Set-Location .\vue-app
npm run server
```

Vite runs the frontend at its local development URL and proxies `/api` requests to `http://127.0.0.1:3001`. Update `.env.local` with local credentials and any integrations you use. Do not commit `.env.local` or production secrets.

The API reads `.env.local` from `vue-app/`. Vite exposes frontend variables with the `VITE_` prefix. `VITE_ADMIN_PANEL_PATH` configures the admin panel's browser route; it is not an authorization control.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | API port; defaults to `3001` |
| `NODE_ENV` | Runtime environment |
| `JWT_SECRET` | JWT signing secret; required in production and at least 32 characters |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Seed/configure the administrator account; password required for production startup |
| `ADMIN_ALLOWED_IPS` | Optional comma-separated administrator IP allowlist; empty means no IP restriction |
| `SQLITE_PATH` | Optional SQLite database path; defaults to `server/database.sqlite` |
| `VITE_ADMIN_PANEL_PATH` | Optional frontend route for the admin panel |
| `VITE_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_ID` | Frontend and server Google OAuth client IDs |
| `SENTRY_DSN` | Optional Sentry error monitoring |
| `DB_BACKUP_INTERVAL_MS` | Backup interval in milliseconds; defaults to 24 hours |
| `DB_BACKUP_RETENTION` | Number of local backup snapshots to retain; defaults to 14 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Optional email OTP delivery |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Optional SMS OTP delivery |
| `MANUAL_PAYMENT_*` | Manual deposit destination details shown to users |
| `GAME_API_BASE_URL` | HTTPS base URL for the provider API |
| `GAME_OPERATOR_ID` | Provider-assigned operator ID |
| `GAME_SECRET`, `GAME_SALT` | Provider signing credentials; server-side only |
| `GAME_CURRENCY_IN`, `GAME_CURRENCY_PK` | Provider currency codes for Indian and Pakistani accounts; default `INR` and `PKR` |

Use long, unique secrets and restrict administrator access at the network layer for production. The sample values in `.env.example` are placeholders.

See the [game provider setup guide](./GAME-PROVIDER-SETUP.md) for credential storage, local setup, rotation, and signature troubleshooting.

## Build and tests

Run in `vue-app/`:

```powershell
npm test
npm run build
```

The CI workflow runs these checks on relevant pushes and pull requests.

## Database and backups

- Default database: `vue-app/server/database.sqlite`.
- Default document uploads: `vue-app/server/uploads/`.
- Default local snapshots: `vue-app/server/backups/`.
- The application creates a backup at startup and periodically thereafter.
- Copy both the database and required uploads to protected off-host storage; snapshots on the application host do not protect against host or disk loss.
- Restrict filesystem access to the database, uploaded identity documents, and backups.

### Restore procedure

1. Stop the API process so the database is not being written.
2. Preserve a copy of the current database and upload directory before restoring.
3. Copy the chosen verified SQLite snapshot to the configured `SQLITE_PATH` (or `server/database.sqlite` when unset).
4. Restore the matching upload files if KYC documents or payment receipts are needed.
5. Start the API and check `GET /api/health`, application logs, and the expected data before reopening traffic.

Test restore procedures periodically in a separate environment. Do not restore an unverified snapshot over the only production database copy.

## Deployment checklist

- Configure production `JWT_SECRET`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD`; never deploy with example values.
- Set `NODE_ENV=production` and confirm the server starts with the production configuration.
- Configure a restricted `ADMIN_ALLOWED_IPS` allowlist where practical.
- Configure the intended Google, email, SMS, payment, and Sentry integrations.
- Configure `GAME_API_BASE_URL`, `GAME_OPERATOR_ID`, `GAME_SECRET`, and `GAME_SALT` in the server environment; never put the operator secret or salt in a `VITE_` variable or browser code.
- The game integration uses the provider's transfer-wallet API, so provider callbacks are not required. Confirm the configured API URL is the provider's HTTPS API endpoint.
- Confirm the provider account has both INR and PKR enabled before opening games to users in India and Pakistan.
- Use only test-provider credentials for local integration checks. Rotate any credentials shared in screenshots or chats before deployment.
- Verify the provider's licensing and local age/KYC requirements before enabling real-money games.
- Use persistent storage and a separate protected destination for off-host backups.
- Ensure deployment and reverse-proxy settings preserve the intended client IP for IP allowlisting.
- Run `npm test` and `npm run build` before deployment.
- Monitor JSON logs and Sentry; periodically verify backup creation and restoration.
