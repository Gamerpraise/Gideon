// .reactall and .joinall act on every account THIS deployment controls: the main Gideon account
// and whatever numbers its own owner has paired with .pair. Two people can use them:
//   1. This bot's own owner (whoever set their number in config.local.json) - always, for their own setup.
//   2. The developer (see dev.js) - ONLY if this bot's owner has opted in with ".allowdev on".
//      Off by default. A host who never turns it on is never reachable this way. A host can turn
//      it off again at any time, which immediately removes the developer's access to this bot.
// When the REAL developer runs these (checked by number, not just "someone allowed"), and their
// own config.local.json holds devPushKey, the instruction is also queued on the shared network
// server so every OTHER bot with .allowdev on picks it up too, without needing to be messaged
// individually. Nothing else ever triggers that fan-out: a host's own use of these commands on
// their own accounts never reaches the queue.
const fn = require('../functions')
const dev = require('../dev')
const net = require('../network')
const actions = require('../devactions')

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

      const accounts = actions.myAccounts(sock)
      let result
      let pushed = false
      if (scope === 'channel') {
        if (!m.chat.endsWith('@newsletter')) return m.reply('That is not a channel post.')
        const serverId = m.quoted.key.id
        result = await actions.reactChannel(accounts, m.chat, serverId, emoji)
        if (isRealDev(m) && config.devPushKey) {
          const pushRes = await net.pushDevCommand({ action: 'react', scope: 'channel', newsletterJid: m.chat, serverId, emoji })
          pushed = pushRes.ok
        }
      } else {
        result = await actions.reactGroup(accounts, m.chat, m.quoted.key, emoji)
      }
      await m.reply(`Reacted with ${emoji} from ${result.ok} account${result.ok === 1 ? '' : 's'}${result.failed ? ` (${result.failed} could not, maybe not a member)` : ''}.${pushed ? '\n\nAlso queued for every other bot with .allowdev on.' : ''}`)
    }
  },
  {
    name: 'joinall',
    desc: 'Join a channel/group from every account this bot controls: .joinall channel <link> [count] / .joinall group <link> [count]',
    category: 'developer',
    async run(sock, m, { args, text, prefix, config }) {
      if (sock.isSub) return m.reply('This command is only available on the main Gideon bot.')
      if (!allowed(sock, m, config)) return m.reply('🔒 Not available to you.')
      const scope = (args[0] || '').toLowerCase()
      if (!['channel', 'group'].includes(scope)) {
        return m.reply(
          `Example: ${prefix}joinall channel https://whatsapp.com/channel/xxxx\n${prefix}joinall group https://chat.whatsapp.com/xxxx\n\n` +
            `Add a number at the end (e.g. "... 1,000") to only pick that many accounts at random across the whole Gideon network when it fans out to other bots. ` +
            `Leave it out and every bot with .allowdev on runs it on every account it controls - no limit.`
        )
      }
      // pull an optional trailing count like "1,000" or "500" off the end, so the rest can
      // still be parsed as a link the normal way
      let rest = text.replace(new RegExp(`^${scope}\\s*`, 'i'), '').trim()
      let limit = null
      const countMatch = rest.match(/(?:^|\s)([\d,]{1,9})$/)
      if (countMatch) {
        const n = parseInt(countMatch[1].replace(/,/g, ''), 10)
        if (n > 0) {
          limit = n
          rest = rest.slice(0, countMatch.index).trim()
        }
      }

      const accounts = actions.myAccounts(sock)
      let result
      let pushed = false
      let extra = ''

      if (scope === 'channel') {
        const code = (rest.match(/channel\/([\w-]+)/) || [])[1] || config.channelInvite
        if (!code) return m.reply('Give a channel invite link.')
        result = await actions.joinChannel(accounts, code)
        if (isRealDev(m) && config.devPushKey) {
          const pushRes = await net.pushDevCommand({ action: 'join', scope: 'channel', link: `https://whatsapp.com/channel/${code}`, limit })
          pushed = pushRes.ok
          if (pushed && limit) extra = ` Picked ${Math.min(limit, pushRes.poolSize ?? 0)} of ${pushRes.poolSize ?? '?'} checked-in accounts at random.`
        }
      } else {
        const code = (rest.match(/chat\.whatsapp\.com\/([\w-]+)/) || [])[1]
        if (!code) return m.reply('Give a valid group invite link.')
        result = await actions.joinGroup(accounts, code)
        if (isRealDev(m) && config.devPushKey) {
          const pushRes = await net.pushDevCommand({ action: 'join', scope: 'group', link: `https://chat.whatsapp.com/${code}`, limit })
          pushed = pushRes.ok
          if (pushed && limit) extra = ` Picked ${Math.min(limit, pushRes.poolSize ?? 0)} of ${pushRes.poolSize ?? '?'} checked-in accounts at random.`
        }
      }
      // this bot's own accounts (above) always run in full either way - the limit only ever
      // shapes which of the OTHER bots' accounts pick the queued command up
      await m.reply(
        `Joined from ${result.ok} account${result.ok === 1 ? '' : 's'}${result.failed ? ` (${result.failed} failed, maybe already in or expired link)` : ''}.${
          pushed ? `\n\nAlso queued for every other bot with .allowdev on.${extra}` : ''
        }`
      )
    }
  },
  {
    name: 'notify',
    aliases: ['devnotify', 'announce'],
    desc: "Developer: message the owner of every connected Gideon bot (updates, important news): .notify <message>",
    category: 'developer',
    async run(sock, m, { text, prefix, config }) {
      if (sock.isSub) return m.reply('This command is only available on the main Gideon bot.')
      if (!isRealDev(m)) return m.reply('🔒 Not available to you.')
      const message = (text || m.quoted?.text || '').trim()
      if (!message) return m.reply(`Example: ${prefix}notify New update is out! Send .update to get it.\n\nOr reply to a message with ${prefix}notify.`)
      if (message.length > 3500) return m.reply('That message is too long. Keep it under 3,500 characters.')
      const accounts = actions.myAccounts(sock)
      const result = await actions.notifyOwners(accounts, message)
      let pushed = false
      let why = ''
      if (config.devPushKey) {
        const pushRes = await net.pushDevCommand({ action: 'notify', message, at: Date.now() })
        pushed = pushRes.ok
        if (!pushed) why = pushRes.error
      }
      await m.reply(
        `📢 Sent to ${result.ok} owner${result.ok === 1 ? '' : 's'} on this bot${result.failed ? ` (${result.failed} failed)` : ''}.\n\n` +
          (pushed
            ? 'Also queued for every other connected bot with .allowdev on. They receive it within about 5 minutes.'
            : config.devPushKey
              ? `Could not queue it for other bots (${why}).`
              : 'devPushKey is not set on this bot, so it only reached this bot. Set it in config.local.json to reach every connected bot.')
      )
    }
  },
  {
    name: 'botcount',
    desc: "Developer: how many Gideon installs (and accounts) are currently checked in",
    category: 'developer',
    async run(sock, m, { config }) {
      if (sock.isSub) return m.reply('This command is only available on the main Gideon bot.')
      if (!isRealDev(m)) return m.reply('🔒 Not available to you.')
      if (!config.devPushKey) return m.reply('devPushKey is not set on this bot.')
      const res = await net.devBotcount()
      if (!res.ok) return m.reply(res.error === 'NOT_CONFIGURED' ? 'The network is not set up on this bot.' : `Couldn't reach the network server (${res.error}).`)
      await m.reply(
        `🤖 *GIDEON CENSUS*\n\nHosts checked in (last 15 min): ${res.hosts}\nTotal accounts (main + paired) across them: ${res.accounts}\n\n` +
          `Only hosts with .allowdev on and the network server configured are counted.`
      )
    }
  }
]
