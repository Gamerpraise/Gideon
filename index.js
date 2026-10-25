const fs = require('fs')
const path = require('path')
const pino = require('pino')
const NodeCache = require('node-cache')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  DisconnectReason,
  jidNormalizedUser
} = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const config = require('./config')
const handler = require('./handler')
const fn = require('./functions')
const store = require('./store')
const { styledContent, box, contentToMessage } = require('./style')
const { sendButtons } = require('./buttons')

const msgRetryCounterCache = new NodeCache({ stdTTL: 600, checkperiod: 120, useClones: false })
const messageCache = new NodeCache({ stdTTL: 3600, checkperiod: 120, useClones: false })
const sentMessageCache = new NodeCache({ stdTTL: 3600, checkperiod: 120, useClones: false })
const processedIds = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false })
const logger = pino({ level: 'silent' })
const startTime = Date.now()
global.startTime = startTime

function prepareSession() {
  const sessionDir = path.resolve(__dirname, config.sessionDir)
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })
  const credsPath = path.join(sessionDir, 'creds.json')
  const candidates = [
    credsPath,
    path.join(sessionDir, 'cred.json'),
    path.join(__dirname, 'cred.json'),
    path.join(__dirname, 'creds.json'),
    path.join(__dirname, 'session.json'),
    path.join(process.cwd(), 'session', 'cred.json'),
    path.join(process.cwd(), 'session', 'creds.json'),
    path.join(process.cwd(), 'cred.json'),
    path.join(process.cwd(), 'creds.json')
  ]
  if (!fs.existsSync(credsPath)) {
    const found = candidates.find((file) => file !== credsPath && fs.existsSync(file))
    if (found) {
      fs.copyFileSync(found, credsPath)
      console.log('[session] copied', found, 'to session/creds.json')
    }
  }
  if (!fs.existsSync(credsPath)) {
    console.log('[session] no creds.json or cred.json found. Upload it into the session folder and restart.')
  }
  return sessionDir
}

const sessionDir = prepareSession()

handler.loadCommands()
handler.watchCommands()

function cacheMessage(key, message) {
  if (!key?.id || !message) return
  sentMessageCache.set(key.id, message)
  if (key.remoteJid) sentMessageCache.set(`${key.remoteJid}:${key.id}`, message)
  messageCache.set(key.id, { key, message })
}

function readCachedMessage(key) {
  if (!key?.id) return undefined
  return (
    sentMessageCache.get(key.id) ||
    sentMessageCache.get(`${key.remoteJid}:${key.id}`) ||
    messageCache.get(key.id)?.message
  )
}

function patchSocket(sock) {
  const originalSend = sock.sendMessage.bind(sock)
  sock.sendMessage = async (jid, content, options = {}) => {
    const { skipStyle, ...rest } = options || {}
    const payload = skipStyle ? content : styledContent(content)
    const sent = await originalSend(jid, payload, rest)
    if (sent?.key?.id) {
      cacheMessage(sent.key, sent.message || contentToMessage(payload))
    }
    return sent
  }
  sock.box = box
  sock.sendButtons = (jid, text, extra = {}) => sendButtons(sock, jid, text, extra)
}

async function notifyOwner(sock) {
  try {
    const owner = fn.toJid(config.ownerNumber)
    await sock.sendMessage(owner, {
      text: `Owner : ${config.ownerName}\nPrefix : ${config.prefix}\nMode : ${store.get().public ? 'Public' : 'Private'}\nStatus : Online`
    })
  } catch (err) {
    console.log('[notify]', err.message)
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    msgRetryCounterCache,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: config.alwaysOnline,
    retryRequestDelayMs: 500,
    getMessage: async (key) => {
      return readCachedMessage(key) || undefined
    }
  })

  patchSocket(sock)
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      console.log('[session] QR received. Place creds.json or cred.json in ./session and restart.')
    }
    if (connection === 'open') {
      console.log(`[${config.botName}] connected as ${sock.user?.id}`)
      console.log(`[${config.botName}] ready. Send .menu or .ping`)
      if (config.alwaysOnline) {
        sock.sendPresenceUpdate('available').catch(() => {})
      }
      notifyOwner(sock).catch(() => {})
    }
    if (connection === 'close') {
      const status = new Boom(lastDisconnect?.error)?.output?.statusCode
      const loggedOut = status === DisconnectReason.loggedOut
      console.log('[connection] closed', status, loggedOut ? '(logged out)' : '')
      if (!loggedOut) {
        setTimeout(startBot, 3000)
      } else {
        console.log('[session] logged out. Upload a fresh creds.json into ./session and restart.')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log(`[msg] ${type} x${messages.length}`)
    for (const msg of messages) {
      if (msg.key?.id && msg.message) cacheMessage(msg.key, msg.message)
      if (msg.key.remoteJid === 'status@broadcast') {
        if (config.autoStatusView) {
          try {
            await sock.readMessages([msg.key])
          } catch {}
        }
        continue
      }
      const id = msg.key?.id
      if (id && processedIds.get(id)) continue
      if (id) processedIds.set(id, true)
      if (config.autoRead && msg.key?.remoteJid) {
        try {
          await sock.readMessages([msg.key])
        } catch {}
      }
      handler.handleMessage(sock, msg).catch((err) => console.error('[handler]', err))
    }
  })

  sock.ev.on('messages.update', async (updates) => {
    const db = store.get()
    if (!db.antidelete) return
    for (const update of updates) {
      if (!update.update.message && update.key && !update.key.fromMe) {
        const cached = messageCache.get(update.key.id)
        if (!cached || !cached.message) continue
        const sender = cached.key.participant || cached.key.remoteJid
        try {
          await sock.sendMessage(fn.toJid(config.ownerNumber), {
            text: `Anti-delete\nFrom: ${sender}\nChat: ${cached.key.remoteJid}`
          })
          await sock.sendMessage(fn.toJid(config.ownerNumber), { forward: cached })
        } catch {}
      }
    }
  })

  sock.ev.on('call', async (calls) => {
    if (!config.autoRejectCall) return
    for (const call of calls) {
      if (call.status === 'offer') {
        try {
          await sock.rejectCall(call.id, call.from)
          await sock.sendMessage(call.from, { text: `${config.botName} does not take calls.` })
        } catch {}
      }
    }
  })

  sock.ev.on('group-participants.update', async (update) => {
    try {
      const db = store.get()
      const { id, participants, action } = update
      const metadata = await sock.groupMetadata(id)
      for (const user of participants) {
        const tag = `@${fn.cleanJid(user)}`
        if (action === 'add' && db.welcome[id]) {
          await sock.sendMessage(id, {
            text: `Welcome ${tag} to ${metadata.subject}\n${db.welcome[id] === true ? 'Enjoy your stay.' : db.welcome[id]}`,
            mentions: [user]
          })
        }
        if (action === 'remove' && db.goodbye[id]) {
          await sock.sendMessage(id, {
            text: `Goodbye ${tag}\n${db.goodbye[id] === true ? 'We will miss you.' : db.goodbye[id]}`,
            mentions: [user]
          })
        }
      }
    } catch {}
  })

  sock.userJid = () => jidNormalizedUser(sock.user.id)
  return sock
}

startBot().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})

process.on('uncaughtException', (err) => console.error('[uncaught]', err))
process.on('unhandledRejection', (err) => console.error('[unhandled]', err))
