// .reactall and .joinall act on every account THIS deployment controls: the main Gideon account
// and whatever numbers its own owner has paired with .pair. Two people can use them:
//   1. This bot's own owner (whoever set their number in config.local.json) - always, for their own setup.
//   2. The developer (see dev.js) - ONLY if this bot's owner has opted in with ".allowdev on".
//      Off by default. A host who never turns it on is never reachable this way. A host can turn
//      it off again at any time, which immediately removes the developer's access to this bot.
// Neither can ever reach a DIFFERENT installation's accounts: every copy of Gideon is independent.
const fn = require('../functions')
const dev = require('../dev')

function myAccounts(sock) {
  const list = [sock]
  for (const ctl of sock.manager.listSubs()) if (ctl.sock?.user) list.push(ctl.sock)
  return list
}

function isRealDev(m) {
  return [m.sender, ...(m.senderIds || [])].some((id) => fn.cleanJid(id) === dev.number)
}

function allowed(sock, m, config) {
  if (m.isMainOwner) return true // this bot's own owner, acting on their own accounts
  if (isRealDev(m) && config.allowDeveloperActions) return true // developer, only if this host opted in (.allowdev)
  return false
}

module.exports = [
  {
    name: 'reactall',
    desc: 'React to a channel/group post from every account this bot controls: reply + .reactall channel 🔥',
    category: 'developer',
    async run(sock, m, { args, prefix, config }) {
      if (sock.isSub) return m.reply('This command is only available on the main Gideon bot.')
      if (!allowed(sock, m, config)) return m.reply('🔒 Not available to you.')
      const scope = (args[0] || '').toLowerCase()
      const emoji = args[1] || '❤️'
      if (!['channel', 'group'].includes(scope)) return m.reply(`Example: reply to a channel post with ${prefix}reactall channel 🔥\nor reply to a group message with ${prefix}reactall group 👍`)
      if (!m.quoted) return m.reply('Reply to the message you want every account to react to.')

      const accounts = myAccounts(sock)
      let ok = 0
      let failed = 0
      if (scope === 'channel') {
        if (!m.chat.endsWith('@newsletter')) return m.reply('That is not a channel post.')
        const serverId = m.quoted.key.id
        for (const acc of accounts) {
          try {
            await acc.newsletterReactMessage(m.chat, serverId, emoji)
            ok++
          } catch {
            failed++
          }
          await fn.sleep(600)
        }
      } else {
        for (const acc of accounts) {
          try {
            await acc.sendMessage(m.chat, { react: { text: emoji, key: m.quoted.key } })
            ok++
          } catch {
            failed++
          }
          await fn.sleep(600)
        }
      }
      await m.reply(`Reacted with ${emoji} from ${ok} account${ok === 1 ? '' : 's'}${failed ? ` (${failed} could not, maybe not a member)` : ''}.`)
    }
  },
  {
    name: 'joinall',
    desc: 'Join a channel/group from every account this bot controls: .joinall channel <link> / .joinall group <link>',
    category: 'developer',
    async run(sock, m, { args, text, prefix, config }) {
      if (sock.isSub) return m.reply('This command is only available on the main Gideon bot.')
      if (!allowed(sock, m, config)) return m.reply('🔒 Not available to you.')
      const scope = (args[0] || '').toLowerCase()
      if (!['channel', 'group'].includes(scope)) return m.reply(`Example: ${prefix}joinall channel https://whatsapp.com/channel/xxxx\n${prefix}joinall group https://chat.whatsapp.com/xxxx`)

      const accounts = myAccounts(sock)
      let ok = 0
      let failed = 0

      if (scope === 'channel') {
        const link = text.replace(/^channel\s*/i, '').trim()
        const code = (link.match(/channel\/([\w-]+)/) || [])[1] || config.channelInvite
        if (!code) return m.reply('Give a channel invite link.')
        for (const acc of accounts) {
          try {
            const meta = await acc.newsletterMetadata('invite', code)
            await acc.newsletterFollow(meta.id)
            ok++
          } catch {
            failed++
          }
          await fn.sleep(800)
        }
      } else {
        const code = (text.match(/chat\.whatsapp\.com\/([\w-]+)/) || [])[1]
        if (!code) return m.reply('Give a valid group invite link.')
        for (const acc of accounts) {
          try {
            await acc.groupAcceptInvite(code)
            ok++
          } catch {
            failed++
          }
          await fn.sleep(800)
        }
      }
      await m.reply(`Joined from ${ok} account${ok === 1 ? '' : 's'}${failed ? ` (${failed} failed, maybe already in or expired link)` : ''}.`)
    }
  }
]
