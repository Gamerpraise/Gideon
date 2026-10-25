const fs = require('fs')
const path = require('path')
const serialize = require('./serialize')
const config = require('./config')
const store = require('./store')
const fn = require('./functions')

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
  for (const name of names) aliases.set(name, mod.name.toLowerCase())
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

async function handleMessage(sock, msg) {
  try {
    if (!msg.message) return
    if (msg.key.remoteJid === 'status@broadcast') return
    const m = serialize(sock, msg)
    if (!m.body && !m.quoted) return
    if (isBanned(m.sender) && !fn.isOwner(m.sender)) return

    const db = store.get()
    if (!db.public && !fn.isOwner(m.sender) && !m.fromMe) return

    if (m.isGroup) {
      const groupSettings = {
        antilink: db.antilink[m.chat],
        antitoxic: db.antitoxic[m.chat],
        autosticker: db.autosticker[m.chat],
        mute: db.mute[m.chat]
      }
      if (groupSettings.mute && !fn.isOwner(m.sender) && !m.fromMe) return
      if (groupSettings.antilink && fn.isUrl(m.body) && !fn.isOwner(m.sender)) {
        const metadata = await sock.groupMetadata(m.chat)
        const admins = await fn.getGroupAdmins(metadata.participants)
        if (!admins.includes(m.sender)) {
          await sock.sendMessage(m.chat, { delete: m.key })
          await sock.sendMessage(m.chat, { text: `Link detected @${fn.cleanJid(m.sender)}\nLinks are not allowed.`, mentions: [m.sender] })
        }
      }
      if (groupSettings.antitoxic) {
        const toxic = /(fuck|shit|bitch|asshole|nigga|stupid|idiot|bastard|pussy|dick)/i
        if (toxic.test(m.body) && !fn.isOwner(m.sender)) {
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

    console.log(`[in] fromMe=${m.fromMe} chat=${m.chat} body=${JSON.stringify(m.body)}`)
    const parsed = parseCommand(m.body)
    if (!parsed) return
    const command = getCommand(parsed.cmd)
    if (!command) {
      console.log(`[cmd] unknown: ${parsed.cmd}`)
      return
    }

    m.command = parsed.cmd
    m.text = parsed.text
    m.args = parsed.args
    console.log(`[cmd] ${parsed.cmd} from ${m.sender} in ${m.chat}`)

    if (command.owner && !fn.isOwner(m.sender) && !m.fromMe) {
      return m.reply('This command is owner only.')
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
      if (!admins.includes(m.sender) && !fn.isOwner(m.sender)) {
        return m.reply('This command is for group admins.')
      }
    }
    if (command.botAdmin && m.isGroup) {
      const metadata = await sock.groupMetadata(m.chat)
      const admins = await fn.getGroupAdmins(metadata.participants)
      const botNum = fn.cleanJid(sock.user.id)
      const isBotAdmin = admins.some((id) => fn.cleanJid(id) === botNum)
      if (!isBotAdmin) {
        return m.reply('I need to be a group admin to run this.')
      }
    }

    await command.run(sock, m, { args: parsed.args, text: parsed.text, prefix: config.prefix, commands: listCommands(), config, store, fn })
  } catch (err) {
    console.error('[handler]', err)
    try {
      await sock.sendMessage(msg.key.remoteJid, { text: `Command error\n${err.message || err}` })
    } catch {}
  }
}

module.exports = {
  loadCommands,
  watchCommands,
  getCommand,
  listCommands,
  handleMessage
}
