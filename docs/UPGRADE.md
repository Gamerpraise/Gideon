# Gideon AI platform upgrade: install, deploy, migrate

Nothing was replaced. Same Baileys bot, same Express + Firebase Admin + Firestore server, same Global Gideon Network. New code is in:
`Global-Gideon-server-main/platform/` and `public/admin.html` (server), `premium.js`, `plugins.js`, `commands/premium.js`, `scripts/gen-registry.js`, `commandpolicy.default.json` (bot).

## How it fits together
- **Bot** asks the server for the policy (`GET /policy`) and, for every PREMIUM command, asks `POST /premium/authorize`. The bot never says "I am premium"; it proves which installation it is (installId + secret token issued by the server) and the server answers from its own records.
- **Free commands** run locally exactly as before. The only things that can stop them are the admin's own switches (command disabled, Economy off, Fun off).
- **Free Mode is the default** (`subscriptionEnabled: false`). Paystack is not needed for it.
- **Economy**: `economyMode` LOCAL or GLOBAL. In GLOBAL the local names (`.balance`, `.daily`, `.transfer`...) run their `g…` twin on the network (`.gbalance`, `.gdaily`, `.gsend`). `.donate` has no twin and stays local. In LOCAL the `g…` commands still work for people who ran `.joinnetwork on`.
- **Honest limit:** the bot's code is open and runs on other people's hosts. The server decides and tells the bot, but a host who edits their own copy of the bot to skip the check can still run that local code. What cannot be bypassed is anything the server itself performs (all global economy rolls and balances, Premium IDs, payments). Treat Premium on locally-executed commands as honest-user enforcement.

## What lives where (public bot repo vs private server repo)
| Private repo (`Global-Gideon-server-main`) | Public bot repo (`Gideon-main` minus the server folder) |
|---|---|
| Premium IDs, subscriptions, payments, Paystack keys | `premium.js`, the gate in `handler.js` (asks the server) |
| Admin dashboard, the full command registry, policy | all command files and `commandpolicy.default.json` (names and default tiers only) |
| Global economy (balances, rolls, validation) | local economy |
| Firestore rules, `.env` | `config.js` |
**Important and honest:** the bot repo is public and runs on other people's machines, so the gate in `handler.js` is an *honest-user* gate. Someone can fork the bot and delete the check, then run premium command code they have copied. What cannot be bypassed is whatever the server itself does. To make Premium genuinely hard to bypass, the premium command code has to move to the private server (or be delivered only to subscribed installations). See the end of this file for the options.

## 1. Server (Render or similar)
1. Replace the server folder contents with `Global-Gideon-server-main/` from this ZIP (no new npm dependencies; Node 20+ for built-in `fetch`).
2. Set environment variables from `.env.example`. At minimum add `SESSION_SECRET` and `SECRETS_KEY` (and make sure `FIREBASE_SERVICE_ACCOUNT` is from the Firebase project `gideon-e2265`, the same project the dashboard signs in to). Rotate `NETWORK_KEY` (the old one is public). There is **no admin password** any more.
3. Firebase console, Authentication, Sign-in method: enable **Email/Password**. (The web config is already built into `public/admin.html`.)
4. Deploy, open `https://<server>/admin`, choose **Sign up** with `gamerpraisemoder@gmail.com`, open the verification link Firebase emails you, then **Log in**.
5. Publish the new `firestore.rules` (Firebase console, Firestore, Rules).

### Admin sign-in (how it works)
- The dashboard signs in with the **Firebase JS SDK in your browser**. Your password goes straight to Firebase; **it never reaches your server and is never stored**. The page then sends Firebase's ID token to `POST /admin/api/auth/session`, the server **verifies it with the Admin SDK**, requires the email to be exactly `ADMIN_EMAIL` (default `gamerpraisemoder@gmail.com`) **and verified**, and answers with a 12-hour signed session.
- Any other email is refused (and logged). An unverified account can never get in, so nobody can register your email before you and use it.
- **After you have created your account, turn sign-ups off:** Firebase console, Authentication, Settings, User actions, untick **Enable create (sign-up)**. Then nobody else can create accounts in that project at all. Firebase's public API cannot otherwise be told to refuse other emails; the dashboard and the rules already ignore them, but turning sign-up off is what really stops stray accounts. I did not delete anyone's accounts (the project may be shared and deletion is permanent).
- `firestore.rules` lets only the verified admin email read/write the admin collections from a client. `secrets` (Paystack key), `idempotency`, `webhookEvents`, `devCommands`, `trades` and `meta` stay server-only for everyone. The server's Admin SDK ignores rules. **Publish the rules file** (Firebase console, Firestore, Rules). It has not been run in the Firebase emulator.

### Try the dashboard in SPCK Editor before you host anything
SPCK cannot run Node, so `admin.html` has a **preview mode**. Open `Global-Gideon-server-main/public/admin.html` in SPCK and use Preview (keep the project folder structure intact: the page loads `logo.jpg`/`banner.jpg` from its own folder and `../platform/registry.json`). The page detects that no server is behind it and:
- signs you in with Firebase (needs internet and the Email/Password provider enabled);
- reads Firestore directly (the published rules allow only your verified email), so every tab shows real data, or zeros if nothing is there yet;
- lets you change the **background image**, **settings switches** and **command FREE/PREMIUM/enabled** settings (saved to Firestore, so the hosted server picks them up);
- shows "Preview mode (no server)" in the header, and **refuses anything that needs the server** (issuing Premium IDs, balance adjustments, Paystack, file uploads) with a clear message. Those need the server for secure checks and audit logs; they work as soon as you deploy.
If sign-in fails with a "requests from referer blocked" style error, your Firebase API key has a website restriction: add SPCK's preview origin (or remove the restriction for testing) in Google Cloud console, APIs & Services, Credentials.

