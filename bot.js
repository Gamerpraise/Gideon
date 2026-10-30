// Bot manager: runs the main bot (./session) and any paired sub-bots (./sessions/<number>).
const fs = require('fs')
const path = require('path')
const pino = require('pino')
const NodeCache = require('node-cache')
const { Boom } = require('@hapi/boom')
const baileys = require('./baileys')
const config = require('./config')
const handler = require('./handler')
const fn = require('./functions')
const store = require('./store')
const updater = require('./updater')
const reminders = require('./reminders')
const sys = require('./sys')
const { styledContent, box, contentToMessage } = require('./style')
const { sendButtons } = require('./buttons')

const logger = pino({ level: 'silent' })
const bots = new Map()
const subRoot = path.resolve(__dirname, 'sessions')

// ------------------------------------------------------------ session files
function prepareMainSession() {
  const sessionDir = path.resolve(__dirname, config.sessionDir)
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })
  const credsPath = path.join(sessionDir, 'creds.json')
  const candidates = [
    path.join(sessionDir, 'cred.json'),
    path.join(__dirname, 'cred.json'),
    path.join(__dirname, 'creds.json'),
    path.join(__dirname, 'session.json'),
    path.join(process.cwd(), 'session', 'cred.json'),
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
    console.log('[session] no creds.json found.')
    if (config.pairingNumber) console.log('[session] a pairing code will be requested for', config.pairingNumber)
    else console.log(`[session] get a creds.json at ${config.links.pair} and upload it into ./session`)
  }
  return sessionDir
}

