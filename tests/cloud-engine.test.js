// Engine hooks used by GIDEON CLOUD (bot.js manager.cloud) with a fake Baileys: no WhatsApp connection. Run: node tests/cloud-engine.test.js
const ROOT = require('path').join(__dirname, '..'); process.chdir(ROOT)
require(require('path').join(ROOT, 'tests/stub-missing-modules.js'))
const assert = require('assert')
require.cache['@hapi/boom'] = 1; const Mod = require('module'); const _l = Mod._load; Mod._load = function (r, ...a) { return r === '@hapi/boom' ? { Boom: class { constructor(e) { this.output = e && e.output } } } : _l.call(this, r, ...a) }
const baileys = require(require('path').join(ROOT, 'baileys'))
// fake Baileys: a socket that reports 'open' (online) for creds with me, never touches the network
const EventEmitter = require('events')
baileys.load = async () => {
  const B = {
    useMultiFileAuthState: async (dir) => ({ state: { creds: JSON.parse(require('fs').readFileSync(dir + '/creds.json', 'utf8')), keys: {} }, saveCreds() {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }), makeCacheableSignalKeyStore: (k) => k, Browsers: { ubuntu: () => ['u'] },
    DisconnectReason: { loggedOut: 401, connectionReplaced: 440, restartRequired: 515 }, jidNormalizedUser: (j) => j,
    makeWASocket: (o) => { const ev = new EventEmitter(); ev.removeAllListeners = EventEmitter.prototype.removeAllListeners.bind(ev); const sock = { ev, authState: { creds: o.auth.creds }, user: { id: '2348012345678:1@s.whatsapp.net' }, sendMessage: async () => ({}), groupMetadata: async () => ({}), end() {}, logout: async () => { sock.loggedOut = true }, sendPresenceUpdate: async () => {}, newsletterMetadata: async () => { throw new Error('x') }, readMessages: async () => {} }; global.__lastSock = sock; setTimeout(() => ev.emit('connection.update', { connection: 'open' }), 20); return sock }
  }
  baileys.get = () => B; return B
}
const { manager } = require(require('path').join(ROOT, 'bot'))
;(async () => {
  const dir = require('fs').mkdtempSync(require('os').tmpdir() + '/eng-'); require('fs').writeFileSync(dir + '/creds.json', JSON.stringify({ me: { id: '2348012345678:1@s.whatsapp.net' } }))
  const ctl = await manager.cloud.open('cb_aaaaaaaaaaaa', dir)
  assert.strictEqual(ctl.status, 'connecting'); await new Promise((r) => setTimeout(r, 120))
  assert.strictEqual(ctl.status, 'online'); assert(ctl.openedAt > 0); assert(ctl.logs.some((l) => l.includes('confirmed')))
  assert.strictEqual(manager.listSubs().length, 0, 'cloud bots hidden from .pair lists')
  assert.strictEqual(await manager.remove('cb_aaaaaaaaaaaa'), false, '.unpair cannot touch cloud bots')
  // logged-out: the hook is called so cloud.js can delete the saved session, and the bot is forgotten
  let hooked = null; manager.cloud.onLoggedOut = (id) => { hooked = id; require('fs').rmSync(dir, { recursive: true, force: true }) }
  global.__lastSock.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } }); await new Promise((r) => setTimeout(r, 80))
  assert.strictEqual(hooked, 'cb_aaaaaaaaaaaa'); assert(!require('fs').existsSync(dir + '/creds.json')); assert.strictEqual(manager.get('cb_aaaaaaaaaaaa'), undefined)
  manager.cloud.onLoggedOut = null; require('fs').mkdirSync(dir, { recursive: true }); require('fs').writeFileSync(dir + '/creds.json', JSON.stringify({ me: { id: '2348012345678:1@s.whatsapp.net' } }))
  // restart creates a fresh connection
  const c2 = await manager.cloud.open('cb_aaaaaaaaaaaa', dir); await new Promise((r) => setTimeout(r, 120)); assert.strictEqual(c2.status, 'online'); assert(c2 !== ctl)
  await manager.cloud.stop('cb_aaaaaaaaaaaa'); assert.strictEqual(manager.get('cb_aaaaaaaaaaaa').status, 'offline')
  await manager.cloud.close('cb_aaaaaaaaaaaa'); assert(true); assert.strictEqual(manager.get('cb_aaaaaaaaaaaa'), undefined)
  console.log('engine cloud hooks OK'); process.exit(0)
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
