# HUIDU Quick Setup

Configure HUIDU only in the server environment or ignored `vue-app/.env.local`. Never commit or expose credentials.

```dotenv
HUIDU_SERVER_URL=https://provider.example
HUIDU_AGENCY_UID=your-agency-uid
HUIDU_AES_KEY=your-exactly-32-byte-key
HUIDU_PLAYER_PREFIX=yourprefix
GAME_CURRENCY_IN=INR
GAME_CURRENCY_PK=PKR
GAME_CURRENCY_NP=NPR
```

The URL must use HTTPS. The AES key must be exactly 32 UTF-8 bytes; the player prefix must be 2–8 alphanumeric characters. Merge settings into an existing `.env.local` and restart the API.

The default game currencies are INR for India, PKR for Pakistan, and NPR for existing Nepal accounts. New account country selection currently supports India and Pakistan. Set each `GAME_CURRENCY_*` value to the currency code enabled for your HUIDU agency if it differs from the default. These are provider currency codes; the customer interface displays INR and NPR as `Rs.` and PKR as `PKR`.

HUIDU supplies the provider/game catalog (`GET /game/providers`, `GET /game/list`) and transfer-wallet API (`POST /game/v2`). Catalog calls pass the agency ID, language, and supplier code where required by HUIDU. Transfer requests use AES-256-ECB with PKCS padding; the outer and encrypted-payload millisecond timestamps are strings as shown in the API guide. Positive amounts fund the game wallet, negative amounts return funds, and zero queries its balance. Uncertain transfers remain pending and retry with the same transfer ID.

Players choose how much to move from Main Wallet when launching; the server checks the available balance and reserves the transfer atomically. The unselected Main Wallet funds remain there. Game wagers and winnings are handled by HUIDU in the provider Game Wallet. When a player closes the embedded game or navigates away, the app removes the iframe and refreshes the displayed provider balance; no funds are automatically returned to Main Wallet, so winnings remain in Game Wallet. A player can explicitly request the full provider-confirmed balance be moved to Main Wallet from the wallet page. The published HUIDU API does not document a separate server-side game-session close endpoint, so removing the iframe closes the in-browser session but cannot confirm server-side revocation by HUIDU. Ask HUIDU for an official close-session API if their provider session must also be explicitly terminated. Duplicate-transfer error `10027` remains pending for reconciliation; it must not be treated as a definitive failed transfer or retried with a new ID.

The app's deposits and withdrawals are currently manual: administrators verify payment proof before crediting a deposit, and withdrawals require verified KYC, destination review, and manual payout processing before approval. There is no integrated payment gateway or automatic payout processor; live settlement depends on the configured manual operating process.

The backend caches a successful catalog on disk for six hours, serves that cache while refreshing it, and spaces provider-list requests by five seconds. A `10030` rate-limit response starts a persisted one-hour cooldown to prevent repeated requests from page reloads or API restarts. Keep `vue-app/server/cache/` on persistent writable storage. These defaults reduce request bursts but cannot override the agency limits enforced by HUIDU.

The customer app attempts to display the returned `game_launch_url` in an iframe. HUIDU's public integration documentation describes navigating the player to that URL, but does not confirm iframe support. The public homepage's headers and an invalid sample launch URL do not establish the frame policy of a live game session. If embedding is blocked or the game appears blank, use **Open with HUIDU** to follow the documented direct-launch flow. Do not proxy the game or bypass CSP or `X-Frame-Options`. Verifying a real session requires an authorized test account; launching through the transfer-wallet API may move available funds.

**Current status:** The latest local catalog check returned HUIDU error `10030` (“Too many requests”). The catalog and game launches are not currently verified live. Tests use mocked provider responses; do not treat them as live verification or test with real balances until HUIDU confirms access.

Check local secret-file exclusion with:

```powershell
git check-ignore vue-app/.env.local
```

Use separate test and production credentials. Do not disable encryption, use dashboard credentials as API credentials, or manually clear pending transfers without HUIDU confirmation.
