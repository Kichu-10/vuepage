# Game provider credentials and setup

This app integrates with the game provider using its **transfer-wallet API**. Provider credentials are server-side secrets and must not be added to source code, this document, `.env.example`, frontend variables, screenshots, or Git commits.

## Configuration

Set these variables in the server environment. For local development, use `vue-app/.env.local`, which is ignored by Git:

| Variable | Value to obtain/configure |
| --- | --- |
| `GAME_API_BASE_URL` | Provider API base URL, using HTTPS |
| `GAME_OPERATOR_ID` | API operator ID assigned by the provider |
| `GAME_SECRET` | Secret key paired with that API operator ID |
| `GAME_SALT` | Salt paired with that API operator ID and secret |
| `GAME_CURRENCY_IN` | Provider currency for India; defaults to `INR` |
| `GAME_CURRENCY_PK` | Provider currency for Pakistan; defaults to `PKR` |

Example format only—replace placeholders locally; do not commit real values:

```dotenv
GAME_API_BASE_URL=https://provider-api.example
GAME_OPERATOR_ID=replace-with-api-operator-id
GAME_SECRET=replace-with-api-secret
GAME_SALT=replace-with-api-salt
GAME_CURRENCY_IN=INR
GAME_CURRENCY_PK=PKR
```

The merchant dashboard login and password are separate from API signing credentials. Keep dashboard passwords in an approved password manager; do not configure or publish them in this app.

## Local setup

1. Copy `vue-app/.env.example` to `vue-app/.env.local` if the local file does not already exist. Merge the game variables into an existing file rather than replacing it, to preserve admin and other app settings.
2. Obtain the API base URL, API operator ID, secret, and salt as a matched set from the provider. Confirm the account is enabled for the transfer-wallet API and the required currencies.
3. Restart the API after changing `.env.local`; the server reads environment configuration at startup.
4. Check `GET /api/health`, then load the game catalog. Do not test transfers with real balances until the provider confirms the test account and a test launch works.

Confirm `.env.local` is ignored before staging changes:

```powershell
git check-ignore vue-app/.env.local
```

Never use a `VITE_` variable for `GAME_SECRET` or `GAME_SALT`: frontend variables are bundled into browser code.

## Signature and troubleshooting

The provider's integration guide specifies an MD5 signature over the request parameters sorted alphabetically, followed by `secret=<secret>&salt=<salt>`. Empty values are omitted. The implementation is in `vue-app/server/services/game-provider.js` and includes a test against the guide's published signing example.

If the catalog responds with provider error `1004` (`Invalid hash code`):

- Confirm the API operator ID, secret, and salt are a matched, currently active set for the selected API environment.
- Confirm the provider has enabled API access for that operator and provided the correct API base URL.
- Ask the provider to verify its expected signature format and the exact request fields for `getGameList`.
- Do not work around the rejection by disabling signature checks or trying dashboard credentials as API credentials.

The integration was last tested against the provider test API, which returned error `1004`. This indicates the provider did not accept the configured signature; it is not evidence that the game catalog or transfers are ready. Retry after the provider confirms or reissues the API credentials.

## Rotation and production

- Rotate secrets immediately if they appear in chat, tickets, source control, logs, or screenshots. Update the server environment and restart the API.
- Use different provider credentials for test and production environments.
- Before enabling production, confirm the operator account, currencies, transfer-wallet permissions, HTTPS endpoint, and provider-side IP allowlisting with the provider.
- Do not commit `.env.local`, secret values, merchant passwords, or generated local admin credentials.
