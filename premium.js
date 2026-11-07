// Bot side of the Gideon platform layer (policy + Premium). The bot NEVER decides it is premium:
//  - it asks the Global Gideon Network server who it is allowed to be (/premium/authorize, /premium/status),
//  - it keeps a short cache of the server's answers only so a flaky connection does not break every command,
//  - Free commands are never blocked by this file except through the admin's own switches (economy / fun / disabled).
// FREE MODE (subscriptions off): everything works for everyone, premium commands included. PREMIUM MODE: premium commands (or the whole bot, if paid-only is on) need a paid Premium ID.
const fs = require('fs')
const path = require('path')
const net = require('./network')
const store = require('./store')
const config = require('./config')

const FREE_MODE_MESSAGE = 'Gideon Premium is currently unavailable.\nGideon is operating in Free Mode.'
const POLICY_TTL = 60 * 1000
const ENTITLEMENT_TTL = 5 * 60 * 1000
const GRACE_MS = 10 * 60 * 1000 // how long a previous "yes" from the server is trusted if the server is unreachable

let defaults = { commands: [] }
try { defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'commandpolicy.default.json'), 'utf8')) } catch {}
const defaultMap = {}
for (const c of defaults.commands) defaultMap[c.name] = { t: c.defaultTier === 'PREMIUM' ? 'P' : c.defaultTier === 'RESTRICTED' ? 'R' : 'F', e: c.defaultEnabled ? 1 : 0, c: c.class }

const state = {
  settings: { subscriptionEnabled: false, paidOnlyMode: false, paidOnlyFreeCommands: ['subscribe', 'premium'], paystackEnabled: false, premiumCommandsEnabled: true, economyEnabled: true, funEnabled: true, economyMode: 'LOCAL', freeModeMessage: FREE_MODE_MESSAGE },
  commands: null, // from the server; falls back to defaultMap
  policyAt: 0,
  reachable: false
}

// ------------------------------------------------------------------ one premium context per MAIN bot
// The host's main bot (and everyone it pairs) is context 'main'. Every Gideon Cloud bot is the main bot of its own
// owner, so it gets its own context: its own install on the server, its own Premium ID and its own entitlement.
// People paired by a Cloud bot share that Cloud bot's context.
const ctxs = new Map()
const newCtx = (key) => ({ key, entitlement: { active: false, at: 0, expiresAt: 0, premiumId: null }, authCache: { okAt: 0 }, registering: null, timer: null, sock: null })
const mainCtx = newCtx('main')
ctxs.set('main', mainCtx)
Object.defineProperty(state, 'entitlement', { get: () => mainCtx.entitlement, set: (v) => { mainCtx.entitlement = v } })
Object.defineProperty(state, 'authCache', { get: () => mainCtx.authCache, set: (v) => { mainCtx.authCache = v } })
function ctxFor(sock) {
  const key = sock && sock.isCloud ? sock.botId : (sock && sock.parentId) || 'main'
  let c = ctxs.get(key)
  if (!c) { c = newCtx(key); ctxs.set(key, c) }
  if (sock && sock.isCloud) c.sock = sock
  return c
}
const numberOfJid = (jid) => String(jid || '').split(':')[0].split('@')[0].replace(/\D/g, '')
const ownerNumberOf = (c) => (c.key === 'main' ? config.ownerNumber : numberOfJid(c.sock?.user?.id))

// ------------------------------------------------------------------ identity (installId + token issued by the server)
const rootDb = () => (store.root ? store.root() : store.get())
function identity(c) {
  const db = rootDb()
  if (c.key === 'main') {
    db.premium = db.premium || { installId: null, token: null }
    return db.premium
  }
  db.premiumByBot = db.premiumByBot || {}
  return (db.premiumByBot[c.key] = db.premiumByBot[c.key] || { installId: null, token: null })
}
// ensureInstall(accounts, sock): `sock` picks whose identity (host main by default, or a Cloud bot)
async function ensureInstall(accounts, sock) {
  const c = ctxFor(sock)
  const id = identity(c)
  if (id.installId && id.token) return id
  if (!net.configured()) return null
  const owner = ownerNumberOf(c)
  if (!owner) return null // a Cloud bot whose WhatsApp is not connected yet
  if (!c.registering) {
    c.registering = net
      .registerInstall({ ownerNumber: owner, accounts: accounts || [owner], version: require('./package.json').version })
      .then((r) => {
        if (r.ok && r.installId && r.token) {
          id.installId = r.installId
          id.token = r.token
          store.save()
        }
        return id.installId ? id : null
      })
      .finally(() => { c.registering = null })
  }
  return c.registering
}

