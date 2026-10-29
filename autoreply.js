const store = require('./store')
const fn = require('./functions')

const lastSent = new Map()

function fill(text, m) {
  return String(text)
    .replace(/\{name\}/gi, m.pushName || 'there')
    .replace(/\{time\}/gi, fn.clockString())
}

// Called by the handler for any message that is not a command.
// Private chats only, never to the owner, never twice in a row (cooldown).
async function check(sock, m) {
  const ar = store.get().autoreply
  if (sock.isSub || !ar || !ar.enabled) return false
  if (m.fromMe || m.isOwner || m.isGroup || m.isNewsletter || !m.body) return false

  const body = m.body.toLowerCase()
  const now = Date.now()

  for (const [keyword, reply] of Object.entries(ar.keywords || {})) {
    if (!body.includes(keyword)) continue
    const id = `${m.sender}:${keyword}`
    if (now - (lastSent.get(id) || 0) < 15000) return true
    lastSent.set(id, now)
    await m.reply(fill(reply, m))
    return true
  }

  if (!ar.text) return false
  const id = `${m.sender}:default`
  if (now - (lastSent.get(id) || 0) < (ar.cooldownMin || 60) * 60000) return false
  lastSent.set(id, now)
  await m.reply(fill(ar.text, m))
  return true
}

module.exports = { check }
