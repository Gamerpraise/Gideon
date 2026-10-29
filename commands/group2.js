const fn = require('../functions')

module.exports = [
  {
    name: 'lock',
    aliases: ['close', 'mutegc'],
    desc: 'Lock the group: only admins can send messages',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m) {
      await sock.groupSettingUpdate(m.chat, 'announcement')
      await m.reply('Group locked. Only admins can send messages.')
    }
  },
  {
    name: 'unlock',
    aliases: ['open', 'unmutegc'],
    desc: 'Unlock the group: everyone can send messages',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m) {
      await sock.groupSettingUpdate(m.chat, 'not_announcement')
      await m.reply('Group unlocked. Everyone can send messages.')
    }
  },
  {
    name: 'lockinfo',
    desc: 'Only admins can edit group name, photo and description',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m) {
      await sock.groupSettingUpdate(m.chat, 'locked')
      await m.reply('Group info locked to admins.')
    }
  },
  {
    name: 'unlockinfo',
    desc: 'Everyone can edit group name, photo and description',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m) {
      await sock.groupSettingUpdate(m.chat, 'unlocked')
      await m.reply('Group info unlocked for everyone.')
    }
  },
  {
    name: 'setgrouppp',
    aliases: ['setgpp', 'setgcpp'],
    desc: 'Set group picture from a replied image',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m) {
      const target = m.quoted || m
      if (!/image/.test(target.mtype || '')) return m.reply('Reply an image.')
      await sock.updateProfilePicture(m.chat, await target.download())
      await m.reply('Group picture updated.')
    }
  },
  {
    name: 'disappear',
    aliases: ['ephemeral'],
    desc: 'Disappearing messages: .disappear 24h | 7d | 90d | off',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m, { args }) {
      const map = { '24h': 86400, '7d': 604800, '90d': 7776000, off: 0 }
      const key = (args[0] || '').toLowerCase()
      if (!(key in map)) return m.reply('Example: .disappear 24h | 7d | 90d | off')
      await sock.groupToggleEphemeral(m.chat, map[key])
      await m.reply(`Disappearing messages: ${key}`)
    }
  },
  {
    name: 'approveall',
    aliases: ['approve'],
    desc: 'Approve every pending join request',
    category: 'group',
    group: true,
    admin: true,
    botAdmin: true,
    async run(sock, m) {
      const list = await sock.groupRequestParticipantsList(m.chat)
      if (!list.length) return m.reply('No pending requests.')
      await sock.groupRequestParticipantsUpdate(m.chat, list.map((p) => p.jid || p.phone_number || p.id), 'approve')
      await m.reply(`Approved ${list.length} request(s).`)
    }
  },
  {
    name: 'vcf',
    aliases: ['savecontacts'],
    desc: 'Export group members as a contacts file',
    category: 'group',
    group: true,
    admin: true,
    async run(sock, m) {
      const meta = await sock.groupMetadata(m.chat)
      const rows = meta.participants
        .map((p) => p.phoneNumber || p.jid || (String(p.id).endsWith('@s.whatsapp.net') ? p.id : null))
        .filter(Boolean)
      if (!rows.length) return m.reply('WhatsApp is hiding member numbers in this group, so there is nothing to export.')
      const vcf = rows
        .map((jid, i) => `BEGIN:VCARD\nVERSION:3.0\nFN:${meta.subject} ${i + 1}\nTEL;type=CELL;waid=${fn.cleanJid(jid)}:+${fn.cleanJid(jid)}\nEND:VCARD`)
        .join('\n')
      await sock.sendMessage(m.chat, { document: Buffer.from(vcf), mimetype: 'text/vcard', fileName: `${meta.subject}.vcf` }, { quoted: m._msg })
    }
  }
]
