const dev = require('../dev')

// The developer's contact. Always shows the real developer, whatever the host put in config.local.json.
module.exports = {
  name: 'devowner',
  aliases: ['developer', 'contactdev', 'gpraise'],
  desc: 'Contact the developer of Gideon',
  category: 'info',
  async run(sock, m, { config }) {
    const vcard =
      'BEGIN:VCARD\nVERSION:3.0\n' +
      `FN:${dev.name} (Developer)\n` +
      `ORG:Gideon Bot;\n` +
      `TEL;type=CELL;type=VOICE;waid=${dev.number}:+${dev.number}\n` +
      'END:VCARD'
    await sock.sendMessage(m.chat, { contacts: { displayName: `${dev.name} (Developer)`, contacts: [{ vcard }] } }, { quoted: m._msg })
    await m.reply(
      `Gideon was built by ${dev.name}\n\nChat: https://wa.me/${dev.number}\nChannel: ${dev.channel}\nYouTube: ${dev.youtube}\nStore: ${dev.store}\nGitHub: ${dev.github}\nSession site: ${dev.pair}`
    )
  }
}
