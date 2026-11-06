# GIDEON CLOUD

A web dashboard where people sign in, paste the `Gideon~` Session ID from https://praise-pair.onrender.com/ and run their own Gideon on their own WhatsApp. Powered by GPRAISE.

## What runs where
| File | Role |
|---|---|
| `index.html`, `cloud-config.js` | The dashboard, served at `/` by the bot itself (no build step, no dependencies) |
| `cloud.js` | Small HTTP server (Node built-ins only) inside the bot process: serves the dashboard and the API under `/api/cloud/*` |
| `bot.js` | Additive: `manager.cloud.open/stop/close`, per-bot `status`, `lastError`, `openedAt`, `logs` |
| `cloud-data/` | Created at runtime: `bots.json` (owner uid, name, number) and `sessions/<botId>/creds.json` (mode 0600). Git-ignored and never touched by `.update` |

The Global Gideon server (economy, Premium, Paystack, admin) is **unchanged**; nothing in it needed to change. Premium stays inside the bot exactly as before: Cloud bots are ordinary linked accounts and the existing gate in `handler.js` still applies to every command.

## Deploy
1. Host the bot as a **Web Service** (Render, Katabump with a public port, etc.). `Procfile` already runs `bash start.sh`; the dashboard listens on `process.env.PORT` (or `cloud.port`, default 3000).
2. **Firebase Authentication** (the existing project `gideon-e2265`): Console > Authentication > Sign-in method: Email/Password must be on, and **sign-up must be enabled** so customers can create accounts. This differs from the admin-dashboard advice in `docs/UPGRADE.md` to turn sign-ups off. Firestore rules are unaffected: only the admin email can read admin collections, and customers never touch Firestore from the browser.
3. If the Firebase web API key has an HTTP-referrer restriction (Google Cloud console > Credentials), add your dashboard domain.
4. Optional `config.local.json` overrides:
   ```json
   { "cloud": { "maxBotsPerUser": 3, "maxBots": 20, "requireVerifiedEmail": true, "enabled": true } }
   ```
5. Keep `cloud-data/` on **persistent disk**. On a host with an ephemeral disk (Render free), every redeploy wipes sessions and users must add their bots again.

## Security model
- Sign-in: Firebase email/password. The browser sends the Firebase ID token; `cloud.js` verifies signature, issuer, audience and expiry against Google's public keys. Email must be verified by default.
- Every bot record stores its owner's Firebase uid; every request is checked against it. Another user's bot id answers 404, identical to a missing bot.
- The Session ID is only read from the POST body, written to that bot's own `creds.json`, and never logged, returned, put in a URL, or stored in Firestore/`bots.json`. The browser clears the field after sending and keeps only a Firebase refresh token in `localStorage`.
- The Owner WhatsApp Number must match the number inside the Session ID, or the request is refused. A number already connected anywhere in this Gideon (main bot, `.pair` users, other Cloud users) is refused.
- Only `index.html` and `cloud-config.js` can be served. `config.js`, `database.json`, `session/` and everything else return 404.
- Rate limits (connect attempts, failed sign-ins, per-user and per-IP requests), 300 KB body limit, CSP and no-store headers on the API.
- A bot is shown **Online only after WhatsApp confirms the login** (`connection: open`). A logged-out or replaced session shows an error and is never silently deleted.
- Cloud bots are separate from `.pair`: they do not appear in `.listpaired`, count against `maxSubBots`, or can be removed with `.unpair`.
- Sessions are stored on disk in plain files, like the existing `session/` and `sessions/` folders. Anyone with server file access can use them.

## Assumption to verify
The pairing site's source is not in either project. `cloud.js` (`decodeSession`) accepts `Gideon~` followed by the creds.json text encoded as base64 / base64url, optionally gzipped, or raw JSON, and requires Baileys credentials containing a linked number. If your pair site encodes the Session ID differently, adjust that one function; `tests/cloud.test.js` shows the accepted forms. Nothing is guessed: unreadable IDs are rejected.

## Delete behaviour
DELETE logs the linked device out of WhatsApp (same as `.unpair`) and removes the session files. Stop keeps the session and just disconnects.

## Tests
`npm run test:cloud` runs the API (auth, ownership isolation, secrecy, limits, static whitelist, restore), the dashboard script end to end against the real API, and the `bot.js` hooks with a fake Baileys. Not covered: a real WhatsApp login, real Firebase, and visual layout (open the page on phone and desktop).
