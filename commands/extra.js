const fn = require('../functions')

module.exports = [
  {
    name: 'qr',
    aliases: ['qrcode'],
    desc: 'Create a QR code',
    category: 'tools',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .qr https://gpraise-hub.store')
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`
      await sock.sendMessage(m.chat, { image: { url }, caption: text }, { quoted: m._msg })
    }
  },
  {
    name: 'readqr',
    aliases: ['scanqr'],
    desc: 'Read a QR code from an image',
    category: 'tools',
    async run(sock, m) {
      const target = m.quoted || m
      if (!/image/.test(target.mtype || '')) return m.reply('Reply a QR image.')
      try {
        const buffer = await target.download()
        const FormData = require('form-data')
        const axios = require('axios')
        const form = new FormData()
        form.append('file', buffer, { filename: 'qr.png' })
        const { data } = await axios.post('https://api.qrserver.com/v1/read-qr-code/', form, { headers: form.getHeaders() })
        const text = data?.[0]?.symbol?.[0]?.data
        await m.reply(text || 'No QR data found.')
      } catch {
        await m.reply('Could not read that QR.')
      }
    }
  },
  {
    name: 'pinterest',
    aliases: ['pin'],
    desc: 'Search Pinterest images',
    category: 'search',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .pinterest cars')
      try {
        const data = await fn.fetchJson(`https://api.siputzx.my.id/api/s/pinterest?query=${encodeURIComponent(text)}`)
        const list = data.result || data.data || []
        const item = Array.isArray(list) ? list[0] : list
        const url = item?.images_url || item?.url || item?.image
        if (!url) return m.reply('No image found.')
        await sock.sendMessage(m.chat, { image: { url }, caption: text }, { quoted: m._msg })
      } catch {
        await m.reply('Pinterest search failed.')
      }
    }
  },
  {
    name: 'wallpaper',
    aliases: ['wp'],
    desc: 'Random wallpaper',
    category: 'search',
    async run(sock, m, { text }) {
      const q = text || 'nature'
      const url = `https://source.unsplash.com/1280x720/?${encodeURIComponent(q)}`
      await sock.sendMessage(m.chat, { image: { url }, caption: q }, { quoted: m._msg })
    }
  },
  {
    name: 'couplepp',
    aliases: ['cpp'],
    desc: 'Couple profile pictures',
    category: 'fun',
    async run(sock, m) {
      try {
        const data = await fn.fetchJson('https://raw.githubusercontent.com/iamriz7/kopel_/master/kopel.json')
        const pick = fn.pickRandom(data)
        await sock.sendMessage(m.chat, { image: { url: pick.male }, caption: 'Male' })
        await sock.sendMessage(m.chat, { image: { url: pick.female }, caption: 'Female' })
      } catch {
        await m.reply('Could not fetch couple pictures.')
      }
    }
  },
  {
    name: 'toqr',
    aliases: ['makeqr'],
    desc: 'Turn text into a QR sticker',
    category: 'convert',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .toqr Gideon')
      const { Sticker, StickerTypes } = require('wa-sticker-formatter')
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`
      const buffer = await fn.getBuffer(url)
      const sticker = new Sticker(buffer, {
        pack: 'Gideon',
        author: 'Gpraise',
        type: StickerTypes.FULL,
        quality: 80
      })
      await sock.sendMessage(m.chat, await sticker.toMessage())
    }
  }
]
