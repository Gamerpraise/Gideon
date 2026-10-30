const store = require('../store')
const { THEMES, box, themeId } = require('../style')

function preview() {
  const rows = THEMES.map((t, i) => {
    const sample = box('.menu\n.ping\n.alive', 'GIDEON', t)
    return `*${i + 1}. ${t.name}*${themeId() === i + 1 ? '  ✅ active' : ''}\n${sample}`
  })
  return `🎨 *GIDEON THEMES*\n\n${rows.join('\n\n')}\n\nPick one with *.theme <number>*\nExample: .theme 5 • Reset: .theme 1`
}

module.exports = [
  {
    name: 'theme',
    aliases: ['themes'],
    desc: 'Change how the bot styles its messages: .theme / .theme 3',
    category: 'owner',
    owner: true,
    async run(sock, m, { args }) {
      if (sock.isSub) return m.reply('Only the main Gideon owner can change the theme.')
      const q = (args[0] || '').toLowerCase()
      if (!q) {
        // sent raw so the preview is not wrapped in the active theme
        return sock.sendMessage(m.chat, { text: preview() }, { quoted: m._msg, skipStyle: true })
      }
      let id = /^\d+$/.test(q) ? Number(q) : THEMES.findIndex((t) => t.name.toLowerCase() === q) + 1
      if (q === 'default' || q === 'reset') id = 1
      if (!id || id < 1 || id > THEMES.length) return m.reply(`Pick a number from 1 to ${THEMES.length}. Send .theme to see them all.`)
      store.get().theme = id
      store.save()
      await m.reply(`Theme changed to ${id}. ${THEMES[id - 1].name}\nThis is how every message looks now. Send .menu to see it.`)
    }
  }
]
