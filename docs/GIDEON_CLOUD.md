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

## Making yourself the MAIN bot (SESSION_ID)
Only one WhatsApp account per deployment is the main bot (full owner commands such as `.pair` and `.self`). Anyone added through the dashboard is a sub-bot. On hosts without a file manager (Render), set an environment variable `SESSION_ID` to your own `Gideon~...` Session ID: on every start it is written to `session/creds.json`, so you are the main bot even after a disk wipe. A saved `creds.json` for the same number is kept; a different number replaces it. Do not also add your own number in the dashboard. Treat `SESSION_ID` like a password.

## Cloud users are MAIN bots of their own number
Everyone who adds a Session ID in the dashboard runs as the main bot of their own WhatsApp number and can use every owner command from their own chat ("Message yourself"), except the host-only ones. Host-only: `.eval`, `.exec`, `.restart`, `.update`, `.clear` (they run code on, restart, update or clean the whole server and every user's bot) and the developer commands `.reactall`, `.joinall`, `.notify`, `.botcount`. A Cloud user who tries one is told "You are not allowed to use this command". A paired person who tries any owner command is told "only available on the main Gideon bot". `.getsession` gives a Cloud user their OWN session as a `Gideon~` ID. Mark a command `dev: true` to make it host-only.
- Everything a Cloud user changes stays theirs: prefix, theme, auto-read and the other switches, public/private, bans, antilink and the other group settings, auto-reply, reminders, local economy. Each user has their own database (`cloud-data/sessions/<id>/db.json`, deleted together with the bot), and nothing they do touches the host or other users. This is done in `context.js` (the user's context follows everything their bot's events start).
- `.pair` allows at most `cloud.maxPairedPerBot` people (3) per Cloud bot. Each paired person is another live WhatsApp connection, so this is the RAM guard. People paired by a Cloud bot follow that Cloud bot's settings, never use the host's own `maxSubBots` slots and never show in the host's `.listpaired`. Paired people only get the commands marked `subSafe`.
- Deleting a Cloud bot, or WhatsApp logging it out, also removes everyone it paired (their sessions are deleted and their devices logged out) and the user's database.
Raise `cloud.maxPairedPerBot` in `config.js` when you move to a bigger host.

## Premium IDs: one ID, one live WhatsApp
- A Premium ID never changes. Renewing adds days to the same ID, and it stays until it expires.
- Every main bot (the host's, and each Cloud user's) is its own installation on the Global server and enters its own ID: `.premium id:GID-123456` in "Message yourself". People a Cloud user pairs share that user's Premium.
- An ID works on ONE WhatsApp at a time. While a bot is online it sends a heartbeat every 5 minutes. If another number tries the same ID meanwhile, the server answers "in use".
- To use the ID on another number: log the first one out of WhatsApp or delete its bot. The ID is freed immediately (same ID, same expiry). If the first bot just went offline without logging out, it frees itself about 12 minutes after it was last online. STOP in the dashboard does not free it right away.
- Needs the updated Global Gideon server (`/premium/release`, live-holder check). Deploy the server first, then the bot.


## Firebase storage for Cloud users (survives a wiped disk, deleted on logout)
Set `FIREBASE_SERVICE_ACCOUNT` (the service-account JSON from Firebase console > Project settings > Service accounts, pasted as is, or base64 of it) in the host's environment. Optional: `CLOUD_STORE_KEY` (your own passphrase for the encryption; if you set it, never change it, or old backups cannot be read).
- Each Cloud user's session and settings are copied, **encrypted**, to Firestore collection `cloudBots` (the data is unreadable without your key). The disk stays the working copy; Firebase is the safety copy.
- Uploads happen at most once every 10 minutes per user, only when something changed (Firestore free tier allows 20,000 writes a day, which covers well over 30 busy users).
- On start, any user who is in Firebase but not on the disk (new host, wiped disk) is restored and started automatically. Moving to Oracle = deploy there with the same environment variables and stop the old host first; two hosts running the same session at once makes WhatsApp disconnect it.
- When a user logs out of WhatsApp or deletes their bot, their session, settings and Firebase copy are deleted, which frees the storage.
- People a Cloud user paired are NOT copied (they re-pair after a wiped disk).
- Without `FIREBASE_SERVICE_ACCOUNT` everything works as before, on the disk only.

## Premium plans and `.subscribe`
Plans are edited in the Global server admin: Subscription Settings > Plans (name, days, price in naira; price 0 = not for sale). `.subscribe` shows them as a numbered list and `.subscribe 2` sends the Paystack link for the second one (an email is optional: `.subscribe 2 me@mail.com` if the buyer wants Paystack's receipt). Premium IDs are now long (`GID-XXXX-XXXX-XXXX`); old 6-digit IDs keep working.

## `.gideonai`
Asks several AI providers in turn (Gemini if `GEMINI_API_KEY` is set, then two free ones), so one dead service no longer breaks it. A free Gemini key from aistudio.google.com makes it much more reliable. `GEMINI_MODEL` changes the model.

## Downloaders: `.yt <link or search>`, `.ytmp4`, `.play <song or link>`, `.fb <link>`
They use yt-dlp (found on the PATH, in `YTDLP_PATH`, or downloaded once into `./bin`). Each download works in a temp folder that is deleted as soon as the file was sent, never accumulates, and is limited (`config.downloads`: 2 at a time, 60 MB video, 40 MB audio, 12 / 20 minutes, 20 s between requests per person). Firestore is not used for this: a document there is limited to 1 MiB, so it cannot hold media. If YouTube blocks a datacenter IP ("sign in to confirm you are not a bot"), put a cookies file on the host and set `YTDLP_COOKIES` to its path. Without yt-dlp the old online services are tried as a fallback.
