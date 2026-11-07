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
      // The one owner command co-owners still can't use (see handler.js) - .self/.private is a
      // lockdown the main owner can set, so a co-owner being able to undo it would defeat the
      // point of it being a lockdown. Everything else a co-owner can now do, same as the owner.
      if (!m.isMainOwner) return m.reply('🔒 Only the main owner can take the bot out of private mode.')
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
    desc: 'Block a user: tag, reply, give a number, or run it in their private chat',
    category: 'owner',
    owner: true,
    async run(sock, m, { args }) {
      const user = m.quoted?.sender || m.mentionedJid?.[0] || (args[0] ? fn.toJid(args[0]) : null) || (!m.isGroup ? m.chat : null)
      if (!user) return m.reply('Tag, reply or give a number. Example: .block 2348012345678')
      const ids = [user, m.quoted?.sender, ...(m.mentionedJid || [])].filter(Boolean)
      if (fn.isOwner(ids.map((j) => fn.cleanJid(j)))) return m.reply('You cannot block an owner.')
      const res = await fn.setBlock(sock, user, 'block', ids)
      if (!res.ok) return m.reply(`❌ Could not block that user (${res.error}).`)
      await m.reply(res.verified ? '🚫 Blocked. (Confirmed on the WhatsApp block list.)' : '🚫 Block request sent to WhatsApp.')
    }
  },
  {
    name: 'unblock',
    aliases: ['unbanuser'],
    desc: 'Unblock a user',
    category: 'owner',
    owner: true,
    async run(sock, m, { args }) {
      const user = m.quoted?.sender || m.mentionedJid?.[0] || (args[0] ? fn.toJid(args[0]) : null) || (!m.isGroup ? m.chat : null)
      if (!user) return m.reply('Tag, reply or give a number.')
      const ids = [user, m.quoted?.sender, ...(m.mentionedJid || [])].filter(Boolean)
      const res = await fn.setBlock(sock, user, 'unblock', ids)
      if (!res.ok) return m.reply(`❌ Could not unblock that user (${res.error}).`)
      await m.reply(res.verified ? '✅ Unblocked. (Confirmed on the WhatsApp block list.)' : '✅ Unblock request sent to WhatsApp.')
    }
  },
  {
    name: 'ban',
    aliases: ['banbot'],
    desc: 'Ban a user from using the bot',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, store }) {
      const user = m.quoted?.sender || m.mentionedJid[0] || (args[0] ? fn.toJid(args[0]) : null)
      if (!user) return m.reply('Tag, reply or give a number. Example: .ban 2348012345678')
      const ids = new Set([fn.cleanJid(user)])
      try {
        const pn = await fn.resolvePN(sock, user)
        if (pn) ids.add(fn.cleanJid(pn))
      } catch {}
      const db = store.get()
      if ([...ids].some((id) => fn.isOwner(id))) return m.reply('You cannot ban an owner.')
      for (const id of ids) if (id && !db.banned.includes(id)) db.banned.push(id)
      store.save()
      await m.reply(`🚫 Banned ${[...ids].join(' / ')}.\nIf they use a command they will be told they are banned.`)
    }
  },
  {
    name: 'unban',
    aliases: ['unbanbot'],
    desc: 'Unban a user',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, store }) {
      const user = m.quoted?.sender || m.mentionedJid[0] || (args[0] ? fn.toJid(args[0]) : null)
      if (!user) return m.reply('Tag, reply or give a number.')
      const ids = new Set([fn.cleanJid(user)])
      try {
        const pn = await fn.resolvePN(sock, user)
        if (pn) ids.add(fn.cleanJid(pn))
      } catch {}
      const db = store.get()
      db.banned = db.banned.filter((v) => !ids.has(v))
      store.save()
      await m.reply(`✅ Unbanned ${[...ids].join(' / ')}.`)
    }
  },
  {
    name: 'banlist',
    aliases: ['banned'],
    desc: 'Show banned users',
    category: 'owner',
    owner: true,
    async run(sock, m, { store }) {
      const list = store.get().banned
      await m.reply(list.length ? `🚫 *BANNED* (${list.length})\n\n${list.map((n, i) => `${i + 1}. ${n}`).join('\n')}` : 'Nobody is banned.')
    }
  },
  {
    name: 'addowner',
    aliases: ['ao'],
    desc: 'Add a co-owner (main owner only)',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, store }) {
      if (!m.isMainOwner) return m.reply('🔒 Only the main owner can add owners.')
      const user = m.quoted?.sender || m.mentionedJid[0] || (args[0] ? fn.toJid(args[0]) : null)
      if (!user) return m.reply('Tag, reply or give a number. Example: .addowner 2348012345678')
      const num = fn.cleanJid(user)
      if (num === config.ownerNumber.replace(/\D/g, '')) return m.reply('That is already the main owner.')
      const db = store.get()
      if (db.owners.includes(num)) return m.reply(`${num} is already a co-owner.`)
      db.owners.push(num)
      store.save()
      await m.reply(`👑 ${num} is now a co-owner.\nThey get full owner access - same as you, everywhere except they can't take the bot out of private mode (.public) if you've locked it. Only you can remove them with .delowner.`)
    }
  },
  {
    name: 'delowner',
    aliases: ['do'],
    desc: 'Remove a co-owner (main owner only)',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, store }) {
      if (!m.isMainOwner) return m.reply('🔒 Only the main owner can remove owners.')
      const user = m.quoted?.sender || m.mentionedJid[0] || (args[0] ? fn.toJid(args[0]) : null)
      if (!user) return m.reply('Tag, reply or give a number.')
      const num = fn.cleanJid(user)
      if (num === config.ownerNumber.replace(/\D/g, '')) return m.reply('Cannot remove the main owner.')
      const db = store.get()
      if (!db.owners.includes(num)) return m.reply(`${num} is not a co-owner.`)
      db.owners = db.owners.filter((v) => v !== num)
      store.save()
      await m.reply(`Removed co-owner ${num}.`)
    }
  },
  {
    name: 'listowner',
    aliases: ['owners', 'coowners'],
    desc: 'Show co-owners (main owner only)',
    category: 'owner',
    owner: true,
    async run(sock, m, { store }) {
      if (!m.isMainOwner) return m.reply('🔒 Only the main owner can see this list.')
      const main = config.ownerNumber.replace(/\D/g, '')
      const co = store.get().owners.filter((n) => n !== main)
      await m.reply(`👑 *OWNERS*\n\nMain: ${main}\n${co.length ? co.map((n, i) => `Co-owner ${i + 1}: ${n}`).join('\n') : 'No co-owners yet.'}`)
    }
  },
  {
    name: 'restart',
    aliases: ['reboot'],
    desc: 'Restart the bot',
    category: 'owner',
    owner: true,
    dev: true, // host-only: a Gideon Cloud user's own bot cannot run it
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
    dev: true, // host-only: a Gideon Cloud user's own bot cannot run it
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
    dev: true, // host-only: a Gideon Cloud user's own bot cannot run it
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
      if (m.isGroup) return m.reply('Use this command in my private chat only.')
      if (sock.isCloud) {
        // a Gideon Cloud user's own session (never the host's), as a Gideon~ Session ID they can use again
        const own = path.join(sock.manager.get(sock.botId)?.sessionDir || '', 'creds.json')
        if (!fs.existsSync(own)) return m.reply('No session found for this account.')
        const id = 'Gideon~' + require('zlib').gzipSync(fs.readFileSync(own)).toString('base64')
        return sock.sendMessage(m.chat, { text: `Your Session ID (keep it private, it gives full access to your WhatsApp):\n\n${id}` }, { skipStyle: true })
      }
      const file = path.join(__dirname, '..', 'session', 'creds.json')
      if (!fs.existsSync(file)) return m.reply('No creds.json found in session.')
      await sock.sendMessage(m.chat, {
        document: fs.readFileSync(file),
        mimetype: 'application/json',
        fileName: 'creds.json'
      })
    }
  }
]
