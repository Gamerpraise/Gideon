const fs = require('fs')
const path = require('path')
const config = require('./config')
const als = require('./context')

const file = path.join(__dirname, 'database.json')

const defaults = {
  public: config.public,
  owners: [config.ownerNumber.replace(/\D/g, '')],
  banned: [],
  welcome: {},
  goodbye: {},
  antilink: {},
  antitoxic: {},
  autosticker: {},
  mute: {},
  antidelete: true,
  afk: {},
  warns: {},
  prefix: null,
  theme: 1,
  callWarns: {},
  devNoticeShown: false,
  devQueue: { lastSeen: 0 },
  network: {},
  sessionStarts: {},
  settings: {},
  ghost: false,
  ghostBackup: null,
  users: {},
  gxp: {},
  levelup: {},
  antibadword: {},
  antispam: {},
  reminders: [],
  contacts: {},
  followed: {},
  autobio: { enabled: false, text: '{bot} online • {time} • {date}' },
  updateSha: null,
  updateNotified: null,
  autoreply: { enabled: false },
  premium: { installId: null, token: null }
}

function load() {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(defaults, null, 2))
      return { ...defaults }
    }
    return { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch {
    return { ...defaults }
  }
}

let data = load()

let timer = null
let timerAt = 0
let writing = false
let dirty = false
const tmpPath = file + '.tmp'

function flush() {
  if (!dirty && !timer) return
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  dirty = false
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data))
    fs.renameSync(tmpPath, file)
  } catch {}
}

async function writeNow() {
  if (writing) {
    dirty = true
    return
  }
  writing = true
  dirty = false
  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(data))
    await fs.promises.rename(tmpPath, file)
  } catch {}
  writing = false
  if (dirty) schedule(500)
}

function schedule(delay) {
  dirty = true
  const at = Date.now() + delay
  if (timer && timerAt <= at) return
  if (timer) clearTimeout(timer)
  timerAt = at
  timer = setTimeout(() => {
    timer = null
    writeNow()
  }, delay)
}

// Writes never block the bot: they are batched and done in the background.
const save = () => schedule(300)
const saveSoon = (delay = 4000) => schedule(delay)

// ---- Gideon Cloud: one database per Cloud user, kept next to their session (deleted together with it)
const botStores = new Map()
const botFile = (id) => path.join(__dirname, 'cloud-data', 'sessions', id, 'db.json')
function bot(id) {
  let b = botStores.get(id)
  if (b) return b
  let loaded = {}
  try { loaded = JSON.parse(fs.readFileSync(botFile(id), 'utf8')) } catch {}
  // a fresh copy of the defaults (nested objects must not be shared), the user's own number is the only owner
  const base = JSON.parse(JSON.stringify(defaults))
  Object.assign(base, { owners: [], public: config.public, network: {}, premium: { installId: null, token: null } })
  b = { id, data: { ...base, ...loaded }, timer: null, dead: false }
  b.write = () => {
    b.timer = null
    if (b.dead) return
    try { fs.writeFileSync(botFile(id) + '.tmp', JSON.stringify(b.data)); fs.renameSync(botFile(id) + '.tmp', botFile(id)) } catch {}
  }
  b.save = (delay = 300) => { if (!b.dead && !b.timer) { b.timer = setTimeout(b.write, delay); b.timer.unref?.() } }
  botStores.set(id, b)
  return b
}
function dropBot(id) {
  const b = botStores.get(id)
  if (b) { b.dead = true; if (b.timer) clearTimeout(b.timer); botStores.delete(id) }
}
const mine = () => { const c = als.getStore(); return c ? c.store : null }
function flushBots() { for (const b of botStores.values()) if (b.timer) { clearTimeout(b.timer); b.write() } }

process.on('exit', () => { flush(); flushBots() })

module.exports = {
  // inside a Cloud bot's context this is THAT user's database, everywhere else the host's
  get: () => (mine() ? mine().data : data),
  root: () => data, // always the host's database (identities, host-wide records)
  set(key, value) {
    const b = mine()
    if (b) { b.data[key] = value; b.save(); return }
    data[key] = value
    save()
  },
  save: () => { const b = mine(); b ? b.save() : save() },
  saveSoon: (delay) => { const b = mine(); b ? b.save(delay || 4000) : saveSoon(delay) },
  flush: () => { flush(); flushBots() },
  bot,
  dropBot,
  reload() {
    data = load()
    return data
  }
}
