const fn = require('../functions')

module.exports = [
  {
    name: 'ai',
    aliases: ['gpt', 'ask'],
    desc: 'Ask AI',
    category: 'ai',
    async run(sock, m, { text }) {
      const query = text || m.quoted?.text
      if (!query) return m.reply('Example: .ai write a caption')
      try {
        const data = await fn.fetchJson(`https://api.siputzx.my.id/api/ai/gpt3?prompt=${encodeURIComponent('You are Gideon, a helpful WhatsApp bot by Gpraise.')}&content=${encodeURIComponent(query)}`)
        const answer = data.data || data.result || data.response || data
        await m.reply(typeof answer === 'string' ? answer : JSON.stringify(answer))
      } catch {
        await m.reply('AI is busy. Try again later.')
      }
    }
  },
  {
    name: 'imagine',
    aliases: ['aiimage', 'draw'],
    desc: 'Generate an AI image',
    category: 'ai',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .imagine a neon robot in Lagos')
      try {
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}`
        await sock.sendMessage(m.chat, { image: { url }, caption: text })
      } catch {
        await m.reply('Image generation failed.')
      }
    }
  },
  {
    name: 'lyrics',
    aliases: ['lyric'],
    desc: 'Find song lyrics',
    category: 'search',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .lyrics faded')
      try {
        const data = await fn.fetchJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(text)}/${encodeURIComponent(text)}`)
        if (!data.lyrics) return m.reply('Lyrics not found.')
        await m.reply(data.lyrics.slice(0, 4000))
      } catch {
        await m.reply('Lyrics not found.')
      }
    }
  },
  {
    name: 'wiki',
    aliases: ['wikipedia'],
    desc: 'Search Wikipedia',
    category: 'search',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .wiki Nigeria')
      try {
        const data = await fn.fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text)}`)
        await m.reply(`*${data.title}*\n${data.extract}`)
      } catch {
        await m.reply('No Wikipedia result.')
      }
    }
  },
  {
    name: 'define',
    aliases: ['dictionary', 'dict'],
    desc: 'Define a word',
    category: 'search',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .define bot')
      try {
        const data = await fn.fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`)
        const meaning = data[0]?.meanings?.[0]?.definitions?.[0]?.definition
        await m.reply(meaning || 'No definition found.')
      } catch {
        await m.reply('No definition found.')
      }
    }
  },
  {
    name: 'npm',
    aliases: ['npmjs'],
    desc: 'Search npm packages',
    category: 'search',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .npm baileys')
      try {
        const data = await fn.fetchJson(`https://registry.npmjs.org/${encodeURIComponent(text)}`)
        await m.reply(`*${data.name}*\n${data.description || '-'}\nLatest: ${data['dist-tags']?.latest}\n${data.homepage || ''}`)
      } catch {
        await m.reply('Package not found.')
      }
    }
  },
  {
    name: 'github',
    aliases: ['ghuser'],
    desc: 'Get GitHub user info',
    category: 'search',
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .github torvalds')
      try {
        const data = await fn.fetchJson(`https://api.github.com/users/${encodeURIComponent(text)}`)
        await sock.sendMessage(m.chat, {
          image: { url: data.avatar_url },
          caption: `*${data.login}*\n${data.bio || '-'}\nRepos: ${data.public_repos}\nFollowers: ${data.followers}\n${data.html_url}`
        })
      } catch {
        await m.reply('User not found.')
      }
    }
  }
]
