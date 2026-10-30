const crypto = require('crypto')
const fn = require('../functions')

const decode = (s = '') =>
  String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&eacute;/g, 'é')

const ball = [
  'It is certain.', 'Without a doubt.', 'Yes, definitely.', 'Most likely.', 'Signs point to yes.',
  'Ask again later.', 'Cannot predict now.', 'Do not count on it.', 'My sources say no.', 'Very doubtful.'
]

async function target(sock, m) {
  return m.quoted?.sender || m.mentionedJid?.[0] || null
}

module.exports = [
  {
    name: 'poll',
    aliases: ['vote'],
    desc: 'Create a poll: .poll Question | option1 | option2',
    category: 'group',
    async run(sock, m, { text, prefix }) {
      const parts = text.split('|').map((v) => v.trim()).filter(Boolean)
      if (parts.length < 3) return m.reply(`Example: ${prefix}poll Best food? | Rice | Beans | Yam`)
      const [name, ...values] = parts
      await sock.sendMessage(m.chat, { poll: { name, values: values.slice(0, 12), selectableCount: 1 } }, { quoted: m._msg })
    }
  },
  {
    name: 'tagadmins',
    aliases: ['tagadmin', 'calladmins'],
    desc: 'Mention all group admins',
    category: 'group',
    group: true,
    async run(sock, m, { text }) {
      const meta = await sock.groupMetadata(m.chat)
      const admins = meta.participants.filter((p) => p.admin)
      const list = admins.map((p, i) => `${i + 1}. @${fn.cleanJid(p.phoneNumber || p.id)}`).join('\n')
      await sock.sendMessage(m.chat, { text: `${text || 'Attention admins'}\n\n${list}`, mentions: admins.map((p) => p.id) }, { quoted: m._msg })
    }
  },
  {
    name: 'warn',
    desc: 'Warn a member (3 warnings = removed)',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { store, text }) {
      const user = await target(sock, m)
      if (!user) return m.reply('Tag or reply the member to warn.')
      const db = store.get()
      const id = fn.cleanJid(user)
      db.warns[m.chat] = db.warns[m.chat] || {}
      db.warns[m.chat][id] = (db.warns[m.chat][id] || 0) + 1
      store.save()
      const count = db.warns[m.chat][id]
      await m.reply(`@${id} warned (${count}/3).${text ? `\nReason: ${text}` : ''}`, { mentions: [user] })
      if (count >= 3) {
        try {
          await sock.groupParticipantsUpdate(m.chat, [user], 'remove')
          delete db.warns[m.chat][id]
          store.save()
          await m.reply(`@${id} reached 3 warnings and was removed.`, { mentions: [user] })
        } catch {
          await m.reply('Reached 3 warnings but I need to be admin to remove them.')
        }
      }
    }
  },
  {
    name: 'warnings',
    aliases: ['warns'],
    desc: 'Show warnings of a member',
    category: 'group',
    group: true,
    async run(sock, m, { store }) {
      const user = (await target(sock, m)) || m.sender
      const id = fn.cleanJid(user)
      const count = store.get().warns?.[m.chat]?.[id] || 0
      await m.reply(`@${id} has ${count}/3 warnings.`, { mentions: [user] })
    }
  },
  {
    name: 'resetwarn',
    aliases: ['clearwarn'],
    desc: 'Clear warnings of a member',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { store }) {
      const user = await target(sock, m)
      if (!user) return m.reply('Tag or reply the member.')
      const db = store.get()
      if (db.warns[m.chat]) delete db.warns[m.chat][fn.cleanJid(user)]
      store.save()
      await m.reply('Warnings cleared.')
    }
  },
  {
    name: 'afk',
    desc: 'Go AFK; people who tag you get told',
    category: 'tools',
    async run(sock, m, { text, store }) {
      const db = store.get()
      db.afk = db.afk || {}
      db.afk[fn.cleanJid(m.sender)] = { reason: text || '', time: Date.now() }
      store.save()
      await m.reply(`You are now AFK${text ? `: ${text}` : ''}.`)
    }
  },
  {
    name: '8ball',
    desc: 'Ask the magic 8 ball',
    category: 'fun',
    async run(sock, m, { text, prefix }) {
      if (!text) return m.reply(`Example: ${prefix}8ball Will I be rich?`)
      await m.reply(`Q: ${text}\nA: ${fn.pickRandom(ball)}`)
    }
  },
  {
    name: 'password',
    aliases: ['genpass'],
    desc: 'Generate a strong password (default 16)',
    category: 'tools',
    async run(sock, m, { args }) {
      const len = Math.min(Math.max(parseInt(args[0]) || 16, 6), 64)
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*'
      const pass = Array.from(crypto.randomBytes(len), (b) => chars[b % chars.length]).join('')
      await m.reply(`Password (${len}):\n${pass}`)
    }
  },
  {
    name: 'advice',
    desc: 'Random advice',
    category: 'fun',
    async run(sock, m) {
      try {
        const data = await fn.fetchJson('https://api.adviceslip.com/advice')
        await m.reply(data.slip.advice)
      } catch {
        await m.reply('Advice service is down, try again.')
      }
    }
  },
  {
    name: 'cat',
    desc: 'Random cat picture',
    category: 'fun',
    async run(sock, m) {
      try {
        const data = await fn.fetchJson('https://api.thecatapi.com/v1/images/search')
        await sock.sendMessage(m.chat, { image: { url: data[0].url }, caption: 'Meow' }, { quoted: m._msg })
      } catch {
        await m.reply('Could not fetch a cat right now.')
      }
    }
  },
  {
    name: 'dog',
    desc: 'Random dog picture',
    category: 'fun',
    async run(sock, m) {
      try {
        const data = await fn.fetchJson('https://dog.ceo/api/breeds/image/random')
        await sock.sendMessage(m.chat, { image: { url: data.message }, caption: 'Woof' }, { quoted: m._msg })
      } catch {
        await m.reply('Could not fetch a dog right now.')
      }
    }
  },
  {
    name: 'meme',
    desc: 'Random meme',
    category: 'fun',
    async run(sock, m) {
      try {
        const data = await fn.fetchJson('https://meme-api.com/gimme')
        await sock.sendMessage(m.chat, { image: { url: data.url }, caption: data.title }, { quoted: m._msg })
      } catch {
        await m.reply('Could not fetch a meme right now.')
      }
    }
  },
  {
    name: 'trivia',
    aliases: ['quiz'],
    desc: 'Random trivia question (answer is hidden under Read more)',
    category: 'fun',
    async run(sock, m) {
      try {
        const data = await fn.fetchJson('https://opentdb.com/api.php?amount=1&type=multiple')
        const q = data.results[0]
        const options = [...q.incorrect_answers, q.correct_answer].map(decode).sort(() => Math.random() - 0.5)
        const letters = ['A', 'B', 'C', 'D']
        const list = options.map((o, i) => `${letters[i]}. ${o}`).join('\n')
        await m.reply(`${decode(q.question)}\n\n${list}\n${'\u200b'.repeat(4001)}\nAnswer: ${decode(q.correct_answer)}`)
      } catch {
        await m.reply('Trivia service is down, try again.')
      }
    }
  },
  {
    name: 'bible',
    desc: 'Get a Bible verse: .bible john 3:16',
    category: 'tools',
    async run(sock, m, { text, prefix }) {
      if (!text) return m.reply(`Example: ${prefix}bible john 3:16`)
      try {
        const data = await fn.fetchJson(`https://bible-api.com/${encodeURIComponent(text)}`)
        await m.reply(`${data.reference}\n\n${String(data.text).trim()}\n\n(${data.translation_name})`)
      } catch {
        await m.reply('Verse not found.')
      }
    }
  },
  {
    name: 'coinprice',
    aliases: ['price', 'cryptoprice'],
    desc: 'Real crypto price: .coinprice bitcoin',
    category: 'tools',
    async run(sock, m, { text, prefix }) {
      const coin = (text || '').toLowerCase().trim()
      if (!coin) return m.reply(`Example: ${prefix}coinprice bitcoin`)
      try {
        const data = await fn.fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=usd,ngn&include_24hr_change=true`)
        const p = data[coin]
        if (!p) return m.reply('Coin not found. Use the full name, e.g. bitcoin, ethereum, solana.')
        await m.reply(`${coin.toUpperCase()}\nUSD: $${p.usd.toLocaleString()}\nNGN: ₦${p.ngn.toLocaleString()}\n24h: ${p.usd_24h_change?.toFixed(2)}%`)
      } catch {
        await m.reply('Price service is busy, try again.')
      }
    }
  },
  {
    name: 'currency',
    aliases: ['convert', 'fx'],
    desc: 'Convert money: .currency 100 usd ngn',
    category: 'tools',
    async run(sock, m, { args, prefix }) {
      const amount = parseFloat(args[0])
      const from = (args[1] || '').toUpperCase()
      const to = (args[2] || '').toUpperCase()
      if (!amount || !from || !to) return m.reply(`Example: ${prefix}currency 100 usd ngn`)
      try {
        const data = await fn.fetchJson(`https://open.er-api.com/v6/latest/${from}`)
        const rate = data.rates?.[to]
        if (!rate) return m.reply('Unknown currency code.')
        await m.reply(`${amount.toLocaleString()} ${from} = ${(amount * rate).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${to}`)
      } catch {
        await m.reply('Could not get the rate right now.')
      }
    }
  },
  {
    name: 'time',
    aliases: ['clock'],
    desc: 'Time in a zone: .time Africa/Lagos',
    category: 'tools',
    async run(sock, m, { text, config }) {
      const zone = text || config.timezone
      try {
        await m.reply(`${zone}\n${new Date().toLocaleString('en-GB', { timeZone: zone })}`)
      } catch {
        await m.reply('Unknown timezone. Example: .time America/New_York')
      }
    }
  }
]
