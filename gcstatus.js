const crypto = require('crypto')
const baileys = require('../baileys')

// .gcstatus  ->  post a WhatsApp GROUP STATUS (the status that lives inside a group)
//   .gcstatus Hello family            text status in this group
//   reply an image/video/voice note with .gcstatus [caption]
//   owner in DM: .gcstatus 1203630xxxxxxxx@g.us your text   (post to another group)
module.exports = {
  name: 'gcstatus',
  aliases: ['swgc', 'groupstatus', 'gstatus', 'gcstory'],
  desc: 'Post a status inside a group (text, image, video or audio)',
  category: 'group',
  async run(sock, m, { args, prefix }) {
    let target = m.chat
    let words = [...args]
    if (words[0] && /@g\.us$/.test(words[0])) {
      if (!m.isOwner) return m.reply('Only the owner can post to another group.')
      target = words.shift()
    } else if (!m.isGroup) {
      return m.reply(`Use this inside a group, or from DM: ${prefix}gcstatus <groupId>@g.us your text`)
    }
    const caption = words.join(' ').trim()

    const source = m.quoted || m
    const kind = (source.mtype || '').replace('Message', '')
    let content
    if (['image', 'video', 'audio'].includes(kind)) {
      let buffer
      try {
        buffer = await source.download()
      } catch {
        return m.reply('Could not download that media.')
      }
      if (kind === 'image') content = { image: buffer, caption }
      else if (kind === 'video') content = { video: buffer, caption }
      else content = { audio: buffer, mimetype: 'audio/mp4', ptt: false }
    } else {
      const text = caption || m.quoted?.text || ''
      if (!text) {
        return m.reply(`Send text or reply media.\nExample: ${prefix}gcstatus Good morning everyone`)
      }
      content = { text }
    }

    await m.react('⏳')
    try {
      const B = baileys.get()
      const inner = await B.generateWAMessageContent(content, { upload: sock.waUploadToServer })
      if (inner.extendedTextMessage) {
        inner.extendedTextMessage.backgroundArgb = [0xff1a1a2e, 0xff0f3460, 0xff16213e, 0xff3d0000][Math.floor(Math.random() * 4)]
        inner.extendedTextMessage.font = 1
      }
      inner.messageContextInfo = { messageSecret: crypto.randomBytes(32) }
      await sock.relayMessage(
        target,
        { groupStatusMessageV2: { message: inner } },
        { messageId: B.generateMessageID() }
      )
      await m.react('✅')
      await m.reply('Group status posted.')
    } catch (err) {
      await m.react('❌')
      await m.reply(`Could not post the group status.\n${err.message || err}\n\nMake sure the bot account is in that group and your WhatsApp supports Group Status.`)
    }
  }
}
