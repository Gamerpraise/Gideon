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
  await sock.sendMessage(m.chat, { text: `@${id} ${reason} (warning ${count}/3)`, mentions: [m.sender] }).catch(() => {})
  if (count >= 3) {
    // groups that use hidden @lid ids need the original id, so try every form we know for this sender
    const ids = [...new Set([...(m.senderIds || []), m.sender].filter(Boolean))]
    let removed = false
    for (const jid of ids) {
      try {
        await sock.groupParticipantsUpdate(m.chat, [jid], 'remove')
        removed = true
        break
      } catch {}
    }
    delete db.warns[m.chat][id]
    store.save()
    await sock
      .sendMessage(m.chat, {
        text: removed ? `@${id} reached 3 warnings and was removed.` : `@${id} reached 3 warnings, but I could not remove them. Make me a group admin.`,
        mentions: [m.sender]
      })
      .catch(() => {})
  }
}

// Anti-link: members who post a link get the message deleted + a warning (3 warnings = removed).
// Group admins, the bot owner and the bot's own messages are never touched.
// returns true when the message was handled and nothing else should run
async function antilink(sock, m) {
  if (!m.isGroup || m.isOwner || m.fromMe) return false
  if (!store.get().antilink?.[m.chat]) return false
  if (!fn.hasLink(m.body)) return false
  let metadata
  try {
    metadata = await sock.groupMetadata(m.chat)
  } catch {
    return false // cannot tell who is an admin, so never punish anyone
  }
  const admins = await fn.getGroupAdmins(metadata.participants)
  if (fn.isInList(admins, [m.sender, ...(m.senderIds || [])])) return false
  const botIsAdmin = fn.isInList(admins, [sock.user?.id, sock.user?.lid].filter(Boolean))
  if (botIsAdmin) await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {})
  await punish(sock, m, botIsAdmin ? 'links are not allowed here, your message was deleted' : 'links are not allowed here (make me a group admin so I can delete them)')
  return true
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

module.exports = { check, antilink, punish, DEFAULT_WORDS }
