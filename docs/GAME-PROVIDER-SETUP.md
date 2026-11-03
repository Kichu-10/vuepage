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

HUIDU supplies the provider/game catalog (`GET /game/providers`, `GET /game/list`) and transfer-wallet API (`POST /game/v2`). Positive amounts fund the game wallet, negative amounts return funds, and zero queries its balance. Uncertain transfers remain pending and retry with the same transfer ID.

The backend caches a successful catalog on disk for six hours, serves that cache while refreshing it, and spaces provider-list requests by one second. A `10030` rate-limit response starts a persisted 15-minute cooldown to prevent repeated requests from page reloads or API restarts. Keep `vue-app/server/cache/` on persistent writable storage. These defaults reduce request bursts but cannot override the agency limits enforced by HUIDU.

**Current status:** Recent live catalog checks returned `HUIDU returned an invalid game entry` (HTTP 502). The catalog and game launches are not verified live; ask HUIDU to confirm the catalog response format and API access. Tests use mocked provider responses; do not treat them as live verification or test with real balances until HUIDU confirms access.

Check local secret-file exclusion with:

```powershell
git check-ignore vue-app/.env.local
```

Use separate test and production credentials. Do not disable encryption, use dashboard credentials as API credentials, or manually clear pending transfers without HUIDU confirmation.
