const store = require('./store')
const config = require('./config')

// "30m", "2h", "1h30m", "45s", "2d"  ->  milliseconds from now
function parseDuration(token) {
  const re = /(\d+)\s*(d|h|m|s)/gi
  let total = 0
  let found = false
  let last = 0
  let match
  while ((match = re.exec(token))) {
    if (match.index !== last) return null
    found = true
    last = re.lastIndex
    const n = parseInt(match[1])
    total += n * { d: 86400000, h: 3600000, m: 60000, s: 1000 }[match[2].toLowerCase()]
  }
  return found && last === token.length ? Date.now() + total : null
}

// "20:30" -> next time it is 20:30 in config.timezone
function parseClock(token) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(token)
  if (!match) return null
  const moment = require('moment-timezone')
  const at = moment.tz(config.timezone).set({ hour: +match[1], minute: +match[2], second: 0, millisecond: 0 })
  if (at.valueOf() <= Date.now()) at.add(1, 'day')
  return at.valueOf()
}

const parseWhen = (token) => parseDuration(token) || parseClock(token)

function add(entry) {
  const db = store.get()
  db.reminders = db.reminders || []
  const id = Math.random().toString(36).slice(2, 6)
  db.reminders.push({ id, ...entry })
  store.save()
  return id
}

function start(manager) {
  setInterval(async () => {
    const db = store.get()
    if (!db.reminders?.length) return
    const now = Date.now()
    const due = db.reminders.filter((r) => r.at <= now)
    if (!due.length) return
    for (const r of due) {
      const bot = manager.get(r.bot)
      if (!bot?.sock?.user) {
        if (now - r.at > 86400000) db.reminders = db.reminders.filter((x) => x.id !== r.id)
        continue // bot offline right now, try again next tick
      }
      db.reminders = db.reminders.filter((x) => x.id !== r.id)
      try {
        if (r.kind === 'send') await bot.sock.sendMessage(r.jid, { text: r.text })
        else await bot.sock.sendMessage(r.jid, { text: `Reminder @${String(r.user).split('@')[0]}\n${r.text}`, mentions: [r.user] })
      } catch (err) {
        console.log('[reminders]', err.message)
      }
    }
    store.save()
  }, 15000)
}

module.exports = { parseWhen, add, start }
