# Testing report

Run on the final code with `npm test` (`node tests/platform.test.js` + `node tests/bot.test.js`).

**Result: 94 server tests, 18 bot tests, 35 browser (UI) tests: all passed, 0 failed.**

## What the tests ran against (read this)
The sandbox had no network and no npm packages, so the tests use in-memory stand-ins (`tests/fakes.js`) for Firestore and Express and a mocked `fetch` for Paystack. That exercises my logic (policy, authorization, binding, settlement, idempotency, validation, encryption) but it is **not** the same as the real services. **Not tested:** the real Firebase libraries and servers (sign-in, email links, Firestore rules in the emulator), real Firestore (transaction contention, indexes), real Paystack (a real test-mode payment end to end, real webhook delivery), a real WhatsApp session, the dashboard in a browser (its JavaScript compiles and the API it calls is tested, but nobody clicked through it), and a deploy on Render/Katabump. Do a test-mode payment before going live.

## Your scenario list
| Scenario | Covered by |
|---|---|
| Free Mode | exact Free Mode message, no payment prompt, free/economy/fun commands pass, checkout refused |
| Premium Mode | free commands unaffected; premium blocked without subscription; allowed with one |
| Paystack not configured | status says unavailable, checkout refused, cannot be enabled without a key |
| Paystack configured | keys validated, stored encrypted (plaintext absent from stored doc), test connection, checkout amount decided by server, signed webhook settles |
| Economy Local / Global | mode switch exposed to bots; bot redirects local names to global twins incl. renamed ones; `.donate` stays local |
| Economy with subscriptions OFF | works with subscriptions/Paystack on or off |
| Fun with subscriptions OFF | works |
| Free commands with subscriptions ON | works |
| Premium without subscription | blocked (`NOT_PREMIUM`) |
| Premium with active subscription | allowed; survives a "restart" |
| Expired Premium ID | blocked (`EXPIRED`), free commands unaffected |
| Invalid Premium ID | rejected; malformed rejected; rate limited |
| Duplicate payment webhook | repeated and re-ID'd deliveries grant once, no extra extension; webhook + two polls in parallel settle once |
| Command category changes | FREE<->PREMIUM, disable (aliases follow), bad input rejected, restricted commands cannot be changed |
| Economy transaction integrity | idempotency-key replay, separate keys separate, tx log, negative balance refused, concurrent adjustments cannot overdraw |
| File upload security | traversal/bad names, child_process/eval/process.env/fs-write/dynamic require/credential paths, interface check, syntax error, wrong extension, size, JSON/PNG magic/SVG script, uploaded code **not executed** at upload or approval, versioning, rollback needs re-approval, plugin signature verifiable |
| Also | admin login/rate limit/forged token, amount mismatch, other installs can't read/steal, secrets never in responses, bots get only the public settings |

## Dashboard and sign-in
- Server: ID-token session exchange (garbage/missing token, different email, unverified admin email, look-alike emails, forged/tampered/other-email sessions, rate limit, audit log), no password routes exist, banner validation/reset, dashboard fields.
- Browser (headless Chromium, Firebase CDN libraries replaced by stubs, API mocked): both **hosted** and **preview (SPCK-style, no server)** modes: login rules, dashboard panels, banner upload and reset, all 15 tabs open, Command Manager, preview refusing server-only actions, preview writing settings/commands to Firestore, logout, no JavaScript errors, and a phone-width layout check.
- Stubs are not Firebase: do one real sign-up/login, and one real banner upload, before relying on it.