// ------------------------------------------------------------------ policy
async function refreshPolicy(force) {
  if (!force && Date.now() - state.policyAt < POLICY_TTL) return
  state.policyAt = Date.now()
  const r = await net.policy()
  if (r.ok && r.commands && r.settings) {
    state.commands = r.commands
    state.settings = { ...state.settings, ...r.settings }
    state.reachable = true
    if (typeof r.settings.currencySymbol === 'string') config.currencySymbol = r.settings.currencySymbol
  } else {
    state.reachable = false
  }
}
const entry = (name) => (state.commands && state.commands[name]) || defaultMap[name] || { t: 'F', e: 1, c: 'utility' }

// ------------------------------------------------------------------ entitlement (background features need a sync answer)
async function refreshEntitlement(force, sock) {
  const c = ctxFor(sock)
  if (!force && Date.now() - c.entitlement.at < ENTITLEMENT_TTL) return c.entitlement
  const id = await ensureInstall(null, sock)
  if (!id) return c.entitlement
  const r = await net.premiumStatus(id.installId, id.token)
  if (r.ok) c.entitlement = { active: !!r.active, at: Date.now(), expiresAt: r.expiresAt || 0, premiumId: r.premiumId || null, daysLeft: r.daysLeft, reason: r.reason }
  else if (r.status === 401) { id.installId = null; id.token = null; store.save() } // the server forgot us: register again next time
  return c.entitlement
}
function entitlementActive(c) {
  const e = c.entitlement
  if (!e.active) return false
  if (e.expiresAt && e.expiresAt < Date.now()) return false
  return Date.now() - e.at < GRACE_MS + ENTITLEMENT_TTL
}

// Synchronous answer for background features (auto status view, anti-call, ...).
// `feature` is the name of the command that controls the feature, e.g. "autostatus" or "anticall".
function featureAllowed(feature, sock) {
  const e = entry(feature)
  if (e.t === 'R' || !e.e) return false
  if (e.t !== 'P') return true
  if (!state.settings.subscriptionEnabled) return !!state.settings.premiumCommandsEnabled // Free Mode: everyone gets everything
  return !!(state.settings.premiumCommandsEnabled && entitlementActive(ctxFor(sock)))
}

// ------------------------------------------------------------------ the gate used by handler.js
async function gate(command, sock) {
  const c = ctxFor(sock)
  await refreshPolicy().catch(() => {})
  const name = command.name.toLowerCase()
  const e = entry(name)
  const s = state.settings
  if (e.t === 'R') return { allow: false, message: 'This feature is disabled by Gideon platform policy.' }
  if (!e.e) return { allow: false, message: 'This command is currently disabled by the administrator.' }
  if (e.c === 'economy' && !s.economyEnabled) return { allow: false, message: 'The economy system is currently disabled by the administrator.' }
  if (e.c === 'fun' && !s.funEnabled) return { allow: false, message: 'Fun commands are currently disabled by the administrator.' }
  // Paid-only (Premium Mode + lock-whole-bot): every command is treated as Premium except the admin's free list
  const locked = !!(s.subscriptionEnabled && s.paidOnlyMode && !(s.paidOnlyFreeCommands || ['subscribe', 'premium']).includes(name))
  if (e.t !== 'P' && !locked) return { allow: true }
  if (e.t === 'P' && !s.premiumCommandsEnabled) return { allow: false, message: 'Premium commands are currently disabled by the administrator.' }
  // Free Mode: subscriptions are off, so everyone can use premium commands too
  if (!s.subscriptionEnabled) return { allow: true }

  // Premium: ask the server every time (a successful answer is reused for a minute to keep commands quick)
  if (Date.now() - c.authCache.okAt < 60 * 1000 && s.subscriptionEnabled) return { allow: true }
  const id = await ensureInstall(null, sock)
  if (!id) return { allow: false, message: s.subscriptionEnabled ? 'Could not reach the Gideon network to verify Premium right now. Try again shortly.' : s.freeModeMessage }
  const r = await net.premiumAuthorize(id.installId, id.token, name)
  if (r.ok && r.allow) {
    c.authCache.okAt = Date.now()
    c.entitlement = { ...c.entitlement, active: true, at: Date.now() }
    return { allow: true }
  }
  if (r.ok && r.allow === false) {
    c.authCache.okAt = 0
    if (r.code === 'NOT_PREMIUM' || r.code === 'EXPIRED') c.entitlement = { ...c.entitlement, active: false, at: Date.now() }
    return { allow: false, message: r.message || s.freeModeMessage }
  }
  if (r.status === 401) { id.installId = null; id.token = null; store.save(); return { allow: false, message: 'Premium could not be verified. Try again in a moment.' } }
  // server unreachable: honour a recent "yes", otherwise stay in free mode
  if (c.authCache.okAt && Date.now() - c.authCache.okAt < GRACE_MS) return { allow: true }
  return { allow: false, message: s.subscriptionEnabled ? 'Could not reach the Gideon network to verify Premium right now. Try again shortly.' : s.freeModeMessage }
}

