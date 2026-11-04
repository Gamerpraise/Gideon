# Firestore schema

Firestore rules stay as they were (`allow read, write: if false`). Only the server's Admin SDK touches data.
Collections marked **new** are created automatically the first time they are written.

## Existing (unchanged)
| Collection | Doc id | Purpose |
|---|---|---|
| `players` | phone number | Global economy account: `balance, banked, loan, loanDue, jailUntil, inv, job, invest, crypto, biz, cd, lastWorkAt, lastRobAt, ...` |
| `hosts` | host number | Census from `.allowdev` hosts: `accounts[], lastSeen` |
| `devCommands` | auto | Developer fan-out queue |
| `trades`, `meta` | n/a | Trades, `lastRob`, `lottery`, `crypto` |

## New
| Collection | Doc id | Fields |
|---|---|---|
| `settings` | `global` | `subscriptionEnabled, paystackEnabled, premiumCommandsEnabled, economyEnabled, funEnabled, economyMode (LOCAL/GLOBAL), freeModeMessage, plans[{id,name,days,amountNaira}], currency` |
| `settings` | `economy` | `currencyName, currencySymbol, startBalance, dailyReward, weeklyReward, workMin, workMax, workCooldownMin, robCooldownMin, minBet, maxBet, loanMax, itemPrices{item:price}` |
| `commandPolicy` | command name | Admin overrides only: `tier (FREE/PREMIUM), enabled, updatedAt`. Defaults live in `platform/registry.json` |
| `installs` | `inst_<24 hex>` | `tokenHash (sha256), ownerNumber, accounts[], version, premiumId, createdAt, lastSeen, localEconomy{users,totalCoins}` |
| `premiumIds` | `GID-nnnnnn` | `id, status (active/revoked), boundInstallId, ownerNumber, rebinds, source (paystack/admin), expiresAt, createdAt, lastReference` |
| `payments` | Paystack reference `GDN_...` | `installId, ownerNumber, plan, days, amountKobo, currency, email, status, processed, paidAt, via, premiumId, gatewayId` |
| `webhookEvents` | sha256(event:reference) | `event, reference, at, done, outcome` (webhook idempotency) |
| `idempotency` | sha256(key) | `status (inflight/done), http, body, expiresAt` (24 h TTL, swept hourly) |
| `economyTx` | auto | Economy request log: `at, path, number, to, amount, item, action, ok, error, balance, earned` (+ `reason, by` for admin adjustments). 30-day TTL (admin adjustments 365 days) |
| `secrets` | `paystack` | `publicKey, environment, secretBox{iv,tag,data} (AES-256-GCM), secretLast4, secretMode, lastTest`. Never returned by any API |
| `files` | file name | `kind, version, status (validated/active/rejected), sha256, size, content (base64), history[last 10 versions]` |
| `uploadLogs` | auto | Every upload attempt, including rejected ones, with the reasons |
| `auditLogs` | auto | `at, actor, action, detail` for every admin change, claim, settlement and failed login |

## Suggested indexes
Single-field only; Firestore creates these automatically. `economyTx` filtered by `number` plus ordered by `at` needs one composite index (`number ASC, at DESC`): Firestore prints a link in the server log the first time you use the transaction search.
