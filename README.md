# Whispers Cosmetics POS

A complete cosmetics point-of-sale and inventory system: barcode checkout, stock ledger, refunds, customer credit, M-Pesa payments (Daraja STK Push plus manual confirmation codes), audit trail, backups and daily/monthly reporting. It ships as a web app, a Docker/VPS deployment, and an Android APK wrapper that loads the deployed store.

## Stack

- **Frontend:** React 19, Vite 8, TypeScript, Tailwind CSS 4, lucide-react
- **Backend:** Express 4 on Node 24, built-in `node:sqlite` (WAL, foreign keys), TypeScript via `tsx`
- **Money:** all amounts stored as integer cents; refunds are prorated with the same algorithm on client and server
- **Auth:** 4-digit PIN (scrypt hash), opaque HttpOnly session cookies, login throttling, same-origin guard, security headers and API rate limits
- **Mobile:** Capacitor 8 Android wrapper (remote URL) with a native Android print bridge

## Quick start

Requirements: Node.js 24+.

```bash
npm install
cp .env.example .env      # optional for local dev
npm run dev               # http://localhost:3000
```

The first launch creates `data/whispers.db`, applies migrations, and (if the database is empty) imports the legacy export at `data/whispers_db.json`.

**Default PIN: `1234`.** The server logs a warning until you change it in **Settings → Change PIN**. Change it before going live.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite middleware + API on port 3000 with HMR |
| `npm run build` | Build the SPA to `dist/` and bundle the server to `dist-server/server.js` |
| `npm start` | Run the built production server (`dist-server/server.js --production`) |
| `npm run typecheck` | TypeScript checks for client, server and tests |
| `npm test` | Unit tests (refund math, M-Pesa SMS parser) plus a full API end-to-end suite |
| `npm run clean` | Remove build output |
| `npm run mobile:sync` | Sync the built web app and config into the Android project |
| `npm run mobile:open` | Open the Android project in Android Studio |

## Configuration

All configuration is environment-based (`.env` is loaded automatically). See [.env.example](.env.example) for the full list.

Key values:

- `PORT`, `HOST`, `DATA_DIR` — listener and storage location (default `./data`)
- `STORE_TIMEZONE` — business date timezone (default `Africa/Nairobi`)
- `CASHIER_NAME` — printed on receipts and audit entries
- `TRUST_PROXY`, `COOKIE_SECURE`, `SESSION_DAYS` — set both proxy flags when running behind HTTPS
- `SEED_LEGACY` — import `data/whispers_db.json` once into an empty database
- `APP_URL` — public HTTPS origin, used to derive the M-Pesa callback URL
- `MANUAL_MPESA_ENABLED` — allow cashiers to record a payment from the confirmation SMS

## M-Pesa (Daraja)

STK Push switches on automatically when every value below is present; otherwise the app runs with manual M-Pesa code entry only.

```env
MPESA_ENV=production                 # sandbox | production
MPESA_SHORTCODE=174379               # Till / Paybill shortcode
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
MPESA_PASSKEY=...
APP_URL=https://pos.example.com
MPESA_CALLBACK_SECRET=<random-long-string>
# optional explicit callback instead of APP_URL + secret:
# MPESA_CALLBACK_URL=https://pos.example.com/api/mpesa/callback/<secret>
MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline
```

- The callback endpoint is `POST /api/mpesa/callback/<MPESA_CALLBACK_SECRET>`. It must be publicly reachable over HTTPS.
- STK Push requires whole-shilling totals; the POS explains this when a cent amount is rejected.
- Every M-Pesa code is single-use across sales and credit payments.
- A pending STK intent locks the cart so the amount cannot change mid-payment.

## Docker / VPS deployment

```bash
cp .env.example .env
# edit .env: set APP_URL, MPESA_* if used, and for HTTPS:
#   TRUST_PROXY=true
#   COOKIE_SECURE=true
docker compose up -d --build
```

- The SQLite database, uploads and backups live in the `./data` volume (`/data` in the container).
- Put nginx/Caddy/Traefik in front for TLS, forward to `http://127.0.0.1:3000`, and set `TRUST_PROXY=true` plus `COOKIE_SECURE=true`.
- Do **not** expose the container over plain HTTP on a public IP with `COOKIE_SECURE=true` — login cookies will not persist.
- Health check: `GET /api/health`.

Example nginx location:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Backups and restore

Backups are SQLite snapshots written to `DATA_DIR/backups`:

- automatically on startup and every 6 hours (at most one per day),
- on graceful shutdown,
- on demand from **Settings → Backups** (also downloadable there).

To restore: stop the server, replace `data/whispers.db` with the chosen `whispers-YYYY-MM-DD....db`, delete any `whispers.db-wal` / `whispers.db-shm` files, then start the server. Keep the old file until you have verified the restore.

## Android APK

The APK is a Capacitor WebView that loads the deployed POS URL, so it needs the server to be online (this is not an offline on-device database).

1. Deploy the server on HTTPS (see above).
2. In GitHub, add a repository variable **`POS_SERVER_URL`** = `https://pos.example.com`.
3. Run **Actions → Android APK → Run workflow** (optionally pass `server_url`), or push a `v*` tag.
4. Download the `whispers-cosmetics-debug-apk` artifact and install `app-debug.apk` on the phone (allow installation from unknown sources).

The debug APK is signed with the debug key — fine for sideloading, not for Play Store release. For a release build, create a keystore, add the signing config to `android/app/build.gradle`, and keep the keystore out of git.

Notes:

- Receipt printing inside the APK uses Android's print service via a small native plugin (`ReceiptPrinterPlugin`); browser printing still uses the normal print dialog.
- Android hardware back navigates the POS history before leaving the app.
- The web app can also be used directly in a mobile browser; the APK just adds an installable icon and native print dialog.
- If you change the server URL, re-run the workflow; the URL is compiled at build time.

Local APK build (requires JDK 21 + Android SDK):

```bash
npm run build
CAPACITOR_SERVER_URL=https://pos.example.com npx cap sync android
cd android && ./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

## Testing

```bash
npm test
```

- `tests/refunds.test.ts` — rounding, discounts, partial/sequential refunds, invalid quantities
- `tests/mpesaParser.test.ts` — Till/Paybill SMS parsing, mismatches, generated demo SMS
- `tests/server.test.ts` — boots a real server on a temporary database and exercises login/throttling, bootstrap, products and stock ledger, cash/manual-M-Pesa/credit sales, refunds, reports, audit, uploads, backups, settings, PIN change and unconfigured Daraja

CI (`.github/workflows/ci.yml`) runs typecheck, tests and the production build on every push/PR.

## Project layout

```
server.ts                 startup: DB, migrations, legacy import, Vite/prod serving, timers
server/                   Express app, auth, SQLite, M-Pesa, validation, services
server/services/          products, sales, credits, reports, settings, backups, uploads
src/                      React client (views, POS, receipts, settings, reports)
src/lib/                  shared refund allocation, M-Pesa parser, API client, formatting
tests/                    node:test unit and API suites
android/                  Capacitor Android project (tracked)
data/whispers_db.json     legacy export imported into an empty database
```

## Security notes

- Change the default PIN immediately; changing it revokes all other sessions.
- Set a long random `MPESA_CALLBACK_SECRET`; the callback URL is unguessable and validates the Daraja payload.
- Use HTTPS in production and enable `COOKIE_SECURE` + `TRUST_PROXY`.
- Keep `.env`, `data/` and keystores out of version control (already in `.gitignore`).
- Backups contain customer names, phones and sales history — treat them as sensitive.