// ------------------------------------------------------------------ economy mode: LOCAL commands follow the admin's mode
const GLOBAL_NAME = { transfer: 'gsend', coinflipbet: 'gcoinflip', leaderboard: 'grichest', richest: 'grichest', poorest: 'gpoorest' }
function economyRedirect(command, getCommand) {
  if (state.settings.economyMode !== 'GLOBAL') return null
  if ((command.category || '') !== 'local economy') return null
  const target = getCommand(GLOBAL_NAME[command.name] || 'g' + command.name)
  return target && target !== command && target.category === 'global economy' ? target : null
}

// ------------------------------------------------------------------ housekeeping loop (main bot only)
function localEconomyStats() {
  const users = store.get().users || {}
  let n = 0, coins = 0
  for (const u of Object.values(users)) if (u && u.eco) { n++; coins += (u.coins || 0) + (u.eco.bank || 0) }
  return { users: n, totalCoins: coins }
}
let timer = null
function start(manager) {
  if (timer) return
  const tick = async () => {
    try {
      await refreshPolicy(true)
      const id = await ensureInstall(accountsOf(manager))
      if (id) {
        await net.registerInstall({ installId: id.installId, token: id.token, ownerNumber: config.ownerNumber, accounts: accountsOf(manager), version: require('./package.json').version, localEconomy: localEconomyStats() })
        await refreshEntitlement(true)
      }
      await require('./plugins').sync().catch(() => {})
    } catch {}
  }
  setTimeout(tick, 5000)
  timer = setInterval(tick, 5 * 60 * 1000)
  timer.unref?.()
  const quick = setInterval(() => refreshPolicy(true).catch(() => {}), POLICY_TTL)
  quick.unref?.()
}
// ---- Cloud bots: each one keeps its own install alive (this is the "I am online" signal that holds its Premium ID)
function startBot(sock, manager) {
  if (!sock || !sock.isCloud) return
  const c = ctxFor(sock)
  if (c.timer) return
  const tick = async () => {
    try {
      await refreshPolicy().catch(() => {})
      if (!state.settings.subscriptionEnabled || !c.sock?.user) return // Free Mode: nothing to hold, nothing to register
      const owner = ownerNumberOf(c)
      const accounts = [owner, ...manager.listChildren(c.key).map((b) => String(b.id).replace(/\D/g, ''))]
      const id = await ensureInstall(accounts, c.sock)
      if (id) {
        await net.registerInstall({ installId: id.installId, token: id.token, ownerNumber: owner, accounts, version: require('./package.json').version })
        await refreshEntitlement(true, c.sock)
      }
    } catch {}
  }
  setTimeout(tick, 15000)
  c.timer = setInterval(tick, 5 * 60 * 1000)
  c.timer.unref?.()
}
// A bot stopped / logged out / was deleted. `release` frees its Premium ID for another WhatsApp number (the ID and its
// expiry are untouched). `forget` also drops this bot's identity (the bot itself is gone).
async function stopBot(key, { release = false, forget = false } = {}) {
  const c = ctxs.get(key)
  if (!c) return
  if (c.timer) { clearInterval(c.timer); c.timer = null }
  try {
    const id = identity(c)
    if (release && id.installId && id.token && state.settings.subscriptionEnabled) await net.premiumRelease(id.installId, id.token)
  } catch {}
  c.entitlement = { active: false, at: 0, expiresAt: 0, premiumId: null }
  c.authCache = { okAt: 0 }
  if (forget && key !== 'main') {
    const db = rootDb()
    if (db.premiumByBot) delete db.premiumByBot[key]
    store.save()
    ctxs.delete(key)
  }
}

function accountsOf(manager) {
  try {
    const list = []
    const main = manager.get('main')
    if (main?.sock?.user?.id) list.push(String(main.sock.user.id).split(':')[0].split('@')[0])
    for (const c of manager.listSubs()) list.push(String(c.id).replace(/\D/g, ''))
    return list.length ? list : [config.ownerNumber]
  } catch { return [config.ownerNumber] }
}

module.exports = { gate, featureAllowed, economyRedirect, ensureInstall, refreshPolicy, refreshEntitlement, start, startBot, stopBot, state, entry, FREE_MODE_MESSAGE }
