const guard = require('../guard')

const flag = (db, key, chat) => db[key]?.[chat]

module.exports = [
  {
    name: 'antibadword',
    aliases: ['antiswear'],
    desc: 'Delete bad words and warn (3 warnings = removed)',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m, { args, store }) {
      const mode = (args[0] || '').toLowerCase()
      const db = store.get()
      if (!['on', 'off'].includes(mode)) return m.reply(`Example: .antibadword on | off\nNow: ${flag(db, 'antibadword', m.chat)?.enabled ? 'on' : 'off'}`)
      db.antibadword[m.chat] = { ...(db.antibadword[m.chat] || { words: [] }), enabled: mode === 'on' }
      store.save()
      await m.reply(`Anti bad word ${mode}.`)
    }
  },
  {
    name: 'addbadword',
    desc: 'Add a word to this group bad word list',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { text, store }) {
      const word = text.trim().toLowerCase()
      if (!word) return m.reply('Example: .addbadword stupid')
      const db = store.get()
      const entry = (db.antibadword[m.chat] = db.antibadword[m.chat] || { enabled: false, words: [] })
      if (!entry.words.includes(word)) entry.words.push(word)
      store.save()
      await m.reply(`Added "${word}".${entry.enabled ? '' : '\nTurn it on with .antibadword on'}`)
    }
  },
  {
    name: 'delbadword',
    desc: 'Remove a word from this group bad word list',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { text, store }) {
      const word = text.trim().toLowerCase()
      const db = store.get()
      const entry = db.antibadword[m.chat]
      if (!entry || !entry.words.includes(word)) return m.reply('That word is not in your list.')
      entry.words = entry.words.filter((w) => w !== word)
      store.save()
      await m.reply(`Removed "${word}".`)
    }
  },
  {
    name: 'badwords',
    desc: 'Show the bad word list for this group',
    category: 'group',
    group: true,
    async run(sock, m, { store }) {
      const entry = store.get().antibadword[m.chat]
      await m.reply(`Anti bad word: ${entry?.enabled ? 'on' : 'off'}\n\nBuilt in: ${guard.DEFAULT_WORDS.join(', ')}\nYour words: ${entry?.words?.join(', ') || 'none'}`)
    }
  },
  {
    name: 'antispam',
    aliases: ['antiflood'],
    desc: 'Delete message floods and warn (3 warnings = removed)',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m, { args, store }) {
      const mode = (args[0] || '').toLowerCase()
      const db = store.get()
      if (!['on', 'off'].includes(mode)) return m.reply(`Example: .antispam on | off\nNow: ${db.antispam[m.chat] ? 'on' : 'off'}`)
      if (mode === 'on') db.antispam[m.chat] = true
      else delete db.antispam[m.chat]
      store.save()
      await m.reply(`Anti spam ${mode}.`)
    }
  }
]
