const fs = require('fs')
const path = require('path')
const config = require('./config')

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
  autoreply: { enabled: false, text: 'Hi {name}, I am not available right now. I will reply as soon as I can.', keywords: {}, cooldownMin: 60 }
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

process.on('exit', flush)

module.exports = {
  get: () => data,
  set(key, value) {
    data[key] = value
    save()
  },
  save,
  saveSoon,
  flush,
  reload() {
    data = load()
    return data
  }
}
