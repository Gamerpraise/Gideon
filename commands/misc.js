const config = require('../config')
const fn = require('../functions')

module.exports = [
  {
    name: 'channel',
    aliases: ['follow', 'waichannel'],
    desc: 'Get the official WhatsApp channel',
    category: 'general',
    async run(sock, m) {
      await sock.sendButtons(m.chat, 'Official WhatsApp channel', {
        quoted: m._msg,
        buttons: [{ text: 'View Channel', url: config.links.channel }]
      })
    }
  },
  {
    name: 'store',
    aliases: ['shop', 'apps'],
    desc: 'Open Gpraise store',
    category: 'general',
    async run(sock, m) {
      await sock.sendButtons(m.chat, 'Buy or post apps here', {
        quoted: m._msg,
        buttons: [{ text: 'Open Store', url: config.links.store }]
      })
    }
  },
  {
    name: 'youtube',
    aliases: ['yt'],
    desc: 'Open Gpraise YouTube',
    category: 'general',
    async run(sock, m) {
      await sock.sendButtons(m.chat, 'Subscribe on YouTube', {
        quoted: m._msg,
        buttons: [{ text: 'Subscribe YouTube', url: config.links.youtube }]
      })
    }
  },
  {
    name: 'org',
    aliases: ['organization', 'website'],
    desc: 'Open organization website',
    category: 'general',
    async run(sock, m) {
      await sock.sendButtons(m.chat, 'Organization and code editor', {
        quoted: m._msg,
        buttons: [
          { text: 'Organization', url: config.links.organization },
          { text: 'Code Editor', url: config.links.editor }
        ]
      })
    }
  },
  {
    name: 'delete',
    aliases: ['del', 'dlt'],
    desc: 'Delete a quoted bot message',
    category: 'general',
    async run(sock, m) {
      if (!m.quoted) return m.reply('Reply the message to delete.')
      try {
        await sock.sendMessage(m.chat, { delete: m.quoted.key })
      } catch {
        await m.reply('I can only delete my own messages unless I am admin.')
      }
    }
  },
  {
    name: 'react',
    aliases: ['r'],
    desc: 'React to a quoted message',
    category: 'general',
    async run(sock, m, { text }) {
      if (!m.quoted) return m.reply('Reply a message.')
      await sock.sendMessage(m.chat, { react: { text: text || '✅', key: m.quoted.key } })
    }
  },
  {
    name: 'everyone',
    aliases: ['notify'],
    desc: 'Simple mention of quoted user',
    category: 'general',
    async run(sock, m, { text }) {
      const user = m.quoted?.sender || m.mentionedJid[0]
      if (!user) return m.reply('Tag or reply someone.')
      await sock.sendMessage(m.chat, { text: `${text || 'Hey'} @${fn.cleanJid(user)}`, mentions: [user] })
    }
  },
  {
    name: 'nowa',
    aliases: ['checkwa'],
    desc: 'Check if a number is on WhatsApp',
    category: 'tools',
    async run(sock, m, { args }) {
      if (!args[0]) return m.reply('Example: .nowa 2348057940822')
      const jid = fn.toJid(args[0])
      const [result] = await sock.onWhatsApp(jid)
      await m.reply(result?.exists ? `${args[0]} is on WhatsApp.` : `${args[0]} is not on WhatsApp.`)
    }
  },
  {
    name: 'id',
    aliases: ['jid', 'chatid'],
    desc: 'Show chat and sender JID',
    category: 'tools',
    async run(sock, m) {
      await m.reply(`Chat: ${m.chat}\nSender: ${m.sender}`)
    }
  }
]
