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

function save() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

// for busy writes (xp, contacts): one disk write every few seconds instead of every message
function saveSoon(delay = 4000) {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2))
    } catch {}
  }, delay)
}

module.exports = {
  get: () => data,
  set(key, value) {
    data[key] = value
    save()
  },
  save,
  saveSoon,
  reload() {
    data = load()
    return data
  }
}
