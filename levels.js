const store = require('./store')
const fn = require('./functions')

const lastXp = new Map()

const levelOf = (xp) => Math.floor(Math.sqrt(xp / 100))
const xpForLevel = (level) => level * level * 100

function user(num) {
  const db = store.get()
  db.users = db.users || {}
  if (!db.users[num]) db.users[num] = { xp: 0, coins: 0, msgs: 0, lastDaily: 0, streak: 0, lastWork: 0 }
  return db.users[num]
}

// called for normal (non-command) messages
async function onMessage(sock, m) {
  if (m.fromMe || !m.body || m.body.length < 3) return
  const num = fn.cleanJid(m.sender)
  const now = Date.now()
  if (now - (lastXp.get(num) || 0) < 20000) return
  lastXp.set(num, now)

  const u = user(num)
  const before = levelOf(u.xp)
  const gain = 5 + Math.floor(Math.random() * 8)
  u.xp += gain
  u.msgs += 1
  if (m.isGroup) {
    const db = store.get()
    db.gxp = db.gxp || {}
    db.gxp[m.chat] = db.gxp[m.chat] || {}
    db.gxp[m.chat][num] = (db.gxp[m.chat][num] || 0) + gain
  }
  store.saveSoon()

  const after = levelOf(u.xp)
  if (after > before && m.isGroup && store.get().levelup?.[m.chat]) {
    await m.reply(`@${num} reached level ${after}!`, { mentions: [m.sender] })
  }
}

module.exports = { onMessage, user, levelOf, xpForLevel }
