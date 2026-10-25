const { Sticker, StickerTypes } = require('wa-sticker-formatter')
const config = require('../config')
const fn = require('../functions')

async function makeSticker(buffer, extra = {}) {
  const sticker = new Sticker(buffer, {
    pack: extra.pack || config.packName,
    author: extra.author || config.packAuthor,
    type: extra.crop ? StickerTypes.CROPPED : StickerTypes.FULL,
    quality: extra.quality || 70
  })
  return sticker.toMessage()
}

module.exports = [
  {
    name: 'sticker',
    aliases: ['s', 'stiker'],
    desc: 'Turn image or video into a sticker',
    category: 'convert',
    async run(sock, m, { text }) {
      const target = m.quoted || m
      const type = target.mtype || ''
      if (!/image|video|sticker/.test(type)) return m.reply('Send or reply an image/video with .sticker')
      const buffer = await target.download()
      const [pack, author] = text.split('|').map((v) => v.trim())
      const msg = await makeSticker(buffer, { pack, author })
      await sock.sendMessage(m.chat, msg, { quoted: { key: m.key, message: m.message } })
    }
  },
  {
    name: 'toimg',
    aliases: ['toimage', 'img'],
    desc: 'Convert sticker to image',
    category: 'convert',
    async run(sock, m) {
      if (!m.quoted || m.quoted.mtype !== 'stickerMessage') return m.reply('Reply a sticker.')
      const buffer = await m.quoted.download()
      await sock.sendMessage(m.chat, { image: buffer, caption: 'Converted by Gideon' }, { quoted: { key: m.key, message: m.message } })
    }
  },
  {
    name: 'tovid',
    aliases: ['tovideo', 'tomp4'],
    desc: 'Convert animated sticker to video',
    category: 'convert',
    async run(sock, m) {
      if (!m.quoted || m.quoted.mtype !== 'stickerMessage') return m.reply('Reply an animated sticker.')
      const buffer = await m.quoted.download()
      await sock.sendMessage(m.chat, { video: buffer, caption: 'Converted by Gideon' }, { quoted: { key: m.key, message: m.message } })
    }
  },
  {
    name: 'take',
    aliases: ['wm', 'steal'],
    desc: 'Steal a sticker with your pack name',
    category: 'convert',
    async run(sock, m, { text }) {
      if (!m.quoted) return m.reply('Reply a sticker or image.')
      const buffer = await m.quoted.download()
      const [pack, author] = (text || 'Gideon|Gpraise').split('|').map((v) => v.trim())
      const msg = await makeSticker(buffer, { pack, author })
      await sock.sendMessage(m.chat, msg)
    }
  },
  {
    name: 'emojimix',
    aliases: ['mix'],
    desc: 'Mix two emojis into a sticker',
    category: 'convert',
    async run(sock, m, { args }) {
      const query = args.join(' ')
      const parts = query.split('+').map((v) => v.trim()).filter(Boolean)
      if (parts.length < 2) return m.reply('Example: .emojimix 😂+🔥')
      try {
        const url = `https://tenor.googleapis.com/v2/featured?key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${encodeURIComponent(parts[0] + '_' + parts[1])}`
        const data = await fn.fetchJson(url)
        const img = data.results?.[0]?.url || data.results?.[0]?.media_formats?.png_transparent?.url
        if (!img) return m.reply('Could not mix those emojis.')
        const buffer = await fn.getBuffer(img)
        const msg = await makeSticker(buffer)
        await sock.sendMessage(m.chat, msg)
      } catch {
        await m.reply('Emoji mix failed.')
      }
    }
  }
]
