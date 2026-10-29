const fs = require('fs')
const path = require('path')
const config = require('../config')
const fn = require('../functions')

module.exports = [
  {
    name: 'public',
    aliases: ['modepublic'],
    desc: 'Set bot to public mode',
    category: 'owner',
    owner: true,
    async run(sock, m, { store }) {
      store.set('public', true)
      await m.reply('Bot is now public.')
    }
  },
  {
    name: 'self',
    aliases: ['private', 'modeprivate'],
    desc: 'Set bot to private mode',
    category: 'owner',
    owner: true,
    async run(sock, m, { store }) {
      store.set('public', false)
      await m.reply('Bot is now private.')
    }
  },
  {
    name: 'broadcast',
    aliases: ['bc'],
    desc: 'Broadcast a message to all chats',
    category: 'owner',
    owner: true,
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .broadcast Hello everyone')
      const chats = Object.keys(await sock.groupFetchAllParticipating().catch(() => ({})))
      let sent = 0
      for (const id of chats) {
        try {
          await sock.sendMessage(id, { text: `*${config.botName} Broadcast*\n\n${text}` })
          sent++
          await fn.sleep(1500)
        } catch {}
      }
      await m.reply(`Broadcast sent to ${sent} group(s).`)
    }
  },
  {
    name: 'join',
    aliases: ['joingc'],
    desc: 'Join a group via invite link',
    category: 'owner',
    owner: true,
    async run(sock, m, { text }) {
      const code = (text.match(/chat\.whatsapp\.com\/([\w-]+)/) || [])[1]
      if (!code) return m.reply('Send a valid group invite link.')
      await sock.groupAcceptInvite(code)
      await m.reply('Joined the group.')
    }
  },
  {
    name: 'leave',
    aliases: ['leavegc'],
    desc: 'Leave the current group',
    category: 'owner',
    owner: true,
    group: true,
    async run(sock, m) {
      await m.reply('Leaving...')
      await sock.groupLeave(m.chat)
    }
  },
  {
    name: 'block',
    aliases: ['banuser'],
    desc: 'Block a user',
    category: 'owner',
    owner: true,
    async run(sock, m, { args }) {
      const user = m.quoted?.sender || m.mentionedJid[0] || (args[0] ? fn.toJid(args[0]) : null)
      if (!user) return m.reply('Tag, reply or give a number.')
      await sock.updateBlockStatus(user, 'block')
      await m.reply('Blocked.')
    }
  },
  {
    name: 'unblock',
    aliases: ['unbanuser'],
    desc: 'Unblock a user',
    category: 'owner',
    owner: true,
    async run(sock, m, { args }) {
      const user = m.quoted?.sender || m.mentionedJid[0] || (args[0] ? fn.toJid(args[0]) : null)
      if (!user) return m.reply('Tag, reply or give a number.')
      await sock.updateBlockStatus(user, 'unblock')
      await m.reply('Unblocked.')
    }
  },
  {
    name: 'ban',
    aliases: ['banbot'],
    desc: 'Ban a user from using the bot',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, store }) {
      const user = m.quoted?.sender || m.mentionedJid[0] || args[0]
      if (!user) return m.reply('Tag, reply or give a number.')
      const num = fn.cleanJid(user)
      const db = store.get()
      if (!db.banned.includes(num)) db.banned.push(num)
      store.save()
      await m.reply(`Banned ${num}.`)
    }
  },
  {
    name: 'unban',
    aliases: ['unbanbot'],
    desc: 'Unban a user',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, store }) {
      const user = m.quoted?.sender || m.mentionedJid[0] || args[0]
      if (!user) return m.reply('Tag, reply or give a number.')
      const num = fn.cleanJid(user)
      const db = store.get()
      db.banned = db.banned.filter((v) => v !== num)
      store.save()
      await m.reply(`Unbanned ${num}.`)
    }
  },
  {
    name: 'addowner',
    aliases: ['ao'],
    desc: 'Add an extra owner',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, store }) {
      const user = m.quoted?.sender || m.mentionedJid[0] || args[0]
      if (!user) return m.reply('Tag, reply or give a number.')
      const num = fn.cleanJid(user)
      const db = store.get()
      if (!db.owners.includes(num)) db.owners.push(num)
      store.save()
      await m.reply(`Added owner ${num}.`)
    }
  },
  {
    name: 'delowner',
    aliases: ['do'],
    desc: 'Remove an extra owner',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, store }) {
      const user = m.quoted?.sender || m.mentionedJid[0] || args[0]
      if (!user) return m.reply('Tag, reply or give a number.')
      const num = fn.cleanJid(user)
      if (num === config.ownerNumber) return m.reply('Cannot remove the main owner.')
      const db = store.get()
      db.owners = db.owners.filter((v) => v !== num)
      store.save()
      await m.reply(`Removed owner ${num}.`)
    }
  },
  {
    name: 'restart',
    aliases: ['reboot'],
    desc: 'Restart the bot',
    category: 'owner',
    owner: true,
    async run(sock, m) {
      await m.reply('Restarting...')
      setTimeout(() => process.exit(42), 800)
    }
  },
  {
    name: 'eval',
    dangerous: true,
    aliases: ['>', 'execute'],
    desc: 'Run JavaScript as owner',
    category: 'owner',
    owner: true,
    async run(sock, m, { text }) {
      if (!text) return m.reply('Provide code.')
      try {
        let result = await eval(`(async () => { ${text} })()`)
        if (typeof result !== 'string') result = require('util').inspect(result, { depth: 1 })
        await m.reply(String(result).slice(0, 4000))
      } catch (err) {
        await m.reply(String(err))
      }
    }
  },
  {
    name: 'exec',
    dangerous: true,
    aliases: ['$', 'term'],
    desc: 'Run a shell command',
    category: 'owner',
    owner: true,
    async run(sock, m, { text }) {
      if (!text) return m.reply('Provide a command.')
      const { exec } = require('child_process')
      exec(text, { timeout: 20000 }, async (err, stdout, stderr) => {
        const out = stdout || stderr || err?.message || 'Done'
        await m.reply(String(out).slice(0, 4000))
      })
    }
  },
  {
    name: 'setpp',
    aliases: ['fullpp', 'setpic'],
    desc: 'Set bot profile picture',
    category: 'owner',
    owner: true,
    async run(sock, m) {
      const target = m.quoted || m
      if (!/image/.test(target.mtype || '')) return m.reply('Reply an image.')
      const buffer = await target.download()
      await sock.updateProfilePicture(sock.user.id, buffer)
      await m.reply('Profile picture updated.')
    }
  },
  {
    name: 'setbio',
    aliases: ['setstatus'],
    desc: 'Set bot about/bio',
    category: 'owner',
    owner: true,
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .setbio Gideon is online')
      await sock.updateProfileStatus(text)
      await m.reply('Bio updated.')
    }
  },
  {
    name: 'antidelete',
    aliases: ['antidel'],
    desc: 'Toggle anti-delete forwarding',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, store }) {
      const mode = (args[0] || '').toLowerCase()
      if (!['on', 'off'].includes(mode)) return m.reply('Example: .antidelete on | .antidelete off')
      store.set('antidelete', mode === 'on')
      await m.reply(`Anti-delete ${mode}.`)
    }
  },
  {
    name: 'getsession',
    dangerous: true,
    aliases: ['session'],
    desc: 'Send session creds to owner',
    category: 'owner',
    owner: true,
    async run(sock, m) {
      const file = path.join(__dirname, '..', 'session', 'creds.json')
      if (!fs.existsSync(file)) return m.reply('No creds.json found in session.')
      if (m.isGroup) return m.reply('Use this command in my private chat only.')
      await sock.sendMessage(m.chat, {
        document: fs.readFileSync(file),
        mimetype: 'application/json',
        fileName: 'creds.json'
      })
    }
  }
]
