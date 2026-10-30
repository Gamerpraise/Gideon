const store = require('./store')
const fn = require('./functions')

const floods = new Map()
const lastSpamWarn = new Map()

const DEFAULT_WORDS = ['fuck', 'bitch', 'asshole', 'bastard', 'pussy', 'dick']

function matches(body, words) {
  const text = String(body).toLowerCase()
  return words.some((w) => {
    const word = String(w).toLowerCase().trim()
    if (!word) return false
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'iu').test(text)
  })
}

async function punish(sock, m, reason) {
  const db = store.get()
  const id = fn.cleanJid(m.sender)
  db.warns[m.chat] = db.warns[m.chat] || {}
  db.warns[m.chat][id] = (db.warns[m.chat][id] || 0) + 1
  const count = db.warns[m.chat][id]
  store.save()
  await sock.sendMessage(m.chat, { text: `@${id} ${reason} (warning ${count}/3)`, mentions: [m.sender] })
  if (count >= 3) {
    try {
      await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove')
      delete db.warns[m.chat][id]
      store.save()
      await sock.sendMessage(m.chat, { text: `@${id} reached 3 warnings and was removed.`, mentions: [m.sender] })
    } catch {}
  }
}

// returns true when the message was handled (deleted) and nothing else should run
async function check(sock, m) {
  if (!m.isGroup || m.isOwner || m.fromMe) return false
  const db = store.get()
  const bad = db.antibadword?.[m.chat]
  const spam = db.antispam?.[m.chat]
  if (!bad?.enabled && !spam) return false

  const metadata = await sock.groupMetadata(m.chat)
  const admins = await fn.getGroupAdmins(metadata.participants)
  if (fn.isInList(admins, [m.sender, ...m.senderIds])) return false
  if (!fn.isInList(admins, [sock.user?.id, sock.user?.lid].filter(Boolean))) return false // cannot delete without admin

  if (bad?.enabled && matches(m.body, [...DEFAULT_WORDS, ...(bad.words || [])])) {
    await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})
    await punish(sock, m, 'bad language is not allowed here')
    return true
  }

  if (spam) {
    const key = `${m.chat}:${m.sender}`
    const now = Date.now()
    const list = (floods.get(key) || []).filter((t) => now - t < 8000)
    list.push(now)
    floods.set(key, list)
    if (list.length > 6) {
      await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})
      if (now - (lastSpamWarn.get(key) || 0) > 15000) {
        lastSpamWarn.set(key, now)
        await punish(sock, m, 'stop spamming')
      }
      return true
    }
  }
  return false
}

module.exports = { check, DEFAULT_WORDS }
