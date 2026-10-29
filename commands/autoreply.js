// Auto-reply for private chats. Owner only.
//   .autoreply on|off          switch it
//   .setreply <text>           default reply (once per person per cooldown). {name} {time} work
//   .replycooldown <minutes>   how long before the default reply can repeat
//   .addreply hello | Hi {name}!   keyword reply
//   .delreply hello            remove a keyword
//   .replies                   show everything
module.exports = [
  {
    name: 'autoreply',
    aliases: ['ar'],
    desc: 'Turn private-chat auto-reply on/off',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, store }) {
      const mode = (args[0] || '').toLowerCase()
      const db = store.get()
      if (!['on', 'off'].includes(mode)) return m.reply(`Example: .autoreply on | .autoreply off\nNow: ${db.autoreply?.enabled ? 'on' : 'off'}`)
      db.autoreply = { ...db.autoreply, enabled: mode === 'on' }
      store.save()
      await m.reply(`Auto-reply ${mode}.`)
    }
  },
  {
    name: 'setreply',
    desc: 'Set the default auto-reply text',
    category: 'owner',
    owner: true,
    async run(sock, m, { text, store }) {
      if (!text) return m.reply('Example: .setreply Hi {name}, I am busy. I will reply later.')
      const db = store.get()
      db.autoreply = { ...db.autoreply, text }
      store.save()
      await m.reply('Default auto-reply saved.')
    }
  },
  {
    name: 'replycooldown',
    desc: 'Minutes before the default auto-reply repeats',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, store }) {
      const min = parseInt(args[0])
      if (!min || min < 1) return m.reply('Example: .replycooldown 60')
      const db = store.get()
      db.autoreply = { ...db.autoreply, cooldownMin: min }
      store.save()
      await m.reply(`Cooldown: ${min} minute(s).`)
    }
  },
  {
    name: 'addreply',
    desc: 'Add keyword reply: .addreply price | It is 5k',
    category: 'owner',
    owner: true,
    async run(sock, m, { text, store }) {
      const [keyword, ...rest] = text.split('|')
      const reply = rest.join('|').trim()
      if (!keyword.trim() || !reply) return m.reply('Example: .addreply price | The price is 5k')
      const db = store.get()
      const keywords = { ...(db.autoreply?.keywords || {}), [keyword.trim().toLowerCase()]: reply }
      db.autoreply = { ...db.autoreply, keywords }
      store.save()
      await m.reply(`Keyword "${keyword.trim().toLowerCase()}" added.`)
    }
  },
  {
    name: 'delreply',
    desc: 'Remove a keyword reply',
    category: 'owner',
    owner: true,
    async run(sock, m, { text, store }) {
      const key = text.trim().toLowerCase()
      const db = store.get()
      if (!key || !db.autoreply?.keywords?.[key]) return m.reply('Keyword not found. Use .replies to see them.')
      delete db.autoreply.keywords[key]
      store.save()
      await m.reply('Removed.')
    }
  },
  {
    name: 'replies',
    aliases: ['replylist'],
    desc: 'Show auto-reply setup',
    category: 'owner',
    owner: true,
    async run(sock, m, { store }) {
      const ar = store.get().autoreply || {}
      const words = Object.entries(ar.keywords || {}).map(([k, v]) => `- ${k} -> ${v}`).join('\n') || '- none'
      await m.reply(`Auto-reply: ${ar.enabled ? 'on' : 'off'}\nCooldown: ${ar.cooldownMin || 60} min\nDefault: ${ar.text || '-'}\n\nKeywords\n${words}`)
    }
  }
]
