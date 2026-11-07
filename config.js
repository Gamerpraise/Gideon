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
  allowDeveloperActions: true,
  // The shared economy network (see network-server/README.md). Off by default - a host
  // turns it on themselves with .joinnetwork on, which is what actually enables it; these
  // two values just say which server to talk to once they do. Unset = .joinnetwork can't
  // do anything yet, and the bot says so plainly.
  networkApiUrl: 'https://gideon-network.onrender.com',
  networkKey: '56c606233b6cd99e1a5aac838df40f5a',
  // Only ever set this in the real developer's own config.local.json, never in the public
  // repo - it's what lets .joinall/.reactall reach every opted-in bot, not just this one.
  // Leave blank on every other installation; .joinall/.reactall then just act on this bot's
  // own accounts, exactly as before.
  devPushKey: '',
  // Signed plugins from the admin File Manager. OFF unless the host turns it on in config.local.json (see plugins.js).
  allowPlugins: false,
  pluginPublicKey: '',
  channelInvite: '0029VbBRPc3CMY0IePiiU808',
  // .update pulls the newest code from this public GitHub repo
  repo: 'Gamerpraise/Gideon',
  repoBranch: 'main',
  updateNotify: true,
  // disk guard (Katabump free plan = 700 MB). Cleans automatically at 85%
  diskLimitMB: 700,
  autoClear: true,
  // .pair limits
  maxSubBots: 10, // every paired user is a full extra WhatsApp connection inside this one process.
  // Sub-bots are started in a staggered queue (see bot.js startSaved) instead of all at once, so
  // this is safe to raise further in config.local.json if your server copes with more.
  // GIDEON CLOUD: the dashboard served at / and its API under /api/cloud. Sign-in is the existing Firebase
  // Authentication project (the same one the server's admin dashboard uses). Override any of this in config.local.json.
  // .yt / .ytmp4 / .play / .fb (downloader.js): temp files are deleted right after sending; these limits protect RAM, CPU and disk
  downloads: { parallel: 2, maxVideoMB: 60, maxAudioMB: 40, maxVideoMin: 12, maxAudioMin: 20, cooldownSec: 20, timeoutSec: 150 },
  cloud: {
    enabled: true,
    port: 3000, // process.env.PORT wins (Render, Heroku...)
    firebaseProjectId: 'gideon-e2265',
    maxBotsPerUser: 3,
    maxPairedPerBot: 3, // each Cloud bot is a MAIN bot for its owner: they can .pair up to this many people
    maxBots: 20,
    requireVerifiedEmail: true,
    allowedOrigins: [] // only needed if the dashboard page is hosted on a different domain than the bot
  },
  links: {
    organization: 'https://binary-ghosts.vercel.app',
    editor: 'https://gpcode-eta.vercel.app/',
    store: 'https://gpraise-hub.store',
    youtube: 'https://youtube.com/@gamer_praise',
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
    const cloud = { ...config.cloud, ...(local.cloud || {}) }
    Object.assign(config, local, { links, cloud })
    if (local.ownerNumber) ownerIsDefault = false
  }
} catch (err) {
  if (err.code !== 'ENOENT') console.log(`[config] config.local.json exists but could not be read: ${err.message}. Check it's valid JSON (a trailing comma or a missing comma is the usual cause). Using defaults until it's fixed.`)
}

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

// Gideon Cloud: these settings belong to each Cloud user (see context.js). Outside a Cloud context everything is the one shared config.
const als = require('./context')
const PER_BOT = ['prefix', 'autoRead', 'autoTyping', 'alwaysOnline', 'autoRejectCall', 'autoStatusView', 'autoStatusReact', 'autoSaveStatus', 'buttonMode', 'allowDeveloperActions']
const BASE = {}
for (const k of PER_BOT) BASE[k] = config[k] // defaults, before the host's own saved choices are applied at boot
module.exports = new Proxy(config, {
  get(target, key, recv) {
    const c = als.getStore()
    if (c && typeof key === 'string' && PER_BOT.includes(key)) return key in c.config ? c.config[key] : BASE[key]
    return Reflect.get(target, key, recv)
  },
  set(target, key, value) {
    const c = als.getStore()
    if (c && typeof key === 'string' && PER_BOT.includes(key)) c.config[key] = value
    else target[key] = value
    return true
  }
})
