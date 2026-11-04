const reminders = require('../reminders')
const store = require('../store')
const fn = require('../functions')

// time can be 30m, 2h, 1h30m, 45s, 2d, or a clock time like 20:30 (bot timezone)
module.exports = [
  {
    name: 'remind',
    aliases: ['reminder', 'remindme'],
    desc: 'Remind me later: .remind 30m call mum',
    category: 'tools',
    async run(sock, m, { args, prefix }) {
      const at = reminders.parseWhen(args[0] || '')
      const text = args.slice(1).join(' ').trim()
      if (!at || !text) return m.reply(`Example: ${prefix}remind 30m call mum\n${prefix}remind 20:30 watch the match`)
      const id = reminders.add({ kind: 'remind', bot: sock.botId, jid: m.chat, user: m.sender, at, text })
      await m.reply(`Okay. I will remind you at ${new Date(at).toLocaleString('en-GB', { timeZone: require('../config').timezone })}.\nID: ${id}`)
    }
  },
  {
    name: 'schedule',
    aliases: ['sched', 'sendlater'],
    desc: 'Send a message in this chat later: .schedule 20:00 Good night',
    category: 'tools',
    admin: true,
    async run(sock, m, { args, prefix }) {
      const at = reminders.parseWhen(args[0] || '')
      const text = args.slice(1).join(' ').trim()
      if (!at || !text) return m.reply(`Example: ${prefix}schedule 20:00 Good night everyone\n${prefix}schedule 2h Match starts now`)
      const id = reminders.add({ kind: 'send', bot: sock.botId, jid: m.chat, user: m.sender, at, text })
      await m.reply(`Scheduled for ${new Date(at).toLocaleString('en-GB', { timeZone: require('../config').timezone })}.\nID: ${id}`)
    }
  },
  {
    name: 'reminders',
    aliases: ['myreminders', 'scheduled'],
    desc: 'List pending reminders and scheduled messages',
    category: 'tools',
    async run(sock, m) {
      const list = (store.get().reminders || []).filter((r) => r.bot === sock.botId && (r.jid === m.chat || r.user === m.sender))
      if (!list.length) return m.reply('Nothing pending.')
      await m.reply(
        list
          .map((r) => `${r.id} • ${r.kind === 'send' ? 'send' : 'remind'} • ${fn.runtime(Math.max(0, (r.at - Date.now()) / 1000))} • ${r.text.slice(0, 40)}`)
          .join('\n')
      )
    }
  },
  {
    name: 'delremind',
    aliases: ['cancelremind', 'unschedule'],
    desc: 'Cancel a reminder by its ID',
    category: 'tools',
    async run(sock, m, { args }) {
      const db = store.get()
      const before = (db.reminders || []).length
      db.reminders = (db.reminders || []).filter((r) => !(r.id === args[0] && r.bot === sock.botId && (r.user === m.sender || m.isOwner)))
      store.save()
      await m.reply(db.reminders.length < before ? 'Cancelled.' : 'No reminder with that ID (or it is not yours).')
    }
  }
]
