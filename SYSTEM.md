# B9 Game — System Overview

B9 Game is a mobile-friendly gaming platform built as a Vue web app with an Express API and SQLite database. The live application is in [`vue-app/`](./vue-app/).

## Stack

- **Frontend:** Vue 3, TypeScript, Vite, Vue Router, Pinia
- **Backend:** Node.js 22+, Express 5, Zod
- **Database:** SQLite through Node's built-in `node:sqlite`
- **Authentication:** JWT sessions and bcrypt password hashing
- **Other:** Multer uploads, Helmet, rate limiting, optional Sentry

## Main features

- Public home and game catalog, plus sign-in-only promotions
- User accounts, Google Sign-In, profile photos, and KYC submissions
- Wallet deposits and withdrawals with admin review
- Admin dashboard for users, transactions, support, settings, game results, and visual promotion banners
- HUIDU transfer-wallet integration for game catalogs, launches, and wallet transfers
- Country-based wallet and game-provider currencies: India uses INR, Pakistan uses PKR, and supported existing Nepal accounts use NPR. INR and NPR display to users as `Rs.`; PKR displays as `PKR`.

Promotions can be added, edited, paused, and activated in the admin **Promotions** section. Admins may upload banner artwork and mark a complete creative so it displays edge-to-edge in the homepage carousel.

## Architecture and data

The Vue app sends `/api` requests to Express. Frontend pages and shared components are under `vue-app/src/`; API routes are in `vue-app/server/routers/`; shared database and wallet logic is in `vue-app/server/`.

SQLite stores users, transactions, integer-cent balances, ledger entries, game players/transfers, KYC, promotions, and support records. Database transactions protect balance changes. Uncertain provider transfers remain pending and reuse their transfer ID when retried.

Uploaded files are stored under `vue-app/server/uploads/`. The SQLite database defaults to `vue-app/server/database.sqlite`; `SQLITE_PATH` can override it. The API creates local database backups under `server/backups`.

New account registration and Google Sign-In country selection support India and Pakistan. The selected country determines the account's currency; existing Nepal accounts are also mapped to NPR. Game-provider requests use the configured ISO currency code, while the customer-facing label uses `Rs.` for INR/NPR and `PKR` for PKR. Provider currency codes can be overridden with the server-side `GAME_CURRENCY_IN`, `GAME_CURRENCY_PK`, and `GAME_CURRENCY_NP` settings.

## Security and provider notes

- User and administrator APIs require JWTs; administrator routes also enforce the admin role and optional IP allowlisting.
- Keep secrets in the server environment or ignored `vue-app/.env.local`; never put them in frontend variables or source control.
- HUIDU uses AES-256-ECB encrypted transfer requests. The latest local catalog check was rate-limited with HUIDU error `10030`; live catalog and game launches are not currently verified. See the [provider setup guide](./docs/GAME-PROVIDER-SETUP.md).
- Banner images are public media; identity documents and payment proofs require administrator authorization.

## Run and validate

From PowerShell:

```powershell
Set-Location .\vue-app
npm ci
npm run dev
```

In another terminal, run the API with `npm run server`. Copy `.env.example` to `.env.local` and configure server-side settings before enabling integrations.

Run checks from `vue-app/`:

```powershell
npm test
npm run build
```

See the [API reference](./docs/API.md), [operations guide](./docs/OPERATIONS.md), and [Vue app README](./vue-app/README.md) for details.