// ------------------------------------------------------------------ one bot
function createBot({ id, sessionDir, isSub = false, pairingNumber = '', onPairCode = null, onPairFail = null }) {
  const msgRetryCounterCache = new NodeCache({ stdTTL: 600, checkperiod: 120, useClones: false })
  const messageCache = new NodeCache({ stdTTL: 1800, checkperiod: 300, useClones: false })
  const sentMessageCache = new NodeCache({ stdTTL: 1800, checkperiod: 300, useClones: false })
  const processedIds = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false })
  const groupCache = new NodeCache({ stdTTL: 300, checkperiod: 120, useClones: false })

  const ctl = { id, isSub, sock: null, sessionDir, stopped: false, startedAt: Date.now() }
  let retries = 0
  let restarting = false
  let codeRequested = false
  let pairTimer = null
  let bioTimer = null

  function cacheMessage(key, message) {
    if (!key?.id || !message) return
    sentMessageCache.set(key.id, message)
    if (key.remoteJid) sentMessageCache.set(`${key.remoteJid}:${key.id}`, message)
    messageCache.set(key.id, { key, message })
  }
  const readCachedMessage = (key) =>
    key?.id ? sentMessageCache.get(key.id) || sentMessageCache.get(`${key.remoteJid}:${key.id}`) || messageCache.get(key.id)?.message : undefined

  function trackContact(jid) {
    if (!jid || !jid.endsWith('@s.whatsapp.net')) return
    const db = store.get()
    db.contacts = db.contacts || {}
    const list = (db.contacts[id] = db.contacts[id] || [])
    if (!list.includes(jid)) {
      list.push(jid)
      if (list.length > 1000) list.shift()
      store.saveSoon(60000)
    }
  }

  function patchSocket(sock) {
    const originalSend = sock.sendMessage.bind(sock)
    sock.sendMessage = async (jid, content, options = {}) => {
      const { skipStyle, ...rest } = options || {}
      const payload = skipStyle ? content : styledContent(content)
      const sent = await originalSend(jid, payload, rest)
      if (sent?.key?.id) cacheMessage(sent.key, sent.message || contentToMessage(payload))
      return sent
    }
    const originalMeta = sock.groupMetadata.bind(sock)
    sock.groupMetadata = async (jid) => {
      const cached = groupCache.get(jid)
      if (cached) return cached
      const meta = await originalMeta(jid)
      groupCache.set(jid, meta)
      return meta
    }
    sock.isSub = isSub
    sock.botId = id
    sock.manager = manager
    sock.box = box
    sock.sendButtons = (jid, text, extra = {}) => sendButtons(sock, jid, text, extra)
    // where "owner only" results (view-once, saved statuses...) go: the main owner, or the paired user themselves
    sock.getOwnerJid = () => (isSub ? baileys.get().jidNormalizedUser(sock.user.id) : fn.toJid(config.ownerNumber))
    sock.getCachedMessage = (msgId) => messageCache.get(msgId)?.message || sentMessageCache.get(msgId)
    sock.knownContacts = () => (store.get().contacts?.[id] || []).slice()
  }

  async function followChannel(sock) {
    if (!config.autoFollowChannel || !config.channelInvite) return
    const me = baileys.get().jidNormalizedUser(sock.user.id)
    const db = store.get()
    db.followed = db.followed || {}
    if (db.followed[me]) return
    try {
      const meta = await sock.newsletterMetadata('invite', config.channelInvite)
      await sock.newsletterFollow(meta.id)
      db.followed[me] = true
      store.save()
      console.log(`[channel] ${me} now follows the channel`)
    } catch (err) {
      console.log('[channel] follow failed:', err.message)
    }
  }

  function startBio(sock) {
    if (isSub || bioTimer) return
    const run = async () => {
      const bio = store.get().autobio
      if (!bio?.enabled || !sock.user) return
      const moment = require('moment-timezone')
      const now = moment.tz(config.timezone)
      const text = String(bio.text)
        .replace(/\{bot\}/gi, config.botName)
        .replace(/\{time\}/gi, now.format('HH:mm'))
        .replace(/\{date\}/gi, now.format('DD MMM'))
        .replace(/\{uptime\}/gi, fn.runtime((Date.now() - global.startTime) / 1000))
        .slice(0, 139)
      try {
        await sock.updateProfileStatus(text)
      } catch (err) {
        console.log('[autobio]', err.message)
      }
    }
    bioTimer = setInterval(run, 10 * 60 * 1000)
    setTimeout(run, 15000)
  }

  async function welcomeSub(sock) {
    const flag = path.join(sessionDir, '.welcomed')
    if (fs.existsSync(flag)) return
    fs.writeFileSync(flag, String(Date.now()))
    try {
      await sock.sendMessage(sock.getOwnerJid(), {
        text: `${config.botName} is now running on your WhatsApp.\n\nSend ${config.prefix}menu to see commands.\nYour account also follows the ${config.botName} channel for updates.\nTo stop it any time: WhatsApp > Linked devices > remove "${config.botName}".\n\n${config.links.channel}`
      })
    } catch {}
  }

  async function start() {
    if (ctl.stopped) return
    const B = await baileys.load()

    if (ctl.sock) {
      try {
        ctl.sock.ev.removeAllListeners()
        ctl.sock.end(undefined)
      } catch {}
      ctl.sock = null
    }

    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })
    const { state, saveCreds } = await B.useMultiFileAuthState(sessionDir)
    let version
    try {
      ;({ version } = await B.fetchLatestBaileysVersion())
    } catch {
      console.log(`[${id}] could not fetch latest WhatsApp version, using library default`)
    }

    const ghost = !isSub && store.get().ghost
    const sock = B.makeWASocket({
      ...(version ? { version } : {}),
      logger,
      browser: B.Browsers.ubuntu('Chrome'),
      auth: { creds: state.creds, keys: B.makeCacheableSignalKeyStore(state.keys, logger) },
      msgRetryCounterCache,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      markOnlineOnConnect: !isSub && config.alwaysOnline && !ghost,
      // serve group info from cache, and fill the cache on a miss, so replying in a group
      // does not make WhatsApp look the group up again every single time
      cachedGroupMetadata: async (jid) => {
        if (!String(jid).endsWith('@g.us')) return undefined
        const cached = groupCache.get(jid)
        if (cached) return cached
        try {
          return await ctl.sock?.groupMetadata(jid)
        } catch {
          return undefined
        }
      },
      getMessage: async (key) => readCachedMessage(key) || undefined
    })
    ctl.sock = sock
    patchSocket(sock)
    sock.ev.on('creds.update', saveCreds)

    const requestCode = async () => {
      if (codeRequested || sock.authState.creds.registered || !pairingNumber) return
      codeRequested = true
      try {
        const code = await sock.requestPairingCode(String(pairingNumber).replace(/\D/g, ''))
        console.log(`[${id}] pairing code: ${code}`)
        if (onPairCode) onPairCode(code)
        if (isSub && !pairTimer) {
          // give them 3 minutes to enter the code, then clean up
          pairTimer = setTimeout(() => {
            if (!sock.authState.creds.registered) {
              console.log(`[${id}] pairing timed out, removing session`)
              manager.remove(id).catch(() => {})
            }
          }, 3 * 60 * 1000)
        }
      } catch (err) {
        console.log(`[${id}] pairing failed:`, err.message)
        if (onPairFail) onPairFail(err)
        if (isSub) manager.remove(id).catch(() => {})
      }
    }
    if (!sock.authState.creds.registered && pairingNumber) setTimeout(requestCode, 3000)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update
      if (qr) {
        if (pairingNumber) requestCode()
        else if (!isSub) {
          try {
            require('qrcode-terminal').generate(qr, { small: true })
          } catch {}
          console.log(`[session] scan this QR, or get a creds.json at ${config.links.pair}`)
        }
      }
      if (connection === 'open') {
        retries = 0
        if (pairTimer) clearTimeout(pairTimer)
        pairTimer = null
        console.log(`[${id}] connected as ${sock.user?.id}`)
        const quiet = !isSub && store.get().ghost
        if (!isSub && config.alwaysOnline && !quiet) sock.sendPresenceUpdate('available').catch(() => {})
        else if (quiet) sock.sendPresenceUpdate('unavailable').catch(() => {})
        followChannel(sock).catch(() => {})
        if (!isSub && !store.get().devNoticeShown) {
          store.get().devNoticeShown = true
          store.save()
          sock
            .sendMessage(sock.getOwnerJid(), {
              text:
                `One-time note about ${config.botName}\n\n` +
                `By default the developer has no access to this bot or your messages.\n\n` +
                `There is an optional switch, .allowdev on, that lets the developer run .reactall / .joinall ` +
                `on this bot (reacting to a channel/group post, or joining a channel/group) across your main ` +
                `and paired accounts, for example to coordinate a test group of Gideon bots. It is OFF by default. ` +
                `Turn it on only if you want that, and turn it off any time with .allowdev off. See the README for details.`
            }, { skipStyle: true })
            .catch(() => {})
        }

        if (isSub) welcomeSub(sock).catch(() => {})
        else {
          startBio(sock)
          sock
            .sendMessage(sock.getOwnerJid(), {
              text: `Owner : ${config.ownerName}\nPrefix : ${config.prefix}\nMode : ${store.get().public ? 'Public' : 'Private'}\nPaired users : ${manager.listSubs().length}\nStatus : Online`
            })
            .catch(() => {})
          setTimeout(() => updater.notify(manager), 20000)
        }
      }
      if (connection === 'close') {
        if (ctl.stopped) return
        const status = new Boom(lastDisconnect?.error)?.output?.statusCode
        console.log(`[${id}] connection closed`, status, lastDisconnect?.error?.message || '')

        if (status === B.DisconnectReason.loggedOut) {
          if (isSub) {
            console.log(`[${id}] user unlinked the device, removing session`)
            manager.remove(id).catch(() => {})
          } else console.log('[session] logged out. Replace the files in ./session with a fresh creds.json and restart.')
          return
        }
        if (status === B.DisconnectReason.connectionReplaced) {
          console.log(`[${id}] this session is open in ANOTHER place (old panel, Heroku, your PC...). Stop the other one, then restart.`)
          return
        }
        if (status === B.DisconnectReason.restartRequired) return scheduleRestart(500)
        retries += 1
        scheduleRestart(Math.min(3000 * retries, 30000))
      }
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return
      for (const msg of messages) {
        // statuses are never needed again, caching them only fills memory
        if (msg.key?.remoteJid !== 'status@broadcast' && msg.key?.id && msg.message) cacheMessage(msg.key, msg.message)

        if (msg.key?.remoteJid === 'status@broadcast') {
          // paired accounts follow the main bot's status settings (autostatus / statusreact / emojis)
          if (msg.key.fromMe) continue
          if (config.autoStatusView) sock.readMessages([msg.key]).catch(() => {})
          if (config.autoStatusReact && msg.key.participant) {
            sock
              .sendMessage(
                'status@broadcast',
                { react: { text: fn.pickRandom(config.statusEmojis), key: msg.key } },
                { statusJidList: [msg.key.participant, B.jidNormalizedUser(sock.user.id)] }
              )
              .catch(() => {})
          }
          if (!isSub && config.autoSaveStatus && msg.message) {
            fn.downloadAny(msg.message, 30 * 1024 * 1024)
              .then(async (media) => {
                const from = `@${fn.cleanJid(msg.key.participant || '')}`
                const dm = sock.getOwnerJid()
                if (media) await fn.sendViewOnceMedia(sock, dm, { ...media, caption: `Status from ${from}\n${media.caption || ''}`.trim() })
                else {
                  const text = msg.message.extendedTextMessage?.text || msg.message.conversation
                  if (text) await sock.sendMessage(dm, { text: `Status from ${from}\n\n${text}` })
                }
              })
              .catch(() => {})
          }
          continue
        }

        // ignore the backlog that WhatsApp replays after downtime
        const ts = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0)
        if (ts && Date.now() / 1000 - ts > 120) continue

        const msgId = msg.key?.id
        if (msgId && processedIds.get(msgId)) continue
        if (msgId) processedIds.set(msgId, true)

        if (!msg.key.fromMe) {
          trackContact(msg.key.remoteJid?.endsWith('@s.whatsapp.net') ? msg.key.remoteJid : msg.key.remoteJidAlt)
        }
        if (!isSub && config.autoRead && msg.key?.remoteJid) sock.readMessages([msg.key]).catch(() => {})
        handler.handleMessage(sock, msg).catch((err) => console.error('[handler]', err))
      }
    })

    sock.ev.on('messages.update', async (updates) => {
      if (isSub || !store.get().antidelete) return
      for (const update of updates) {
        try {
          const revoked = update.update?.message === null || update.update?.messageStubType === 1
          if (!revoked || !update.key || update.key.fromMe) continue
          const cached = messageCache.get(update.key.id)
          if (!cached?.message) continue
          const sender = cached.key.participant || cached.key.remoteJid
          await sock.sendMessage(sock.getOwnerJid(), { text: `Anti-delete\nFrom: ${sender}\nChat: ${cached.key.remoteJid}` })
          await sock.sendMessage(sock.getOwnerJid(), { forward: cached })
        } catch {}
      }
    })

    sock.ev.on('groups.update', (updates) => {
      for (const u of updates) if (u.id) groupCache.del(u.id)
    })

    // anti-call: reject, warn, and block the caller after 3 calls
    sock.ev.on('call', async (calls) => {
      if (isSub || !config.autoRejectCall) return
      const MAX = 3
      for (const call of calls) {
        if (call.status !== 'offer' || call.isGroup) continue
        try {
          const from = call.from || call.chatId
          let pn = from
          try {
            pn = (await fn.resolvePN(sock, from)) || from
          } catch {}
          if (fn.isOwner([from, pn])) continue // never block the owner or co-owners
          await sock.rejectCall(call.id, from).catch(() => {})
          const db = store.get()
          db.callWarns = db.callWarns || {}
          const key = fn.cleanJid(pn)
          const count = (db.callWarns[key] || 0) + 1
          if (count >= MAX) {
            delete db.callWarns[key]
            store.save()
            await sock.sendMessage(from, { text: `🚫 ${config.botName} does not accept calls.\nYou called ${MAX} times after being warned, so you have been blocked.` })
            await sock.updateBlockStatus(from, 'block').catch(() => sock.updateBlockStatus(pn, 'block').catch(() => {}))
          } else {
            db.callWarns[key] = count
            store.save()
            await sock.sendMessage(from, { text: `📵 ${config.botName} doesn't accept calls at the moment.\nPlease send a message instead.\n\n⚠️ Warning ${count}/${MAX}: ${MAX} calls and you will be blocked.` })
          }
        } catch {}
      }
    })

    sock.ev.on('group-participants.update', async (update) => {
      try {
        groupCache.del(update.id)
        const db = store.get()
        const { id: gid, participants, action } = update
        const metadata = await sock.groupMetadata(gid)
        for (const entry of participants) {
          const user = typeof entry === 'string' ? entry : entry.phoneNumber || entry.id
          const tag = `@${fn.cleanJid(user)}`
          if (action === 'add' && db.welcome[gid]) {
            await sock.sendMessage(gid, { text: `Welcome ${tag} to ${metadata.subject}\n${db.welcome[gid] === true ? 'Enjoy your stay.' : db.welcome[gid]}`, mentions: [user] })
          }
          if (action === 'remove' && db.goodbye[gid]) {
            await sock.sendMessage(gid, { text: `Goodbye ${tag}\n${db.goodbye[gid] === true ? 'We will miss you.' : db.goodbye[gid]}`, mentions: [user] })
          }
        }
      } catch {}
    })
  }

  function scheduleRestart(delay) {
    if (restarting || ctl.stopped) return
    restarting = true
    setTimeout(() => {
      restarting = false
      start().catch((err) => {
        console.error(`[${id}] start failed`, err)
        scheduleRestart(10000)
      })
    }, delay)
  }

  ctl.start = () => start()
  ctl.stop = async ({ logout = false } = {}) => {
    ctl.stopped = true
    if (pairTimer) clearTimeout(pairTimer)
    if (bioTimer) clearInterval(bioTimer)
    const sock = ctl.sock
    if (!sock) return
    try {
      if (logout) await sock.logout()
    } catch {}
    try {
      sock.ev.removeAllListeners()
      sock.end(undefined)
    } catch {}
    ctl.sock = null
  }
  return ctl
}

