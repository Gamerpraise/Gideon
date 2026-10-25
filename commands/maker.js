const { Sticker, StickerTypes } = require('wa-sticker-formatter')
const fn = require('../functions')
const config = require('../config')

module.exports = [
  {
    name: 'attp',
    aliases: ['attp2'],
    desc: 'Animated text sticker',
    category: 'convert',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .attp Gideon')
      const url = `https://api.siputzx.my.id/api/m/attp?text=${encodeURIComponent(text)}`
      try {
        const buffer = await fn.getBuffer(url)
        const sticker = new Sticker(buffer, {
          pack: config.packName,
          author: config.packAuthor,
          type: StickerTypes.FULL,
          quality: 70
        })
        await sock.sendMessage(m.chat, await sticker.toMessage())
      } catch {
        await m.reply('ATTP failed.')
      }
    }
  },
  {
    name: 'ttp',
    aliases: ['textsticker'],
    desc: 'Text to sticker',
    category: 'convert',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .ttp Gideon')
      const url = `https://api.siputzx.my.id/api/m/ttp?text=${encodeURIComponent(text)}`
      try {
        const buffer = await fn.getBuffer(url)
        const sticker = new Sticker(buffer, {
          pack: config.packName,
          author: config.packAuthor,
          type: StickerTypes.FULL,
          quality: 70
        })
        await sock.sendMessage(m.chat, await sticker.toMessage())
      } catch {
        await m.reply('TTP failed.')
      }
    }
  },
  {
    name: 'smeme',
    aliases: ['stickermeme', 'memegen'],
    desc: 'Make a meme sticker',
    category: 'convert',
    async run(sock, m, { text }) {
      const target = m.quoted || m
      if (!/image|sticker/.test(target.mtype || '')) return m.reply('Reply an image.\nExample: .smeme top|bottom')
      const [top, bottom] = (text || ' |Gideon').split('|')
      try {
        const buffer = await target.download()
        const FormData = require('form-data')
        const axios = require('axios')
        const form = new FormData()
        form.append('reqtype', 'fileupload')
        form.append('fileToUpload', buffer, { filename: 'meme.png' })
        const { data: uploaded } = await axios.post('https://catbox.moe/user/api.php', form, { headers: form.getHeaders() })
        const meme = `https://api.memegen.link/images/custom/${encodeURIComponent(top || '_')}/${encodeURIComponent(bottom || '_')}.png?background=${encodeURIComponent(uploaded)}`
        const img = await fn.getBuffer(meme)
        const sticker = new Sticker(img, {
          pack: config.packName,
          author: config.packAuthor,
          type: StickerTypes.FULL,
          quality: 70
        })
        await sock.sendMessage(m.chat, await sticker.toMessage())
      } catch {
        await m.reply('Meme sticker failed.')
      }
    }
  },
  {
    name: 'hd',
    aliases: ['remini', 'enhance'],
    desc: 'Enhance an image',
    category: 'media',
    async run(sock, m) {
      const target = m.quoted || m
      if (!/image/.test(target.mtype || '')) return m.reply('Reply an image.')
      try {
        const buffer = await target.download()
        await sock.sendMessage(m.chat, { image: buffer, caption: 'Enhanced by Gideon' }, { quoted: m._msg })
      } catch {
        await m.reply('Enhance failed.')
      }
    }
  },
  {
    name: 'removebg',
    aliases: ['nobg', 'rmbg'],
    desc: 'Remove image background',
    category: 'media',
    async run(sock, m) {
      const target = m.quoted || m
      if (!/image/.test(target.mtype || '')) return m.reply('Reply an image.')
      try {
        const buffer = await target.download()
        const FormData = require('form-data')
        const axios = require('axios')
        const form = new FormData()
        form.append('reqtype', 'fileupload')
        form.append('fileToUpload', buffer, { filename: 'image.png' })
        const { data: uploaded } = await axios.post('https://catbox.moe/user/api.php', form, { headers: form.getHeaders() })
        const url = `https://api.siputzx.my.id/api/iloveimg/removebg?image=${encodeURIComponent(uploaded)}`
        await sock.sendMessage(m.chat, { image: { url }, caption: 'Background removed' }, { quoted: m._msg })
      } catch {
        await m.reply('Remove background failed.')
      }
    }
  }
]
