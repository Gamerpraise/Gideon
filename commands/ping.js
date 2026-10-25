const os = require('os')
const fn = require('../functions')

module.exports = [
  {
    name: 'ping',
    aliases: ['speed'],
    desc: 'Check bot speed',
    category: 'general',
    async run(sock, m) {
      const start = Date.now()
      await m.reply(`Pong ${Date.now() - start}ms\nUptime ${fn.runtime(process.uptime())}`)
    }
  },
  {
    name: 'runtime',
    aliases: ['uptime'],
    desc: 'Bot uptime',
    category: 'general',
    async run(sock, m) {
      await m.reply(`Uptime: ${fn.runtime(process.uptime())}`)
    }
  },
  {
    name: 'alive',
    aliases: ['online'],
    desc: 'Check if the bot is alive',
    category: 'general',
    async run(sock, m, { config }) {
      await m.reply(`${config.botName} is alive.\nOwner: ${config.ownerName}\nTime: ${fn.clockString()}`)
    }
  },
  {
    name: 'owner',
    aliases: ['creator', 'dev'],
    desc: 'Show owner contact',
    category: 'general',
    async run(sock, m, { config }) {
      const vcard =
        'BEGIN:VCARD\n' +
        'VERSION:3.0\n' +
        `FN:${config.ownerName}\n` +
        `ORG:${config.botName}\n` +
        `TEL;type=CELL;type=VOICE;waid=${config.ownerNumber}:+${config.ownerNumber}\n` +
        'END:VCARD'
      await sock.sendMessage(m.chat, {
        contacts: {
          displayName: config.ownerName,
          contacts: [{ vcard }]
        }
      })
      await sock.sendButtons(
        m.chat,
        `${config.botName} Owner\n${config.ownerName}\n+${config.ownerNumber}`,
        { quoted: m._msg }
      )
    }
  },
  {
    name: 'script',
    aliases: ['sc', 'repo'],
    desc: 'Bot info and links',
    category: 'general',
    async run(sock, m, { config }) {
      await sock.sendButtons(
        m.chat,
        `${config.botName}\nA Baileys WhatsApp bot by ${config.ownerName}`,
        { quoted: m._msg }
      )
    }
  },
  {
    name: 'server',
    aliases: ['sys', 'system'],
    desc: 'Server information',
    category: 'general',
    async run(sock, m) {
      await m.reply(
        `*Server*\n` +
          `Platform: ${os.platform()} ${os.arch()}\n` +
          `CPU: ${os.cpus()[0]?.model || 'unknown'}\n` +
          `Cores: ${os.cpus().length}\n` +
          `RAM: ${fn.formatSize(os.totalmem() - os.freemem())} / ${fn.formatSize(os.totalmem())}\n` +
          `Node: ${process.version}\n` +
          `Uptime: ${fn.runtime(os.uptime())}`
      )
    }
  }
]
