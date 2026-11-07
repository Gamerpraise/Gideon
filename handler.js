const fs = require('fs')
const path = require('path')
const serialize = require('./serialize')
const config = require('./config')
const store = require('./store')
const fn = require('./functions')
const autoreply = require('./autoreply')
const guard = require('./guard')
const levels = require('./levels')
const premium = require('./premium')

const commands = new Map()
const aliases = new Map()
const commandDir = path.join(__dirname, 'commands')

function clearRequire(file) {
  try {
    delete require.cache[require.resolve(file)]
  } catch {}
}

function registerCommand(mod) {
  if (!mod || !mod.name || typeof mod.run !== 'function') return
  const names = [mod.name, ...(mod.aliases || [])].map((n) => String(n).toLowerCase())
  commands.set(mod.name.toLowerCase(), mod)
  for (const name of names) {
    const owner = aliases.get(name)
    if (owner && owner !== mod.name.toLowerCase()) console.warn(`[commands] "${name}" is used by both ${owner} and ${mod.name}, the latter wins`)
    aliases.set(name, mod.name.toLowerCase())
  }
}

function loadCommands() {
  commands.clear()
  aliases.clear()
  if (!fs.existsSync(commandDir)) fs.mkdirSync(commandDir, { recursive: true })
  const files = fs.readdirSync(commandDir).filter((f) => f.endsWith('.js'))
  for (const file of files) {
    const full = path.join(commandDir, file)
    try {
      clearRequire(full)
      const mod = require(full)
      if (Array.isArray(mod)) mod.forEach(registerCommand)
      else registerCommand(mod)
    } catch (err) {
      console.error(`[commands] failed to load ${file}:`, err.message)
    }
  }
  console.log(`[commands] loaded ${commands.size} command(s) from ${files.length} file(s)`)
}

function watchCommands() {
  return
}

function getCommand(name) {
  const key = aliases.get(String(name || '').toLowerCase())
  return key ? commands.get(key) : null
}

function listCommands() {
  return [...commands.values()]
}

function parseCommand(text) {
  if (!text) return null
  const body = String(text).replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim()
  if (!body.toLowerCase().startsWith(String(config.prefix).toLowerCase())) return null
  const [cmd, ...args] = body.slice(config.prefix.length).trim().split(/ +/)
  return { cmd: (cmd || '').toLowerCase(), args, text: args.join(' ') }
}

function isBanned(jid) {
  return store.get().banned.includes(fn.cleanJid(jid))
}

// Extra owners (added with .addowner) can only use these owner commands. Everything else stays with the main owner.
// Co-owners (.addowner) get the exact same command access as the main owner - adding one is a
// deliberate, main-owner-only decision (see commands/owner.js), so there is no smaller
// whitelist here to second-guess that trust.
const banNotice = new Map()

// AFK: tell people when someone they tag/reply to is away, and welcome the user back
async function afkCheck(sock, m) {
  const afk = store.get().afk || {}
  const mine = m.senderIds.concat(m.sender).map(fn.cleanJid).find((id) => afk[id])
  if (mine && !m.body.toLowerCase().startsWith(`${config.prefix}afk`)) {
    const since = fn.runtime((Date.now() - afk[mine].time) / 1000)
    delete afk[mine]
    store.set('afk', afk)
    await m.reply(`Welcome back. You were away for ${since}.`)
  }
  const targets = [...(m.mentionedJid || []), m.quoted?.sender].filter(Boolean)
  for (const t of targets) {
    const id = fn.cleanJid(t)
    if (afk[id]) {
      const since = fn.runtime((Date.now() - afk[id].time) / 1000)
      await m.reply(`@${id} is AFK (${afk[id].reason || 'no reason'}) for ${since}.`, { mentions: [t] })
    }
  }
}

