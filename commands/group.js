const fn = require('../functions')

async function metadata(sock, m) {
  return sock.groupMetadata(m.chat)
}

module.exports = [
  {
    name: 'tagall',
    aliases: ['all', 'mentionall'],
    desc: 'Mention every group member',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { text }) {
      const meta = await metadata(sock, m)
      const mentions = meta.participants.map((p) => p.id)
      const list = mentions.map((id, i) => `${i + 1}. @${fn.cleanJid(id)}`).join('\n')
      await sock.sendMessage(m.chat, {
        text: `${text || 'Tag all'}\n\n${list}`,
        mentions
      })
    }
  },
  {
    name: 'hidetag',
    aliases: ['htag', 'hide'],
    desc: 'Hidden tag all members',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { text }) {
      const meta = await metadata(sock, m)
      await sock.sendMessage(m.chat, {
        text: text || 'Hello everyone',
        mentions: meta.participants.map((p) => p.id)
      })
    }
  },
  {
    name: 'kick',
    aliases: ['remove'],
    desc: 'Remove a member',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m, { args }) {
      const user = m.quoted?.sender || m.mentionedJid[0] || (args[0] ? fn.toJid(args[0]) : null)
      if (!user) return m.reply('Tag or reply the member to kick.')
      await sock.groupParticipantsUpdate(m.chat, [user], 'remove')
      await m.reply('Removed.')
    }
  },
  {
    name: 'add',
    aliases: ['inviteuser'],
    desc: 'Add a member by number',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m, { args }) {
      if (!args[0]) return m.reply('Example: .add 234xxxxxxxxxx')
      const user = fn.toJid(args[0])
      await sock.groupParticipantsUpdate(m.chat, [user], 'add')
      await m.reply('Added.')
    }
  },
  {
    name: 'promote',
    aliases: ['admin'],
    desc: 'Make a member admin',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m, { args }) {
      const user = m.quoted?.sender || m.mentionedJid[0] || (args[0] ? fn.toJid(args[0]) : null)
      if (!user) return m.reply('Tag or reply the member to promote.')
      await sock.groupParticipantsUpdate(m.chat, [user], 'promote')
      await m.reply('Promoted.')
    }
  },
  {
    name: 'demote',
    aliases: ['unadmin'],
    desc: 'Remove admin role',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m, { args }) {
      const user = m.quoted?.sender || m.mentionedJid[0] || (args[0] ? fn.toJid(args[0]) : null)
      if (!user) return m.reply('Tag or reply the admin to demote.')
      await sock.groupParticipantsUpdate(m.chat, [user], 'demote')
      await m.reply('Demoted.')
    }
  },
  {
    name: 'grouplink',
    aliases: ['link', 'invite'],
    desc: 'Get group invite link',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m) {
      const code = await sock.groupInviteCode(m.chat)
      await m.reply(`https://chat.whatsapp.com/${code}`)
    }
  },
  {
    name: 'revoke',
    aliases: ['resetlink'],
    desc: 'Reset group invite link',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m) {
      await sock.groupRevokeInvite(m.chat)
      await m.reply('Group link reset.')
    }
  },
  {
    name: 'setname',
    aliases: ['subject'],
    desc: 'Change group name',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .setname Gideon Hub')
      await sock.groupUpdateSubject(m.chat, text)
      await m.reply('Group name updated.')
    }
  },
  {
    name: 'setdesc',
    aliases: ['gdesc'],
    desc: 'Change group description',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m, { text }) {
      if (!text) return m.reply('Example: .setdesc rules here')
      await sock.groupUpdateDescription(m.chat, text)
      await m.reply('Group description updated.')
    }
  },
  {
    name: 'group',
    aliases: ['gc'],
    desc: 'Open or close the group',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m, { args }) {
      const mode = (args[0] || '').toLowerCase()
      if (!['open', 'close'].includes(mode)) return m.reply('Example: .group open | .group close')
      await sock.groupSettingUpdate(m.chat, mode === 'open' ? 'not_announcement' : 'announcement')
      await m.reply(mode === 'open' ? 'Group opened.' : 'Group closed.')
    }
  },
  {
    name: 'welcome',
    aliases: ['setwelcome'],
    desc: 'Toggle welcome message',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { args, text, store }) {
      const db = store.get()
      const mode = (args[0] || '').toLowerCase()
      if (mode === 'on') db.welcome[m.chat] = text.replace(/^on\s*/i, '') || true
      else if (mode === 'off') delete db.welcome[m.chat]
      else return m.reply('Example: .welcome on Welcome to the group | .welcome off')
      store.save()
      await m.reply(`Welcome ${mode}.`)
    }
  },
  {
    name: 'goodbye',
    aliases: ['left', 'setgoodbye'],
    desc: 'Toggle goodbye message',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { args, text, store }) {
      const db = store.get()
      const mode = (args[0] || '').toLowerCase()
      if (mode === 'on') db.goodbye[m.chat] = text.replace(/^on\s*/i, '') || true
      else if (mode === 'off') delete db.goodbye[m.chat]
      else return m.reply('Example: .goodbye on Bye | .goodbye off')
      store.save()
      await m.reply(`Goodbye ${mode}.`)
    }
  },
  {
    name: 'antilink',
    aliases: ['nolink'],
    desc: 'Toggle anti-link',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { args, store }) {
      const db = store.get()
      const mode = (args[0] || '').toLowerCase()
      if (!['on', 'off'].includes(mode)) return m.reply('Example: .antilink on | .antilink off')
      if (mode === 'on') db.antilink[m.chat] = true
      else delete db.antilink[m.chat]
      store.save()
      await m.reply(`Antilink ${mode}.`)
    }
  },
  {
    name: 'antitoxic',
    aliases: ['antibad'],
    desc: 'Toggle anti-toxic',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { args, store }) {
      const db = store.get()
      const mode = (args[0] || '').toLowerCase()
      if (!['on', 'off'].includes(mode)) return m.reply('Example: .antitoxic on | .antitoxic off')
      if (mode === 'on') db.antitoxic[m.chat] = true
      else delete db.antitoxic[m.chat]
      store.save()
      await m.reply(`Antitoxic ${mode}.`)
    }
  },
  {
    name: 'autosticker',
    aliases: ['autos'],
    desc: 'Auto convert images to stickers',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { args, store }) {
      const db = store.get()
      const mode = (args[0] || '').toLowerCase()
      if (!['on', 'off'].includes(mode)) return m.reply('Example: .autosticker on | .autosticker off')
      if (mode === 'on') db.autosticker[m.chat] = true
      else delete db.autosticker[m.chat]
      store.save()
      await m.reply(`Autosticker ${mode}.`)
    }
  },
  {
    name: 'mute',
    aliases: ['silence'],
    desc: 'Mute bot in this group',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { store }) {
      const db = store.get()
      db.mute[m.chat] = true
      store.save()
      await m.reply('Bot muted in this group.')
    }
  },
  {
    name: 'unmute',
    aliases: ['unsilence'],
    desc: 'Unmute bot in this group',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m, { store }) {
      const db = store.get()
      delete db.mute[m.chat]
      store.save()
      await m.reply('Bot unmuted in this group.')
    }
  },
  {
    name: 'groupinfo',
    aliases: ['gcinfo', 'infogc'],
    desc: 'Show group information',
    category: 'group',
    group: true,
    async run(sock, m) {
      const meta = await metadata(sock, m)
      const admins = meta.participants.filter((p) => p.admin)
      await m.reply(
        `*${meta.subject}*\n` +
          `ID: ${meta.id}\n` +
          `Members: ${meta.participants.length}\n` +
          `Admins: ${admins.length}\n` +
          `Created: ${meta.creation ? new Date(meta.creation * 1000).toUTCString() : '-'}\n` +
          `Desc: ${meta.desc || '-'}`
      )
    }
  },
  {
    name: 'listadmin',
    aliases: ['admins'],
    desc: 'List group admins',
    category: 'group',
    group: true,
    async run(sock, m) {
      const meta = await metadata(sock, m)
      const admins = meta.participants.filter((p) => p.admin)
      const text = admins.map((p, i) => `${i + 1}. @${fn.cleanJid(p.id)}`).join('\n')
      await sock.sendMessage(m.chat, { text: `*Admins*\n${text}`, mentions: admins.map((p) => p.id) })
    }
  }
]
