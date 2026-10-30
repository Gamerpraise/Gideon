// Auto-reply that answers like the owner, using chats exported into the /reply folder (see replyengine.js).
// Main Gideon account only. Replies are plain text: no box, no theme, no watermark, so it looks human.
const store = require('./store')
const fn = require('./functions')
const engine = require('./replyengine')

let loaded = false
const bursts = new Map() // chat -> [timestamps] (stops bot-to-bot loops)
const busy = new Set()

function ensureLoaded() {
  if (!loaded) {
    engine.load()
    loaded = true
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function eligible(sock, m) {
  const ar = store.get().autoreply
  if (sock.isSub || !ar || !ar.enabled) return false
  if (m.fromMe || m.isGroup || m.isNewsletter) return false
  if (m.sender?.endsWith('@broadcast')) return false
  const ids = [m.sender, ...(m.senderIds || [])]
  if (m.isOwner || fn.isOwner(ids)) return false
  const ts = Number(m._msg?.messageTimestamp || m.messageTimestamp || 0)
  if (ts && Date.now() / 1000 - ts > 120) return false // ignore old messages after a reconnect
  const now = Date.now()
  const list = (bursts.get(m.chat) || []).filter((t) => now - t < 2 * 60000)
  if (list.length >= 6) return false
  bursts.set(m.chat, list)
  return true
}

async function send(sock, m, lines) {
  busy.add(m.chat)
  try {
    await sleep(1200 + Math.random() * 2500) // "reading" time
    await sock.sendPresenceUpdate('composing', m.chat).catch(() => {})
    await sleep(engine.typingDelay(lines))
    for (let i = 0; i < lines.length; i++) {
      await sock.sendMessage(m.chat, { text: lines[i] }, { skipStyle: true })
      bursts.get(m.chat)?.push(Date.now())
      if (i < lines.length - 1) {
        await sock.sendPresenceUpdate('composing', m.chat).catch(() => {})
        await sleep(900 + Math.random() * 1500)
      }
    }
    await sock.sendPresenceUpdate('paused', m.chat).catch(() => {})
  } finally {
    busy.delete(m.chat)
  }
}

// text messages that are not commands
async function check(sock, m) {
  if (!m.body || !eligible(sock, m) || busy.has(m.chat)) return false
  ensureLoaded()
  const result = engine.reply(m.chat, m.body)
  await send(sock, m, result.lines)
  return true
}

// voice notes
async function checkVoice(sock, m) {
  if (m.mtype !== 'audioMessage' || !m.msg?.ptt) return false
  if (!eligible(sock, m) || busy.has(m.chat)) return false
  ensureLoaded()
  await send(sock, m, [engine.voiceReply()])
  return true
}

function reload() {
  loaded = true
  return engine.load()
}

module.exports = { check, checkVoice, reload }
