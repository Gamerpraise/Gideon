const baileys = require('./baileys')
const config = require('./config')
const fn = require('./functions')

const getContentType = (c) => baileys.get().getContentType(c)
const jidNormalizedUser = (j) => baileys.get().jidNormalizedUser(j)
const downloadContentFromMessage = (...a) => baileys.get().downloadContentFromMessage(...a)

function unwrapMessage(message) {
  let current = message
  for (let i = 0; i < 6 && current; i++) {
    const next =
      current.deviceSentMessage?.message ||
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message ||
      current.editedMessage?.message ||
      current.associatedChildMessage ||
      null
    if (!next) break
    current = next
  }
  return current
}

function extractText(message) {
  if (!message) return ''
  const msg = unwrapMessage(message)
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.buttonsMessage?.contentText ||
    msg.listMessage?.description ||
    msg.templateButtonReplyMessage?.selectedId ||
    msg.buttonsResponseMessage?.selectedButtonId ||
    msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
    msg.reactionMessage?.text ||
    ''
  )
}

function serialize(sock, msg) {
  if (!msg) return msg
  const m = {}
  m._msg = msg
  m.key = msg.key
  m.id = msg.key.id
  m.fromMe = msg.key.fromMe
  m.chat = msg.key.remoteJid
  m.isGroup = m.chat?.endsWith('@g.us')
  m.isNewsletter = m.chat?.endsWith('@newsletter')
  // WhatsApp now hides numbers behind @lid ids. Keep every id we know for the sender
  // (raw + alternate) so owner/admin checks keep working.
  const rawSender = m.fromMe
    ? sock.user.id
    : m.isGroup
      ? msg.key.participant || msg.participant
      : msg.key.remoteJid
  const altSender = m.isGroup ? msg.key.participantAlt : msg.key.remoteJidAlt
  const pnSender = [altSender, rawSender].find((j) => j && String(j).endsWith('@s.whatsapp.net'))
  m.sender = jidNormalizedUser(pnSender || rawSender || '')
  m.senderIds = [
    ...new Set(
      [rawSender, altSender, m.fromMe ? sock.user?.lid : null]
        .filter(Boolean)
        .map((j) => jidNormalizedUser(j))
    )
  ]
  m.pushName = msg.pushName || 'User'
  m.messageTimestamp = msg.messageTimestamp
  m.broadcast = msg.broadcast
  m.message = unwrapMessage(msg.message)
  m.raw = msg.message
  m.mtype = getContentType(m.message) || ''
  m.msg = m.message ? m.message[m.mtype] : null
  m.body = String(extractText(m.message) || '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim()
  m.text = m.body
  m.args = m.body.trim().split(/ +/).slice(1)
  m.prefix = config.prefix
  m.mentionedJid = m.msg?.contextInfo?.mentionedJid || []
  m.quoted = null

  const ctx = m.msg?.contextInfo
  if (ctx?.quotedMessage) {
    const quotedRaw = ctx.quotedMessage
    const quotedUnwrapped =
      quotedRaw.viewOnceMessage?.message ||
      quotedRaw.viewOnceMessageV2?.message ||
      quotedRaw.viewOnceMessageV2Extension?.message ||
      quotedRaw.ephemeralMessage?.message ||
      quotedRaw
    const quotedType = getContentType(quotedUnwrapped)
    const quotedMsg = quotedUnwrapped?.[quotedType]
    m.quoted = {
      key: {
        remoteJid: ctx.remoteJid || m.chat,
        fromMe: ctx.participant
          ? [sock.user?.id, sock.user?.lid].filter(Boolean).map((j) => jidNormalizedUser(j)).includes(jidNormalizedUser(ctx.participant))
          : false,
        id: ctx.stanzaId,
        participant: ctx.participant
      },
      sender: jidNormalizedUser(ctx.participant || m.chat),
      message: quotedUnwrapped,
      mtype: quotedType,
      msg: quotedMsg,
      text: extractText(quotedUnwrapped),
      raw: quotedRaw,
      isViewOnce: Boolean(
        quotedRaw.viewOnceMessage ||
          quotedRaw.viewOnceMessageV2 ||
          quotedRaw.viewOnceMessageV2Extension ||
          quotedMsg?.viewOnce
      ),
      download: async () => {
        const type = (quotedType || '').replace('Message', '')
        const stream = await downloadContentFromMessage(quotedMsg, type === 'sticker' ? 'sticker' : type)
        let buffer = Buffer.from([])
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
        return buffer
      }
    }
  }

  m.download = async () => fn.downloadMediaMessage(m)
  m.reply = (text, options = {}) => {
    if (text && typeof text === 'object') return sock.sendMessage(m.chat, text, { quoted: msg, ...options })
    const { mentions, ...rest } = options || {}
    const content = { text: String(text ?? '') }
    if (mentions) content.mentions = mentions
    return sock.sendMessage(m.chat, content, { quoted: msg, ...rest })
  }
  m.react = (emoji) => sock.sendMessage(m.chat, { react: { text: emoji, key: m.key } })
  m.send = (content, options = {}) => sock.sendMessage(m.chat, content, { quoted: msg, ...options })
  return m
}

module.exports = serialize
