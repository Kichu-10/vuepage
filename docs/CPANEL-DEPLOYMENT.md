# cPanel Deployment Handoff

Share this document with the hosting provider or cPanel support team. It describes the application and the hosting capabilities needed to run it. **It intentionally contains no passwords, API keys, tokens, or account identifiers.**

## Application overview

- Project: B9 Game web application
- Frontend: Vue 3, TypeScript, and Vite; production files are generated in `vue-app/dist/`.
- Backend: Node.js ES modules and Express; entry point is `vue-app/server/index.js`.
- Database: SQLite using Node's built-in `node:sqlite` API.
- Persistent data: SQLite database, user-uploaded files, database backups, and provider catalog cache.
- API health check: `GET /api/health` should return `{"ok":true}`.
- Required runtime: Node.js **22 or newer** with the built-in SQLite API available; npm.

The frontend is not a standalone static website. Login, administrator tools, game catalog, uploads, wallet, and other application features require the backend.

## Hosting capability request

Please confirm whether this cPanel account can provide all of the following:

1. A managed **Setup Node.js App** or equivalent that runs Node.js 22 or newer.
2. A persistent Node application process, with its assigned `PORT` supplied by the hosting platform.
3. An HTTPS application URL on the customer's domain or subdomain.
4. Same-origin routing: serve the Vue single-page application and send `/api/*` requests to the Node process. Send `/uploads/*` to the backend as well; uploaded identity documents require the application's administrator authorization and must not be exposed as static public files.
5. A persistent, private, writable application data directory for the SQLite database, uploads, backups, and catalog cache. It must not be publicly downloadable.
6. Node dependencies installed from `vue-app/package-lock.json` using `npm ci`.
7. A secure way to set and update server environment variables without placing their values in source control, the public web root, or this handoff.
8. A supported backup and restore plan for the SQLite database and required uploads.

If Node.js application hosting or the required same-origin proxy is unavailable, please state that clearly. Uploading only `dist/` may display the frontend but will **not** make the application functional.

## Application setup (for the hosting team)

1. Keep the application source and runtime data outside the public web root where possible. Do not upload `.env.local`, credentials, development databases, or `node_modules`.
2. Use Node.js 22 or newer. Install dependencies from `vue-app/package-lock.json` with `npm ci`.
3. Build the production frontend from `vue-app/` with `npm run build`.
4. Start the backend with `npm run server` (equivalent to `node server/index.js`), using the host-assigned `PORT`.
5. Serve the built `vue-app/dist/` frontend with a history fallback to `index.html`, so routes such as `/games` and the configured admin route work on refresh.
6. Proxy `/api/*` to the backend. Proxy `/uploads/*` to the backend without bypassing its authentication checks.
7. Configure `SQLITE_PATH` to a persistent writable path outside the public web root. Keep the `server/uploads/`, `server/backups/`, and `server/cache/` directories persistent and private as applicable.
8. Set restrictive filesystem permissions on the database, backups, and uploaded identity/payment documents.
9. Enable HTTPS, configure the domain DNS as required, restart the application after setting its environment, and verify `GET /api/health`.
10. Document the assigned Node version, application URL, application root, start command, log location, backup location, and restart procedure for the customer.

The Vite proxy in `vite.config.ts` is for local development; it is not a production reverse proxy. Production routing must be configured by the host or hosting platform.

## Environment variables to configure privately

Set only the values needed for enabled features. Enter values directly in the cPanel Node application environment-variable interface or the host's secret manager. Do not send filled-in values in email, chat, source files, screenshots, or this document.

### Core application and admin

| Variable | Requirement |
| --- | --- |
| `NODE_ENV` | Set to `production`. |
| `PORT` | Use the port assigned by the hosting platform. |
| `JWT_SECRET` | Generate a unique, random secret of at least 32 characters. |
| `ADMIN_USERNAME` | Choose the production administrator username. |
| `ADMIN_PASSWORD` | Set a strong, unique production administrator password. Startup synchronizes the configured username/password with the admin account, so coordinate changes and protect access to this setting. |
| `ADMIN_ALLOWED_IPS` | Optional comma-separated administrator IP allowlist. Confirm proxy/client IP handling with the host before enabling it. |
| `SQLITE_PATH` | Strongly recommended: absolute path to the persistent private SQLite database file. |
| `VITE_ADMIN_PANEL_PATH` | Optional frontend route, configured at build time. This is not an authentication or access-control mechanism. |

### Game provider integration

The game catalog and game-wallet integration require provider credentials issued to the site owner:

| Variable | Requirement |
| --- | --- |
| `HUIDU_SERVER_URL` | Provider's HTTPS API base URL. |
| `HUIDU_AGENCY_UID` | Agency identifier issued by the provider. Treat as sensitive. |
| `HUIDU_AES_KEY` | Provider-issued AES key; exactly 32 UTF-8 bytes. Treat as a secret. |
| `HUIDU_PLAYER_PREFIX` | Provider-approved prefix of 2–8 letters or numbers. |
| `GAME_CURRENCY_IN` | Optional currency code for Indian accounts; defaults to `INR`. Confirm it is enabled with the provider. |
| `GAME_CURRENCY_PK` | Optional currency code for Pakistani accounts; defaults to `PKR`. Confirm it is enabled with the provider. |
| `GAME_CURRENCY_NP` | Optional currency code for Nepal accounts; defaults to `NPR`. Enable only if supported and intended. |

Never put provider credentials in a `VITE_` variable or browser code. Do not enable real-money games until the site owner confirms provider authorization, supported currencies, licensing, age restrictions, and local compliance requirements.

### Optional integrations and operations

| Variables | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google sign-in web client ID; configure the production domain in the Google OAuth console. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Email verification delivery. Keep authentication values secret. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | SMS verification delivery. Keep the auth token secret. |
| `MANUAL_PAYMENT_*` | Payment destination details intentionally displayed to users. Confirm the exact approved values with the site owner. |
| `SENTRY_DSN` | Optional error monitoring. |
| `DB_BACKUP_INTERVAL_MS`, `DB_BACKUP_RETENTION` | Optional local backup schedule and retention; defaults are 24 hours and 14 snapshots. Local snapshots do not replace off-host backups. |

See `docs/OPERATIONS.md` for the complete configuration reference and restore procedure.

## Credential handoff and security

- The site owner should set production secrets directly in cPanel or the provider's secret manager. Hosting support normally does not need the owner's cPanel password or third-party game-provider passwords.
- Never add filled-in secrets to this file, `.env.example`, GitHub, a support ticket, or a public web directory.
- If temporary support access is unavoidable, create a separate, least-privilege account, agree on its scope and expiry, and revoke it immediately after work is complete. Do not share the owner's primary cPanel or domain-registrar password.
- Rotate any real credentials that have appeared in a repository example, screenshot, email, or chat before going live. Use new production-only values.
- Keep backups off the application host as well as locally, and test a restore before launch.
- Require the host to confirm private storage and access controls before uploading real identity, payment, or user data.

## Values for the site owner to fill in privately

- Domain/subdomain: `[enter the public domain here; no login details]`
- Hosting provider/support contact: `[company or support ticket reference]`
- cPanel Node.js app URL and root: `[provided by the host]`
- Node.js version: `[provided by the host; must be 22 or newer]`
- Persistent data path and backup/restore procedure: `[confirmed by the host]`
- Production environment variables: `[set privately in cPanel; do not copy them into this document]`
