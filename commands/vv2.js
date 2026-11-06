const fn = require('../functions')

// .vv2  (reply a view-once)  ->  the media lands in YOUR DM. Nothing is posted in the chat,
// and the .vv2 message itself is deleted, so nobody sees that you opened it.
module.exports = {
  name: 'vv2',
  aliases: ['vvdm', 'reveal2', 'stealvv'],
  desc: 'Send a view-once message to the owner DM silently',
  category: 'media',
  owner: true,
  subSafe: true,
  async run(sock, m) {
    const dm = sock.getOwnerJid()
    const quiet = async () => {
      try {
        await sock.sendMessage(m.chat, { delete: m.key })
      } catch {}
    }
    if (!m.quoted) return m.reply('Reply a view-once image, video or voice note.')

    let media = null
    try {
      media = await fn.downloadViewOnce(m.quoted.raw)
      if (!media && /image|video|audio/.test(m.quoted.mtype || '')) {
        media = {
          type: m.quoted.mtype.replace('Message', ''),
          buffer: await m.quoted.download(),
          caption: m.quoted.text || '',
          mimetype: m.quoted.msg?.mimetype,
          ptt: m.quoted.msg?.ptt || false
        }
      }
    } catch (err) {
      await sock.sendMessage(dm, { text: `vv2 failed: ${err.message || err}` }, { skipStyle: true })
      return quiet()
    }
    if (!media) {
      await sock.sendMessage(dm, { text: 'vv2: that was not a view-once or the media is no longer available.' })
      return quiet()
    }

    const from = m.quoted.sender ? `@${fn.cleanJid(m.quoted.sender)}` : 'unknown'
    await fn.sendViewOnceMedia(sock, dm, { ...media, caption: `${media.caption || ''}\n\nFrom: ${from}\nChat: ${m.isGroup ? 'group' : 'private'}`.trim() })
    await quiet()
  }
}
