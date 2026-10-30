const baileys = require('./baileys')
const config = require('./config')
const { box } = require('./style')

function linkButtons() {
  return [
    { text: 'View Channel', url: config.links.channel },
    { text: 'Subscribe YouTube', url: config.links.youtube },
    { text: 'Open Store', url: config.links.store }
  ]
}

function toNativeButtons(buttons) {
  return (buttons || linkButtons()).slice(0, 3).map((b) => ({
    name: 'cta_url',
    buttonParamsJson: JSON.stringify({
      display_text: b.text,
      url: b.url,
      merchant_url: b.url
    })
  }))
}

// WhatsApp only draws interactive buttons from a normal (non-business) account when the
// message carries these extra binary nodes. Without them the buttons are silently dropped.
function flowNodes(jid) {
  const nodes = [
    {
      tag: 'biz',
      attrs: {},
      content: [
        {
          tag: 'interactive',
          attrs: { type: 'native_flow', v: '1' },
          content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
        }
      ]
    }
  ]
  if (!String(jid).endsWith('@g.us')) nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } })
  return nodes
}

async function sendButtons(sock, jid, text, extra = {}) {
  const body = extra.skipBox ? String(text ?? '') : box(text)
  const buttons = extra.buttons || linkButtons()
  const quoted = extra.quoted
  const footer = extra.footer || `${config.botName} • ${config.ownerName}`
  const mode = extra.mode || config.buttonMode || 'native'

  if (mode === 'native') {
    try {
      const B = baileys.get()
      const { proto, generateWAMessageFromContent } = B
      // optional picture on top of the message (one single message: image + text + buttons)
      let header = { title: '', subtitle: '', hasMediaAttachment: false }
      if (extra.image) {
        const media = await B.generateWAMessageContent({ image: extra.image }, { upload: sock.waUploadToServer })
        header = { title: '', subtitle: '', hasMediaAttachment: true, imageMessage: media.imageMessage }
      }
      const msg = generateWAMessageFromContent(
        jid,
        {
          viewOnceMessage: {
            message: {
              messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
              interactiveMessage: proto.Message.InteractiveMessage.create({
                body: { text: body },
                footer: { text: footer },
                header: proto.Message.InteractiveMessage.Header.create(header),
                nativeFlowMessage: { buttons: toNativeButtons(buttons), messageParamsJson: '' }
              })
            }
          }
        },
        { userJid: sock.user?.id, quoted }
      )
      await sock.relayMessage(jid, msg.message, { messageId: msg.key.id, additionalNodes: flowNodes(jid) })
      return msg
    } catch (err) {
      console.log('[buttons] native flow failed, sending text links:', err.message)
    }
  }

  // text mode (or fallback): same links as plain text, always visible
  const linksText = buttons.map((b) => `${b.text}: ${b.url}`).join('\n')
  return sock.sendMessage(jid, { text: `${body}\n\n${linksText}` }, { quoted, skipStyle: true })
}

module.exports = { sendButtons, linkButtons }
