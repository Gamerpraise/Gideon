// Keeps your WhatsApp About line fresh. Updates every 10 minutes (WhatsApp does not like faster).
//   .autobio on | off
//   .autobio set Gideon online • {time} • {date}     ({bot} {time} {date} {uptime})
module.exports = {
  name: 'autobio',
  aliases: ['bioclock'],
  desc: 'Owner: auto-update your About line with a live clock',
  category: 'owner',
  owner: true,
  async run(sock, m, { args, text, store, prefix }) {
    const db = store.get()
    const mode = (args[0] || '').toLowerCase()
    db.autobio = db.autobio || { enabled: false, text: '{bot} online • {time} • {date}' }
    if (mode === 'on' || mode === 'off') {
      db.autobio.enabled = mode === 'on'
      store.save()
      return m.reply(`Auto bio ${mode}.\nText: ${db.autobio.text}`)
    }
    if (mode === 'set') {
      const value = text.replace(/^set\s*/i, '').trim()
      if (!value) return m.reply(`Example: ${prefix}autobio set Gideon online • {time} • {date}`)
      db.autobio.text = value.slice(0, 139)
      store.save()
      return m.reply(`Saved.\n${db.autobio.text}`)
    }
    await m.reply(`Auto bio: ${db.autobio.enabled ? 'on' : 'off'}\nText: ${db.autobio.text}\n\n${prefix}autobio on | off | set <text>`)
  }
}
