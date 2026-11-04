// Bot-side tests (gate, background features, economy mode redirect). Run: node tests/bot.test.js
// Uses fake network/store modules, so it needs no WhatsApp connection and writes nothing to database.json.
const assert = require('assert')
const path = require('path')
const root = path.join(__dirname, '..')
const inject = (name, exports) => { const f = require.resolve(path.join(root, name)); require.cache[f] = { id: f, filename: f, loaded: true, exports } }

const db = { premium: { installId: 'inst_x', token: 'tok' }, users: { a: { coins: 100, eco: { bank: 50 } }, b: { coins: 5 } } }
inject('store.js', { get: () => db, save() {}, set() {} })
inject('config.js', { ownerNumber: '2348000000001', currencySymbol: '$' })
const server = { policy: { ok: true, settings: {}, commands: null }, auth: { ok: true, allow: false, message: 'x' }, up: true, calls: [] }
const defaults = require(path.join(root, 'commandpolicy.default.json'))
const fullCommands = {}
for (const c of defaults.commands) fullCommands[c.name] = { t: c.defaultTier === 'PREMIUM' ? 'P' : c.defaultTier === 'RESTRICTED' ? 'R' : 'F', e: c.defaultEnabled ? 1 : 0, c: c.class }
const base = { subscriptionEnabled: false, premiumCommandsEnabled: true, economyEnabled: true, funEnabled: true, economyMode: 'LOCAL', freeModeMessage: 'Gideon Premium is currently unavailable.\nGideon is operating in Free Mode.' }
const net = {
  configured: () => true,
  policy: async () => (server.up ? { ok: true, settings: { ...base, ...server.settings }, commands: server.commands || fullCommands } : { ok: false, error: 'UNREACHABLE' }),
  registerInstall: async () => ({ ok: true, installId: 'inst_x', token: 'tok' }),
  premiumAuthorize: async (i, t, c) => { server.calls.push(c); return server.up ? server.auth : { ok: false, error: 'UNREACHABLE' } },
  premiumStatus: async () => (server.up ? { ok: true, active: !!server.active, expiresAt: Date.now() + 86400000 } : { ok: false, error: 'UNREACHABLE' })
}
inject('network.js', net)
const premium = require(path.join(root, 'premium.js'))

let passed = 0, failed = 0
const t = async (n, f) => { try { server.settings = {}; server.commands = null; server.up = true; server.active = false; server.auth = { ok: true, allow: false, message: 'blocked' }; premium.state.authCache.okAt = 0; premium.state.entitlement = { active: false, at: 0 }; await f(); passed++; console.log('  ok  ', n) } catch (e) { failed++; console.log(' FAIL ', n, '\n       ->', e.message) } }
const cmd = (name, category = 'x') => ({ name, category })
const G = async (name, category) => { await premium.refreshPolicy(true); return premium.gate(cmd(name, category)) }

