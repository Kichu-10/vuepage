# B9 Game — System Setup and Client Guide

This guide helps the site owner, client, or hosting provider understand what B9 Game does, what is needed to run it, and which credentials configure its services. It is hosting-provider neutral. **Do not add real passwords, API keys, or account logins to this file.**

## What the website does

B9 Game is a mobile-friendly online gaming platform with:

- A public home page and game catalog.
- Player registration, login, account profiles, and optional Google Sign-In.
- Wallet deposit and withdrawal requests for administrators to review.
- KYC document submission and administrator review.
- A customer-support inbox and site announcements.
- An administrator dashboard to manage players, payments, promotions, game providers, games, and game availability.
- Optional HUIDU provider integration for game catalogs, game launches, and transfers between the site's wallet and the provider game wallet.

Admins can select and import available games in bulk. New games start disabled. Only explicitly enabled games under enabled providers are published. Game and provider artwork can be added in the admin dashboard.

Payment handling is not an automatic bank or payment-gateway settlement: admins configure the payment instructions and manually review requests. Promotions are informational; the app does not automatically grant promotional credits.

## System architecture

- **Frontend:** Vue 3, TypeScript, Vite, Vue Router, and Pinia. Production build output is `vue-app/dist/`.
- **Backend:** Node.js 22 or newer and Express 5. Entry point: `vue-app/server/index.js`.
- **Database:** SQLite using Node's built-in `node:sqlite` API.
- **Authentication:** signed JWT sessions and bcrypt password hashing.
- **Other services:** image/document uploads, request rate limiting, security headers, optional Sentry monitoring.

This is a full-stack application, not a standalone static site. The frontend needs the backend for authentication, admin features, games, wallets, uploads, and other APIs. Production hosting must run Node.js and serve the frontend with a history fallback, while forwarding `/api/*` to the backend. Requests to `/uploads/*` must also reach the backend so its administrator authorization stays in effect. The Vite proxy in `vite.config.ts` is for local development only.

## What the owner/host needs to provide

1. A domain or subdomain and control of its DNS.
2. Hosting that supports Node.js 22 or newer, npm, and the built-in SQLite API. This may be a managed Node application platform, a virtual server, or a container host.
3. HTTPS for the public site.
4. A persistent writable data location for the SQLite database, user uploads, backups, and provider catalog cache. Keep this data outside public static hosting.
5. Same-origin web routing: serve the frontend and forward `/api/*` and `/uploads/*` to the running backend.
6. A secure environment-variable or secret-manager interface for production credentials.
7. An off-host backup destination and a documented database restore process.

If a hosting plan only serves static files and cannot run a Node backend or proxy API requests to one, core site features will not work there. A separate static frontend host and Node backend host can be used if they are configured to work together securely.

## Setup overview

### Local development

From PowerShell:

```powershell
Set-Location .\vue-app
npm ci
Copy-Item .env.example .env.local
```

Set local-only values in the ignored `.env.local` file. Start the frontend and API in separate terminals:

```powershell
npm run dev
```

```powershell
npm run server
```

The development frontend uses Vite to proxy API requests to the local backend. Do not use the development server for production.

### Production hosting

1. Deploy the application source to a private application directory. Do not upload `.env.local`, real secrets, `node_modules`, or local development databases.
2. Use Node.js 22 or newer; install dependencies in `vue-app/` with `npm ci`.
3. Set production environment variables using the hosting platform's private environment/secret settings.
4. Build the client with `npm run build`. `VITE_ADMIN_PANEL_PATH` is a frontend build-time setting; rebuild the frontend if it changes.
5. Start the backend with `npm run server`, using the port supplied by the hosting platform.
6. Configure HTTPS and production routing: serve `vue-app/dist/` with fallback to `index.html`; proxy `/api/*` and `/uploads/*` to the backend.
7. Configure `SQLITE_PATH` and ensure the database, `server/uploads/`, `server/backups/`, and `server/cache/` remain writable and persistent across deploys/restarts.
8. Configure OAuth provider origins and any optional email/SMS/game-provider services.
9. Verify `GET /api/health` returns `{"ok":true}`. Test registration/login, admin login, API proxying, uploads, database persistence, and backup/restore before inviting users.
10. Ask the host for the application URL, runtime version, application root, logs, restart procedure, storage path, and backup/restore details.

## Credentials and settings: what they are for

Enter real values only in the server's private environment or secret manager. The `.env.example` file contains names and placeholders, not production credentials.

### Website and administrator

| Variable | What it is used for | Secret? |
| --- | --- | --- |
| `JWT_SECRET` | Signs and verifies user/admin login sessions. Use a unique random value of at least 32 characters. | Yes |
| `ADMIN_USERNAME` | Username for the administrator account created/synchronized at backend startup. | Protect it |
| `ADMIN_PASSWORD` | Password for the administrator account created/synchronized at backend startup. Use a strong, unique production password. | Yes |
| `ADMIN_ALLOWED_IPS` | Optional comma-separated IP allowlist for administrator access. Empty means no IP restriction. Confirm proxy IP handling with the host. | No, but security-sensitive |
| `VITE_ADMIN_PANEL_PATH` | Optional browser route for the admin page, configured when building the frontend. It is not authentication or a security barrier. | No |
| `NODE_ENV` | Set to `production` for a production deployment. | No |
| `PORT` | Backend listen port; the hosting platform may assign this value. | No |
| `SQLITE_PATH` | Optional absolute path to the persistent SQLite database. | No; keep the file private |

