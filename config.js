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
  channelInvite: '0029VbBRPc3CMY0IePiiU808',
  // .update pulls the newest code from this public GitHub repo
  repo: 'Gamerpraise/Gideon',
  repoBranch: 'main',
  updateNotify: true,
  // .pair limits
  maxSubBots: 10,
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

// config.local.json is never touched by .update. Put your own owner number etc. there:
// { "ownerNumber": "234xxxxxxxxxx", "ownerName": "You", "botName": "MyBot", "prefix": "." }
try {
  const local = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8'))
  const links = { ...config.links, ...(local.links || {}) }
  Object.assign(config, local, { links })
} catch {}

if (process.env.OWNER_NUMBER) config.ownerNumber = process.env.OWNER_NUMBER
if (process.env.OWNER_NAME) config.ownerName = process.env.OWNER_NAME
if (process.env.BOT_NAME) config.botName = process.env.BOT_NAME
if (process.env.PREFIX) config.prefix = process.env.PREFIX
config.ownerNumber = String(config.ownerNumber).replace(/\D/g, '')

module.exports = config
