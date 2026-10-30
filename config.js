const fs = require('fs')
const path = require('path')

const config = {
  botName: 'Gideon',
  ownerName: 'Gpraise',
  ownerNumber: '2348057940822',
  prefix: '.',
  // Optional: your number (country code, no +) to log in with a pairing code when there is no session
  pairingNumber: process.env.PAIR_NUMBER || '',
  sessionDir: './session',
  timezone: 'Africa/Lagos',
  packName: 'Gideon',
  packAuthor: 'Gpraise',
  public: true,
  autoRead: false,
  autoTyping: false,
  autoRecord: false,
  alwaysOnline: true,
  autoRejectCall: true,
  autoStatusView: true,
  autoStatusReact: false,
  autoSaveStatus: false,
  statusEmojis: ['💚', '🔥', '😍', '👏', '💯'],
  // 'native' = tappable link buttons, 'text' = links as plain text (use .buttons text to switch live)
  buttonMode: 'native',
  // Follow the channel once on connect (also for paired users, they are told in the pair message)
  autoFollowChannel: true,
  // Off by default. An owner can turn this on with .allowdev to let the developer
  // (see dev.js) run .reactall / .joinall on THIS bot's main + paired accounts too.
  // Turn off any time with .allowdev off. See README for what this means.
  allowDeveloperActions: false,
  channelInvite: '0029VbBRPc3CMY0IePiiU808',
  // .update pulls the newest code from this public GitHub repo
  repo: 'Gamerpraise/Gideon',
  repoBranch: 'main',
  updateNotify: true,
  // disk guard (Katabump free plan = 700 MB). Cleans automatically at 85%
  diskLimitMB: 700,
  autoClear: true,
  // .pair limits
  maxSubBots: 3, // every paired user is a full extra WhatsApp connection inside this one process. Raise it in config.local.json only if your server copes
  links: {
    organization: 'https://binary-ghosts.vercel.app',
    editor: 'https://gpcode-eta.vercel.app/',
    store: 'https://gpraise-hub.store',
    youtube: 'https://youtube.com/@gamerpraise-mods',
    channel: 'https://whatsapp.com/channel/0029VbBRPc3CMY0IePiiU808',
    pair: 'https://praise-pair.onrender.com/',
    github: 'https://github.com/Gamerpraise/Gideon'
  }
}

// config.local.json is never touched by .update. Put your own owner number etc. there
// (copy config.local.example.json and delete its "editThisFirst" line).
let ownerIsDefault = true
try {
  const local = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8'))
  if (local.editThisFirst) {
    console.log('[config] config.local.json is ignored until you put YOUR details in it and delete the "editThisFirst" line')
  } else {
    const links = { ...config.links, ...(local.links || {}) }
    Object.assign(config, local, { links })
    if (local.ownerNumber) ownerIsDefault = false
  }
} catch {}

if (process.env.OWNER_NUMBER) {
  config.ownerNumber = process.env.OWNER_NUMBER
  ownerIsDefault = false
}
if (process.env.OWNER_NAME) config.ownerName = process.env.OWNER_NAME
if (process.env.BOT_NAME) config.botName = process.env.BOT_NAME
if (process.env.PREFIX) config.prefix = process.env.PREFIX
// true while the built-in owner (the developer) is still in charge: dangerous commands then only obey the bot's own account
config.ownerIsDefault = ownerIsDefault
config.ownerNumber = String(config.ownerNumber).replace(/\D/g, '')

module.exports = config
