# B9 Game Vue app

This is the standalone Vue 3 implementation. It is separate from the React project in `.dist/frontend/pixel-to-playful-pages-35`.

See the repository's [System Documentation](../SYSTEM.md), [API Reference](../docs/API.md), and [Operations Guide](../docs/OPERATIONS.md) for architecture, routes, configuration, and deployment guidance.

The client uses Vue Router and Pinia. Public pages are available at `/`, `/games`, `/promotions`, `/wallet`, and `/account`; the configured admin path remains separate. Express endpoints are organized under `server/routers`, shared wallet/database operations are in `server/services` and `server/database.js`, and SQLite data is stored in normalized tables. Existing SQLite JSON records are migrated on server startup.

From the repository root, run:

```powershell
Set-Location .\vue-app
npm install
npm run dev
```

Create a production build with `npm run build`.

Run backend tests with `npm test`. Copy `.env.example` to `.env.local` and replace the example values before deployment. The HUIDU transfer-wallet integration uses server-side `HUIDU_SERVER_URL`, `HUIDU_AGENCY_UID`, `HUIDU_AES_KEY`, and `HUIDU_PLAYER_PREFIX` settings; do not expose these values to the browser or commit real credentials. Signed-in users can manage payment requests, transaction history, return provider-wallet funds from the Wallet page, and upload a JPEG, PNG, or WebP profile picture (up to 3 MB) from Account or Profile. `SENTRY_DSN` enables error monitoring; database snapshots are written to `server/backups` daily by default and old snapshots are trimmed according to `DB_BACKUP_RETENTION`.

Google Sign-In and account creation use the same server-side `GOOGLE_CLIENT_ID` for verification and rendering the browser button; add the app's origins to that OAuth web client. A verified Google profile photo is shown until the user uploads a profile picture. Administrators create, edit, activate, pause, and remove visual member promotions in the Promotions section of the admin panel, including uploading JPEG, PNG, or WebP banner artwork up to 5 MB. For finished creatives that already include their offer text and button, enable **Image contains complete offer design**; the homepage displays those banners edge-to-edge in a responsive carousel. Offers and terms are visible only after sign-in, and the app does not automatically credit promotional rewards.

See the repository's [API Reference](../docs/API.md), [Operations Guide](../docs/OPERATIONS.md), and [Game Provider Setup](../docs/GAME-PROVIDER-SETUP.md) for game-wallet routes, credential handling, and deployment configuration.
