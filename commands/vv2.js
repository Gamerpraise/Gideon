const fn = require('../functions')

module.exports = {
  name: 'vv2',
  aliases: ['vvdm', 'reveal2', 'stealvv'],
  desc: 'Send a view-once message to your DM secretly',
  category: 'media',
  async run(sock, m) {
    if (!m.quoted) return m.reply('Reply a view-once image, video or voice note.')
    let media = await fn.downloadViewOnce(m.quoted.raw)
    if (!media && /image|video|audio/.test(m.quoted.mtype || '')) {
      media = {
        type: m.quoted.mtype.replace('Message', ''),
        buffer: await m.quoted.download(),
        caption: m.quoted.text || '',
        mimetype: m.quoted.msg?.mimetype,
        ptt: m.quoted.msg?.ptt || false
      }
    }
    if (!media) return m.reply('That is not a view-once message. Reply the view-once media.')
    await fn.sendViewOnceMedia(sock, m.sender, {
      ...media,
      caption: media.caption || ''
    })
    try {
      await sock.sendMessage(m.chat, { delete: m.key })
    } catch {}
  }
}
