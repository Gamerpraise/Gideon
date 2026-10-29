<div align="center">

# 🤖 GIDEON

**A WhatsApp bot by Gpraise**, built on Baileys. Fast, group-friendly, and updates itself from GitHub.

[WhatsApp Channel](https://whatsapp.com/channel/0029VbBRPc3CMY0IePiiU808) · [YouTube](https://youtube.com/@gamerpraise-mods) · [Store](https://gpraise-hub.store) · [Get your session](https://praise-pair.onrender.com/)

</div>

---

## 🚀 Deploy on Katabump (5 minutes)

**1. Get your session file (`creds.json`)**
Open **https://praise-pair.onrender.com/**, enter your WhatsApp number, type the pairing code into
WhatsApp (Settings > Linked devices > Link a device > Link with phone number), then download `creds.json`.

**2. Download the bot**
On this GitHub page click **Code > Download ZIP**. You get `Gideon-main.zip`.

**3. Upload it to Katabump**
Open your server on Katabump > **File Manager** > upload `Gideon-main.zip` > **Unarchive**.
Make sure `index.js` sits in the server root (move the files out of the `Gideon-main` folder if they ended up inside it).

**4. Add your session**
Open the **`session`** folder and upload your `creds.json` into it.

**5. Set your number (so you are the owner)**
Rename `config.local.example.json` to `config.local.json` and put your own details in it:

```json
{
  "ownerNumber": "234XXXXXXXXXX",
  "ownerName": "Your Name",
  "botName": "Gideon",
  "prefix": "."
}
```

(Skip this step if you are Gpraise.) This file is never overwritten by updates.

**6. Start it**
Startup file: `index.js` (Node 20 or newer). Press **Start**. The first start installs dependencies,
then the console prints `connected`. Send `.ping` or `.menu` to the bot.

> ⚠️ Never share `creds.json`. Anyone who has it controls your WhatsApp.

---

## 🔄 Update without re-uploading

When a new version is pushed to GitHub, send this to your bot:

| Command | What it does |
| --- | --- |
| `.update check` | See if GitHub has something newer |
| `.update` | Download the newest code, install new packages if needed, restart |

`.update` never touches your `session/`, `sessions/`, `database.json` or `config.local.json`.
The bot also messages you when an update is available.

---

## 👥 Let friends run Gideon too (`.pair`)

Owner only:

| Command | What it does |
| --- | --- |
| `.pair 2348012345678` | Gives that number a pairing code. They enter it in WhatsApp and Gideon runs on their account |
| `.listpaired` | Who is paired |
| `.unpair 2348012345678` | Remove a user |

Paired users get the normal commands (menu, fun, tools, groups, media). They do **not** get
owner commands such as eval, exec, update or session export. Each person can unlink Gideon any time from
WhatsApp > Linked devices. Paired accounts also follow the Gideon channel.

---

## ✨ What it can do

- **Groups:** `.lock` `.unlock` `.lockinfo` `.tagall` `.hidetag` `.tagadmins` `.kick` `.promote` `.demote` `.poll` `.warn` `.antilink` `.antibadword` `.antispam` `.welcome` `.disappear` `.approveall` `.vcf` `.setgrouppp` `.gcstatus` (post a group status)
- **Media:** `.sticker` `.getpp` `.vv` and `.vv2` (view-once to your DM) `.savestatus` (reply to a status to save it)
- **Fun and games:** `.rank` `.top` `.daily` `.work` `.gamble` `.give` `.8ball` `.trivia` `.meme` `.cat` `.dog` `.advice`
- **Tools:** `.remind` `.schedule` `.reminders` `.afk` `.bible` `.crypto` `.currency` `.time` `.password`
- **Owner:** `.ghost` (hide blue ticks, last seen, online, photo) `.autoreply` `.autobio` `.poststatus` `.autoread` `.autotyping` `.autostatus` `.statusreact` `.autosavestatus` `.anticall` `.setprefix` `.buttons` `.update` `.pair`

Send `.menu` for the full list.

**Add your own command:** copy `commands/example.js`, rename it, change `name`, `desc` and `run`. Done.

---

## 🛠 Troubleshooting

| Log message | What to do |
| --- | --- |
| `connectionReplaced` | The same session is running somewhere else. Stop the other host, then restart |
| `logged out` | Get a fresh `creds.json` from the pairing site and upload it into `session/` |
| Buttons not showing | Send `.buttons text` to switch the links to plain text |
| Bot online but silent | Check `.ping`. Make sure `index.js` is the startup file and the owner number is right |

---

## 💚 Support Gpraise

| | |
| --- | --- |
| 📢 WhatsApp Channel | https://whatsapp.com/channel/0029VbBRPc3CMY0IePiiU808 |
| ▶️ YouTube (Gamerpraise Mods) | https://youtube.com/@gamerpraise-mods |
| 🛒 Store | https://gpraise-hub.store |
| 👻 Binary Ghosts (programmers' team) | https://binary-ghosts.vercel.app |
| 💻 GPcode (mobile code editor) | https://gpcode-eta.vercel.app/ |
| 🔑 Session / pairing site | https://praise-pair.onrender.com/ |
| 🐙 GitHub | https://github.com/Gamerpraise/Gideon |

If Gideon helps you, star the repo, subscribe on YouTube and follow the channel. It means a lot.

---

Made by **Gpraise** · License MIT
