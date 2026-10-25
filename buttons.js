const { proto, generateWAMessageFromContent } = require('@whiskeysockets/baileys')
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

async function sendButtons(sock, jid, text, extra = {}) {
  const body = extra.skipBox ? String(text ?? '') : box(text)
  const buttons = extra.buttons || linkButtons()
  const nativeButtons = toNativeButtons(buttons)
  const quoted = extra.quoted
  const footer = extra.footer || `${config.botName} • ${config.ownerName}`

  try {
    const sent = await sock.sendMessage(
      jid,
      {
        text: body,
        footer,
        interactiveButtons: nativeButtons
      },
      { quoted, skipStyle: true }
    )
    if (sent?.key?.id) return sent
  } catch (err) {
    console.log('[buttons] interactiveButtons failed:', err.message)
  }

  try {
    const msg = generateWAMessageFromContent(
      jid,
      {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadata: {},
              deviceListMetadataVersion: 2
            },
            interactiveMessage: proto.Message.InteractiveMessage.fromObject({
              body: { text: body },
              footer: { text: footer },
              nativeFlowMessage: { buttons: nativeButtons }
            })
          }
        }
      },
      { userJid: sock.user?.id, quoted }
    )
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id })
    return msg
  } catch (err) {
    console.log('[buttons] nativeFlow failed:', err.message)
  }

  return sock.sendMessage(jid, { text: body }, { quoted, skipStyle: true })
}

module.exports = { sendButtons, linkButtons }