;(async () => {
  await t('Free Mode: free commands (management, economy, fun) pass without contacting the server for premium', async () => { for (const n of ['lock', 'balance', 'daily', 'joke', 'gbalance']) assert.strictEqual((await G(n)).allow, true, n); assert.strictEqual(server.calls.length, 0) })
  await t('Free Mode: premium command gets the Free Mode message from the server', async () => { server.auth = { ok: true, allow: false, code: 'FREE_MODE', message: base.freeModeMessage }; const v = await G('gideonai'); assert.strictEqual(v.allow, false); assert.strictEqual(v.message, base.freeModeMessage) })
  await t('server unreachable: free commands still work, premium stays blocked with the Free Mode message', async () => { server.up = false; premium.state.policyAt = 0; assert.strictEqual((await G('daily')).allow, true); const v = await G('gideonai'); assert.strictEqual(v.allow, false); assert.match(v.message, /Free Mode/) })
  await t('Premium Mode: every premium request is checked server-side; yes -> allowed', async () => { server.settings = { subscriptionEnabled: true }; server.auth = { ok: true, allow: true }; assert.strictEqual((await G('gideonai')).allow, true); assert.ok(server.calls.includes('gideonai')) })
  await t('Premium Mode: the server saying no blocks it, with the server message', async () => { server.settings = { subscriptionEnabled: true }; server.auth = { ok: true, allow: false, code: 'EXPIRED', message: 'Your Gideon Premium has expired.' }; const v = await G('anticall'); assert.strictEqual(v.allow, false); assert.match(v.message, /expired/) })
  await t('client cannot grant itself premium: nothing in local state makes a premium command pass without a server yes', async () => { server.settings = { subscriptionEnabled: true }; db.premium.active = true; db.premium.premium = true; premium.state.entitlement = { active: true, at: Date.now() }; assert.strictEqual((await G('gideonai')).allow, false) })
  await t('short-lived grace: a recent server "yes" survives a brief outage, a cold start does not', async () => { server.settings = { subscriptionEnabled: true }; server.auth = { ok: true, allow: true }; await G('gideonai'); server.up = false; premium.state.authCache.okAt = Date.now() - 2 * 60 * 1000; assert.strictEqual((await G('gideonai')).allow, true); premium.state.authCache.okAt = 0; assert.strictEqual((await G('gideonai')).allow, false) })
  await t('restricted commands (vv, vv2, antidelete) are blocked in every mode', async () => { server.settings = { subscriptionEnabled: true }; server.auth = { ok: true, allow: true }; for (const n of ['vv', 'vv2', 'antidelete']) { const v = await G(n); assert.strictEqual(v.allow, false, n); assert.match(v.message, /platform policy/) } })
  await t('admin-disabled command is blocked', async () => { server.commands = { ...fullCommands, joke: { t: 'F', e: 0, c: 'fun' } }; assert.match((await G('joke')).message, /disabled/) })
  await t('Economy switch OFF blocks only economy commands (also with subscriptions OFF)', async () => { server.settings = { economyEnabled: false }; assert.strictEqual((await G('balance')).allow, false); assert.strictEqual((await G('gbalance')).allow, false); assert.strictEqual((await G('joke')).allow, true); assert.strictEqual((await G('lock')).allow, true) })
  await t('Fun switch OFF blocks only fun commands', async () => { server.settings = { funEnabled: false }; assert.strictEqual((await G('joke')).allow, false); assert.strictEqual((await G('balance')).allow, true) })
  await t('economy keeps working with subscriptions ON/OFF and Paystack ON/OFF', async () => { for (const s of [{}, { subscriptionEnabled: true }, { paystackEnabled: true }, { subscriptionEnabled: true, paystackEnabled: true }]) { server.settings = s; assert.strictEqual((await G('daily')).allow, true); assert.strictEqual((await G('gdaily')).allow, true) } })
  await t('Command Manager override: a command made PREMIUM on the server is checked; one made FREE is not', async () => { server.settings = { subscriptionEnabled: true }; server.commands = { ...fullCommands, lock: { t: 'P', e: 1, c: 'management' }, gideonai: { t: 'F', e: 1, c: 'advanced' } }; server.calls = []; await G('lock'); assert.deepStrictEqual(server.calls, ['lock']); server.calls = []; assert.strictEqual((await G('gideonai')).allow, true); assert.deepStrictEqual(server.calls, []) })
  await t('background features: premium ones stay OFF in Free Mode, free ones stay on', async () => { await premium.refreshPolicy(true); for (const f of ['autostatus', 'statusreact', 'autosavestatus', 'anticall', 'autobio', 'autoreply']) assert.strictEqual(premium.featureAllowed(f), false, f); assert.strictEqual(premium.featureAllowed('autoread'), true); assert.strictEqual(premium.featureAllowed('antidelete'), false) })
  await t('background features turn on only with Premium Mode + a server-confirmed active subscription', async () => { server.settings = { subscriptionEnabled: true }; server.active = true; await premium.refreshPolicy(true); await premium.refreshEntitlement(true); assert.strictEqual(premium.featureAllowed('anticall'), true); assert.strictEqual(premium.featureAllowed('antidelete'), false, 'restricted never turns on'); server.settings = { subscriptionEnabled: true, premiumCommandsEnabled: false }; await premium.refreshPolicy(true); assert.strictEqual(premium.featureAllowed('anticall'), false) })
  await t('expired entitlement switches background features off', async () => { server.settings = { subscriptionEnabled: true }; await premium.refreshPolicy(true); premium.state.entitlement = { active: true, at: Date.now(), expiresAt: Date.now() - 1000 }; assert.strictEqual(premium.featureAllowed('anticall'), false) })
  const local = (name) => ({ name, category: 'local economy' })
  const globalCmd = (name) => ({ name, category: 'global economy' })
  const table = { gbalance: globalCmd('gbalance'), gsend: globalCmd('gsend'), grichest: globalCmd('grichest'), gcoinflip: globalCmd('gcoinflip'), gdaily: globalCmd('gdaily') }
  const getCommand = (n) => table[n] || null
  await t('economy mode LOCAL: local commands run as themselves', async () => { await premium.refreshPolicy(true); assert.strictEqual(premium.economyRedirect(local('balance'), getCommand), null) })
  await t('economy mode GLOBAL: local commands run their Global Network twin (including renamed ones)', async () => { server.settings = { economyMode: 'GLOBAL' }; await premium.refreshPolicy(true); assert.strictEqual(premium.economyRedirect(local('balance'), getCommand).name, 'gbalance'); assert.strictEqual(premium.economyRedirect(local('transfer'), getCommand).name, 'gsend'); assert.strictEqual(premium.economyRedirect(local('leaderboard'), getCommand).name, 'grichest'); assert.strictEqual(premium.economyRedirect(local('coinflipbet'), getCommand).name, 'gcoinflip'); assert.strictEqual(premium.economyRedirect(local('donate'), getCommand), null, 'no twin: stays local'); assert.strictEqual(premium.economyRedirect(globalCmd('gbalance'), getCommand), null); assert.strictEqual(premium.economyRedirect({ name: 'joke', category: 'fun' }, getCommand), null) })
  console.log(`\nbot tests: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})()
