// Owner only. Lets other people run Gideon on their own WhatsApp.
//   .pair 2348012345678     gives a pairing code for that number
//   .listpaired             who is paired
//   .unpair 2348012345678   stop it for that person (and log the device out)
module.exports = [
  {
    name: 'pair',
    aliases: ['adduser', 'linkuser'],
    desc: 'Owner: give a number a pairing code to run Gideon on their WhatsApp',
    category: 'owner',
    owner: true,
    dangerous: true,
    async run(sock, m, { args, config }) {
      if (!args[0]) return m.reply(`Example: ${config.prefix}pair 2348012345678\n(country code, no + or spaces)`)
      await m.react('⏳')
      try {
        const code = await sock.manager.pair(args[0])
        const pretty = String(code).replace(/(.{4})(?=.)/, '$1-')
        await m.react('✅')
        await m.reply(
          `Pairing code for ${args[0].replace(/\D/g, '')}\n\n${pretty}\n\nTell them:\nWhatsApp > Settings > Linked devices > Link a device > Link with phone number instead, then type the code.\nIt expires in about 3 minutes.\n\nThey are letting ${config.botName} read and send messages on their account, and they can remove it any time from Linked devices. It also follows the ${config.botName} channel.`
        )
        await sock.sendMessage(m.chat, { text: pretty }, { skipStyle: true })
      } catch (err) {
        await m.react('❌')
        await m.reply(`Could not pair.\n${err.message || err}`)
      }
    }
  },
  {
    name: 'listpaired',
    aliases: ['paired', 'pairlist'],
    desc: 'Owner: list paired users',
    category: 'owner',
    owner: true,
    async run(sock, m, { config }) {
      const subs = sock.manager.listSubs()
      if (!subs.length) return m.reply(`No paired users yet. Use ${config.prefix}pair <number>`)
      const lines = subs.map((b, i) => `${i + 1}. ${b.id} ${b.sock?.user ? '(online)' : '(offline)'}`)
      await m.reply(`Paired users ${subs.length}/${config.maxSubBots}\n\n${lines.join('\n')}`)
    }
  },
  {
    name: 'unpair',
    aliases: ['removeuser', 'unlinkuser'],
    desc: 'Owner: remove a paired user',
    category: 'owner',
    owner: true,
    dangerous: true,
    async run(sock, m, { args }) {
      const id = String(args[0] || '').replace(/\D/g, '')
      if (!id) return m.reply('Example: .unpair 2348012345678')
      const ok = await sock.manager.remove(id, { logout: true })
      await m.reply(ok ? `Removed ${id}. Their linked device is logged out.` : 'That number is not paired.')
    }
  }
]