## Raw output
```
  ok   there is no admin password anywhere and the server never sees a password (no password login routes exist) 
  ok   admin API refuses requests without a session 
  ok   ping tells the dashboard a server is hosting it 
  ok   session: missing / garbage Firebase token refused 
  ok   session: a verified Firebase account with a DIFFERENT email is refused (and logged) 
  ok   session: the admin email with an UNVERIFIED address is refused (nobody can squat your email) 
  ok   session: verified admin email gets a session 
  ok   session: email comparison is case-insensitive but exact (no look-alikes) 
  ok   session works and /me reports the admin email 
  ok   forged or tampered session tokens are rejected 
  ok   a correctly signed session for any other email is rejected 
  ok   session exchange is rate limited 
  ok   failed and denied sign-ins are in the audit log 
  ok   dashboard page and its artwork are served without a session, API data is not 
  ok   banner upload: only real image data URLs, size capped, reset works 
  ok   overview exposes the dashboard fields (uptime, version, paystack state) 
  ok   default is FREE MODE (subscriptions off) 
  ok   Free Mode: premium command blocked with the exact Free Mode message 
  ok   Free Mode: no payment prompt in the blocked message 
  ok   Free Mode: free management command allowed 
  ok   Free Mode: economy command allowed (local + global names) 
  ok   Free Mode: fun command allowed 
  ok   Free Mode: checkout refused, answers with Free Mode message 
  ok   Free Mode: economy endpoints still work through the guard 
  ok   restricted commands (vv, vv2, antidelete) are blocked in every mode 
  ok   restricted commands cannot be switched on or made FREE from the dashboard 
  ok   Premium Mode ON: free commands still work 
  ok   Premium Mode ON, no subscription: premium command blocked (NOT_PREMIUM) 
  ok   Paystack not configured: status says payments unavailable, checkout refused 
  ok   Paystack cannot be enabled before a secret key exists 
  ok   Bot-facing authorize rejects an unknown token 
  ok   admin can issue a Premium ID without Paystack (format GID-nnnnnn) 
  ok   invalid Premium ID is rejected 
  ok   malformed Premium ID is rejected 
  ok   valid Premium ID binds to the installation and unlocks premium commands 
  ok   premium stays active across a "restart" (a brand-new session for the same installation) 
  ok   another installation cannot steal a bound ID 
  ok   same owner number can re-bind after losing its database (limited to 3 times) 
  ok   claim attempts are rate limited per installation 
  ok   expired Premium ID: blocked with EXPIRED 
  ok   revoked Premium ID loses access; restore brings it back 
  ok   global Premium Commands switch OFF blocks even subscribers 
  ok   turning subscriptions OFF blocks premium again (even for a valid subscriber) 
  ok   Paystack secret is rejected if malformed 
  ok   Paystack: environment/key mismatch is rejected 
  ok   Paystack: save keys (encrypted at rest, never returned) 
  ok   Paystack: test connection succeeds with a good key 
  ok   Paystack: enable 
  ok   plans with price 0 are not purchasable 
  ok   checkout needs a valid email 
  ok   checkout creates a pending payment with the amount decided by the SERVER (client amount ignored) 
  ok   webhook with a bad signature is rejected and grants nothing 
  ok   signed webhook for a payment Paystack has NOT confirmed grants nothing (server verifies itself) 
  ok   signed webhook after Paystack confirms: Premium ID generated, bound to the installation, expiry saved 
  ok   DUPLICATE webhook does not grant twice or extend again 
  ok   concurrent webhook + customer poll settle exactly once 
  ok   renewal by the same installation extends the SAME ID instead of issuing a new one 
  ok   amount mismatch from Paystack grants nothing 
  ok   one installation cannot read another's payment 
  ok   Paystack switch OFF: checkout unavailable but existing subscribers keep working 
  ok   Command Manager: FREE -> PREMIUM change takes effect 
  ok   Command Manager: PREMIUM -> FREE makes an advanced command work without a subscription 
  ok   Command Manager: disabling a command blocks it everywhere; aliases follow 
  ok   Command Manager: bad tier / unknown command rejected 
  ok   Command Manager lists every command with class, tier, policy and handler status 
  ok   every economy and fun command is FREE by default 
  ok   user-named FREE examples are FREE and PREMIUM examples are PREMIUM by default 
  ok   economy mode LOCAL/GLOBAL is switchable and exposed to bots 
  ok   economy keeps working with subscriptions OFF and Paystack OFF 
  ok   economy keeps working with subscriptions ON 
  ok   Economy System switch only affects the economy (fun + premium unaffected) 
  ok   Fun switch only affects fun commands 
  ok   duplicate economy request (same idempotency key) is applied once and replayed 
  ok   different idempotency keys are separate transactions 
  ok   economy requests are written to the transaction log 
  ok   admin balance adjustment is audited and cannot create a negative balance 
  ok   concurrent adjustments never overdraw 
  ok   economy config validated and applied live (daily reward, bets, shop price) 
  ok   economy players search + stats endpoints work 
  ok   file upload: path traversal / bad names rejected 
  ok   file upload: plugin using child_process / eval / process.env / fs write rejected 
  ok   file upload: plugin missing the command interface or with a syntax error rejected 
  ok   file upload: wrong extension for kind, empty, oversize rejected 
  ok   file upload: config must be valid JSON; image must match its magic bytes; svg scripts rejected 
  ok   file upload: a valid plugin is stored as VALIDATED (inactive) and is never executed by the server 
  ok   plugins are NOT distributed without a signing key 
  ok   plugin signing: bots receive a verifiable signature once a key is configured 
  ok   file versioning + rollback (rolled-back plugin needs re-approval) 
  ok   file manager writes upload logs, including rejected uploads 
  ok   file validator unit checks 
  ok   dashboard endpoints respond (overview, installs, payments, premium, analytics, logs, security) 
  ok   payments list masks customer emails and never includes keys 
  ok   bots only get the public settings subset (no keys, no plans) 
  ok   security page flags the NETWORK_KEY published in the repo 
platform tests: 94 passed, 0 failed
  ok   Free Mode: free commands (management, economy, fun) pass without contacting the server for premium
  ok   Free Mode: premium command gets the Free Mode message from the server
  ok   server unreachable: free commands still work, premium stays blocked with the Free Mode message
  ok   Premium Mode: every premium request is checked server-side; yes -> allowed
  ok   Premium Mode: the server saying no blocks it, with the server message
  ok   client cannot grant itself premium: nothing in local state makes a premium command pass without a server yes
  ok   short-lived grace: a recent server "yes" survives a brief outage, a cold start does not
  ok   restricted commands (vv, vv2, antidelete) are blocked in every mode
  ok   admin-disabled command is blocked
  ok   Economy switch OFF blocks only economy commands (also with subscriptions OFF)
  ok   Fun switch OFF blocks only fun commands
  ok   economy keeps working with subscriptions ON/OFF and Paystack ON/OFF
  ok   Command Manager override: a command made PREMIUM on the server is checked; one made FREE is not
  ok   background features: premium ones stay OFF in Free Mode, free ones stay on
  ok   background features turn on only with Premium Mode + a server-confirmed active subscription
  ok   expired entitlement switches background features off
  ok   economy mode LOCAL: local commands run as themselves
  ok   economy mode GLOBAL: local commands run their Global Network twin (including renamed ones)

bot tests: 18 passed, 0 failed

== HOSTED mode ==
  ok   login screen shows, app hidden
  ok   non-admin email refused before anything is sent
  ok   wrong password refused
  ok   unverified admin account cannot log in (verification email re-sent)
  ok   sign-up for a non-admin email is refused
  ok   correct admin login shows the dashboard
  ok   hosted: Firebase ID token was exchanged with the server for a session
  ok   stat cards, chart, activity, quick actions, info and status panels all render
  ok   banner: uploading an image changes the hero background and persists
  ok   banner: Reset goes back to the default art
  ok   every sidebar tab opens without a JavaScript error
  ok   Command Manager lists the commands and marks vv/vv2/antidelete restricted
  ok   Command Manager: changing a command tier sends the change
  ok   log out returns to the login screen
  ok   no JavaScript errors on the page

== PREVIEW mode ==
  ok   login screen shows, app hidden
  ok   non-admin email refused before anything is sent
  ok   wrong password refused
  ok   unverified admin account cannot log in (verification email re-sent)
  ok   sign-up for a non-admin email is refused
  ok   correct admin login shows the dashboard
  ok   preview: no server calls, data came from Firestore, banner/logo load from the same folder
  ok   stat cards, chart, activity, quick actions, info and status panels all render
  ok   preview: real Firestore numbers on the cards (2 installs, 3 accounts, 1 premium)
  ok   banner: uploading an image changes the hero background and persists
  ok   banner: Reset goes back to the default art
  ok   every sidebar tab opens without a JavaScript error
  ok   Command Manager lists the commands and marks vv/vv2/antidelete restricted
  ok   Command Manager: changing a command tier sends the change
  ok   preview: actions that need the server are refused with a clear message (Premium ID, economy adjust)
  ok   preview: Paystack tab explains it needs the server (and shows no keys)
  ok   preview: settings switches are saved to Firestore
  ok   log out returns to the login screen
  ok   no JavaScript errors on the page

== PHONE ==
  ok   phone: sidebar hidden until the hamburger is tapped, no sideways scroll

ui tests: 35 passed, 0 failed
```
