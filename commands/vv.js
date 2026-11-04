const fn = require('../functions')

module.exports = {
  name: 'vv',
  aliases: ['viewonce', 'reveal'],
  desc: 'Open a view-once message in this chat',
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
    await fn.sendViewOnceMedia(sock, m.chat, media, m._msg)
  }
}
