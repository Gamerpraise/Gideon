<div align="center">

# 🔴 GIDEON

**Pair your WhatsApp number. Gideon starts running on it — instantly.**

No creds, no uploads, no hosting panel for your users. They open the site, enter a number, and their own Gideon bot goes live.

</div>

> ⚠️ **Disclaimer:** Unofficial, not affiliated with WhatsApp. Using automated bots can get a WhatsApp number banned if misused. Don't spam. Use a spare number if you can.

---

## 📚 Contents

1. [How this is different from a normal bot repo](#-how-this-is-different)
2. [Features](#-features)
3. [Where to host it](#-where-to-host-it) — Render vs Vercel
4. [Deploy on Render (phone-friendly)](#-deploy-on-render)
5. [Keep bots alive after restarts](#-keep-bots-alive-after-restarts-mongodb)
6. [Settings](#-settings)
7. [The owner lock](#-the-owner-lock)
8. [The .pair command](#-the-pair-command)
9. [Add your own commands](#-add-your-own-commands)
10. [All commands](#-all-commands)
11. [Troubleshooting](#-troubleshooting)

---

## 🆚 How this is different

Most Baileys bot repos make YOU (the person deploying) run one bot for yourself. This one is a **website**: anyone who visits it types in their WhatsApp number, and a brand-new Gideon instance starts running for them, on this one server — you never touch their session, and they never touch any files.

- **You** host **one** server (this repo, on Render or similar).
- **Everyone who visits the site** gets their own running Gideon, on their own number.
- **You** (Gpraise, `2348057940822`) remain the only owner on every single one of those bots — see [The owner lock](#-the-owner-lock).

If you'd rather run a single bot you fully control (every setting unlocked), deploy this same code but think of yourself as the only visitor — or ask for the plain single-bot version.

---

## ✨ Features

- 🔗 **Pair and go** — enter a number (or scan a QR), Gideon connects and starts automatically. Nothing to upload, nothing to copy.
- 📢 **Auto-follows your WhatsApp channel** on every hosted bot (best-effort — see note below), so users see your updates and know when to run `.update`.
- 👑 **Locked owner** — only `2348057940822` can use admin/settings commands, on every hosted bot, no matter whose number it's running on. Nobody who pairs can edit, reconfigure or take over their bot.
- 🔑 **`.pair` command** — from any hosted bot's chat, the owner can pair a brand-new number straight from WhatsApp, no website needed.
- 🧩 **Plugin commands** — every command is one file in `/commands`, loaded automatically.
- 👥 **Group tools, 🛠️ utilities, 🎮 fun, 🤖 AI** — see the full list below.
- ♻️ **Self-healing** — each hosted bot reconnects itself after drops, with backoff.
- ☁️ **Optional encrypted backup** (MongoDB) — survives restarts/redeploys on free hosting.
- 🧱 **One file per feature, all in the repo root** — only `/commands` is a folder. Easy to edit from a phone.

> **Honesty note on auto-follow:** channels are a newer WhatsApp feature and Baileys' support for following them can change between versions. Gideon tries right after connecting and never blocks the bot if it fails — test it after you deploy, and if it's not following, check the Troubleshooting section.

---

## 🖥️ Where to host it

This app keeps a **permanent, always-open connection** to WhatsApp for every single hosted bot, and writes small files to disk. That rules a few platforms out:

| Platform | Works? | Why |
|---|---|---|
| **Render** (Web Service) | ✅ Recommended | Runs a real Node process that can stay connected. Free tier sleeps after ~15 min idle — fix with a free pinger (below) |
| **Railway / Fly.io** | ✅ | Same idea as Render, usage-based free tiers |
| A VPS (Oracle Cloud "Always Free", etc.) | ✅ Most reliable | Truly 24/7, no sleep, but more setup |
| **Vercel** | ❌ Will not work | Vercel only runs short-lived serverless functions — no persistent WebSocket connections, no background processes. A WhatsApp bot cannot stay connected there |
| **Netlify / Cloudflare Pages** | ❌ | Same reason as Vercel |

**Recommendation: Render**, free tier, with the keep-alive trick below. Move to Render's paid Starter plan (or a VPS) once you have real users and want zero downtime.

---

## 🚀 Deploy on Render

Written for doing this entirely from a **phone**.

### 1. Put the files on GitHub
1. On GitHub, create a new **private** repository (e.g. `gideon-web`).
2. Use GitHub's **"Add file" → "Upload files"** on the repo page, and upload every file from this project **straight into the root** — including the `commands` folder. Do not create any other folders.
3. Commit.

### 2. Create the Render service
1. Go to **render.com**, sign in, and connect your GitHub account.
2. **New → Web Service** → pick your `gideon-web` repo (Render can use private repos).
3. Fill in:

   | Setting | Value |
   |---|---|
   | Runtime | **Node** |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | Free (to start) |
   | Health Check Path | `/health` |

4. Open **Environment** and add `NODE_VERSION` = `20`.
5. Click **Create Web Service**. Watch the logs for `Gideon web running` — then open your `https://….onrender.com` link. 🎉

> One click instead? Use **New → Blueprint** — `render.yaml` already has these settings.

### 3. Keep the free instance awake
Free Render sleeps after ~15 minutes with no visitors — and since this server holds everyone's live bot connections, sleeping would disconnect every hosted bot at once.
1. Make a free account at **uptimerobot.com**.
2. Add a new monitor: type **HTTP(s)**, URL = `https://your-app.onrender.com/health`, interval = **5 minutes**.
3. That's it — the ping keeps Render from sleeping, so bots stay connected.

(This is a known trade-off of free hosting, not a bug — move to a paid Render plan or a VPS for guaranteed uptime.)

---

## ☁️ Keep bots alive after restarts (MongoDB)

Render's free plan **wipes its disk** on every redeploy or occasional restart. Without a backup, every hosted bot would need to re-pair. With a free MongoDB database, logins are saved **encrypted** and every bot comes back by itself.

1. Make a free account at **mongodb.com/cloud/atlas** → create a free (M0) cluster.
2. **Database Access** → add a user with a password.
3. **Network Access** → add `0.0.0.0/0` (allow from anywhere — Render's IPs change).
4. **Connect → Drivers** → copy the connection string (`mongodb+srv://user:pass@....`).
5. On Render → **Environment**, add:
   - `MONGODB_URI` = that connection string
   - `DATA_KEY` = any long random password (20+ characters) — **save this somewhere safe**. Losing it makes old backups unreadable.
6. Restart the service. The logs should show `☁️ Encrypted backup is ON`.

Without this, `BOT_HOSTING` still works fine — bots just won't survive a disk wipe, and users would need to pair again.

---

## ⚙️ Settings

Set these on Render → Environment. Everything is optional except the two above if you want persistence.

| Name | Default | Meaning |
|---|---|---|
| `MAX_BOTS` | `8` | How many hosted bots run at once (raise this on a paid plan with more RAM) |
| `OWNER_EXTRA` | – | Extra trusted owner numbers besides `2348057940822`, comma separated |
| `AUTO_FOLLOW_CHANNEL` | `true` | Try to follow `CHANNEL_URL` on every hosted bot |
| `SITE_NAME` | Gideon | Name shown on the site |
| `YOUTUBE_URL` / `GITHUB_URL` / `CHANNEL_URL` | your links | Shown on the site and in the bot's welcome message |
| `PREFIX` | `.` | Command prefix |
| `MAX_WARNS` | `3` | Warnings before antilink removes someone |
| `AI_API_KEY` | – | Enables `.ai` on every hosted bot (you pay for all usage — see note below) |
| `MONGODB_URI` / `DATA_KEY` | – | Encrypted backup (see above) |

⚠️ **Shared AI cost:** if you set `AI_API_KEY`, every hosted bot's `.ai` command uses it — you're billed for everyone's usage. Leave it empty unless you're ready for that.

---

## 👑 The owner lock

Normally in a Baileys bot, "owner" means "whoever's phone this is" — any message your own phone sends looks like it came from the bot's owner. That's fine for a single self-hosted bot. It is **not** fine here, because a stranger pairing their own number would then be the "owner" of their own bot and could change anything.

So on this build:
- The owner check is a **fixed list** (`2348057940822` plus anything in `OWNER_EXTRA`) — never the number that's linked, and never "messages from my own phone."
- This means **you** can message *any* hosted bot directly and use owner commands on it (`.mode`, `.broadcast`, `.restart`, `.logout`, …) — your number is recognized everywhere.
- Everyone else, including the person who paired that exact number, can only use the regular commands (`.menu`, `.sticker`, `.tagall` as a group admin, `.ai`, fun stuff, etc).

This only protects against chat commands. Since your repo is private, nobody can see or fork the source to remove this lock unless you share it with them.

---

## 🔑 The `.pair` command

Lets **you** start a new hosted bot straight from any WhatsApp chat — no website needed:

```
.pair 2348012345678
```

The bot DMs you back a pairing code, you enter it on that phone, and the same chat gets a message once it connects. It's owner-only and only works in a private chat (pairing codes shouldn't be posted in groups).

---

## ➕ Add your own commands

Every command is one file in `/commands/<category>/name.js`. Copy `commands/_template.js`, rename it, edit it, then restart (or send `.reload` as the owner — it reloads every hosted bot in one go).

```js
export default {
    name: 'hello',
    description: 'Say hello',
    usage: 'hello [name]',
    async run({ reply, text, m }) {
        await reply(`Hello ${text || m.pushName}!`);
    }
};
```

Optional fields: `owner`, `group`, `private`, `admin`, `botAdmin`, `cooldown`. Inside `run({ ... })` you get `reply`, `react`, `send`, `sock`, `m`, `quoted`, `args`/`text`, `target`/`targets`, `isOwner`/`isAdmin`/`isBotAdmin`, `participants`/`meta`/`group`, `db`, `config`, `utils`, `uptime()`, `restartBot()`, `logoutBot()`, `prefix`, `commands`.

---

## 📜 All commands

Prefix is `.` by default. Use `.help <command>` for details.

### General

| Command | What it does |
|---|---|
| `.alive` | Check if the bot is online |
| `.help <command>` | Show details about one command |
| `.jid` | Show the id of this chat (and the replied-to user) |
| `.menu [category]` | Show all commands (or one category) |
| `.owner` | Get the owner contact |
| `.ping` | Check how fast the bot responds |
| `.repo` | Bot source code and WhatsApp channel |
| `.runtime` | How long the bot has been running |

### Group

| Command | What it does |
|---|---|
| `.add 2348012345678` | Add a person to the group by number _(admin, group)_ |
| `.antilink off|delete|warn|kick` | Delete links sent by non-admins _(admin, group)_ |
| `.close` | Only admins can send messages _(admin, group)_ |
| `.delete (reply to a message)` | Delete the message you reply to |
| `.demote @user` | Remove admin rights from member(s) _(admin, group)_ |
| `.goodbye on|off|set <text>` | Turn the goodbye message on/off or change its text _(admin, group)_ |
| `.groupinfo` | Show details about this group _(group)_ |
| `.hidetag <message> (or reply to a message)` | Send a message that silently mentions everyone _(admin, group)_ |
| `.kick @user (or reply to them)` | Remove member(s) from the group _(admin, group)_ |
| `.link` | Get the group invite link _(admin, group)_ |
| `.listadmin` | List and mention the group admins _(group)_ |
| `.open` | Let everyone send messages _(admin, group)_ |
| `.poll Question | option 1 | option 2 | option 3` | Create a poll _(group)_ |
| `.promote @user` | Make member(s) group admin _(admin, group)_ |
| `.resetwarn @user` | Clear a member's warnings _(admin, group)_ |
| `.revoke` | Reset the group invite link _(admin, group)_ |
| `.setdesc <text>` | Change the group description _(admin, group)_ |
| `.setname <new name>` | Change the group name _(admin, group)_ |
| `.tagall [message]` | Mention every member of the group _(admin, group)_ |
| `.warn @user [reason]` | Warn a member (kicked at the limit) _(admin, group)_ |
| `.warns @user` | See how many warnings a member has _(group)_ |
| `.welcome on|off|set <text>` | Turn the welcome message on/off or change its text _(admin, group)_ |

### Tools

| Command | What it does |
|---|---|
| `.calc 12*(3+4)` | Do maths |
| `.define word` | English dictionary |
| `.getpp @user (or reply)` | Get someone's profile picture |
| `.githubuser Gamerpraise` | Look up a GitHub profile |
| `.qr <text>` | Create a QR code from text or a link |
| `.sticker [pack | author] (reply to media or send media with this caption)` | Turn an image/video/GIF into a sticker |
| `.toimg (reply to a sticker)` | Turn a sticker back into an image |
| `.tourl (reply to media)` | Upload an image/video/file and get a link |
| `.translate <language code> <text>   e.g. translate fr Good morning` | Translate text (reply to a message or type it) |
| `.tts [lang] <text>   e.g. tts en Hello world` | Turn text into a voice note |
| `.vv (reply to a view-once message)` | Reveal a view-once photo/video/voice note _(owner)_ |
| `.weather Lagos` | Current weather for a city |

### Fun

| Command | What it does |
|---|---|
| `.8ball will I be rich?` | Ask the magic 8-ball |
| `.compliment @user` | Compliment someone |
| `.dare` | Get a dare |
| `.dice` | Roll a dice |
| `.fact` | Get a random fun fact |
| `.flip` | Flip a coin |
| `.joke` | Get a random joke |
| `.pick pizza | rice | burger` | Choose between options |
| `.quote` | Get an inspiring quote |
| `.rate my cooking` | Rate anything out of 100 |
| `.ship @user1 @user2` | Love compatibility between two people |
| `.truth` | Get a truth question |

### Ai

| Command | What it does |
|---|---|
| `.ai what is the capital of Ghana?` | Ask the AI anything (needs AI_API_KEY) |

### Owner

| Command | What it does |
|---|---|
| `.alwaysonline on|off` | Always show the bot as online (on/off) _(owner)_ |
| `.anticall on|off` | Reject incoming calls (on/off) _(owner)_ |
| `.antidelete on|off` | Send deleted messages to the bot chat (on/off) _(owner)_ |
| `.autoread on|off` | Mark incoming messages as read (on/off) _(owner)_ |
| `.autotyping on|off` | Show "typing..." before replying (on/off) _(owner)_ |
| `.autoviewstatus on|off` | Automatically view contacts' statuses (on/off) _(owner)_ |
| `.ban @user` | Stop a person from using the bot _(owner)_ |
| `.banlist` | Show banned users _(owner)_ |
| `.block @user (or reply / use in their chat)` | Block a WhatsApp user _(owner)_ |
| `.broadcast <message>` | Send a message to all groups the bot is in _(owner)_ |
| `.groups` | List the groups the bot is in _(owner)_ |
| `.join https://chat.whatsapp.com/xxxx` | Make the bot join a group via invite link _(owner)_ |
| `.leave` | Make the bot leave this group _(owner, group)_ |
| `.logout confirm` | Turn the bot off and delete your login from the server _(owner)_ |
| `.mode public|private` | Switch between public and private mode _(owner)_ |
| `.pair 2348012345678` | Pair a new number and start Gideon on it, right from chat _(owner, private)_ |
| `.reload` | Reload all command files without restarting _(owner)_ |
| `.restart` | Restart your bot _(owner)_ |
| `.setpp (reply to an image)` | Set the bot profile picture (reply to an image) _(owner)_ |
| `.setprefix <symbol>` | Change the command prefix _(owner)_ |
| `.unban @user` | Let a banned person use the bot again _(owner)_ |
| `.unblock @user (or reply / use in their chat)` | Unblock a WhatsApp user _(owner)_ |



---

## 🧯 Troubleshooting

| Problem | Fix |
|---|---|
| Pair code never arrives / "could not connect (405)" | Redeploy with **Clear build cache & deploy** (re-runs the compatibility patch), or set `WA_VERSION` |
| Bots disconnect every ~15 minutes | Free Render slept — set up the UptimeRobot pinger above |
| All bots gone after a redeploy | Set up `MONGODB_URI` + `DATA_KEY` (see above) |
| "No free bot slots" | Raise `MAX_BOTS`, or move to a plan with more RAM |
| A user can run `.mode`/`.broadcast` etc on their own bot | Shouldn't happen — check `config.js` still has the hardcoded owner number and that you haven't restored an old `handler.js` |
| Channel doesn't auto-follow | Baileys' newsletter support varies by version — not fatal, the bot still works; try updating `@whiskeysockets/baileys` |
| Sticker / `.toimg` fails | Optional packages (`sharp`, `wa-sticker-formatter`) didn't install — redeploy to retry `npm install` |

---

## ❤️ Credits

Made by **Gpraise** · [GitHub](https://github.com/Gamerpraise/) · [WhatsApp Channel](https://whatsapp.com/channel/0029VbBRPc3CMY0IePiiU808)
Built with [Baileys](https://github.com/WhiskeySockets/Baileys). MIT License.
