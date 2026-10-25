const os = require('os')
const config = require('../config')
const fn = require('../functions')

function groupByCategory(commands) {
  const groups = {}
  for (const cmd of commands) {
    const cat = (cmd.category || 'other').toLowerCase()
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(cmd)
  }
  return groups
}

function titleCase(value) {
  return String(value || '').replace(/\b\w/g, (c) => c.toUpperCase())
}

module.exports = {
  name: 'menu',
  aliases: ['help', 'list', 'gideon'],
  desc: 'Show all bot commands',
  category: 'general',
  async run(sock, m, { prefix, commands }) {
    const grouped = groupByCategory(commands)
    const lines = [
      `Owner : ${config.ownerName}`,
      `Prefix : ${prefix}`,
      `Uptime : ${fn.runtime(process.uptime())}`,
      `RAM : ${fn.formatSize(os.totalmem() - os.freemem())} / ${fn.formatSize(os.totalmem())}`,
      `Time : ${fn.clockString()}`,
      ''
    ]

    const order = ['general', 'owner', 'group', 'download', 'convert', 'media', 'tools', 'fun', 'ai', 'search', 'other']
    const cats = [...new Set([...order, ...Object.keys(grouped)])]
    for (const cat of cats) {
      const list = grouped[cat]
      if (!list || !list.length) continue
      lines.push(titleCase(cat))
      for (const cmd of list.sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(` ${prefix}${cmd.name}`)
      }
      lines.push('')
    }

    await m.reply(lines.join('\n').replace(/\n+$/, ''))
    await sock.sendButtons(m.chat, 'Gideon links', { quoted: m._msg })
  }
}
