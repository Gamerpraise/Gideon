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
const net = require('./network')
const devqueue = require('./devqueue')
const premium = require('./premium')
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
function createBot({ id, sessionDir, isSub = false, cloud = false, pairingNumber = '', onPairCode = null, onPairFail = null, onQr = null }) {
  const msgRetryCounterCache = new NodeCache({ stdTTL: 600, checkperiod: 120, useClones: false })
  const messageCache = new NodeCache({ stdTTL: 1800, checkperiod: 300, useClones: false })
  const sentMessageCache = new NodeCache({ stdTTL: 1800, checkperiod: 300, useClones: false })
  const processedIds = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false })
  const groupCache = new NodeCache({ stdTTL: 300, checkperiod: 120, useClones: false })

  // status / lastError / openedAt / logs are read by cloud.js (GIDEON CLOUD). Logs hold status lines only, never credentials.
  const ctl = { id, isSub, cloud, sock: null, sessionDir, stopped: false, startedAt: Date.now(), status: 'connecting', lastError: '', openedAt: 0, logs: [] }
  ctl.note = (text) => {
    ctl.logs.push(`${new Date().toISOString()} ${text}`)
    if (ctl.logs.length > 200) ctl.logs.shift()
    console.log(`[${id}] ${text}`)
  }
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
    // Owner-set (.autobio), applies to every paired account too - same pattern as the other
    // automation toggles below.
    if (bioTimer) return
    const run = async () => {
      const bio = store.get().autobio
      if (!bio?.enabled || !sock.user || !premium.featureAllowed('autobio')) return
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
    ctl.status = 'connecting'
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

    // Same cascade as the rest of this file's owner settings: ghost mode itself can only be
    // toggled from the main bot (see commands/ghost.js, owner: true, no subSafe), and it never
    // touches a paired account's own WhatsApp privacy settings - only the main account's, since
    // only the main sock ever runs the command - but the resulting quiet behavior (skip
    // auto-read/auto-online/etc below) now applies to every paired account too.
    const ghost = store.get().ghost
    const sock = B.makeWASocket({
      ...(version ? { version } : {}),
      logger,
      browser: B.Browsers.ubuntu('Chrome'),
      auth: { creds: state.creds, keys: B.makeCacheableSignalKeyStore(state.keys, logger) },
      msgRetryCounterCache,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      markOnlineOnConnect: config.alwaysOnline && !ghost,
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
        // Captured for anyone who passed onQr (currently .pair), so people who can't type a
        // pairing code into WhatsApp can scan instead - both work for the same pairing attempt.
        if (onQr) onQr(qr)
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
        ctl.status = 'online'
        ctl.lastError = ''
        ctl.openedAt = Date.now()
        ctl.note(`WhatsApp confirmed the login (${sock.user?.id ? fn.cleanJid(sock.user.id) : 'unknown'})`)
        if (pairTimer) clearTimeout(pairTimer)
        pairTimer = null
        console.log(`[${id}] connected as ${sock.user?.id}`)
        // Persisted so .ping/.runtime show how long THIS WhatsApp session has been linked, not
        // how long the current node process has been up - .update restarts the process (and so
        // resets process.uptime()) but keeps the same session, and this should keep counting.
        {
          const db = store.get()
          db.sessionStarts = db.sessionStarts || {}
          if (!db.sessionStarts[id]) {
            db.sessionStarts[id] = Date.now()
            store.save()
          }
        }
        const quiet = store.get().ghost
        if (config.alwaysOnline && !quiet) sock.sendPresenceUpdate('available').catch(() => {})
        else if (quiet) sock.sendPresenceUpdate('unavailable').catch(() => {})
        followChannel(sock).catch(() => {})
        if (!isSub) devqueue.start(sock)
        if (!isSub) premium.start(manager)
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

        // .autobio is an owner setting (see commands/settings.js-style gating), so it applies
        // to every paired account too, same as the other automation toggles below.
        startBio(sock)
        if (isSub) welcomeSub(sock).catch(() => {})
        else {
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

        ctl.openedAt = 0
        if (status === B.DisconnectReason.loggedOut) {
          // A real logout, not a .update restart (which keeps valid creds and never reaches
          // here). If this account had joined the shared network, tell the server to drop
          // its data now, otherwise a fresh re-pair would leave an orphaned record behind.
          const netState = store.get().network?.[id]
          if (netState?.joined && sock.user?.id) {
            net.leave(fn.cleanJid(sock.user.id)).catch(() => {})
            delete store.get().network[id]
            store.save()
          }
          if (store.get().sessionStarts?.[id]) {
            delete store.get().sessionStarts[id]
            store.save()
          }
          if (cloud) {
            // The user logged this device out of WhatsApp: the saved session is dead and must not stay on the server.
            // cloud.js removes the files + record through the hook; the dashboard tells the user the bot was removed.
            ctl.status = 'error'
            ctl.lastError = 'WhatsApp logged this device out. The session was deleted. Generate a new Session ID to add the bot again.'
            ctl.note('logged out by WhatsApp, session deleted')
            ctl.stopped = true
            Promise.resolve()
              .then(() => manager.cloud.onLoggedOut && manager.cloud.onLoggedOut(id))
              .catch((err) => console.log(`[${id}] cloud cleanup failed: ${err.message}`))
              .finally(() => { try { ctl.sock?.end?.(undefined) } catch {} ; if (bots.get(id) === ctl) bots.delete(id) })
          } else if (isSub) {
            console.log(`[${id}] user unlinked the device, removing session`)
            manager.remove(id).catch(() => {})
          } else console.log('[session] logged out. Replace the files in ./session with a fresh creds.json and restart.')
          return
        }
        if (status === B.DisconnectReason.connectionReplaced) {
          ctl.status = 'error'
          ctl.lastError = 'This session is open somewhere else. Close the other copy, then press Restart.'
          ctl.note('session replaced by another connection')
          console.log(`[${id}] this session is open in ANOTHER place (old panel, Heroku, your PC...). Stop the other one, then restart.`)
          return
        }
        if (status === B.DisconnectReason.restartRequired) return scheduleRestart(500)
        retries += 1
        ctl.status = 'connecting'
        ctl.note(`connection closed (${status || 'unknown'}), retrying`)
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
          if (config.autoStatusView && premium.featureAllowed('autostatus')) sock.readMessages([msg.key]).catch(() => {})
          if (config.autoStatusReact && premium.featureAllowed('statusreact') && msg.key.participant) {
            sock
              .sendMessage(
                'status@broadcast',
                { react: { text: fn.pickRandom(config.statusEmojis), key: msg.key } },
                { statusJidList: [msg.key.participant, B.jidNormalizedUser(sock.user.id)] }
              )
              .catch(() => {})
          }
          // Owner setting, applies to every paired account too - each one saves to its OWN
          // DM-to-self (sock.getOwnerJid() below resolves per-account), not the main owner's.
          if (config.autoSaveStatus && premium.featureAllowed('autosavestatus') && msg.message) {
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
        if (config.autoRead && msg.key?.remoteJid) sock.readMessages([msg.key]).catch(() => {})
        handler.handleMessage(sock, msg).catch((err) => console.error('[handler]', err))
      }
    })

    sock.ev.on('messages.update', async (updates) => {
      if (!store.get().antidelete || !premium.featureAllowed('antidelete')) return // restricted by platform policy (see commandpolicy)
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
      if (!config.autoRejectCall || !premium.featureAllowed('anticall')) return
      const MAX = 3
      for (const call of calls) {
        if (call.status !== 'offer' || call.isGroup) continue
        try {
          const from = call.from || call.chatId
          let pn = from
          try {
            pn = (await fn.resolvePN(sock, from)) || from
          } catch {}
          const aliases = [from, pn, call.chatId, call.callerPn].filter(Boolean)
          if (fn.isOwner(aliases)) continue // never block the owner or co-owners
          await sock.rejectCall(call.id, from).catch(() => {})
          const db = store.get()
          db.callWarns = db.callWarns || {}
          // The same caller can show up as a @lid one time and a phone jid the next, so the
          // count is kept under every id we know and the highest one wins. Otherwise it
          // could restart at 1 each time and never reach 3.
          const keys = [...new Set(aliases.map(fn.cleanJid).filter(Boolean))]
          const count = Math.max(0, ...keys.map((k) => db.callWarns[k] || 0)) + 1
          if (count >= MAX) {
            for (const k of keys) delete db.callWarns[k]
            store.save()
            await sock.sendMessage(from, { text: `🚫 ${config.botName} does not accept calls.\nYou called ${MAX} times after being warned, so you have been blocked.` }).catch(() => {})
            const res = await fn.setBlock(sock, from, 'block', aliases)
            console.log(`[anticall] block ${keys.join('/')}: ${res.ok ? (res.verified ? 'confirmed' : 'sent') : `failed (${res.error})`}`)
          } else {
            for (const k of keys) db.callWarns[k] = count
            store.save()
            await sock.sendMessage(from, { text: `📵 ${config.botName} doesn't accept calls at the moment.\nPlease send a message instead.\n\n⚠️ Warning ${count}/${MAX}: ${MAX} calls and you will be blocked.` })
          }
        } catch (err) {
          console.log('[anticall]', err.message)
        }
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
    ctl.status = 'offline'
    ctl.openedAt = 0
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
  // cloud bots (GIDEON CLOUD) are not paired users: .pair / .listpaired / limits never see them
  listSubs: () => [...bots.values()].filter((b) => b.isSub && !b.cloud),

  startMain() {
    const ctl = createBot({ id: 'main', sessionDir: prepareMainSession() })
    bots.set('main', ctl)
    ctl.start().catch((err) => {
      console.error('[main] start failed', err)
      setTimeout(() => ctl.start().catch(() => {}), 10000)
    })
  },

  // bring back every paired user after a restart / update. Starting up to maxSubBots (now 20)
  // Baileys connections all at once at boot is what used to crash the process on a cold start -
  // each one is a real websocket + auth handshake, so they're staggered a couple seconds apart.
  startSaved() {
    if (!fs.existsSync(subRoot)) return
    const dirs = fs.readdirSync(subRoot)
    let delay = 0
    for (const dir of dirs) {
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
      setTimeout(() => {
        const ctl = createBot({ id: dir, sessionDir: full, isSub: true })
        bots.set(dir, ctl)
        ctl.start().catch((err) => console.error(`[${dir}] start failed`, err))
        console.log(`[pair] restored ${dir}`)
      }, delay)
      delay += 2500
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
      let settled = false
      let latestQr = null
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        manager.remove(num).catch(() => {})
        reject(new Error('Could not get a pairing code in time. Try again.'))
      }, 60000)
      const ctl = createBot({
        id: num,
        sessionDir: dir,
        isSub: true,
        pairingNumber: num,
        onQr: (qr) => {
          latestQr = qr
        },
        onPairCode: (code) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          // the QR for this same pairing attempt almost always arrives before the code does,
          // since it fires as soon as the socket connects, well before the 3s pairing-code delay
          resolve({ code, qr: latestQr })
        },
        onPairFail: (err) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(err)
        }
      })
      bots.set(num, ctl)
      ctl.start().catch((err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      })
    })
  },

  // ---- GIDEON CLOUD (used only by cloud.js). Each cloud bot has its own folder and its own WhatsApp session.
  cloud: {
    // (re)create the connection from the session folder; any older connection with this id is closed first
    async open(id, sessionDir) {
      const old = bots.get(id)
      if (old && !old.cloud) throw new Error('That bot id belongs to a paired user.')
      if (old) await old.stop()
      const ctl = createBot({ id, sessionDir, isSub: true, cloud: true })
      bots.set(id, ctl)
      ctl.note('starting')
      ctl.start().catch((err) => {
        ctl.status = 'error'
        ctl.lastError = 'Could not start this bot.'
        ctl.note(`start failed: ${err.message}`)
      })
      return ctl
    },
    async stop(id) {
      const ctl = bots.get(id)
      if (!ctl || !ctl.cloud) return false
      await ctl.stop()
      ctl.note('stopped')
      return true
    },
    // closes the connection and logs the linked device out of WhatsApp; cloud.js deletes the files
    async close(id) {
      const ctl = bots.get(id)
      if (!ctl || !ctl.cloud) return false
      await ctl.stop({ logout: true })
      bots.delete(id)
      return true
    }
  },

  async remove(id, { logout = false } = {}) {
    const ctl = bots.get(id)
    if (!ctl || !ctl.isSub || ctl.cloud) return false
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
  try {
    require('./cloud').start(manager)
  } catch (err) {
    console.error('[cloud] could not start:', err.message)
  }
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
