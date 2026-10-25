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
  antidelete: true
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

function save() {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

module.exports = {
  get: () => data,
  set(key, value) {
    data[key] = value
    save()
  },
  save,
  reload() {
    data = load()
    return data
  }
}
