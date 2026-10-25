const fn = require('../functions')

const truths = [
  'What is your biggest fear?',
  'Who was your first crush?',
  'What is a secret you never told anyone?',
  'What is the most embarrassing thing you have done?'
]
const dares = [
  'Send a voice note singing your favorite song.',
  'Change your name to Gideon Fan for 10 minutes.',
  'Text your last contact: I am using Gideon bot.',
  'Send a random sticker in this chat.'
]

module.exports = [
  {
    name: 'truth',
    aliases: ['t'],
    desc: 'Random truth question',
    category: 'fun',
    async run(sock, m) {
      await m.reply(`*Truth*\n${fn.pickRandom(truths)}`)
    }
  },
  {
    name: 'dare',
    aliases: ['d'],
    desc: 'Random dare',
    category: 'fun',
    async run(sock, m) {
      await m.reply(`*Dare*\n${fn.pickRandom(dares)}`)
    }
  },
  {
    name: 'ship',
    aliases: ['couple'],
    desc: 'Ship two people',
    category: 'fun',
    async run(sock, m) {
      const a = m.mentionedJid[0] || m.sender
      const b = m.mentionedJid[1] || m.quoted?.sender
      if (!b) return m.reply('Tag two people or reply someone.')
      const score = Math.floor(Math.random() * 101)
      await sock.sendMessage(m.chat, {
        text: `*Ship*\n@${fn.cleanJid(a)} + @${fn.cleanJid(b)}\nCompatibility: ${score}%`,
        mentions: [a, b]
      })
    }
  },
  {
    name: 'slot',
    aliases: ['slots'],
    desc: 'Play slots',
    category: 'fun',
    async run(sock, m) {
      const icons = ['CHERRY', 'LEMON', 'GRAPE', 'SEVEN', 'STAR', 'BAR']
      const spin = [fn.pickRandom(icons), fn.pickRandom(icons), fn.pickRandom(icons)]
      const win = spin[0] === spin[1] && spin[1] === spin[2]
      await m.reply(`${spin.join(' | ')}\n${win ? 'You won!' : 'Try again.'}`)
    }
  },
  {
    name: 'dice',
    aliases: ['roll'],
    desc: 'Roll a dice',
    category: 'fun',
    async run(sock, m) {
      await m.reply(`You rolled ${Math.floor(Math.random() * 6) + 1}`)
    }
  },
  {
    name: 'flip',
    aliases: ['coin'],
    desc: 'Flip a coin',
    category: 'fun',
    async run(sock, m) {
      await m.reply(fn.pickRandom(['Heads', 'Tails']))
    }
  },
  {
    name: 'pick',
    aliases: ['choose'],
    desc: 'Pick from options',
    category: 'fun',
    async run(sock, m, { text }) {
      const options = (text || '').split('|').map((v) => v.trim()).filter(Boolean)
      if (options.length < 2) return m.reply('Example: .pick tea | coffee | juice')
      await m.reply(`I pick: ${fn.pickRandom(options)}`)
    }
  },
  {
    name: 'rate',
    aliases: ['howgay', 'hot'],
    desc: 'Rate someone',
    category: 'fun',
    async run(sock, m, { text }) {
      const target = m.mentionedJid[0] ? `@${fn.cleanJid(m.mentionedJid[0])}` : text || m.pushName
      await m.reply(`${target} is ${Math.floor(Math.random() * 101)}% ${m.command === 'howgay' ? 'gay' : 'rated'}`)
    }
  },
  {
    name: 'joke',
    aliases: ['jokes'],
    desc: 'Random joke',
    category: 'fun',
    async run(sock, m) {
      try {
        const data = await fn.fetchJson('https://official-joke-api.appspot.com/random_joke')
        await m.reply(`${data.setup}\n${data.punchline}`)
      } catch {
        await m.reply('Why did the bot cross the road? To reply your message.')
      }
    }
  },
  {
    name: 'fact',
    aliases: ['facts'],
    desc: 'Random fact',
    category: 'fun',
    async run(sock, m) {
      try {
        const data = await fn.fetchJson('https://uselessfacts.jsph.pl/random.json?language=en')
        await m.reply(data.text)
      } catch {
        await m.reply('Gideon never sleeps.')
      }
    }
  },
  {
    name: 'quoteanime',
    aliases: ['animequote'],
    desc: 'Random anime quote',
    category: 'fun',
    async run(sock, m) {
      try {
        const data = await fn.fetchJson('https://api.quotable.io/random')
        await m.reply(`"${data.content}"\n- ${data.author}`)
      } catch {
        await m.reply('"Stay hungry." - Gideon')
      }
    }
  }
]
