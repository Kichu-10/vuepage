# B9 Game Vue app

This is the standalone Vue 3 implementation. It is separate from the React project in `.dist/frontend/pixel-to-playful-pages-35`.

See the repository's [System Documentation](../SYSTEM.md), [API Reference](../docs/API.md), and [Operations Guide](../docs/OPERATIONS.md) for architecture, routes, configuration, and deployment guidance.

The client uses Vue Router and Pinia. Express endpoints are organized under `server/routers`, shared wallet/database operations are in `server/services` and `server/database.js`, and SQLite data is stored in normalized tables. Existing SQLite JSON records are migrated on server startup.

From the repository root, run:

```powershell
Set-Location .\vue-app
npm install
npm run dev
```

Create a production build with `npm run build`.

Run backend tests with `npm test`. Copy `.env.example` to `.env.local` and replace the example values before deployment. To enable the transfer-wallet game integration, configure `GAME_API_BASE_URL`, `GAME_OPERATOR_ID`, `GAME_SECRET`, and `GAME_SALT` in the server environment. Keep the provider secret and salt server-side. Users can return provider-wallet funds from the wallet dialog. `SENTRY_DSN` enables error monitoring; database snapshots are written to `server/backups` daily by default and old snapshots are trimmed according to `DB_BACKUP_RETENTION`.

See the repository's [API Reference](../docs/API.md), [Operations Guide](../docs/OPERATIONS.md), and [Game Provider Setup](../docs/GAME-PROVIDER-SETUP.md) for game-wallet routes, credential handling, and deployment configuration.
