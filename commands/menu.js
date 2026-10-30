const fs = require('fs')
const path = require('path')
const os = require('os')
const config = require('../config')
const fn = require('../functions')
const { menuText } = require('../style')

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

let botImage = null
function getBotImage() {
  if (botImage !== null) return botImage || null
  try {
    botImage = fs.readFileSync(path.join(__dirname, '..', 'assets', 'gideon.jpg'))
  } catch {
    botImage = false
  }
  return botImage || null
}

module.exports = {
  name: 'menu',
  aliases: ['help', 'list', 'gideon'],
  desc: 'Show all bot commands',
  category: 'general',
  async run(sock, m, { prefix, commands }) {
    const grouped = groupByCategory(commands)
    const stats = [
      `Owner : ${config.ownerName}`,
      `Prefix : ${prefix}`,
      `Uptime : ${fn.runtime(process.uptime())}`,
      `RAM : ${fn.formatSize(os.totalmem() - os.freemem())} / ${fn.formatSize(os.totalmem())}`,
      `Time : ${fn.clockString()}`
    ]
    const order = ['general', 'owner', 'group', 'download', 'convert', 'media', 'tools', 'fun', 'economy', 'ai', 'search', 'other']
    const cats = [...new Set([...order, ...Object.keys(grouped)])]
    const sections = cats
      .filter((cat) => grouped[cat]?.length)
      .map((cat) => ({ name: titleCase(cat), cmds: grouped[cat].map((c) => c.name).sort((a, b) => a.localeCompare(b)) }))

    // ONE message: bot image on top, themed menu as the text, link buttons at the bottom
    const body = menuText({ stats, sections, prefix })
    await sock.sendButtons(m.chat, body, { quoted: m._msg, image: getBotImage(), skipBox: true })
  }
}