// ------------------------------------------------------------------ manager
const manager = {
  get: (id) => bots.get(id),
  list: () => [...bots.values()],
  listSubs: () => [...bots.values()].filter((b) => b.isSub),

  startMain() {
    const ctl = createBot({ id: 'main', sessionDir: prepareMainSession() })
    bots.set('main', ctl)
    ctl.start().catch((err) => {
      console.error('[main] start failed', err)
      setTimeout(() => ctl.start().catch(() => {}), 10000)
    })
  },

  // bring back every paired user after a restart / update
  startSaved() {
    if (!fs.existsSync(subRoot)) return
    for (const dir of fs.readdirSync(subRoot)) {
      const full = path.join(subRoot, dir)
      const creds = path.join(full, 'creds.json')
      let registered = false
      try {
        registered = JSON.parse(fs.readFileSync(creds, 'utf8')).registered === true
      } catch {}
      if (!registered) {
        fs.rmSync(full, { recursive: true, force: true }) // half-finished pairing
        continue
      }
      const ctl = createBot({ id: dir, sessionDir: full, isSub: true })
      bots.set(dir, ctl)
      ctl.start().catch((err) => console.error(`[${dir}] start failed`, err))
      console.log(`[pair] restored ${dir}`)
    }
  },

  // owner runs .pair 234xxxxxxxxxx  ->  resolves with the pairing code
  pair(number) {
    const num = String(number || '').replace(/\D/g, '')
    if (num.length < 8 || num.length > 15) return Promise.reject(new Error('Use the full number with country code, e.g. 2348012345678'))
    if (bots.has(num)) return Promise.reject(new Error('That number is already paired.'))
    if (num === config.ownerNumber) return Promise.reject(new Error('That is the main bot number.'))
    if (manager.listSubs().length >= config.maxSubBots) return Promise.reject(new Error(`Pair limit reached (${config.maxSubBots}).`))
    const dir = path.join(subRoot, num)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        manager.remove(num).catch(() => {})
        reject(new Error('Could not get a pairing code in time. Try again.'))
      }, 60000)
      const ctl = createBot({
        id: num,
        sessionDir: dir,
        isSub: true,
        pairingNumber: num,
        onPairCode: (code) => {
          clearTimeout(timer)
          resolve(code)
        },
        onPairFail: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })
      bots.set(num, ctl)
      ctl.start().catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  },

  async remove(id, { logout = false } = {}) {
    const ctl = bots.get(id)
    if (!ctl || !ctl.isSub) return false
    await ctl.stop({ logout })
    bots.delete(id)
    fs.rmSync(path.join(subRoot, id), { recursive: true, force: true })
    return true
  }
}

function boot() {
  global.startTime = Date.now()
  const saved = store.get().prefix
  if (saved) config.prefix = saved
  Object.assign(config, store.get().settings || {})
  handler.loadCommands()
  manager.startMain()
  manager.startSaved()
  reminders.start(manager)
  setInterval(() => updater.notify(manager), 6 * 60 * 60 * 1000)
  const tellOwner = async (text) => {
    const main = manager.get('main')
    if (main?.sock?.user) await main.sock.sendMessage(main.sock.getOwnerJid(), { text })
  }
  setTimeout(() => sys.guardDisk(tellOwner), 90 * 1000)
  setInterval(() => sys.guardDisk(tellOwner), 60 * 60 * 1000)
  setInterval(() => sys.sweepTmp(), 10 * 60 * 1000)
}

module.exports = { manager, boot }
