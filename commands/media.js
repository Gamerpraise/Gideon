const fn = require('../functions')

module.exports = [
  {
    name: 'tomp3',
    aliases: ['toaudio'],
    desc: 'Convert video to audio',
    category: 'media',
    async run(sock, m) {
      const target = m.quoted || m
      if (!/video|audio/.test(target.mtype || '')) return m.reply('Reply a video.')
      const buffer = await target.download()
      await sock.sendMessage(m.chat, { audio: buffer, mimetype: 'audio/mpeg' })
    }
  },
  {
    name: 'tovn',
    aliases: ['vn'],
    desc: 'Convert audio to voice note',
    category: 'media',
    async run(sock, m) {
      const target = m.quoted || m
      if (!/audio|video/.test(target.mtype || '')) return m.reply('Reply an audio or video.')
      const buffer = await target.download()
      await sock.sendMessage(m.chat, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true })
    }
  },
  {
    name: 'bass',
    aliases: ['deep'],
    desc: 'Send quoted audio as voice note',
    category: 'media',
    async run(sock, m) {
      const target = m.quoted || m
      if (!/audio/.test(target.mtype || '')) return m.reply('Reply an audio.')
      const buffer = await target.download()
      await sock.sendMessage(m.chat, { audio: buffer, mimetype: 'audio/mpeg', ptt: true })
    }
  },
  {
    name: 'tiny',
    aliases: ['resize'],
    desc: 'Send quoted image back compressed',
    category: 'media',
    async run(sock, m) {
      const target = m.quoted || m
      if (!/image/.test(target.mtype || '')) return m.reply('Reply an image.')
      const buffer = await target.download()
      await sock.sendMessage(m.chat, { image: buffer, caption: 'Compressed by Gideon' })
    }
  },
  {
    name: 'save',
    aliases: ['sv'],
    desc: 'Save quoted status or media to your chat',
    category: 'media',
    async run(sock, m) {
      if (!m.quoted) return m.reply('Reply a status or media.')
      const buffer = await m.quoted.download()
      const type = m.quoted.mtype
      if (type === 'imageMessage') await sock.sendMessage(m.sender, { image: buffer, caption: m.quoted.text || '' })
      else if (type === 'videoMessage') await sock.sendMessage(m.sender, { video: buffer, caption: m.quoted.text || '' })
      else if (type === 'audioMessage') await sock.sendMessage(m.sender, { audio: buffer, mimetype: 'audio/mpeg' })
      else return m.reply('Unsupported media.')
      if (m.isGroup) await m.reply('Saved to your DM.')
    }
  },
  {
    name: 'getpp',
    aliases: ['pp', 'profilepic', 'dp'],
    desc: 'Get profile picture (reply, tag, number, or "group")',
    category: 'media',
    async run(sock, m, { args }) {
      const wantsGroup = (args[0] || '').toLowerCase() === 'group' && m.isGroup
      let user
      if (wantsGroup) user = m.chat
      else if (m.quoted?.sender) user = m.quoted.sender
      else if (m.mentionedJid?.[0]) user = m.mentionedJid[0]
      else if (args[0] && /\d{6,}/.test(args[0])) user = fn.toJid(args[0])
      else user = m.isGroup ? m.sender : m.fromMe ? m.chat : m.chat
      const candidates = [...new Set([user, ...(m.senderIds || []).filter(() => user === m.sender)])]
      for (const jid of candidates) {
        for (const type of ['image', 'preview']) {
          try {
            const url = await sock.profilePictureUrl(jid, type)
            if (url) {
              return sock.sendMessage(m.chat, { image: { url }, caption: wantsGroup ? 'Group picture' : `@${fn.cleanJid(jid)}`, mentions: [jid] }, { quoted: m._msg })
            }
          } catch {}
        }
      }
      await m.reply('No profile picture (none set, or their privacy hides it).')
    }
  },
  {
    name: 'getbio',
    aliases: ['bio', 'about'],
    desc: 'Get user about/bio',
    category: 'media',
    async run(sock, m, { args }) {
      const user = m.quoted?.sender || m.mentionedJid[0] || (args[0] ? fn.toJid(args[0]) : m.sender)
      try {
        const status = await sock.fetchStatus(user)
        await m.reply(status?.status || 'No bio.')
      } catch {
        await m.reply('No bio.')
      }
    }
  }
]
