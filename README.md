# Gideon

WhatsApp Baileys bot by Gpraise. Host it on Katabump by uploading your session file and starting the worker.

## Setup

1. Generate a session with your existing session generator web.
2. Put `creds.json` or `cred.json` inside the `session` folder.
3. Deploy on Katabump (or run `npm start` locally).

The bot auto-follows the WhatsApp channel on connect.

## Katabump

The log `index.js file was not found` means the bot files are not in the server root.

1. Upload the zip, then unarchive it.
2. Open File Manager. You must see `index.js`, `package.json`, `commands` and `session` in the first page, not inside another folder.
3. If you see one extra folder after unarchive, open it, select all files, move them to `/home/container` (server root), then delete the empty extra folder.
4. Upload `cred.json` or `creds.json` into the `session` folder.
5. Startup tab:
   - Startup file: `index.js`
   - Or startup command: `bash start.sh`
6. Click Start.

`start.sh` also accepts `cred.json` if you drop it in the server root by mistake.

## Folders

- `commands` add a new `.js` file here. No other files need editing.
- `session` upload `creds.json` or `cred.json` here.

Everything else stays in the project root.

## Owner

- Bot: Gideon
- Owner: Gpraise
- Number: +2348057940822
- Prefix: `.`

## Links

- Organization: https://binary-ghosts.vercel.app
- Code editor: https://gpcode-eta.vercel.app/
- Store: https://gpraise-hub.store
- YouTube: https://youtube.com/@gamerpraise-mods
- Channel: https://whatsapp.com/channel/0029VbBRPc3CMY0IePiiU808

## View once

Reply a view-once message with:

- `.vv` reopen it in the current chat
- `.vv2` send it to your DM so the other person does not see that you saved it

## Add a command

Create `commands/mycommand.js`:

```js
module.exports = {
  name: 'mycommand',
  aliases: ['mc'],
  desc: 'What it does',
  category: 'general',
  async run(sock, m, ctx) {
    await m.reply('It works')
  }
}
```

Restart is not required on most hosts that keep the process running; the commands folder is watched and reloaded.
