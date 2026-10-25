const axios = require('axios')
const fn = require('../functions')

module.exports = [
  {
    name: 'quote',
    aliases: ['q', 'quotely'],
    desc: 'Quote a replied message',
    category: 'tools',
    async run(sock, m) {
      if (!m.quoted) return m.reply('Reply a message.')
      const text = m.quoted.text || 'No text in that message.'
      await m.reply(`"${text}"\n- ${m.quoted.sender.split('@')[0]}`)
    }
  },
  {
    name: 'translate',
    aliases: ['tr'],
    desc: 'Translate text',
    category: 'tools',
    async run(sock, m, { args, text }) {
      const lang = args[0] || 'en'
      const query = args.slice(1).join(' ') || m.quoted?.text
      if (!query) return m.reply('Example: .tr en how are you')
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(lang)}&dt=t&q=${encodeURIComponent(query)}`
        const { data } = await axios.get(url)
        const translated = data[0].map((v) => v[0]).join('')
        await m.reply(translated)
      } catch {
        await m.reply('Translation failed.')
      }
    }
  },
  {
    name: 'shorturl',
    aliases: ['short', 'tinyurl'],
    desc: 'Shorten a URL',
    category: 'tools',
    async run(sock, m, { text }) {
      if (!fn.isUrl(text)) return m.reply('Example: .shorturl https://example.com')
      try {
        const { data } = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(text)}`)
        await m.reply(`Short URL: ${data}`)
      } catch {
        await m.reply('Could not shorten that URL.')
      }
    }
  },
  {
    name: 'ssweb',
    aliases: ['ss', 'screenshot'],
    desc: 'Screenshot a website',
    category: 'tools',
    async run(sock, m, { text }) {
      if (!fn.isUrl(text)) return m.reply('Example: .ssweb https://gpraise-hub.store')
      try {
        const url = `https://image.thum.io/get/fullpage/${text}`
        await sock.sendMessage(m.chat, { image: { url }, caption: text })
      } catch {
        await m.reply('Screenshot failed.')
      }
    }
  },
  {
    name: 'weather',
    aliases: ['cuaca'],
    desc: 'Get weather info',
    category: 'tools',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .weather Lagos')
      try {
        const data = await fn.fetchJson(`https://wttr.in/${encodeURIComponent(text)}?format=j1`)
        const c = data.current_condition[0]
        const area = data.nearest_area[0]
        await m.reply(
          `*Weather ${area.areaName[0].value}*\n` +
            `Country: ${area.country[0].value}\n` +
            `Temp: ${c.temp_C}°C\n` +
            `Feels: ${c.FeelsLikeC}°C\n` +
            `Humidity: ${c.humidity}%\n` +
            `Desc: ${c.weatherDesc[0].value}`
        )
      } catch {
        await m.reply('Could not fetch weather.')
      }
    }
  },
  {
    name: 'calc',
    aliases: ['calculate', 'math'],
    desc: 'Calculate a math expression',
    category: 'tools',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .calc 12*8+5')
      if (!/^[0-9+\-*/().%\s]+$/.test(text)) return m.reply('Invalid expression.')
      try {
        const result = Function(`"use strict"; return (${text})`)()
        await m.reply(`${text} = ${result}`)
      } catch {
        await m.reply('Could not calculate that.')
      }
    }
  },
  {
    name: 'tts',
    aliases: ['say'],
    desc: 'Text to speech',
    category: 'tools',
    async run(sock, m, { args, text }) {
      if (!text) return m.reply('Example: .tts en hello world')
      const lang = args[0]?.length <= 5 ? args[0] : 'en'
      const query = args[0]?.length <= 5 ? args.slice(1).join(' ') : text
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(query)}&tl=${lang}&client=tw-ob`
      await sock.sendMessage(m.chat, { audio: { url }, mimetype: 'audio/mpeg', ptt: true })
    }
  },
  {
    name: 'tourl',
    aliases: ['upload'],
    desc: 'Upload media and get a URL',
    category: 'tools',
    async run(sock, m) {
      const target = m.quoted || m
      if (!target.download) return m.reply('Reply an image, video or document.')
      try {
        const buffer = await target.download()
        const FormData = require('form-data')
        const form = new FormData()
        form.append('reqtype', 'fileupload')
        form.append('fileToUpload', buffer, { filename: 'file.bin' })
        const { data } = await axios.post('https://catbox.moe/user/api.php', form, { headers: form.getHeaders() })
        await m.reply(`URL: ${data}`)
      } catch {
        await m.reply('Upload failed.')
      }
    }
  },
  {
    name: 'readmore',
    aliases: ['more'],
    desc: 'Create a read more message',
    category: 'tools',
    async run(sock, m, { text }) {
      const [a, b] = (text || '').split('|')
      if (!a || !b) return m.reply('Example: .readmore hello|hidden text')
      await m.reply(a + String.fromCharCode(8206).repeat(4001) + b)
    }
  },
  {
    name: 'reverse',
    aliases: ['rev'],
    desc: 'Reverse text',
    category: 'tools',
    async run(sock, m, { text }) {
      const input = text || m.quoted?.text
      if (!input) return m.reply('Provide text.')
      await m.reply(input.split('').reverse().join(''))
    }
  },
  {
    name: 'base64',
    aliases: ['b64'],
    desc: 'Encode or decode base64',
    category: 'tools',
    async run(sock, m, { args, text }) {
      const mode = (args[0] || '').toLowerCase()
      const value = args.slice(1).join(' ')
      if (!['enc', 'dec'].includes(mode) || !value) return m.reply('Example: .base64 enc hello | .base64 dec aGVsbG8=')
      await m.reply(mode === 'enc' ? Buffer.from(value).toString('base64') : Buffer.from(value, 'base64').toString())
    }
  },
  {
    name: 'style',
    aliases: ['fancy', 'fancytext'],
    desc: 'Generate fancy text styles',
    category: 'tools',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .style Gideon')
      const maps = [
        { name: 'Bold', from: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', to: '𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇' },
        { name: 'Italic', from: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', to: '𝘈𝘉𝘊𝘋𝘌𝘍𝘎𝘏𝘐𝘑𝘒𝘓𝘔𝘕𝘖𝘗𝘘𝘙𝘚𝘛𝘜𝘝𝘞𝘟𝘠𝘡𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻' },
        { name: 'Mono', from: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', to: '𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣' }
      ]
      const convert = (map) => text.split('').map((ch) => {
        const i = map.from.indexOf(ch)
        return i >= 0 ? [...map.to][i] : ch
      }).join('')
      await m.reply(maps.map((map) => `*${map.name}*\n${convert(map)}`).join('\n\n'))
    }
  }
]