async function handleMessage(sock, msg) {
  try {
    if (!msg.message) return
    if (msg.key.remoteJid === 'status@broadcast') return
    const m = serialize(sock, msg)
    if (!m.body && !m.quoted) {
      // voice notes have no text: the auto-reply may still answer them
      if (m.mtype === 'audioMessage' && !isBanned(m.sender)) { if (premium.featureAllowed('autoreply', sock)) await autoreply.checkVoice(sock, m).catch(() => {}) }
      return
    }
    // resolve hidden @lid senders to a phone jid when Baileys knows the mapping
    if (m.sender.endsWith('@lid')) {
      const pn = await fn.resolvePN(sock, m.sender)
      if (pn && pn !== m.sender) {
        m.senderIds.push(m.sender)
        m.sender = pn
      }
    }
    // on a paired user's bot only their own account is the owner (never the main owner's number)
    const ids = [m.sender, ...m.senderIds]
    m.isMainOwner = m.fromMe || (!sock.isSub && fn.isMainOwner(ids))
    m.isOwner = m.fromMe || (!sock.isSub && fn.isOwner(ids))
    m.isCoOwner = m.isOwner && !m.isMainOwner
    if (!m.isOwner && ids.some(isBanned)) {
      // tell banned people once in a while when they try a command, otherwise stay quiet
      const early = parseCommand(m.body)
      if (early && getCommand(early.cmd)) {
        const key = `${m.chat}:${fn.cleanJid(m.sender)}`
        if (Date.now() - (banNotice.get(key) || 0) > 5000) {
          banNotice.set(key, Date.now())
          await m.reply('🚫 You have been banned from using this bot.').catch(() => {})
        }
      }
      return
    }

    const db = store.get()
    // group protection runs first: a muted or private-mode bot must still delete links
    if (m.isGroup && (await guard.antilink(sock, m).catch((err) => { console.log('[antilink]', err.message); return false }))) return
    if (!db.public && !m.isOwner) return

    if (m.isGroup) {
      const groupSettings = {
        antilink: db.antilink[m.chat],
        antitoxic: db.antitoxic[m.chat],
        autosticker: db.autosticker[m.chat],
        mute: db.mute[m.chat]
      }
      if (groupSettings.mute && !m.isOwner) return
      if (await guard.check(sock, m)) return
      if (groupSettings.antitoxic) {
        const toxic = /(fuck|shit|bitch|asshole|nigga|stupid|idiot|bastard|pussy|dick)/i
        if (toxic.test(m.body) && !m.isOwner) {
          await sock.sendMessage(m.chat, { delete: m.key })
          await sock.sendMessage(m.chat, { text: `Keep it clean @${fn.cleanJid(m.sender)}`, mentions: [m.sender] })
        }
      }
      if (groupSettings.autosticker && (m.mtype === 'imageMessage' || m.mtype === 'videoMessage') && !m.body.startsWith(config.prefix)) {
        try {
          const { Sticker, StickerTypes } = require('wa-sticker-formatter')
          const buffer = await m.download()
          const sticker = new Sticker(buffer, {
            pack: config.packName,
            author: config.packAuthor,
            type: StickerTypes.FULL,
            quality: 70
          })
          await sock.sendMessage(m.chat, await sticker.toMessage(), { quoted: msg })
        } catch {}
      }
    }

    await afkCheck(sock, m)
    const parsed = parseCommand(m.body)
    const command = parsed ? getCommand(parsed.cmd) : null
    if (!command) {
      if (parsed) console.log(`[cmd] unknown: ${parsed.cmd}`)
      levels.onMessage(sock, m).catch(() => {})
      if (premium.featureAllowed('autoreply', sock)) await autoreply.check(sock, m).catch((err) => console.log('[autoreply]', err.message))
      return
    }

    m.command = parsed.cmd
    m.text = parsed.text
    m.args = parsed.args
    console.log(`[cmd] ${parsed.cmd} from ${m.sender} in ${m.chat}`)

    if (command.owner && !m.isOwner) {
      return m.reply('This command is owner only.')
    }
    if (command.dangerous && config.ownerIsDefault && !m.fromMe) {
      return m.reply('For safety this command only works from the bot account itself until you set your own owner number in config.local.json (see README).')
    }
    // paired people only get what is marked subSafe; a Gideon Cloud user is the main bot of their own number, so they get
    // every owner command except the developer ones (command.dev)
    if (command.owner && sock.isSub) {
      if (sock.isCloud) {
        if (command.dev) return m.reply('You are not allowed to use this command.')
      } else if (!command.subSafe) {
        return m.reply('This command is only available on the main Gideon bot.')
      }
    }
    if (command.group && !m.isGroup) {
      return m.reply('This command can only be used in groups.')
    }
    if (command.private && m.isGroup) {
      return m.reply('This command can only be used in private chat.')
    }
    if (command.admin && m.isGroup) {
      const metadata = await sock.groupMetadata(m.chat)
      const admins = await fn.getGroupAdmins(metadata.participants)
      if (!fn.isInList(admins, [m.sender, ...m.senderIds]) && !m.isOwner) {
        return m.reply('This command is for group admins.')
      }
    }
    if (command.botAdmin && m.isGroup) {
      const metadata = await sock.groupMetadata(m.chat)
      const admins = await fn.getGroupAdmins(metadata.participants)
      const isBotAdmin = fn.isInList(admins, [sock.user?.id, sock.user?.lid].filter(Boolean))
      if (!isBotAdmin) {
        return m.reply('I need to be a group admin to run this.')
      }
    }

    // Owner settings like this one are main-bot-only to CHANGE (see commands/settings.js,
    // owner: true with no subSafe) but apply to every paired account too once set - a paired
    // user can't flip it themselves, but gets the same behavior the main owner chose.
    // Platform layer (see premium.js): admin switches, FREE/PREMIUM tier, and the server-side Premium check.
    // Economy mode: when the admin selects GLOBAL, the local economy commands run their Global Network twin.
    const target = premium.economyRedirect(command, getCommand) || command
    const verdict = await premium.gate(target, sock)
    if (!verdict.allow) return m.reply(verdict.message)
    if (config.autoTyping) sock.sendPresenceUpdate('composing', m.chat).catch(() => {})
    await target.run(sock, m, { args: parsed.args, text: parsed.text, prefix: config.prefix, commands: listCommands(), config, store, fn })
  } catch (err) {
    console.error('[handler]', err)
    try {
      await sock.sendMessage(msg.key.remoteJid, { text: `Command error\n${err.message || err}` })
    } catch {}
  }
}

module.exports = {
  registerCommand,
  loadCommands,
  watchCommands,
  getCommand,
  listCommands,
  handleMessage
}
