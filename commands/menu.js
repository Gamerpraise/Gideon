const fs = require('fs')
const path = require('path')
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

// "Owner" -> "𝗢𝘄𝗻𝗲𝗿" (bold sans font), so every heading stands out from the command list
function boldFont(text) {
  return [...String(text)]
    .map((ch) => {
      const c = ch.codePointAt(0)
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d5d4 + c - 65)
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d5ee + c - 97)
      if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ec + c - 48)
      return ch
    })
    .join('')
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
    const lines = [
      `Owner : ${config.ownerName}`,
      `Prefix : ${prefix}`,
      `Uptime : ${fn.runtime(process.uptime())}`,
      `RAM : ${fn.formatSize(os.totalmem() - os.freemem())} / ${fn.formatSize(os.totalmem())}`,
      `Time : ${fn.clockString()}`,
      ''
    ]

    const order = ['general', 'owner', 'group', 'download', 'convert', 'media', 'tools', 'fun', 'economy', 'ai', 'search', 'other']
    const cats = [...new Set([...order, ...Object.keys(grouped)])]
    for (const cat of cats) {
      const list = grouped[cat]
      if (!list || !list.length) continue
      lines.push(`❖ *${boldFont(titleCase(cat))}*`)
      for (const cmd of list.sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(` ${prefix}${cmd.name}`)
      }
      lines.push('')
    }

    // header lines go with the bot image (captions are short), the command list follows as text
    const headerEnd = lines.indexOf('')
    const image = getBotImage()
    if (image) {
      try {
        await sock.sendMessage(m.chat, { image, caption: lines.slice(0, headerEnd).join('\n') }, { quoted: m._msg })
        lines.splice(0, headerEnd + 1)
      } catch {}
    }
    await m.reply(lines.join('\n').replace(/\n+$/, ''))
    await sock.sendButtons(m.chat, 'Gideon links', { quoted: m._msg })
  }
}