### Dashboard background
Dashboard tab, hero banner: **Change background** uploads any image (resized to at most 1600 px and compressed in your browser, stored in Firestore `settings/branding`); **Reset** restores the default art. The default art and logo are cropped from the screenshot you sent, so replace them with higher-resolution versions (`public/banner.jpg`, `public/logo.jpg`) when you have them.

## 2. Bot (each host)
1. Update the bot files (`.update` pulls from your repo, or upload this ZIP's bot files). Run `npm install` as before (no new bot dependencies).
2. Put the new `networkKey` in `config.local.json` if you rotated it.
3. On first start the bot registers itself and stores `premium.installId/token` in `database.json`. **Do not delete `database.json`** without reading "Recovery" below.
4. After adding or removing command files, run `node scripts/gen-registry.js` and copy the generated `platform/registry.json` to the server (it is regenerated into the server folder automatically if you run it from the full project).

## 3. Migration notes (read before going live)
- **Premium defaults change behaviour in Free Mode.** These now stop working until you switch Premium Mode on or set them FREE in the Command Manager: `.anticall`, `.autostatus`, `.statusreact`, `.autosavestatus`, `.savestatus`, `.autoreply` (+`.replies .reloadreply .replytest`), `.autobio`, `.ghost`, `.poststatus`, `.postpairstatus`, `.delpost`, `.gcstatus`, `.gideonai`, `.imagine`, `.hd`, `.removebg`. Their background behaviour (auto status view, anti-call, etc.) is gated too.
- **`.vv`, `.vv2`, `.antidelete` are shipped disabled** (policy: restricted). They defeat privacy choices other people made. Their source is untouched, but they cannot be enabled or sold from the dashboard. If you disagree, that is a decision to make in code, not in the dashboard.
- Existing balances (local `database.json`, Firestore `players`) are untouched. New economy settings default to the old hard-coded values (start 500, daily 500, weekly 3000, work 100-400 every 30 min, bets 50-5000, loan 2000).
- Old bots talking to the new server keep working (new endpoints are additive). New bots talking to an old server run in Free Mode.
- The economy now sends an idempotency key with each write. Old servers ignore it.

## 4. Paystack (when approved)
1. Dashboard, API & Integrations: paste public key, secret key, pick Test/Live, Save, **Test connection**.
2. In the Paystack dashboard set the webhook to `https://<server>/paystack/webhook`.
3. System Settings: set a plan price (Subscriptions tab, plan JSON, `amountNaira > 0`), enable the Paystack switch, then switch the Global Subscription System ON.
4. Customers: `.subscribe monthly them@email.com`, pay, and the bot DMs the `GID-xxxxxx` ID. If the webhook is missing, the bot's own polling also settles the payment (server-side verified).
Until then you can sell/issue IDs manually: Premium Manager, Generate, send the ID, the customer runs `.premium id:GID-xxxxxx`.

## 5. Recovery and IDs
- `.premium` shows status. `.premium id:GID-747493` restores an ID.
- An ID bound to one installation cannot be claimed by another. If a host loses `database.json` the same **owner number** may re-bind it (max 3 times); anything else needs you to **Unbind** it in the Premium Manager.
- Logout, restart or redeploy never cancels a subscription (it lives on the server). IDs are `GID-` plus 6 random digits; they are protected by installation binding and rate limits, not by secrecy alone.

## 6. Plugins (optional, off by default)
Upload in File Manager: validated, stored with 10 versions and rollback, inactive until you **Approve**. The server never runs uploaded code. To distribute to bots you must set `PLUGIN_SIGNING_KEY`; a host must opt in with `allowPlugins: true` and your public key in its own `config.local.json`. Screening is a safety net, not a sandbox: only distribute code you wrote.

## 7. Tests
`node tests/platform.test.js`, `node -r ./tests/stub-missing-modules.js tests/bot.test.js` and (needs Playwright) `node tests/ui.test.js` (second one only needs the stub if `npm install` has not been run).

## 8. Making Premium harder to bypass (not done yet, your call)
- **A. Run the premium logic on the private server.** For commands that are just computation or an API call (`.gideonai`, `.imagine`, `.hd`, `.removebg`), the bot would only forward the request (`prompt`, image) to the server, which checks the subscription, does the work (with the API keys that only the server holds) and returns the result. A forked bot has nothing to steal. Strongest, and also protects your API keys.
- **B. Premium plugins delivered only to subscribed installations.** For commands that must act on the WhatsApp session itself (`.anticall`, `.autostatus`, auto-reply, ghost), the code has to run in the bot. Keep that code out of the public repo, store it in the File Manager, and let the server send it (signed) only while the installation has an active subscription. The infrastructure for this exists (File Manager, signing, `plugins.js`), but a paying host can still read and share the file from their own disk, so this raises the bar rather than closing the door.
- **C. Leave it as is** (honest users only). Fine to launch with; the dashboard, payments, IDs and economy are real either way.
