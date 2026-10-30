// Ghost mode changes the privacy settings of the WhatsApp account this bot is linked to.
// ON  : read receipts off, last seen / profile photo / about hidden, online hidden,
//       bot stops auto-reading messages and statuses, appears offline.
// OFF : puts your previous privacy settings back.
// Note: WhatsApp always shows 2 grey ticks (delivered) while your phone or the bot is connected.
// Nothing can make a message stay on one tick without actually being offline.
const DEFAULTS = { readreceipts: 'all', last: 'contacts', online: 'all', profile: 'contacts', status: 'contacts' }
const FLAGS = ['autoRead', 'alwaysOnline', 'autoStatusView', 'autoStatusReact', 'autoTyping']  // saving statuses never marks them as viewed, so it can stay on

async function step(label, fnc, results) {
  try {
    await fnc()
    results.push(`${label}: ok`)
  } catch (err) {
    results.push(`${label}: failed (${err.message || err})`)
  }
}

async function setPrivacy(sock, p, results) {
  await step('read receipts', () => sock.updateReadReceiptsPrivacy(p.readreceipts), results)
  await step('last seen', () => sock.updateLastSeenPrivacy(p.last), results)
  await step('online', () => sock.updateOnlinePrivacy(p.online), results)
  await step('profile photo', () => sock.updateProfilePicturePrivacy(p.profile), results)
  await step('about', () => sock.updateStatusPrivacy(p.status), results)
}

module.exports = [
  {
    name: 'ghost',
    aliases: ['ghostmode'],
    desc: 'Ghost mode on/off: hide blue ticks, last seen, online, photo, about',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, config, store }) {
      const mode = (args[0] || '').toLowerCase()
      const db = store.get()
      if (!['on', 'off', 'status'].includes(mode)) {
        return m.reply(`Example: .ghost on | .ghost off\nNow: ${db.ghost ? 'ON' : 'off'}`)
      }
      if (mode === 'status') return m.reply(`Ghost mode: ${db.ghost ? 'ON' : 'off'}`)

      const results = []
      if (mode === 'on') {
        if (!db.ghost) {
          let current = {}
          try {
            current = (await sock.fetchPrivacySettings(true)) || {}
          } catch {}
          db.ghostBackup = {
            privacy: {
              readreceipts: current.readreceipts || DEFAULTS.readreceipts,
              last: current.last || DEFAULTS.last,
              online: current.online || DEFAULTS.online,
              profile: current.profile || DEFAULTS.profile,
              status: current.status || DEFAULTS.status
            },
            flags: Object.fromEntries(FLAGS.map((k) => [k, config[k]]))
          }
        }
        await setPrivacy(sock, { readreceipts: 'none', last: 'none', online: 'match_last_seen', profile: 'none', status: 'none' }, results)
        for (const k of FLAGS) config[k] = false
        db.settings = { ...(db.settings || {}), ...Object.fromEntries(FLAGS.map((k) => [k, false])) }
        db.ghost = true
        store.save()
        sock.sendPresenceUpdate('unavailable').catch(() => {})
        return m.reply(`Ghost mode ON\n${results.join('\n')}\n\nBlue ticks, last seen, online, photo and about are hidden. The bot no longer auto-reads or shows online. Delivered (2 grey ticks) cannot be hidden.`)
      }

      const backup = db.ghostBackup || { privacy: DEFAULTS, flags: {} }
      await setPrivacy(sock, backup.privacy, results)
      for (const k of FLAGS) if (k in (backup.flags || {})) config[k] = backup.flags[k]
      db.settings = { ...(db.settings || {}), ...(backup.flags || {}) }
      db.ghost = false
      db.ghostBackup = null
      store.save()
      if (config.alwaysOnline) sock.sendPresenceUpdate('available').catch(() => {})
      await m.reply(`Ghost mode off\n${results.join('\n')}\n\nYour previous privacy settings are back.`)
    }
  },
  {
    name: 'privacy',
    desc: 'Show current WhatsApp privacy settings',
    category: 'owner',
    owner: true,
    async run(sock, m) {
      try {
        const p = await sock.fetchPrivacySettings(true)
        await m.reply(Object.entries(p).map(([k, v]) => `${k}: ${v}`).join('\n') || 'No data.')
      } catch (err) {
        await m.reply(`Could not read privacy settings.\n${err.message || err}`)
      }
    }
  }
]
