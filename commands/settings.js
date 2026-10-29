// Owner switches. They are saved in database.json and survive restarts.
const toggles = {
  autoread: ['autoRead', 'Auto read messages'],
  autotyping: ['autoTyping', 'Typing indicator'],
  alwaysonline: ['alwaysOnline', 'Always online'],
  autostatus: ['autoStatusView', 'Auto view statuses'],
  anticall: ['autoRejectCall', 'Auto reject calls'],
  statusreact: ['autoStatusReact', 'Auto react to statuses'],
  autosavestatus: ['autoSaveStatus', 'Auto save statuses to your DM']
}

module.exports = [
  {
    name: 'setprefix',
    desc: 'Change the command prefix',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, config, store }) {
      const value = args[0]
      if (!value || value.length > 3) return m.reply('Example: .setprefix !   (1-3 characters)')
      config.prefix = value
      store.set('prefix', value)
      await m.reply(`Prefix changed to ${value}`)
    }
  },
  ...Object.entries(toggles).map(([name, [key, label]]) => ({
    name,
    desc: `${label} on/off`,
    category: 'owner',
    owner: true,
    async run(sock, m, { args, config, store }) {
      const mode = (args[0] || '').toLowerCase()
      if (!['on', 'off'].includes(mode)) return m.reply(`Example: .${name} on | .${name} off\nNow: ${config[key] ? 'on' : 'off'}`)
      config[key] = mode === 'on'
      const db = store.get()
      db.settings = { ...(db.settings || {}), [key]: config[key] }
      store.save()
      await m.reply(`${label}: ${mode}`)
    }
  })),
  {
    name: 'buttons',
    desc: 'Link buttons mode: native (tappable) or text',
    category: 'owner',
    owner: true,
    async run(sock, m, { args, config, store }) {
      const mode = (args[0] || '').toLowerCase()
      if (!['native', 'text'].includes(mode)) return m.reply(`Example: .buttons native | .buttons text\nNow: ${config.buttonMode}`)
      config.buttonMode = mode
      const db = store.get()
      db.settings = { ...(db.settings || {}), buttonMode: mode }
      store.save()
      await m.reply(`Buttons mode: ${mode}`)
    }
  },
  {
    name: 'botstatus',
    aliases: ['settings'],
    desc: 'Show bot switches',
    category: 'owner',
    owner: true,
    async run(sock, m, { config, store }) {
      const lines = Object.entries(toggles).map(([name, [key]]) => `${name}: ${config[key] ? 'on' : 'off'}`)
      await m.reply(`Prefix: ${config.prefix}\nMode: ${store.get().public ? 'public' : 'private'}\nAnti-delete: ${store.get().antidelete ? 'on' : 'off'}\n${lines.join('\n')}`)
    }
  }
]