**Important:** an earlier version of the repository's example environment file contained a real-looking admin password before it was replaced with a placeholder. Treat that old value as compromised if it was ever used: change the administrator password and do not reuse it.

### Game provider

| Variable | What it is used for | Secret? |
| --- | --- | --- |
| `HUIDU_SERVER_URL` | HTTPS API endpoint for the configured game-provider agency. | Usually not, but validate it with the provider |
| `HUIDU_AGENCY_UID` | Identifies the authorized agency account at the provider. | Treat as sensitive |
| `HUIDU_AES_KEY` | 32-byte provider-issued encryption key for protected game-wallet requests. | Yes |
| `HUIDU_PLAYER_PREFIX` | Provider-approved prefix for player accounts created by the integration. | Treat as sensitive configuration |
| `GAME_CURRENCY_IN` | Provider currency code for accounts in India; defaults to `INR`. Confirm availability with the provider. | No |
| `GAME_CURRENCY_PK` | Provider currency code for accounts in Pakistan; defaults to `PKR`. Confirm availability with the provider. | No |
| `GAME_CURRENCY_NP` | Provider currency code for supported existing Nepal accounts; defaults to `NPR`. | No |

The site owner must obtain and authorize provider credentials directly with the game provider. Never put provider credentials in a `VITE_` variable, frontend source, public file, or this guide. Do not enable real-money games until the owner confirms the required licensing, age/KYC rules, and provider currency support.

### Optional sign-in, notifications, and monitoring

| Variable(s) | What they are used for | Secret? |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Identifies the Google OAuth web application used for Google Sign-In. Add the production site origin to the Google OAuth configuration. | Client ID is public configuration |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Optional email OTP/verification delivery. | SMTP password is secret |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Optional SMS verification delivery. | Auth token is secret |
| `SENTRY_DSN` | Optional error monitoring destination. | Treat as deployment configuration |

### Payment instructions and operations

| Variable(s) | What they are used for |
| --- | --- |
| `MANUAL_PAYMENT_BANK_NAME`, `MANUAL_PAYMENT_ACCOUNT_NAME`, `MANUAL_PAYMENT_ACCOUNT_NUMBER`, `MANUAL_PAYMENT_IBAN`, `MANUAL_PAYMENT_UPI_ID`, `MANUAL_PAYMENT_WALLET_NAME`, `MANUAL_PAYMENT_WALLET_NUMBER`, `MANUAL_PAYMENT_INSTRUCTIONS` | Payment details and instructions displayed to players for manual deposits. The business owner must approve every value before it is shown publicly. |
| `DB_BACKUP_INTERVAL_MS`, `DB_BACKUP_RETENTION` | Optional local SQLite backup interval and retention; defaults are 24 hours and 14 snapshots. Keep a separate off-host backup too. |

## Credential handoff

- The client/site owner should set production passwords and API secrets directly in the hosting control panel's environment/secret manager.
- The developer or hosting support team does not need the owner's primary domain, hosting, email, Google, Twilio, or game-provider password to read this guide.
- If an operator needs system access, create a separate, least-privilege account with an agreed expiry. Revoke temporary access after setup.
- Never send filled-in `.env` files, passwords, API keys, recovery codes, or database files through public tickets, chat, source control, or email.
- Rotate credentials immediately if they were shared or committed. Use separate credentials for local testing and production.

## Site details to fill in without secrets

- Public domain/subdomain: `[owner fills this in]`
- Hosting provider/platform: `[owner fills this in]`
- Public website URL: `[provided after deployment]`
- Admin page URL: `[configured route; this is not a security control]`
- Support contact shown to users: `[owner-approved public contact]`
- Application health check: `https://[domain]/api/health`

Do **not** fill this section with passwords, private API keys, or account logins.

## Data, privacy, and operations

- SQLite stores player accounts, transactions, integer-cent balances, ledger entries, game players/transfers, KYC metadata, promotions, and support records. Database transactions protect balance changes. Uncertain provider transfers remain pending and use the same transaction ID on safe retries.
- The default database path is `vue-app/server/database.sqlite`; `SQLITE_PATH` can override it.
- Uploaded files are stored under `vue-app/server/uploads/`. Identity documents and payment proofs require administrator authorization. Promotion banners and game artwork are public media.
- Local database backups are written under `vue-app/server/backups/`; provider catalog cache is under `vue-app/server/cache/`.
- Restrict filesystem permissions on the database, uploads, and backups. Back up the database and necessary uploads to protected off-host storage, and test the restore process before launch.
- The API health check only confirms that the API process responds; it does not prove that provider credentials, payments, sign-in, or a game launch work.

## Verification and further reference

Run these commands from `vue-app/` before deployment:

```powershell
npm test
npm run build
```

See the [Operations Guide](./docs/OPERATIONS.md) for configuration, backup, and restore detail; the [Game Provider Setup](./docs/GAME-PROVIDER-SETUP.md) guide for provider integration; and the [API reference](./docs/API.md) for endpoints.
