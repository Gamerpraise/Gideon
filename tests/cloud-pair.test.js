// A Cloud bot is the MAIN bot of its owner: it can .pair up to config.cloud.maxPairedPerBot people, sees only its own,
// and they vanish with it. Fake Baileys, no network. Run: node tests/cloud-pair.test.js
const ROOT = require('path').join(__dirname, '..'); process.chdir(ROOT)
require(require('path').join(ROOT, 'tests/stub-missing-modules.js'))
const fs = require('fs'), assert = require('assert'), EventEmitter = require('events')
const Mod = require('module'); const _l = Mod._load; Mod._load = function (r, ...a) { return r === '@hapi/boom' ? { Boom: class { constructor(e) { this.output = e && e.output } } } : _l.call(this, r, ...a) }
const baileys = require(require('path').join(ROOT, 'baileys'))
baileys.load = async () => {
  const B = {
    useMultiFileAuthState: async (dir) => { const f = dir + '/creds.json'; const creds = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { registered: false }; return { state: { creds, keys: {} }, saveCreds() {} } },
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }), makeCacheableSignalKeyStore: (k) => k, Browsers: { ubuntu: () => ['u'] },
    DisconnectReason: { loggedOut: 401, connectionReplaced: 440, restartRequired: 515 }, jidNormalizedUser: (j) => j,
    makeWASocket: (o) => { const ev = new EventEmitter(); ev.removeAllListeners = EventEmitter.prototype.removeAllListeners.bind(ev); const reg = o.auth.creds.registered !== false
      const sock = { ev, authState: { creds: o.auth.creds }, user: reg ? { id: '2348012345678:1@s.whatsapp.net' } : undefined, sendMessage: async () => ({}), groupMetadata: async () => ({}), end() {}, logout: async () => {}, requestPairingCode: async () => 'ABCD1234', sendPresenceUpdate: async () => {}, newsletterMetadata: async () => { throw new Error('x') }, readMessages: async () => {} }
      if (reg) setTimeout(() => ev.emit('connection.update', { connection: 'open' }), 20); return sock }
  }
  baileys.get = () => B; return B
}
const config = require(require('path').join(ROOT, 'config')); config.cloud.maxPairedPerBot = 3
const { manager } = require(require('path').join(ROOT, 'bot'))
const reject = async (p, re) => { try { await p } catch (e) { assert(re.test(e.message), e.message); return } assert.fail('should have been rejected') }
;(async () => {
  const mk = (id) => { const d = fs.mkdtempSync(require('os').tmpdir() + '/cp-'); fs.writeFileSync(d + '/creds.json', JSON.stringify({ me: { id: '2348012345678:1@s.whatsapp.net' } })); return d }
  const dirA = mk(), dirB = mk()
  const a = await manager.cloud.open('cb_aaaaaaaaaaaa', dirA); await manager.cloud.open('cb_bbbbbbbbbbbb', dirB)
  assert.strictEqual(a.sock === null || a.cloud, true)
  const numbers = ['2348011111111', '2348022222222', '2348033333333', '2348044444444']
  for (const n of numbers.slice(0, 3)) { const r = await manager.pair(n, { parent: 'cb_aaaaaaaaaaaa' }); assert.strictEqual(r.code, 'ABCD1234') }
  assert.strictEqual(manager.listChildren('cb_aaaaaaaaaaaa').length, 3)
  await reject(manager.pair(numbers[3], { parent: 'cb_aaaaaaaaaaaa' }), /up to 3/)          // limit of 3 per Cloud bot
  assert.strictEqual(manager.listChildren('cb_bbbbbbbbbbbb').length, 0)                      // each bot sees only its own
  assert.strictEqual(manager.listSubs().length, 0)                                          // and they never use the host's pair slots
  await manager.pair(numbers[3], { parent: 'cb_bbbbbbbbbbbb' })                              // another Cloud bot has its own 3
  assert.strictEqual(JSON.parse(fs.readFileSync(`${ROOT}/sessions/${numbers[0]}/parent.json`, 'utf8')).parent, 'cb_aaaaaaaaaaaa')
  assert.strictEqual(manager.get(numbers[0]).parent, 'cb_aaaaaaaaaaaa')
  await manager.cloud.close('cb_aaaaaaaaaaaa')                                              // deleting the bot removes the people it paired
  assert.strictEqual(manager.listChildren('cb_aaaaaaaaaaaa').length, 0); assert(!fs.existsSync(`${ROOT}/sessions/${numbers[0]}`))
  assert.strictEqual(manager.listChildren('cb_bbbbbbbbbbbb').length, 1)
  await manager.cloud.close('cb_bbbbbbbbbbbb'); fs.rmSync(`${ROOT}/sessions`, { recursive: true, force: true })
  console.log('cloud pair OK'); process.exit(0)
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
